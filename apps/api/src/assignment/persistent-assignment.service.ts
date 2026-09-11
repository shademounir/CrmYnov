import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { currentPrincipal, permissionDenied, resourceEvaluationContext } from "../permissions/dynamic-context.js";
import { evaluatePermission } from "../permissions/dynamic-evaluator.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { prepareSheetAssignment, commitSheetAssignment, type SheetAssignment } from "./campus-assignment-resolver.js";
import type { IngestionBatchInput } from "../ingestion/ingestion.service.js";
import { readCampusRules } from "./campus-assignment.service.js";
import { applicableCampusRule } from "./campus-assignment-policy.js";
import { recordedAssignment, type RecordedAssignmentDecision } from "./recorded-assignment.js";

export interface PersistentAssignmentInput { leadId: string; eventKey: string; assignment: IngestionBatchInput["assignment"] }
export interface PersistentAssignmentResult { outcome: "ASSIGNED" | "PRESERVED" | "UNASSIGNED"; assignment: SheetAssignment; lead: LeadRecord; replayed: boolean }

@Injectable()
export class PersistentAssignmentService {
  constructor(@Inject(DynamicPermissionRepository) private readonly repository: DynamicPermissionRepository,
    @Inject(LeadService) private readonly leads: LeadService) {}

  async decide(leadId: string, eventKey: string, actor: Principal, correlationId: string): Promise<RecordedAssignmentDecision> {
    if (!/^[a-zA-Z0-9:_-]{8,128}$/u.test(eventKey)) throw new BadRequestException({ code: "assignment_event_invalid" });
    return this.repository.transaction(async (tx) => {
      const { lead, campusId, current } = await this.authorizedLead(tx, leadId, actor);
      const key = `assignment-decision:${createHash("sha256").update(eventKey).digest("hex")}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, hashtext(${campusId}))`;
      const previous = await tx.auditEvent.findUnique({ where: { idempotencyKey: key } });
      if (previous) {
        if (previous.campusId !== campusId || previous.resourceId !== leadId) throw new ConflictException({ code: "assignment_idempotency_conflict" });
        return recordedAssignment(previous.after);
      }
      const configuration = await readCampusRules(tx, campusId);
      const rule = applicableCampusRule(configuration.rules, lead.source, lead.campaign);
      const assignment = rule ? await prepareSheetAssignment(tx, { strategy: rule.strategy }, this.record(lead), campusId, eventKey) : undefined;
      const selection = assignment?.selection;
      const decision: RecordedAssignmentDecision = { id: randomUUID(), eventKey, leadId, campusId, configurationVersion: configuration.version,
        strategy: selection?.strategy ?? "UNASSIGNED", selectedUserId: selection?.selectedUserId ?? null, ruleId: selection?.ruleId ?? null,
        candidateIds: selection?.candidateIds ?? [], candidateFingerprint: selection?.candidateFingerprint ?? null,
        createdAt: new Date().toISOString(), algorithmVersion: "assignment-v1" };
      if (assignment) await commitSheetAssignment(tx, assignment, leadId);
      await tx.auditEvent.create({ data: { id: decision.id, actorId: current.userId, actorRoles: current.roles, campusId, resourceType: "ASSIGNMENT_DECISION",
        resourceId: leadId, eventType: "ASSIGNMENT_DECISION_CREATED", result: "SUCCESS", correlationId, idempotencyKey: key, after: { ...decision } } });
      return decision;
    });
  }


  async previewAutomatic(leadId: string, eventKey: string, actor: Principal): Promise<SheetAssignment> {
    return this.repository.readTransaction(async (tx) => {
      const { lead, campusId } = await this.authorizedLead(tx, leadId, actor);
      const configuration = await readCampusRules(tx, campusId);
      const rule = applicableCampusRule(configuration.rules, lead.source, lead.campaign);
      if (!rule) return { eventKey, campusId, configurationVersion: configuration.version, reason: "assignment_configuration_absent" };
      return this.preview({ leadId, eventKey, assignment: { strategy: rule.strategy } }, actor);
    });
  }

  async preview(input: PersistentAssignmentInput, actor: Principal): Promise<SheetAssignment> {
    return this.repository.readTransaction(async (tx) => {
      const { lead, campusId } = await this.authorizedLead(tx, input.leadId, actor);
      if (lead.assignedToId) return { eventKey: input.eventKey, targetUserId: lead.assignedToId, reason: "assignment_existing_preserved" };
      return prepareSheetAssignment(tx, input.assignment, this.record(lead), campusId, input.eventKey);
    });
  }

