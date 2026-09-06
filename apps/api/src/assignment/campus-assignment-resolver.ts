import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { selectAssignmentCandidate } from "./assignment-selection.js";
import type { AssignmentCandidate, AssignmentDecision } from "./assignment.service.js";
import type { IngestionBatchInput } from "../ingestion/ingestion.service.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { readCampusRules } from "./campus-assignment.service.js";
import { applicableCampusRule } from "./campus-assignment-policy.js";

type Selection = Pick<AssignmentDecision, "ruleId" | "strategy" | "selectedUserId" | "candidateIds" | "candidateFingerprint">;
export interface SheetAssignment { targetUserId?: string; selection?: Selection; eventKey: string; campusId?: string; configurationVersion?: number; reason?: string }

async function eligible(tx: Prisma.TransactionClient, candidate: AssignmentCandidate, campusId: string): Promise<AssignmentCandidate> {
  const user = await tx.collaborator.findUnique({ where: { id: candidate.userId } });
  if (!user?.active || !user.campusId || !user.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER")) return { ...candidate, active: false };
  const campus = await canonicalCampus(tx, user.campusId);
  const activeLeadCount = await tx.lead.count({ where: { assignedToId: user.id, status: { notIn: ["CLOSED_LOST", "ENROLLED"] } } });
  return { ...candidate, active: candidate.active && campus.id === campusId, activeLeadCount };
}

/** Selection and cursor movement stay inside the caller's fenced business transaction. */
export async function prepareSheetAssignment(tx: Prisma.TransactionClient, input: IngestionBatchInput["assignment"], record: { source: string; campaign?: string | undefined },
  campusId: string, eventKey: string, previewOffset = 0): Promise<SheetAssignment> {
  if (input.strategy === "UNASSIGNED") return { eventKey, reason: "assignment_explicitly_unassigned" };
  await canonicalCampus(tx, campusId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, hashtext(${campusId}))`;
  const configuration = await readCampusRules(tx, campusId);
  const rule = applicableCampusRule(configuration.rules, record.source, record.campaign ?? "");
  const evidence = { eventKey, campusId, configurationVersion: configuration.version };
  if (!rule) return { ...evidence, reason: "assignment_configuration_absent" };
  if (!rule.id) throw new ConflictException({ code: "assignment_rule_invalid" });
  if (input.strategy === "FIXED") {
    const candidate = rule.candidates.find((item) => item.userId === input.targetUserId);
    if (!candidate) throw new ConflictException({ code: "assignment_target_ineligible" });
    const current = await eligible(tx, candidate, campusId);
    if (!current.active || current.suspended || current.excluded || current.activeLeadCount >= current.capacity) throw new ConflictException({ code: "assignment_target_ineligible" });
    return { ...evidence, targetUserId: current.userId };
  }
  if (rule.strategy !== input.strategy) throw new ConflictException({ code: "assignment_strategy_conflict" });
  const cursor = await tx.campusAssignmentCursor.findUnique({ where: { campusId_version_ruleId: { campusId, version: configuration.version, ruleId: rule.id } } });
  const candidates = await Promise.all(rule.candidates.map((candidate) => eligible(tx, candidate, campusId)));
  const selection = selectAssignmentCandidate({ id: rule.id, strategy: rule.strategy, cursor: cursor?.cursor ?? 0, candidates }, eventKey, previewOffset);
  return { ...evidence, targetUserId: selection.selectedUserId, selection };
}

export async function commitSheetAssignment(tx: Prisma.TransactionClient, assignment: SheetAssignment, leadId: string): Promise<void> {
  const selection = assignment.selection;
  if (!selection) return;
  if (!assignment.campusId || !assignment.configurationVersion || !leadId) throw new ConflictException({ code: "assignment_evidence_missing" });
  if (selection.strategy === "ROUND_ROBIN") {
    const key = { campusId: assignment.campusId, version: assignment.configurationVersion, ruleId: selection.ruleId };
    await tx.campusAssignmentCursor.upsert({ where: { campusId_version_ruleId: key }, create: { ...key, cursor: 1 }, update: { cursor: { increment: 1 } } });
  }
}
