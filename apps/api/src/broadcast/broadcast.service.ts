import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal, Role } from "../auth/auth.types.js";
import { isRole } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { UserService, type Collaborator } from "../users/user.service.js";
import { LocalBroadcastPublisher } from "./broadcast.publisher.js";

export type BroadcastState = "DRAFT" | "CANCELLED" | "CONFIRMED";
export interface BroadcastAudience { campusIds?: string[]; teamIds?: string[]; roles?: string[]; explicitRecipientIds?: string[] }
export interface CreateBroadcast { title?: string; content?: string; internalLink?: string; audience?: BroadcastAudience; clientRequestId?: string }
export interface BroadcastView { id: string; title: string; content: string; internalLink?: string; authorId: string; state: BroadcastState; version: number; recipientCount: number; createdAt: string; confirmedAt?: string; cancelledAt?: string; correctionOf?: string }
interface StoredBroadcast extends BroadcastView { audience: Required<BroadcastAudience>; recipientIds: readonly string[] }

const IDENTIFIER = /^[a-zA-Z0-9_-]{2,64}$/;
const REQUEST_ID = /^[a-zA-Z0-9:_-]{8,128}$/;
const INTERNAL_LINK = /^\/(?:leads|chat|notifications)(?:\/[a-zA-Z0-9-]+)*$/;

