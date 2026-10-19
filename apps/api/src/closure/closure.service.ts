import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService } from "../leads/lead.service.js";
import { positiveQualificationEvidence, type PositiveQualification } from "../leads/commercial-progression.js";
import { strictBody } from "../references/reference.contract.js";
import { LeadWorkflowPersistenceRepository } from "../leads/lead-workflow-persistence.repository.js";
import { NotificationService } from "../notifications/notification.service.js";
import { hasPilotageReportingScope } from "../reporting/reporting-authority.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { leadResource } from "../permissions/dynamic-resources.js";
import { resourceEvaluationContext } from "../permissions/dynamic-context.js";

export type ClosureState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type ClosureTarget = "PROSPECT" | "CONTACTED" | "QUALIFIED" | "ENROLLED" | "CLOSED_LOST";
export const closureReasons = { PROSPECT: ["COMMERCIAL_STAGE_REVIEW"], CONTACTED: ["COMMERCIAL_STAGE_REVIEW"], QUALIFIED: ["COMMERCIAL_STAGE_REVIEW"], ENROLLED: ["ADMISSION_CONFIRMED", "REGISTRATION_COMPLETE"], CLOSED_LOST: ["NOT_INTERESTED", "UNREACHABLE", "OTHER_PROGRAM"] } as const;
export interface ClosureRequest { id: string; leadId: string; target: ClosureTarget; reason: string; comment: string; evidence: string[]; requesterId: string; state: ClosureState; version: number; createdAt: string; decidedAt?: string; decidedBy?: string; decisionReason?: string }
export interface ClosureInput { target?: string; reason?: string; comment?: string; evidence?: string[]; qualification?: PositiveQualification; idempotencyKey?: string }
const qualificationPrefix = "SERVER_POSITIVE_QUALIFICATION_V1:";
const finalTarget = (target: string): boolean => target === "ENROLLED" || target === "CLOSED_LOST";