  async previewImportRecords(input: IngestionBatchInput, actor: Principal): Promise<Map<number, SheetAssignment>> {
    return this.repository.readTransaction(async (tx) => {
      const current = await currentPrincipal(tx, actor);
      const snapshots = await this.repository.snapshots(tx);
      const offsets = new Map<string, number>();
      const results = new Map<number, SheetAssignment>();
      for (const record of input.records) {
        const campus = await canonicalCampus(tx, record.campus ?? "");
        const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
        if (!evaluatePermission(current, "lead.assign", snapshots, context).allowed) permissionDenied();
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, hashtext(${campus.id}))`;
        const configuration = await readCampusRules(tx, campus.id);
        const rule = applicableCampusRule(configuration.rules, record.source, record.campaign ?? "");
        const key = `${campus.id}:${configuration.version}:${rule?.id ?? "absent"}`;
        const selected = await prepareSheetAssignment(tx, input.assignment, record, campus.id, `${input.idempotencyKey}:${record.lineNumber}`, offsets.get(key) ?? 0);
        results.set(record.lineNumber, selected);
        if (selected.selection?.strategy === "ROUND_ROBIN") offsets.set(key, (offsets.get(key) ?? 0) + 1);
      }
      return results;
    });
  }

  async withReassignmentTarget<T>(leadId: string, targetUserId: string, actor: Principal, permission: "lead.reassign.request" | "lead.reassign.approve", action: (target: string) => Promise<T>): Promise<T> {
    return this.repository.transaction(async (tx) => {
      const { lead, campusId } = await this.authorizedLead(tx, leadId, actor, permission);
      const selection = await prepareSheetAssignment(tx, { strategy: "FIXED", targetUserId }, this.record(lead), campusId, `reassignment:${leadId}`);
      if (!selection.targetUserId) throw new ConflictException({ code: "assignment_target_ineligible" });
      return action(selection.targetUserId);
    });
  }

  async apply(input: PersistentAssignmentInput, actor: Principal, correlationId: string): Promise<PersistentAssignmentResult> {
    if (!/^[a-zA-Z0-9:_-]{8,128}$/u.test(input.eventKey)) throw new BadRequestException({ code: "assignment_event_invalid" });
    return this.repository.transaction(async (tx) => {
      const { lead, campusId, current } = await this.authorizedLead(tx, input.leadId, actor);
      const key = `campus-assignment-decision:${createHash("sha256").update(input.eventKey).digest("hex")}`;
      const requestHash = createHash("sha256").update(JSON.stringify({ leadId: input.leadId, strategy: input.assignment.strategy, target: input.assignment.targetUserId ?? null })).digest("hex");
      const previous = await tx.auditEvent.findUnique({ where: { idempotencyKey: key } });
      if (previous) {
        if (previous.resourceId !== lead.id || !previous.after || typeof previous.after !== "object" || Array.isArray(previous.after) || previous.after.requestHash !== requestHash) {
          throw new ConflictException({ code: "assignment_idempotency_conflict" });
        }
        const visible = await this.leads.findLocalLeadForApi(lead.id);
        if (!visible) throw new NotFoundException({ code: "lead_not_found" });
        return { outcome: "PRESERVED", assignment: { eventKey: input.eventKey, reason: "assignment_replayed" }, lead: visible, replayed: true };
      }
      if (lead.assignedToId) {
        const visible = await this.leads.findLocalLeadForApi(lead.id);
        if (!visible) throw new NotFoundException({ code: "lead_not_found" });
        return { outcome: "PRESERVED", assignment: { eventKey: input.eventKey, targetUserId: lead.assignedToId, reason: "assignment_existing_preserved" }, lead: visible, replayed: false };
      }
      const selection = await prepareSheetAssignment(tx, input.assignment, this.record(lead), campusId, input.eventKey);
      if (!selection.targetUserId) {
        const visible = await this.leads.findLocalLeadForApi(lead.id);
        if (!visible) throw new NotFoundException({ code: "lead_not_found" });
        return { outcome: "UNASSIGNED", assignment: selection, lead: visible, replayed: false };
      }
      const updated = await this.leads.assignLocalLeadForApi(lead.id, selection.targetUserId, current, correlationId, `BATCH:${input.eventKey}`, input.assignment.strategy,
        { origin: input.assignment.strategy === "FIXED" ? "MANUAL" : "AUTOMATIC", decisionRef: key, requestHash,
          configurationVersion: selection.configurationVersion ?? null, selectedUserId: selection.targetUserId, ruleId: selection.selection?.ruleId ?? null });
      await commitSheetAssignment(tx, selection, lead.id);
      return { outcome: "ASSIGNED", assignment: selection, lead: updated, replayed: false };
    });
  }

  private async authorizedLead(tx: Prisma.TransactionClient, id: string, actor: Principal, permission = "lead.assign"): Promise<{ lead: NonNullable<Awaited<ReturnType<typeof tx.lead.findUnique>>>; campusId: string; current: Principal }> {
    if (!/^[a-f\d-]{36}$/iu.test(id)) throw new NotFoundException({ code: "lead_not_found" });
    const current = await currentPrincipal(tx, actor);
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    const campus = await canonicalCampus(tx, lead.campus);
    const context = await resourceEvaluationContext(tx, current, { scope: "CAMPUS", campusKeys: campus.keys, active: true, ...(lead.assignedToId ? { ownerId: lead.assignedToId } : {}) });
    if (!context.campusAllowed) throw new NotFoundException({ code: "lead_not_found" });
    if (!evaluatePermission(current, permission, await this.repository.snapshots(tx), context).allowed) permissionDenied();
    return { lead, campusId: campus.id, current };
  }
  private record(lead: { source: string; campaign: string }): { source: string; campaign: string } {
    // Source values are validated by the canonical Lead creation contract; no client override here.
    return { source: lead.source, campaign: lead.campaign };
  }
}
