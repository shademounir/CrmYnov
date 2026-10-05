import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { LeadWorkflowPersistenceRepository } from "../leads/lead-workflow-persistence.repository.js";
import { AssignmentService } from "./assignment.service.js";
import { PersistentAssignmentService } from "./persistent-assignment.service.js";
import { appendReassignmentEffect, assertReassignmentIntent, boundedReassignmentResults, decisionFingerprint, reassignmentCampusKeys, reassignmentQueueScanLimit, reassignmentRecord, transferScheduledFollowUps } from "./reassignment-persistence.js";
import { strictBody } from "../references/reference.contract.js";
import { assignmentNotification } from "./assignment-notifications.js";

export type ReassignmentStatus = "PENDING" | "APPROVED" | "REJECTED";
export interface ReassignmentRequest {
  id: string; leadId: string; currentOwnerId: string; targetUserId: string; reason: string; moveOpenTasks: boolean;
  requestedBy: string; status: ReassignmentStatus; requestedAt: string; decidedBy?: string; decidedAt?: string; decisionReason?: string;
  version?: number; canDecide?: boolean; leadCode?: string; currentOwnerLabel?: string; targetUserLabel?: string; requesterLabel?: string; transferredFollowUpCount?: number;
}
export interface CreateReassignmentInput { targetUserId: string; reason: string; moveOpenTasks: boolean; idempotencyKey: string }
export interface DecideReassignmentInput { approved: boolean; reason: string; expectedVersion?: number; idempotencyKey?: string }

const IDEMPOTENCY_KEY = /^[a-zA-Z0-9:_-]{8,128}$/;