@Injectable()
export class BroadcastService {
  private readonly broadcasts = new Map<string, Readonly<StoredBroadcast>>();
  private readonly requests = new Map<string, string>();

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(LocalBroadcastPublisher) private readonly publisher: LocalBroadcastPublisher,
  ) {}

  create(principal: Principal, input: CreateBroadcast, correlationId: string): BroadcastView {
    this.assertAuthor(principal);
    const title = input.title?.trim() ?? "";
    const content = input.content?.trim() ?? "";
    const requestId = input.clientRequestId?.trim() ?? "";
    if (title.length < 3 || title.length > 120 || content.length < 3 || content.length > 4000 || !REQUEST_ID.test(requestId)) throw new BadRequestException({ code: "broadcast_content_invalid" });
    if (input.internalLink && !INTERNAL_LINK.test(input.internalLink)) throw new BadRequestException({ code: "broadcast_link_invalid" });
    const audience = this.normalizeAudience(input.audience);
    this.resolveAudience(principal, audience);
    const known = this.requests.get(`${principal.userId}:${requestId}`);
    if (known) return this.view(this.broadcasts.get(known)!);
    const now = new Date().toISOString();
    const record: Readonly<StoredBroadcast> = Object.freeze({ id: randomUUID(), title, content, ...(input.internalLink ? { internalLink: input.internalLink } : {}), authorId: principal.userId, audience, state: "DRAFT", version: 1, recipientCount: 0, recipientIds: Object.freeze([]), createdAt: now });
    this.broadcasts.set(record.id, record); this.requests.set(`${principal.userId}:${requestId}`, record.id);
    this.audit.record({ eventType: "BROADCAST_DRAFT_CREATED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { broadcastId: record.id, state: record.state, audienceCriteriaCount: this.criteriaCount(audience) }, result: "SUCCESS", idempotencyKey: `broadcast-draft:${record.id}` });
    return this.view(record);
  }

  preview(id: string, principal: Principal): { broadcastId: string; version: number; recipientCount: number; mutated: false } {
    const record = this.ownedDraft(id, principal);
    const recipientCount = this.resolveAudience(principal, record.audience).length;
    return { broadcastId: id, version: record.version, recipientCount, mutated: false };
  }

  confirm(id: string, principal: Principal, input: { confirmed?: boolean; expectedVersion?: number; expectedRecipientCount?: number; idempotencyKey?: string }, correlationId: string): BroadcastView {
    this.assertAuthor(principal);
    const current = this.broadcasts.get(id);
    if (!current || current.authorId !== principal.userId) throw new NotFoundException({ code: "broadcast_not_found" });
    if (current.state === "CONFIRMED") {
      if (input.idempotencyKey && this.requests.get(`confirm:${input.idempotencyKey}`) === id) return this.view(current);
      throw new ConflictException({ code: "broadcast_already_confirmed" });
    }
    if (current.state !== "DRAFT" || input.confirmed !== true || input.expectedVersion !== current.version || !input.idempotencyKey || !REQUEST_ID.test(input.idempotencyKey)) throw new ConflictException({ code: "broadcast_confirmation_invalid" });
    const recipientIds = this.resolveAudience(principal, current.audience).map((user) => user.id).sort();
    if (recipientIds.length !== input.expectedRecipientCount) throw new ConflictException({ code: "broadcast_audience_changed" });
    const confirmed: Readonly<StoredBroadcast> = Object.freeze({ ...current, state: "CONFIRMED", version: current.version + 1, recipientCount: recipientIds.length, recipientIds: Object.freeze(recipientIds), confirmedAt: new Date().toISOString() });
    this.broadcasts.set(id, confirmed); this.requests.set(`confirm:${input.idempotencyKey}`, id);
    const delivery = this.publisher.publish({ broadcastId: id, recipientIds });
    this.audit.record({ eventType: "BROADCAST_CONFIRMED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { broadcastId: id, recipientCount: delivery.delivered, snapshotFrozen: true }, result: "SUCCESS", idempotencyKey: `broadcast-confirm:${id}` });
    return this.view(confirmed);
  }

  cancel(id: string, principal: Principal, input: { reason?: string; expectedVersion?: number }, correlationId: string): BroadcastView {
    const current = this.ownedDraft(id, principal);
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3 || reason.length > 500 || input.expectedVersion !== current.version) throw new BadRequestException({ code: "broadcast_cancellation_invalid" });
    const cancelled: Readonly<StoredBroadcast> = Object.freeze({ ...current, state: "CANCELLED", version: current.version + 1, cancelledAt: new Date().toISOString() });
    this.broadcasts.set(id, cancelled);
    this.audit.record({ eventType: "BROADCAST_CANCELLED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { broadcastId: id, reasonCode: "AUTHOR_CANCELLED" }, result: "SUCCESS", idempotencyKey: `broadcast-cancel:${id}` });
    return this.view(cancelled);
  }

  correct(id: string, principal: Principal, input: { title?: string; content?: string; reason?: string; clientRequestId?: string }, correlationId: string): BroadcastView {
    this.assertAuthor(principal);
    const original = this.broadcasts.get(id);
    if (!original || original.state !== "CONFIRMED" || (!this.isAdmin(principal) && original.authorId !== principal.userId)) throw new NotFoundException({ code: "broadcast_not_found" });
    const reason = input.reason?.trim() ?? "";
    const title = input.title?.trim() ?? "";
    const content = input.content?.trim() ?? "";
    const requestId = input.clientRequestId?.trim() ?? "";
    if (reason.length < 3 || reason.length > 500 || title.length < 3 || title.length > 120 || content.length < 3 || content.length > 4000 || !REQUEST_ID.test(requestId)) throw new BadRequestException({ code: "broadcast_correction_invalid" });
    const known = this.requests.get(`correction:${id}:${requestId}`);
    if (known) return this.view(this.broadcasts.get(known)!);
    const correction: Readonly<StoredBroadcast> = Object.freeze({ id: randomUUID(), title, content, authorId: principal.userId, audience: original.audience, state: "CONFIRMED", version: 1, recipientCount: original.recipientCount, recipientIds: original.recipientIds, createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(), correctionOf: id });
    this.broadcasts.set(correction.id, correction); this.requests.set(`correction:${id}:${requestId}`, correction.id);
    this.publisher.publish({ broadcastId: correction.id, recipientIds: original.recipientIds, correctionOf: id });
    this.audit.record({ eventType: "BROADCAST_CORRECTION_EMITTED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { broadcastId: correction.id, correctionOf: id, recipientCount: correction.recipientCount, reasonProvided: true }, result: "SUCCESS", idempotencyKey: `broadcast-correction:${correction.id}` });
    return this.view(correction);
  }

  list(principal: Principal, page: number, pageSize: number): { items: BroadcastView[]; page: number; pageSize: number; total: number } {
    this.assertAuthor(principal);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException({ code: "broadcast_pagination_invalid" });
    const visible = [...this.broadcasts.values()].filter((item) => principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN") || item.authorId === principal.userId).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return { items: visible.slice((page - 1) * pageSize, page * pageSize).map((item) => this.view(item)), page, pageSize, total: visible.length };
  }

  recipientSnapshot(id: string, principal: Principal): { broadcastId: string; recipientIds: string[] } {
    if (!principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "broadcast_recipients_forbidden" });
    const record = this.broadcasts.get(id);
    if (!record) throw new NotFoundException({ code: "broadcast_not_found" });
    return { broadcastId: id, recipientIds: [...record.recipientIds] };
  }

  private ownedDraft(id: string, principal: Principal): Readonly<StoredBroadcast> {
    this.assertAuthor(principal);
    const record = this.broadcasts.get(id);
    if (!record || record.authorId !== principal.userId) throw new NotFoundException({ code: "broadcast_not_found" });
    if (record.state !== "DRAFT") throw new ConflictException({ code: "broadcast_immutable" });
    return record;
  }

  private normalizeAudience(input?: BroadcastAudience): Required<BroadcastAudience> {
    const audience = { campusIds: [...new Set(input?.campusIds ?? [])].sort(), teamIds: [...new Set(input?.teamIds ?? [])].sort(), roles: [...new Set(input?.roles ?? [])].sort(), explicitRecipientIds: [...new Set(input?.explicitRecipientIds ?? [])].sort() };
    if (this.criteriaCount(audience) === 0) throw new BadRequestException({ code: "broadcast_audience_empty" });
    if (![...audience.campusIds, ...audience.teamIds, ...audience.explicitRecipientIds].every((value) => IDENTIFIER.test(value)) || !audience.roles.every(isRole)) throw new BadRequestException({ code: "broadcast_audience_invalid" });
    return audience;
  }

  private resolveAudience(principal: Principal, audience: Required<BroadcastAudience>): Collaborator[] {
    this.assertAudienceScope(principal, audience);
    const users = this.users.list({ active: true }).filter((user) =>
      (audience.campusIds.length === 0 || (user.campusId !== undefined && audience.campusIds.includes(user.campusId))) &&
      (audience.teamIds.length === 0 || (user.teamId !== undefined && audience.teamIds.includes(user.teamId))) &&
      (audience.roles.length === 0 || user.roles.some((role) => audience.roles.includes(role))) &&
      (audience.explicitRecipientIds.length === 0 || audience.explicitRecipientIds.includes(user.id)) && this.userInScope(principal, user));
    if (users.length === 0) throw new BadRequestException({ code: "broadcast_audience_empty" });
    if (audience.explicitRecipientIds.some((id) => !users.some((user) => user.id === id))) throw new ForbiddenException({ code: "broadcast_audience_out_of_scope" });
    return users;
  }

  private assertAudienceScope(principal: Principal, audience: Required<BroadcastAudience>): void {
    if (this.isAdmin(principal)) return;
    if (!principal.roles.includes("MANAGER") || audience.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "broadcast_audience_out_of_scope" });
    const global = principal.scopes.some((scope) => scope.kind === "GLOBAL");
    if (!global && (audience.campusIds.some((id) => !principal.scopes.some((scope) => scope.kind === "CAMPUS" && scope.id === id)) || audience.teamIds.some((id) => !principal.scopes.some((scope) => scope.kind === "TEAM" && scope.id === id)))) throw new ForbiddenException({ code: "broadcast_audience_out_of_scope" });
  }

  private userInScope(principal: Principal, user: Collaborator): boolean {
    if (this.isAdmin(principal) || principal.scopes.some((scope) => scope.kind === "GLOBAL")) return true;
    return principal.scopes.some((scope) => (scope.kind === "CAMPUS" && scope.id === user.campusId) || (scope.kind === "TEAM" && scope.id === user.teamId));
  }

  private assertAuthor(principal: Principal): void { if (!principal.roles.some((role: Role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "broadcast_author_forbidden" }); }
  private isAdmin(principal: Principal): boolean { return principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN"); }
  private criteriaCount(audience: Required<BroadcastAudience>): number { return audience.campusIds.length + audience.teamIds.length + audience.roles.length + audience.explicitRecipientIds.length; }
  private view(record: Readonly<StoredBroadcast>): BroadcastView {
    return { id: record.id, title: record.title, content: record.content, ...(record.internalLink ? { internalLink: record.internalLink } : {}), authorId: record.authorId, state: record.state, version: record.version, recipientCount: record.recipientCount, createdAt: record.createdAt, ...(record.confirmedAt ? { confirmedAt: record.confirmedAt } : {}), ...(record.cancelledAt ? { cancelledAt: record.cancelledAt } : {}), ...(record.correctionOf ? { correctionOf: record.correctionOf } : {}) };
  }
}
