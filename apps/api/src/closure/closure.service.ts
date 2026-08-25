import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadStatus } from "../leads/lead.service.js";
import { LeadWorkflowPersistenceRepository } from "../leads/lead-workflow-persistence.repository.js";
import { NotificationService } from "../notifications/notification.service.js";

export type ClosureState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type ClosureTarget = "ENROLLED" | "CLOSED_LOST";
export const closureReasons = { ENROLLED: ["ADMISSION_CONFIRMED", "REGISTRATION_COMPLETE"], CLOSED_LOST: ["NOT_INTERESTED", "UNREACHABLE", "OTHER_PROGRAM"] } as const;
export interface ClosureRequest { id: string; leadId: string; target: ClosureTarget; reason: string; comment: string; evidence: string[]; requesterId: string; state: ClosureState; version: number; createdAt: string; decidedAt?: string; decidedBy?: string; decisionReason?: string }

@Injectable()
export class ClosureService implements OnModuleInit {
  private readonly requests = new Map<string, Readonly<ClosureRequest>>();
  constructor(
    private readonly leads: LeadService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    @Optional() @Inject(LeadWorkflowPersistenceRepository) private readonly persistence?: LeadWorkflowPersistenceRepository,
  ) {}

  async onModuleInit(): Promise<void> { await this.refreshPersistentState(); }
  persistenceEnabled(): boolean { return this.persistence?.enabled === true; }

  async requestForApi(leadId: string, input: { target?: string; reason?: string; comment?: string; evidence?: string[] }, principal: Principal, correlationId: string): Promise<ClosureRequest> {
    if (!this.persistence?.enabled) return this.request(leadId, input, principal, correlationId);
    await this.refreshPersistentState();
    const record = this.request(leadId, input, principal, correlationId);
    const stored = await this.persistence.saveClosure(record);
    await this.refreshPersistentState(); return stored;
  }

