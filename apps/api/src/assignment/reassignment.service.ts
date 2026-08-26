import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { LeadWorkflowPersistenceRepository } from "../leads/lead-workflow-persistence.repository.js";
import { AssignmentService } from "./assignment.service.js";

export type ReassignmentStatus = "PENDING" | "APPROVED" | "REJECTED";
export interface ReassignmentRequest {
  id: string; leadId: string; currentOwnerId: string; targetUserId: string; reason: string; moveOpenTasks: boolean;
  requestedBy: string; status: ReassignmentStatus; requestedAt: string; decidedBy?: string; decidedAt?: string; decisionReason?: string;
}
export interface CreateReassignmentInput { targetUserId: string; reason: string; moveOpenTasks: boolean; idempotencyKey: string }
export interface DecideReassignmentInput { approved: boolean; reason: string }

const IDEMPOTENCY_KEY = /^[a-zA-Z0-9:_-]{8,128}$/;

@Injectable()
export class ReassignmentService implements OnModuleInit {
  private readonly requests = new Map<string, Readonly<ReassignmentRequest>>();
  private readonly idempotency = new Map<string, string>();
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(AssignmentService) private readonly engine: AssignmentService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(LeadWorkflowPersistenceRepository) private readonly persistence?: LeadWorkflowPersistenceRepository,
  ) {}

  async onModuleInit(): Promise<void> { await this.refreshPersistentState(); }
  persistenceEnabled(): boolean { return this.persistence?.enabled === true; }
  async refreshReportingForApi(): Promise<void> { await this.refreshPersistentState(); }

  async requestForApi(leadId: string, input: CreateReassignmentInput, principal: Principal, correlationId: string): Promise<ReassignmentRequest> {
    if (!this.persistence?.enabled) return this.request(leadId, input, principal, correlationId);
    const replay = await this.persistence.findReassignment(input.idempotencyKey);
    if (replay) return replay;
    await this.refreshPersistentState();
    const record = await this.leads.persistWorkflowMutationForApi(
      leadId, `reassignment-request:${input.idempotencyKey}`, "REASSIGNMENT_REQUEST", input,
      () => this.request(leadId, input, principal, correlationId),
    );
    const stored = await this.persistence.createReassignment(record, input.idempotencyKey);
    await this.refreshPersistentState();
    return stored;
  }

  async decideForApi(requestId: string, input: DecideReassignmentInput, principal: Principal, correlationId: string): Promise<{ request: ReassignmentRequest; lead?: LeadRecord }> {
    if (!this.persistence?.enabled) return this.decide(requestId, input, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.requests.get(requestId);
    if (!current) throw new NotFoundException({ code: "reassignment_request_not_found" });
    const result = await this.leads.persistWorkflowMutationForApi(
      current.leadId, `reassignment-decision:${requestId}`, "REASSIGNMENT_DECISION", input,
      () => this.decide(requestId, input, principal, correlationId),
    );
    const stored = await this.persistence.decideReassignment(result.request, 1);
    await this.refreshPersistentState();
    const lead = result.lead ? await this.leads.findLocalLeadForApi(result.lead.id) : undefined;
    return { request: stored, ...(lead ? { lead } : {}) };
  }

  async listForLeadForApi(leadId: string, principal: Principal): Promise<ReassignmentRequest[]> {
    await this.refreshPersistentState(); return this.listForLead(leadId, principal);
  }

  request(leadId: string, input: CreateReassignmentInput, principal: Principal, correlationId: string): ReassignmentRequest {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "reassignment_request_role_forbidden" });
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) || input.reason.trim().length < 4 || typeof input.moveOpenTasks !== "boolean") throw new BadRequestException({ code: "reassignment_request_invalid" });
    const replay = this.idempotency.get(input.idempotencyKey); if (replay) return this.copy(this.requests.get(replay)!);
    const lead = this.leads.findLocalLead(leadId); if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    if (!lead.assignedToId) throw new ConflictException({ code: "reassignment_current_owner_missing" });
    if (principal.roles.includes("ADMISSIONS") && lead.assignedToId !== principal.userId) throw new ForbiddenException({ code: "reassignment_owner_required" });
    if (lead.assignedToId === input.targetUserId) throw new BadRequestException({ code: "reassignment_target_unchanged" });
    this.engine.assertEligibleTarget(input.targetUserId);
    if ([...this.requests.values()].some((item) => item.leadId === leadId && item.status === "PENDING")) throw new ConflictException({ code: "reassignment_pending_exists" });
    const request: Readonly<ReassignmentRequest> = Object.freeze({ id: randomUUID(), leadId, currentOwnerId: lead.assignedToId,
      targetUserId: input.targetUserId, reason: input.reason.trim(), moveOpenTasks: input.moveOpenTasks,
      requestedBy: principal.userId, status: "PENDING", requestedAt: new Date().toISOString() });
    this.requests.set(request.id, request); this.idempotency.set(input.idempotencyKey, request.id);
    this.leads.addActivity(leadId, { type: "REASSIGNMENT_REQUESTED", result: request.id, note: request.reason }, principal, correlationId);
    this.audit.record({ eventType: "LEAD_REASSIGNMENT_REQUESTED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { requestId: request.id, leadId, currentOwnerId: request.currentOwnerId,
        targetUserId: request.targetUserId, moveOpenTasks: request.moveOpenTasks }, result: "SUCCESS", idempotencyKey: `reassignment-request:${input.idempotencyKey}` });
    return this.copy(request);
  }

  decide(requestId: string, input: DecideReassignmentInput, principal: Principal, correlationId: string): { request: ReassignmentRequest; lead?: LeadRecord } {
    this.assertApprover(principal);
    if (input.reason.trim().length < 4) throw new BadRequestException({ code: "reassignment_decision_reason_required" });
    const current = this.requests.get(requestId); if (!current) throw new NotFoundException({ code: "reassignment_request_not_found" });
    if (current.status !== "PENDING") throw new ConflictException({ code: "reassignment_already_decided" });
    if (current.requestedBy === principal.userId) throw new ForbiddenException({ code: "reassignment_separation_of_duties" });
    let lead: LeadRecord | undefined;
    if (input.approved) {
      this.engine.assertEligibleTarget(current.targetUserId);
      lead = this.leads.reassignLocalLead(current.leadId, current.currentOwnerId, current.targetUserId, principal, correlationId, current.reason);
    } else {
      this.leads.addActivity(current.leadId, { type: "REASSIGNMENT_REJECTED", result: requestId, note: input.reason.trim() }, principal, correlationId);
    }
    const updated: Readonly<ReassignmentRequest> = Object.freeze({ ...current, status: input.approved ? "APPROVED" : "REJECTED",
      decidedBy: principal.userId, decidedAt: new Date().toISOString(), decisionReason: input.reason.trim() });
    this.requests.set(requestId, updated);
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
  private copy(request: Readonly<ReassignmentRequest>): ReassignmentRequest { return { ...request }; }
  private async refreshPersistentState(): Promise<void> {
    if (!this.persistence?.enabled) return;
    const snapshot = await this.persistence.snapshot();
    this.requests.clear();
    for (const item of snapshot.reassignments) this.requests.set(item.id, Object.freeze({ ...item }));
  }
}