@Injectable()
export class ClosureService implements OnModuleInit {
  private readonly requests = new Map<string, Readonly<ClosureRequest>>();
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(LeadWorkflowPersistenceRepository) private readonly persistence?: LeadWorkflowPersistenceRepository,
    @Optional() @Inject(DynamicPermissionRepository) private readonly permissions?: DynamicPermissionRepository,
  ) {}

  async onModuleInit(): Promise<void> { await this.refreshPersistentState(); }

  async refreshReportingForApi(): Promise<void> { await this.refreshPersistentState(); }
  persistenceEnabled(): boolean { return this.persistence?.enabled === true; }

  async requestForApi(leadId: string, input: ClosureInput, principal: Principal, correlationId: string): Promise<ClosureRequest> {
    if (!this.persistence?.enabled) return this.request(leadId, input, principal, correlationId);
    await this.leads.getLeadForApi(leadId, principal, correlationId);
    await this.refreshPersistentState();
    const record = this.request(leadId, input, principal, correlationId);
    try { return await this.persistence.saveClosure(record, undefined, { eventType: "CLOSURE_REQUESTED", principal, correlationId }); }
    finally { await this.refreshPersistentState(); }
  }

  async decideForApi(id: string, input: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): Promise<ClosureRequest> {
    strictBody(input, ["decision", "reason", "expectedVersion"]);
    if (typeof input.reason !== "string" || !["APPROVE", "REJECT"].includes(input.decision ?? "")) throw new BadRequestException({ code: "closure_decision_invalid" });
    if (!this.persistence?.enabled) return this.decide(id, input, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.requests.get(id); if (!current) throw new NotFoundException({ code: "closure_request_not_found" });
    // Retry of an already committed identical decision is a read, not a second
    // approval. A different actor, payload or version still fails closed.
    if (current.state !== "PENDING" && current.decidedBy === principal.userId && current.version === (input.expectedVersion ?? 0) + 1
      && current.decisionReason === input.reason?.trim() && current.state === (input.decision === "APPROVE" ? "APPROVED" : "REJECTED")) return this.copy(current);
    try { await this.leads.persistWorkflowMutationForApi(
      current.leadId, `closure-decision:${id}:${input.expectedVersion ?? "missing"}`, "CLOSURE_DECISION", input,
      () => this.decide(id, input, principal, correlationId),
      principal, correlationId, async (tx, updated) => { await this.persistence!.saveClosureInTransaction(tx, updated, current.version, {
        eventType: updated.state === "APPROVED" ? "CLOSURE_APPROVED" : "CLOSURE_REJECTED", principal, correlationId,
      }); },
    );
    } finally { await this.refreshPersistentState(); }
    return this.copy(this.requests.get(id)!);
  }

  async cancelForApi(id: string, principal: Principal, correlationId: string, retireStage = false): Promise<ClosureRequest> {
    if (!this.persistence?.enabled) return this.cancel(id, principal, correlationId, retireStage);
    await this.refreshPersistentState();
    const current = this.requests.get(id); if (!current) throw new NotFoundException({ code: "closure_request_not_found" });
    const updated = this.cancel(id, principal, correlationId, retireStage);
    if (updated.version === current.version) return updated;
    try { return await this.persistence.saveClosure(updated, current.version, { eventType: "CLOSURE_CANCELLED", principal, correlationId }); }
    finally { await this.refreshPersistentState(); }
  }

  async listForApi(principal: Principal): Promise<Array<ClosureRequest & { canDecide: boolean; canCancel: boolean; canRetire: boolean }>> {
    await this.refreshPersistentState();
    const items = this.list(principal);
    if (!this.permissions?.enabled) return items.map((item) => ({ ...item, canDecide: !this.persistence?.enabled && item.canDecide, canRetire: !this.persistence?.enabled && item.canRetire }));
    return this.permissions.readTransaction(async (tx) => {
      const rows = await this.permissions!.snapshots(tx);
      return Promise.all(items.map(async (item) => {
        const resource = await resourceEvaluationContext(tx, principal, await leadResource(tx, item.leadId));
        const approve = evaluatePermission(principal, "lead.close.approve", rows, resource).allowed;
        return { ...item, canDecide: item.canDecide && approve, canRetire: item.canRetire && approve,
          canCancel: item.canCancel && evaluatePermission(principal, "lead.close.request", rows, resource).allowed };
      }));
    });
  }

  async reconcileNotificationsForApi(principal: Principal): Promise<{ pendingRequests: number }> {
    if (!principal.roles.some((role) => ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role))) throw new ForbiddenException({ code: "closure_approval_forbidden" });
    await this.refreshPersistentState();
    const pending = this.list(principal).filter((item) => item.state === "PENDING" && finalTarget(item.target));
    if (!this.persistence?.enabled) return { pendingRequests: 0 };
    for (const item of pending) await this.persistence.reconcileClosureNotifications(item);
    return { pendingRequests: pending.length };
  }

  request(leadId: string, input: ClosureInput, principal: Principal, correlationId: string): ClosureRequest {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "closure_request_forbidden" }); }
    strictBody(input, ["target", "reason", "comment", "evidence", "qualification", "idempotencyKey"]);
    if (typeof input.comment !== "string" || !Array.isArray(input.evidence) || input.evidence.some((item) => typeof item !== "string" || item.length > 1000 || item.trim().startsWith(qualificationPrefix))) throw new BadRequestException({ code: "closure_request_invalid" });
    const lead = this.leads.getLead(leadId, principal, correlationId); const target = input.target as ClosureTarget; const comment = input.comment.trim();
    const evidence = (input.evidence as unknown[]).map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean);
    if (!finalTarget(target)) throw new BadRequestException({ code: "commercial_stage_approval_retired" });
    if (typeof input.reason !== "string" || !Object.hasOwn(closureReasons, target) || !closureReasons[target]?.includes(input.reason as never) || !comment || comment.length > 1000 || evidence.length === 0 || evidence.length > 10) { throw new BadRequestException({ code: "closure_request_invalid" }); }
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{8,128}$/.test(input.idempotencyKey))) throw new BadRequestException({ code: "closure_idempotency_invalid" });
    const hash = input.idempotencyKey ? createHash("sha256").update(JSON.stringify([leadId, principal.userId, input.idempotencyKey])).digest("hex").slice(0, 32) : undefined;
    const id = hash ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}` : randomUUID();
    const replay = this.requests.get(id);
    if (target === "ENROLLED" && (replay ? replay.evidence.some((item) => item.startsWith(qualificationPrefix)) : lead.status !== "QUALIFIED")) {
      const observed = positiveQualificationEvidence(lead, input.qualification as PositiveQualification | undefined, comment);
      evidence.push(replay ? replay.evidence.find(item => item.startsWith(qualificationPrefix))! : `${qualificationPrefix}${observed}`);
    }
    if (replay) {
      if (replay.target !== target || replay.reason !== input.reason || replay.comment !== comment || JSON.stringify(replay.evidence) !== JSON.stringify(evidence)) throw new ConflictException({ code: "closure_idempotency_conflict" });
      return this.copy(replay);
    }
    if (!["PROSPECT", "CONTACTED", "QUALIFIED"].includes(lead.status)) throw new BadRequestException({ code: "closure_source_status_invalid" });
    if ([...this.requests.values()].some((item) => item.leadId === leadId && item.state === "PENDING")) { throw new ConflictException({ code: "closure_pending" }); }
    const record: Readonly<ClosureRequest> = Object.freeze({ id, leadId, target, reason: input.reason, comment, evidence: [...evidence], requesterId: principal.userId, state: "PENDING", version: 1, createdAt: new Date().toISOString() });
    this.requests.set(record.id, record); this.record(record, principal, correlationId, "CLOSURE_REQUESTED"); return this.copy(record);
  }

  decide(id: string, input: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): ClosureRequest {
    const current = this.requests.get(id);
    if (!current) { throw new NotFoundException({ code: "closure_request_not_found" }); }
    if (current.requesterId === principal.userId) { throw new ForbiddenException({ code: "closure_self_approval_forbidden" }); }
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "closure_approval_forbidden" }); }
    if (current.state !== "PENDING" || input.expectedVersion !== current.version) { throw new ConflictException({ code: "closure_concurrent_decision" }); }
    if (!finalTarget(current.target)) throw new ConflictException({ code: "commercial_stage_approval_retired" });
    const reason = typeof input.reason === "string" ? input.reason.trim() : ""; if (!["APPROVE", "REJECT"].includes(input.decision ?? "") || !reason || reason.length > 1000) { throw new BadRequestException({ code: "closure_decision_invalid" }); }
    if (input.decision === "APPROVE") {
      const qualified = current.evidence.find(item => item.startsWith(qualificationPrefix));
      if (current.target === "ENROLLED" && qualified && qualified !== `${qualificationPrefix}${positiveQualificationEvidence(this.leads.getLead(current.leadId, principal, correlationId), { interestConfirmed: true, eligibilityConfirmed: true }, current.comment)}`) throw new ConflictException({ code: "closure_qualification_stale" });
      this.leads.changeStatus(current.leadId, { status: current.target, reason: current.comment, ...(qualified ? { qualification: { interestConfirmed: true, eligibilityConfirmed: true } } : {}) }, principal, correlationId);
    }
    const updated: Readonly<ClosureRequest> = Object.freeze({ ...current, state: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", version: current.version + 1, decidedAt: new Date().toISOString(), decidedBy: principal.userId, decisionReason: reason });
    this.requests.set(id, updated);
    if (!this.persistence?.enabled) this.notifications.create({ recipientId: current.requesterId, type: "CLOSURE_REQUEST", priority: "HIGH", resourceType: "LEAD", resourceId: current.leadId, href: `/leads/${current.leadId}/closure` }, `closure-decision:${id}`);
    this.record(updated, principal, correlationId, `CLOSURE_${updated.state}`); return this.copy(updated);
  }

  cancel(id: string, principal: Principal, correlationId: string, retireStage = false): ClosureRequest {
    const current = this.requests.get(id);
    if (!current) { throw new NotFoundException({ code: "closure_request_not_found" }); }
    if (retireStage && (finalTarget(current.target) || !principal.roles.some(role => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role)))) throw new ForbiddenException({ code: "closure_retirement_forbidden" });
    if (!retireStage && current.requesterId !== principal.userId) { throw new ForbiddenException({ code: "closure_cancel_forbidden" }); }
    if (current.state === "CANCELLED" && current.decidedBy === principal.userId) return this.copy(current);
    if (current.state !== "PENDING") { throw new ConflictException({ code: "closure_concurrent_decision" }); }
    const updated: Readonly<ClosureRequest> = Object.freeze({ ...current, state: "CANCELLED", version: current.version + 1, decidedAt: new Date().toISOString(), decidedBy: principal.userId, decisionReason: finalTarget(current.target) ? "REQUESTER_CANCELLED" : "COMMERCIAL_STAGE_WORKFLOW_RETIRED_V1" });
    this.requests.set(id, updated);
    this.record(updated, principal, correlationId, "CLOSURE_CANCELLED");
    return this.copy(updated);
  }

  list(principal: Principal): Array<ClosureRequest & { canDecide: boolean; canCancel: boolean; canRetire: boolean }> { const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN"); return [...this.requests.values()].filter((item) => (!principal.permissionLeadIds || principal.permissionLeadIds.has(item.leadId)) && (manager || item.requesterId === principal.userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((item) => ({ ...this.copy(item), canRetire: manager && !finalTarget(item.target) && item.state === "PENDING", canCancel: item.requesterId === principal.userId && item.state === "PENDING", canDecide: manager && item.requesterId !== principal.userId && item.state === "PENDING" && finalTarget(item.target) })); }
  reportingSnapshot(principal: Principal): ClosureRequest[] {
    if (!hasPilotageReportingScope(principal)) return this.list(principal);
    return [...this.requests.values()].filter((item) => principal.permissionLeadIds!.has(item.leadId)).map((item) => this.copy(item));
  }
  private copy(item: Readonly<ClosureRequest>): ClosureRequest { return { ...item, evidence: [...item.evidence] }; }
  private record(item: Readonly<ClosureRequest>, principal: Principal, correlationId: string, eventType: string): void { this.audit.record({ eventType, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { requestId: item.id, leadId: item.leadId, target: item.target, state: item.state, version: item.version, evidenceCount: item.evidence.length }, result: "SUCCESS", idempotencyKey: `${eventType}:${item.id}:${item.version}` }); }
  private async refreshPersistentState(): Promise<void> { if (!this.persistence?.enabled) return; const snapshot = await this.persistence.snapshot(); this.requests.clear(); for (const item of snapshot.closures) this.requests.set(item.id, Object.freeze({ ...item, evidence: [...item.evidence] })); }
}
