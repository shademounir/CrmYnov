import { BadRequestException, ConflictException, HttpException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { AssignmentService, type AssignmentStrategy } from "./assignment.service.js";

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
  constructor(private readonly leads: LeadService, private readonly engine: AssignmentService, private readonly audit: AuditService) {}

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

  assignOne(leadId: string, targetUserId: string, confirmed: boolean, idempotencyKey: string, principal: Principal, correlationId: string): LeadRecord {
    const result = this.assignBatch({ idempotencyKey, confirmed, strategy: "FIXED", targetUserId,
      items: [{ leadId, source: this.leads.findLocalLead(leadId)?.source ?? "UNKNOWN", campaign: this.leads.findLocalLead(leadId)?.campaign ?? "UNKNOWN" }] }, principal, correlationId);
    const assigned = result.assigned[0];
    if (!assigned) throw new ConflictException({ code: result.skipped[0]?.reason ?? result.refused[0]?.reason ?? "assignment_failed" });
    return assigned;
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
  private simulatedTarget(input: BatchAssignmentInput, item: AssignmentItemInput, index: number, principal: Principal): string {
    const selection = this.engine.simulate({ ...item, eventKey: `${input.idempotencyKey}:${index}` }, principal);
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