  async decideForApi(id: string, input: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): Promise<ClosureRequest> {
    if (!this.persistence?.enabled) return this.decide(id, input, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.requests.get(id); if (!current) throw new NotFoundException({ code: "closure_request_not_found" });
    const updated = await this.leads.persistWorkflowMutationForApi(
      current.leadId, `closure-decision:${id}:${input.expectedVersion ?? "missing"}`, "CLOSURE_DECISION", input,
      () => this.decide(id, input, principal, correlationId),
    );
    const stored = await this.persistence.saveClosure(updated, current.version);
    await this.refreshPersistentState(); return stored;
  }

  async cancelForApi(id: string, principal: Principal, correlationId: string): Promise<ClosureRequest> {
    if (!this.persistence?.enabled) return this.cancel(id, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.requests.get(id); if (!current) throw new NotFoundException({ code: "closure_request_not_found" });
    const updated = this.cancel(id, principal, correlationId);
    const stored = await this.persistence.saveClosure(updated, current.version);
    await this.refreshPersistentState(); return stored;
  }

  async listForApi(principal: Principal): Promise<ClosureRequest[]> { await this.refreshPersistentState(); return this.list(principal); }

  request(leadId: string, input: { target?: string; reason?: string; comment?: string; evidence?: string[] }, principal: Principal, correlationId: string): ClosureRequest {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "closure_request_forbidden" }); }
    const lead = this.leads.getLead(leadId, principal, correlationId); const target = input.target as ClosureTarget; const comment = input.comment?.trim(); const evidence = input.evidence?.map((value) => value.trim()).filter(Boolean) ?? [];
    if (!["ENROLLED", "CLOSED_LOST"].includes(target) || !closureReasons[target]?.includes(input.reason as never) || !comment || comment.length > 1000 || evidence.length === 0 || evidence.length > 10) { throw new BadRequestException({ code: "closure_request_invalid" }); }
    const validSource = target === "ENROLLED" ? lead.status === "QUALIFIED" : (["CONTACTED", "QUALIFIED"] as LeadStatus[]).includes(lead.status);
    if (!validSource) { throw new BadRequestException({ code: "closure_source_status_invalid" }); }
    if ([...this.requests.values()].some((item) => item.leadId === leadId && item.state === "PENDING")) { throw new ConflictException({ code: "closure_pending" }); }
    const record: Readonly<ClosureRequest> = Object.freeze({ id: randomUUID(), leadId, target, reason: input.reason!, comment, evidence: [...evidence], requesterId: principal.userId, state: "PENDING", version: 1, createdAt: new Date().toISOString() });
    this.requests.set(record.id, record); this.notifications.create({ recipientId: "manager-queue", type: "CLOSURE_REQUEST", priority: "HIGH", resourceType: "LEAD", resourceId: leadId, href: `/leads/${leadId}/closure` }, `closure-request:${record.id}`); this.record(record, principal, correlationId, "CLOSURE_REQUESTED"); return this.copy(record);
  }

  decide(id: string, input: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): ClosureRequest {
    const current = this.requests.get(id);
    if (!current) { throw new NotFoundException({ code: "closure_request_not_found" }); }
    if (current.requesterId === principal.userId) { throw new ForbiddenException({ code: "closure_self_approval_forbidden" }); }
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "closure_approval_forbidden" }); }
    if (current.state !== "PENDING" || input.expectedVersion !== current.version) { throw new ConflictException({ code: "closure_concurrent_decision" }); }
    const reason = input.reason?.trim(); if (!input.decision || !reason) { throw new BadRequestException({ code: "closure_decision_invalid" }); }
    if (input.decision === "APPROVE") { this.leads.changeStatus(current.leadId, { status: current.target, reason: current.reason }, principal, correlationId); }
    const updated: Readonly<ClosureRequest> = Object.freeze({ ...current, state: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", version: current.version + 1, decidedAt: new Date().toISOString(), decidedBy: principal.userId, decisionReason: reason });
    this.requests.set(id, updated); this.notifications.create({ recipientId: current.requesterId, type: "CLOSURE_REQUEST", priority: "HIGH", resourceType: "LEAD", resourceId: current.leadId, href: `/leads/${current.leadId}/closure` }, `closure-decision:${id}`); this.record(updated, principal, correlationId, `CLOSURE_${updated.state}`); return this.copy(updated);
  }

  cancel(id: string, principal: Principal, correlationId: string): ClosureRequest {
    const current = this.requests.get(id);
    if (!current) { throw new NotFoundException({ code: "closure_request_not_found" }); }
    if (current.requesterId !== principal.userId) { throw new ForbiddenException({ code: "closure_cancel_forbidden" }); }
    if (current.state !== "PENDING") { throw new ConflictException({ code: "closure_concurrent_decision" }); }
    const updated: Readonly<ClosureRequest> = Object.freeze({ ...current, state: "CANCELLED", version: current.version + 1, decidedAt: new Date().toISOString(), decidedBy: principal.userId, decisionReason: "REQUESTER_CANCELLED" });
    this.requests.set(id, updated); this.record(updated, principal, correlationId, "CLOSURE_CANCELLED"); return this.copy(updated);
  }

  list(principal: Principal): ClosureRequest[] { const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN"); return [...this.requests.values()].filter((item) => manager || item.requesterId === principal.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((item) => this.copy(item)); }
  private copy(item: Readonly<ClosureRequest>): ClosureRequest { return { ...item, evidence: [...item.evidence] }; }
  private record(item: Readonly<ClosureRequest>, principal: Principal, correlationId: string, eventType: string): void { this.audit.record({ eventType, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { requestId: item.id, leadId: item.leadId, target: item.target, state: item.state, version: item.version, evidenceCount: item.evidence.length }, result: "SUCCESS", idempotencyKey: `${eventType}:${item.id}:${item.version}` }); }
  private async refreshPersistentState(): Promise<void> { if (!this.persistence?.enabled) return; const snapshot = await this.persistence.snapshot(); this.requests.clear(); for (const item of snapshot.closures) this.requests.set(item.id, Object.freeze({ ...item, evidence: [...item.evidence] })); }
}