@Injectable()
export class ReassignmentService implements OnModuleInit {
  private readonly requests = new Map<string, Readonly<ReassignmentRequest>>();
  private readonly idempotency = new Map<string, string>();
  private readonly decisions = new Map<string, string>();
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(AssignmentService) private readonly engine: AssignmentService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(LeadWorkflowPersistenceRepository) private readonly persistence?: LeadWorkflowPersistenceRepository,
    @Optional() @Inject(PersistentAssignmentService) private readonly campusAssignments?: PersistentAssignmentService,
  ) {}

  async onModuleInit(): Promise<void> { await this.refreshPersistentState(); }
  persistenceEnabled(): boolean { return this.persistence?.enabled === true; }
  async refreshReportingForApi(): Promise<void> { await this.refreshPersistentState(); }

  async requestForApi(leadId: string, input: CreateReassignmentInput, principal: Principal, correlationId: string): Promise<ReassignmentRequest> {
    if (!this.persistence?.enabled) return this.request(leadId, input, principal, correlationId);
    if (!this.campusAssignments) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    this.validateRequest(input);
    return this.campusAssignments.withReassignmentAccess(leadId, principal, "lead.reassign.request", async (tx, current) => {
      const replay = await tx.reassignmentRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (replay) { const record = reassignmentRecord(replay); assertReassignmentIntent(record, leadId, input, current.userId); return record; }
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
      if (!lead.assignedToId) throw new ConflictException({ code: "reassignment_current_owner_missing" });
      if (current.roles.includes("ADMISSIONS") && lead.assignedToId !== current.userId) throw new ForbiddenException({ code: "reassignment_owner_required" });
      if (lead.assignedToId === input.targetUserId) throw new BadRequestException({ code: "reassignment_target_unchanged" });
      await this.campusAssignments!.assertReassignmentTarget(tx, lead, input.targetUserId);
      if (await tx.reassignmentRequest.findFirst({ where: { leadId, status: "PENDING" } })) throw new ConflictException({ code: "reassignment_pending_exists" });
      const row = await tx.reassignmentRequest.create({ data: { leadId, currentOwnerId: lead.assignedToId, targetUserId: input.targetUserId,
        reason: input.reason.trim(), moveOpenTasks: input.moveOpenTasks, requestedBy: current.userId, idempotencyKey: input.idempotencyKey } });
      const record = reassignmentRecord(row);
      const key = `reassignment-request:${createHash("sha256").update(input.idempotencyKey).digest("hex")}`;
      const fingerprint = createHash("sha256").update(JSON.stringify({ actorId: current.userId, leadId, target: input.targetUserId, reason: input.reason.trim(), moveOpenTasks: input.moveOpenTasks })).digest("hex");
      await appendReassignmentEffect(tx, lead, record, current, correlationId, key, fingerprint, "REASSIGNMENT_REQUEST");
      for (const approverId of await this.campusAssignments!.reassignmentApprovers(tx, lead.campus, current.userId)) {
        await assignmentNotification(tx, approverId, lead.id, "ASSIGNMENT", key, "/collaborators");
      }
      return record;
    });
  }

  async decideForApi(requestId: string, input: DecideReassignmentInput, principal: Principal, correlationId: string): Promise<{ request: ReassignmentRequest; lead?: LeadRecord }> {
    if (!this.persistence?.enabled) return this.decide(requestId, input, principal, correlationId);
    if (!this.campusAssignments) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    this.validateDecision(input);
    await this.refreshPersistentState();
    const existing = this.requests.get(requestId);
    if (!existing) throw new NotFoundException({ code: "reassignment_request_not_found" });
    const result = await this.campusAssignments.withReassignmentAccess(existing.leadId, principal, "lead.reassign.approve", async (tx, current) => {
      this.assertApprover(current);
      const row = await tx.reassignmentRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (row.requestedBy === current.userId) throw new ForbiddenException({ code: "reassignment_separation_of_duties" });
      const key = `reassignment-decision:${requestId}`;
      const fingerprint = decisionFingerprint(requestId, input, current.userId);
      const replay = await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        if (replay.fingerprint !== fingerprint || replay.leadId !== row.leadId) throw new ConflictException({ code: "reassignment_idempotency_conflict" });
        return { ...reassignmentRecord(row), ...this.transferSummary(replay.result) };
      }
      if (row.status !== "PENDING") throw new ConflictException({ code: "reassignment_already_decided" });
      if (row.version !== (input.expectedVersion ?? 1)) throw new ConflictException({ code: "reassignment_version_conflict" });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: row.leadId } });
      if (lead.assignedToId !== row.currentOwnerId) throw new ConflictException({ code: "reassignment_owner_changed" });
      if (input.approved) await this.campusAssignments!.assertReassignmentTarget(tx, lead, row.targetUserId);
      const changed = await tx.reassignmentRequest.updateMany({ where: { id: row.id, status: "PENDING", version: row.version }, data: {
        status: input.approved ? "APPROVED" : "REJECTED", decidedBy: current.userId, decidedAt: new Date(), decisionReason: input.reason.trim(), version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException({ code: "reassignment_concurrent_decision" });
      const record = reassignmentRecord(await tx.reassignmentRequest.findUniqueOrThrow({ where: { id: row.id } }));
      const transferred = input.approved ? await transferScheduledFollowUps(tx, record, current, correlationId) : 0;
      const result = { ...record, transferredFollowUpCount: transferred };
      await appendReassignmentEffect(tx, lead, result, current, correlationId, key, fingerprint, "REASSIGNMENT_DECISION", transferred);
      return result;
    });
    const lead = input.approved ? await this.leads.findLocalLeadForApi(result.leadId) : undefined;
    return { request: result, ...(lead ? { lead } : {}) };
  }

  async listForLeadForApi(leadId: string, principal: Principal): Promise<ReassignmentRequest[]> {
    return this.listRequestsForApi(principal, leadId);
  }

  async listRequestsForApi(principal: Principal, leadId?: string): Promise<ReassignmentRequest[]> {
    if (!this.persistenceEnabled()) return leadId ? this.listForLead(leadId, principal) : this.pendingForManager(principal);
    if (!this.campusAssignments) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    return this.campusAssignments.withReassignmentRead(principal, async (tx, current, authorized) => {
      const manager = current.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
      if (!leadId) this.assertApprover(current);
      if (leadId && !await authorized(leadId)) throw new NotFoundException({ code: "lead_not_found" });
      // Query only in-scope requests, never all Leads. Authorization precedes
      // the result cap; the lookahead makes any incomplete scan explicit.
      const campusKeys = await reassignmentCampusKeys(tx, current.scopes);
      const rows = await tx.reassignmentRequest.findMany({ where: { ...(leadId ? { leadId } : { status: "PENDING" }),
        ...(!current.roles.includes("SUPER_ADMIN") ? { lead: { campus: { in: campusKeys } } } : {}) },
        include: { lead: true }, orderBy: leadId ? [{ requestedAt: "desc" }, { id: "desc" }] : [{ requestedAt: "asc" }, { id: "asc" }], take: reassignmentQueueScanLimit + 1 });
      return boundedReassignmentResults(rows, async (row): Promise<ReassignmentRequest | undefined> => {
        if (!await authorized(row.leadId)) return undefined;
        const lead = row.lead;
        if (!manager && lead.assignedToId !== current.userId && row.requestedBy !== current.userId) return undefined;
        const users = await tx.collaborator.findMany({ where: { id: { in: [row.currentOwnerId, row.targetUserId, row.requestedBy] } }, select: { id: true, professionalDisplayName: true } });
        const label = (id: string): string | undefined => users.find((user) => user.id === id)?.professionalDisplayName?.trim() || undefined;
        const currentOwnerLabel = label(row.currentOwnerId), targetUserLabel = label(row.targetUserId), requesterLabel = label(row.requestedBy);
        const decisionKey = `reassignment-decision:${row.id}`;
        const receipt = row.status !== "PENDING" ? await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey: decisionKey } }) : undefined;
        return { ...reassignmentRecord(row), leadCode: lead.leadCode,
          ...(currentOwnerLabel ? { currentOwnerLabel } : {}),
          ...(targetUserLabel ? { targetUserLabel } : {}),
          ...(requesterLabel ? { requesterLabel } : {}),
          ...(receipt ? this.transferSummary(receipt.result) : {}),
          canDecide: manager && row.status === "PENDING" && row.requestedBy !== current.userId && await authorized(row.leadId, "lead.reassign.approve") };
      });
    });
  }

  private transferSummary(result: unknown): { transferredFollowUpCount?: number } {
    if (!result || typeof result !== "object" || !("transferredFollowUpCount" in result)) return {};
    const count = result.transferredFollowUpCount;
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? { transferredFollowUpCount: count } : {};
  }

  request(leadId: string, input: CreateReassignmentInput, principal: Principal, correlationId: string): ReassignmentRequest {
    return this.requestValidated(leadId, input, principal, correlationId);
  }

  private requestValidated(leadId: string, input: CreateReassignmentInput, principal: Principal, correlationId: string, eligibleTarget?: string): ReassignmentRequest {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "reassignment_request_role_forbidden" });
    this.validateRequest(input);
    const replay = this.idempotency.get(input.idempotencyKey);
    if (replay) { const record = this.requests.get(replay)!; assertReassignmentIntent(record, leadId, input, principal.userId); return this.copy(record); }
    const lead = this.leads.findLocalLead(leadId); if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    if (!lead.assignedToId) throw new ConflictException({ code: "reassignment_current_owner_missing" });
    if (principal.roles.includes("ADMISSIONS") && lead.assignedToId !== principal.userId) throw new ForbiddenException({ code: "reassignment_owner_required" });
    if (lead.assignedToId === input.targetUserId) throw new BadRequestException({ code: "reassignment_target_unchanged" });
    this.assertEligibleTarget(input.targetUserId, eligibleTarget);
    if ([...this.requests.values()].some((item) => item.leadId === leadId && item.status === "PENDING")) throw new ConflictException({ code: "reassignment_pending_exists" });
    const request: Readonly<ReassignmentRequest> = Object.freeze({ id: randomUUID(), leadId, currentOwnerId: lead.assignedToId,
      targetUserId: input.targetUserId, reason: input.reason.trim(), moveOpenTasks: input.moveOpenTasks,
      requestedBy: principal.userId, status: "PENDING", requestedAt: new Date().toISOString(), version: 1 });
    this.requests.set(request.id, request); this.idempotency.set(input.idempotencyKey, request.id);
    this.leads.addActivity(leadId, { type: "REASSIGNMENT_REQUESTED", result: request.id, note: request.reason }, principal, correlationId);
    this.audit.record({ eventType: "LEAD_REASSIGNMENT_REQUESTED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { requestId: request.id, leadId, currentOwnerId: request.currentOwnerId,
        targetUserId: request.targetUserId, moveOpenTasks: request.moveOpenTasks }, result: "SUCCESS", idempotencyKey: `reassignment-request:${input.idempotencyKey}` });
    return this.copy(request);
  }

  decide(requestId: string, input: DecideReassignmentInput, principal: Principal, correlationId: string): { request: ReassignmentRequest; lead?: LeadRecord } {
    return this.decideValidated(requestId, input, principal, correlationId);
  }

  private decideValidated(requestId: string, input: DecideReassignmentInput, principal: Principal, correlationId: string, eligibleTarget?: string): { request: ReassignmentRequest; lead?: LeadRecord } {
    this.assertApprover(principal);
    this.validateDecision(input);
    const current = this.requests.get(requestId); if (!current) throw new NotFoundException({ code: "reassignment_request_not_found" });
    if (current.requestedBy === principal.userId) throw new ForbiddenException({ code: "reassignment_separation_of_duties" });
    const fingerprint = decisionFingerprint(requestId, input, principal.userId);
    if (current.status !== "PENDING") {
      if (this.decisions.get(requestId) !== fingerprint) throw new ConflictException({ code: "reassignment_idempotency_conflict" });
      const lead = input.approved ? this.leads.findLocalLead(current.leadId) : undefined;
      return { request: this.copy(current), ...(lead ? { lead } : {}) };
    }
    if ((input.expectedVersion ?? 1) !== (current.version ?? 1)) throw new ConflictException({ code: "reassignment_version_conflict" });
    let lead: LeadRecord | undefined;
    if (input.approved) {
      this.assertEligibleTarget(current.targetUserId, eligibleTarget);
      lead = this.leads.reassignLocalLead(current.leadId, current.currentOwnerId, current.targetUserId, principal, correlationId, current.reason);
    } else {
      this.leads.addActivity(current.leadId, { type: "REASSIGNMENT_REJECTED", result: requestId, note: input.reason.trim() }, principal, correlationId);
    }
    const updated: Readonly<ReassignmentRequest> = Object.freeze({ ...current, status: input.approved ? "APPROVED" : "REJECTED",
      decidedBy: principal.userId, decidedAt: new Date().toISOString(), decisionReason: input.reason.trim(), version: (current.version ?? 1) + 1 });
    this.requests.set(requestId, updated);
    this.decisions.set(requestId, fingerprint);
    this.audit.record({ eventType: input.approved ? "LEAD_REASSIGNMENT_APPROVED" : "LEAD_REASSIGNMENT_REJECTED",
      actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId,
      before: { requestId, status: "PENDING" }, after: { requestId, status: updated.status, moveOpenTasks: updated.moveOpenTasks },
      result: "SUCCESS", idempotencyKey: `reassignment-decision:${requestId}` });
    return { request: this.copy(updated), ...(lead ? { lead } : {}) };
  }

  listForLead(leadId: string, principal: Principal): ReassignmentRequest[] {
    const lead = this.leads.findLocalLead(leadId); if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
    if (!manager && lead.assignedToId !== principal.userId) throw new ForbiddenException({ code: "reassignment_owner_required" });
    return [...this.requests.values()].filter((item) => item.leadId === leadId).sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)).map((item) => this.copy(item));
  }
  pendingForManager(principal: Principal): ReassignmentRequest[] {
    this.assertApprover(principal);
    return [...this.requests.values()].filter((item) => item.status === "PENDING")
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id)).map((item) => this.copy(item));
  }
  reportingSnapshot(principal: Principal): ReassignmentRequest[] {
    const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
    if (!manager && !principal.roles.includes("ADMISSIONS")) throw new ForbiddenException({ code: "reporting_role_required" });
    return [...this.requests.values()].filter((item) => manager || item.requestedBy === principal.userId)
      .map((item) => this.copy(item));
  }
  private assertApprover(principal: Principal): void { if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "reassignment_approval_role_required" }); }
  private validateRequest(input: CreateReassignmentInput): void {
    strictBody(input, ["targetUserId", "reason", "moveOpenTasks", "idempotencyKey"]);
    if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey) || typeof input.reason !== "string"
      || input.reason.trim().length < 4 || input.reason.trim().length > 500 || typeof input.targetUserId !== "string"
      || (this.persistenceEnabled() ? !/^[a-f\d-]{36}$/iu.test(input.targetUserId)
        : !input.targetUserId.trim() || input.targetUserId.length > 128)
      || typeof input.moveOpenTasks !== "boolean") throw new BadRequestException({ code: "reassignment_request_invalid" });
  }
  private validateDecision(input: DecideReassignmentInput): void {
    strictBody(input, ["approved", "reason", "expectedVersion", "idempotencyKey"]);
    if (typeof input.approved !== "boolean" || typeof input.reason !== "string" || input.reason.trim().length < 4 || input.reason.trim().length > 500
      || input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
      || input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey))) throw new BadRequestException({ code: "reassignment_decision_invalid" });
  }
  private assertEligibleTarget(target: string, eligibleTarget?: string): void {
    if (!this.persistenceEnabled()) { this.engine.assertEligibleTarget(target); return; }
    if (!eligibleTarget || target !== eligibleTarget) throw new ConflictException({ code: "assignment_target_ineligible" });
  }
  private copy(request: Readonly<ReassignmentRequest>): ReassignmentRequest { return { ...request }; }
  private async refreshPersistentState(): Promise<void> {
    if (!this.persistence?.enabled) return;
    const snapshot = await this.persistence.snapshot();
    this.requests.clear();
    for (const item of snapshot.reassignments) this.requests.set(item.id, Object.freeze({ ...item }));
  }
}
