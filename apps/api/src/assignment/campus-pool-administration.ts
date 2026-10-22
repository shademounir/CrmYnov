import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Role } from "../auth/auth.types.js";
import type { ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import { assignmentCandidateCapability } from "../permissions/dynamic-evaluator.js";
import { resolveReference } from "../references/reference.repository.js";
import { ingestionSources } from "../ingestion/ingestion-sources.js";
import type { AssignmentRuleInput } from "./assignment.service.js";

export interface CampusPoolCandidate { id: string; label: string; activeLeadCount: number }
export interface CampusPoolAdministration {
  campusId: string; version: number;
  candidates: CampusPoolCandidate[];
  counters: Array<{ ruleId: string; userId: string; label: string; assignedCount: number }>;
  fairnessScope: "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS";
}

/** Only configuration administrators receive this minimized, current Commercial projection. */
export async function campusPoolAdministration(tx: Prisma.TransactionClient, campus: { id: string; keys: string[] }, version: number, rules: readonly AssignmentRuleInput[], permissions: readonly ConfigurationSnapshot[]): Promise<CampusPoolAdministration> {
  const users = await tx.collaborator.findMany({ where: { campusId: { in: campus.keys }, active: true, firstLoginRequired: false, roles: { has: "ADMISSIONS" } },
    select: { id: true, professionalDisplayName: true, professionalEmail: true, roles: true }, orderBy: { id: "asc" }, take: 501 });
  if (users.length > 500) throw new ConflictException({ code: "assignment_candidates_limit" });
  const eligible = users.filter(user => assignmentCandidateCapability(user.roles as Role[], permissions,
    { campus: campus.id, active: true, own: true, team: false, campusAllowed: true, globalAllowed: false }));
  const candidates: CampusPoolCandidate[] = await Promise.all(eligible.map(async user => ({
    id: user.id, label: user.professionalDisplayName?.trim() || user.professionalEmail,
    activeLeadCount: await tx.lead.count({ where: { assignedToId: user.id, status: { notIn: ["CLOSED_LOST", "ENROLLED"] } } })
  })));
  const rows = version ? await tx.campusNewAssignmentCounter.findMany({ where: { campusId: campus.id, version }, take: 10_001 }) : [];
  if (rows.length > 10_000) throw new ConflictException({ code: "assignment_balance_capacity" });
  const counters: CampusPoolAdministration["counters"] = [];
  for (const rule of rules.filter(r => r.balanceNewEntrants)) for (const member of rule.candidates) {
    if (!rule.id) throw new ConflictException({ code: "assignment_rule_invalid" });
    const current = candidates.find(c => c.id === member.userId);
    counters.push({ ruleId: rule.id, userId: member.userId, label: current?.label ?? "Conseiller actuellement indisponible",
      assignedCount: rows.find(r => r.ruleId === rule.id && r.userId === member.userId)?.assignedCount ?? 0 });
  }
  candidates.sort((a, b) => a.label.localeCompare(b.label, "fr") || a.id.localeCompare(b.id));
  return { campusId: campus.id, version, candidates, counters,
    fairnessScope: "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS" };
}

/** New balanced routing uses current canonical reference codes; old snapshots are never remapped. */
export async function validateBalancedPoolReferences(tx: Prisma.TransactionClient, campusId: string, rules: readonly AssignmentRuleInput[]): Promise<void> {
  await Promise.all(rules.filter(r => r.balanceNewEntrants).map(async rule => {
    if (rule.scope === "SOURCE" && !ingestionSources.includes(rule.matchValue as typeof ingestionSources[number])) throw new BadRequestException({ code: "assignment_source_invalid" });
    if (rule.scope !== "CAMPAIGN") return;
    const reference = await resolveReference(tx, "CAMPAIGN", rule.matchValue ?? "", campusId);
    if (reference?.state !== "ACTIVE" || reference.scope === "CAMPUS" && reference.campusId !== campusId) throw new BadRequestException({ code: "assignment_campaign_invalid" });
    if (reference.code !== rule.matchValue) throw new BadRequestException({ code: "assignment_campaign_canonical_code_required" });
  }));
}
