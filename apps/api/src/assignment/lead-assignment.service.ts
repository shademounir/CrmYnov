import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import { PersistentAssignmentService } from "./persistent-assignment.service.js";
import { createHash, randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { AssignmentService, type AssignmentStrategy } from "./assignment.service.js";
import type { IngestionBatchInput } from "../ingestion/ingestion.service.js";
import type { SheetAssignment } from "./campus-assignment-resolver.js";

export type BatchAssignmentStrategy = "FIXED" | AssignmentStrategy;
export interface AssignmentItemInput { leadId: string; source: string; campaign: string }
export interface BatchAssignmentInput {
  idempotencyKey: string;
  items: AssignmentItemInput[];
  strategy: BatchAssignmentStrategy;
  targetUserId?: string;
  confirmed?: boolean;
}
export interface AssignmentPreviewItem { leadId: string; selectedUserId?: string; outcome: "READY" | "SKIPPED" | "REFUSED"; reason?: string }
export interface AssignmentBatchResult { batchId: string; idempotencyKey: string; assigned: LeadRecord[]; skipped: AssignmentPreviewItem[]; refused: AssignmentPreviewItem[] }

const IDEMPOTENCY_KEY = /^[a-zA-Z0-9:_-]{8,128}$/;

@Injectable()
export class LeadAssignmentService {
  private readonly completed = new Map<string, Readonly<AssignmentBatchResult>>();
  private readonly activeLeadLocks = new Set<string>();
  constructor(@Inject(LeadService) private readonly leads: LeadService, @Inject(AssignmentService) private readonly engine: AssignmentService, @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(PersistentAssignmentService) private readonly persistent?: Pick<PersistentAssignmentService, "preview" | "apply"> & Partial<Pick<PersistentAssignmentService, "previewImportRecords">>) {}

  async previewImportRecords(input: IngestionBatchInput, principal: Principal): Promise<Map<number, SheetAssignment>> {
    if (!this.persistent?.previewImportRecords) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    return this.persistent.previewImportRecords(input, principal);
  }

  async previewForApi(input: BatchAssignmentInput, principal: Principal): Promise<AssignmentPreviewItem[]> {
    if (!this.leads.persistenceEnabled()) return this.preview(input, principal);
    this.validate(input, false);
    if (!this.persistent) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    const result: AssignmentPreviewItem[] = [];
    for (const [index, item] of input.items.entries()) {
      const selected = await this.persistent.preview({ leadId: item.leadId, eventKey: `${input.idempotencyKey}:${index}`,
        assignment: { strategy: input.strategy, ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}) } }, principal);
      result.push({ leadId: item.leadId, ...(selected.targetUserId ? { selectedUserId: selected.targetUserId } : {}),
        outcome: selected.reason === "assignment_existing_preserved" ? "SKIPPED" : selected.targetUserId ? "READY" : "REFUSED", ...(selected.reason ? { reason: selected.reason } : {}) });
    }
    return result;
  }

  preview(input: BatchAssignmentInput, principal: Principal): AssignmentPreviewItem[] {
    this.validate(input, false);
    return input.items.map((item, index) => {
      const lead = this.leads.findLocalLead(item.leadId);
      if (!lead) return { leadId: item.leadId, outcome: "REFUSED", reason: "lead_not_found" };
      if (lead.assignedToId) return { leadId: item.leadId, outcome: "SKIPPED", reason: "lead_already_assigned" };
      try {
        const selectedUserId = input.strategy === "FIXED" ? this.fixedTarget(input) : this.simulatedTarget(input, item, index, principal);
        return { leadId: item.leadId, selectedUserId, outcome: "READY" };
      } catch (error) { return { leadId: item.leadId, outcome: "REFUSED", reason: this.reason(error) }; }
    });
  }

  previewTarget(input: Omit<BatchAssignmentInput, "confirmed">, principal: Principal, roundRobinOffset = 0): string {
    this.validate(input, false);
    const item = input.items[0];
    if (!item || input.items.length !== 1) throw new BadRequestException({ code: "assignment_preview_item_required" });
    return input.strategy === "FIXED" ? this.fixedTarget(input) : this.simulatedTarget(input, item, 0, principal, roundRobinOffset);
  }

  assignOne(leadId: string, targetUserId: string, confirmed: boolean, idempotencyKey: string, principal: Principal, correlationId: string): LeadRecord {
    const result = this.assignBatch({ idempotencyKey, confirmed, strategy: "FIXED", targetUserId,
      items: [{ leadId, source: this.leads.findLocalLead(leadId)?.source ?? "UNKNOWN", campaign: this.leads.findLocalLead(leadId)?.campaign ?? "UNKNOWN" }] }, principal, correlationId);
    const assigned = result.assigned[0];
    if (!assigned) throw new ConflictException({ code: result.skipped[0]?.reason ?? result.refused[0]?.reason ?? "assignment_failed" });
    return assigned;
  }

  async assignOneForApi(leadId: string, targetUserId: string, confirmed: boolean, idempotencyKey: string, principal: Principal, correlationId: string): Promise<LeadRecord> {
    const result = await this.assignBatchForApi({ idempotencyKey, confirmed, strategy: "FIXED", targetUserId,
      items: [{ leadId, source: (await this.leads.findLocalLeadForApi(leadId))?.source ?? "UNKNOWN", campaign: (await this.leads.findLocalLeadForApi(leadId))?.campaign ?? "UNKNOWN" }] }, principal, correlationId);
    const assigned = result.assigned[0];
    if (!assigned) throw new ConflictException({ code: result.skipped[0]?.reason ?? result.refused[0]?.reason ?? "assignment_failed" });
    return assigned;
  }

  async assignBatchForApi(input: BatchAssignmentInput, principal: Principal, correlationId: string): Promise<AssignmentBatchResult> {
    if (!this.leads.persistenceEnabled()) return this.assignBatch(input, principal, correlationId);
    this.validate(input, true);
    if (!this.persistent) throw new ConflictException({ code: "persistent_assignment_unavailable" });
    const assigned: LeadRecord[] = []; const skipped: AssignmentPreviewItem[] = []; const refused: AssignmentPreviewItem[] = [];
    for (const [index, item] of input.items.entries()) {
      try {
        const result = await this.persistent.apply({ leadId: item.leadId, eventKey: `${input.idempotencyKey}:${index}`,
          assignment: { strategy: input.strategy, ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}) } }, principal, `${correlationId}:${index}`);
        if (result.outcome === "ASSIGNED" || result.replayed) assigned.push(result.lead);
        else if (result.outcome === "PRESERVED") skipped.push({ leadId: item.leadId, outcome: "SKIPPED", reason: "lead_already_assigned" });
        else refused.push({ leadId: item.leadId, outcome: "REFUSED", reason: result.assignment.reason ?? "assignment_unassigned" });
      } catch (error) { refused.push({ leadId: item.leadId, outcome: "REFUSED", reason: this.reason(error) }); }
    }
    const digest = createHash("sha256").update(JSON.stringify([principal.userId, input.idempotencyKey])).digest("hex");
    const batchId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    const result: Readonly<AssignmentBatchResult> = Object.freeze({ batchId, idempotencyKey: input.idempotencyKey,
      assigned: assigned.map((lead) => Object.freeze({ ...lead })), skipped: skipped.map((item) => Object.freeze({ ...item })), refused: refused.map((item) => Object.freeze({ ...item })) });
    return this.copy(result);
  }

  assignBatch(input: BatchAssignmentInput, principal: Principal, correlationId: string): AssignmentBatchResult {
    this.validate(input, true);
    const previous = this.completed.get(input.idempotencyKey);
    if (previous) return this.copy(previous);
    const assigned: LeadRecord[] = []; const skipped: AssignmentPreviewItem[] = []; const refused: AssignmentPreviewItem[] = [];
    for (const [index, item] of input.items.entries()) {
      if (this.activeLeadLocks.has(item.leadId)) { refused.push({ leadId: item.leadId, outcome: "REFUSED", reason: "assignment_concurrent" }); continue; }
      this.activeLeadLocks.add(item.leadId);
      try {
        const lead = this.leads.findLocalLead(item.leadId);
        if (!lead) { refused.push({ leadId: item.leadId, outcome: "REFUSED", reason: "lead_not_found" }); continue; }
        if (lead.assignedToId) { skipped.push({ leadId: item.leadId, outcome: "SKIPPED", reason: "lead_already_assigned" }); continue; }
        const target = input.strategy === "FIXED" ? this.fixedTarget(input) : this.engineTarget(input, item, index, principal, correlationId);
        assigned.push(this.leads.assignLocalLead(item.leadId, target, principal, `${correlationId}:${index}`, `BATCH:${input.idempotencyKey}`, input.strategy));
      } catch (error) { refused.push({ leadId: item.leadId, outcome: "REFUSED", reason: this.reason(error) }); }
      finally { this.activeLeadLocks.delete(item.leadId); }
    }
    const result: Readonly<AssignmentBatchResult> = Object.freeze({ batchId: randomUUID(), idempotencyKey: input.idempotencyKey,
      assigned: assigned.map((lead) => Object.freeze({ ...lead })), skipped: skipped.map((item) => Object.freeze({ ...item })), refused: refused.map((item) => Object.freeze({ ...item })) });
    this.completed.set(input.idempotencyKey, result);
    this.audit.record({ eventType: "LEAD_ASSIGNMENT_BATCH_COMPLETED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { batchId: result.batchId, assigned: assigned.length,
        skipped: skipped.length, refused: refused.length, strategy: input.strategy }, result: refused.length ? "FAILED" : "SUCCESS",
      idempotencyKey: `lead-assignment-batch:${input.idempotencyKey}` });
    return this.copy(result);
  }

  completedHistory(principal: Principal): AssignmentBatchResult[] {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new BadRequestException({ code: "assignment_manager_required" });
    return [...this.completed.values()].map((result) => this.copy(result));
  }

  private validate(input: BatchAssignmentInput, requireConfirmation: boolean): void {
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) || input.items.length < 1 || input.items.length > 100 || new Set(input.items.map((item) => item.leadId)).size !== input.items.length) throw new BadRequestException({ code: "assignment_batch_invalid" });
    if (requireConfirmation && input.confirmed !== true) throw new BadRequestException({ code: "assignment_confirmation_required" });
    if (!["FIXED", "ROUND_ROBIN", "CONTROLLED_RANDOM"].includes(input.strategy)) throw new BadRequestException({ code: "assignment_strategy_invalid" });
    if ((input.strategy === "FIXED") !== Boolean(input.targetUserId)) throw new BadRequestException({ code: "assignment_target_invalid" });
  }

  private fixedTarget(input: BatchAssignmentInput): string {
    const target = input.targetUserId!; this.engine.assertEligibleTarget(target); return target;
  }
  private simulatedTarget(input: BatchAssignmentInput, item: AssignmentItemInput, index: number, principal: Principal, roundRobinOffset = 0): string {
    const selection = this.engine.simulate({ ...item, eventKey: `${input.idempotencyKey}:${index}` }, principal, roundRobinOffset);
    if (selection.strategy !== input.strategy) throw new ConflictException({ code: "assignment_strategy_rule_mismatch" });
    return selection.selectedUserId;
  }
  private engineTarget(input: BatchAssignmentInput, item: AssignmentItemInput, index: number, principal: Principal, correlationId: string): string {
    const decision = this.engine.assign({ ...item, eventKey: `${input.idempotencyKey}:${index}` }, principal, `${correlationId}:engine:${index}`);
    if (decision.strategy !== input.strategy) throw new ConflictException({ code: "assignment_strategy_rule_mismatch" });
    return decision.selectedUserId;
  }
  private reason(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse() as { code?: unknown }; if (typeof response.code === "string") return response.code;
    }
    return "assignment_failed";
  }
  private copy(result: Readonly<AssignmentBatchResult>): AssignmentBatchResult { return { ...result, assigned: result.assigned.map((lead) => ({ ...lead })), skipped: result.skipped.map((item) => ({ ...item })), refused: result.refused.map((item) => ({ ...item })) }; }
}
