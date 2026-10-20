import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import { assignmentCandidateCapability } from "../permissions/dynamic-evaluator.js";
import type { Role } from "../auth/auth.types.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { readCampusRules } from "./campus-assignment.service.js";
import { applicableCampusRule } from "./campus-assignment-policy.js";
import { eligibleAssignmentCandidate } from "./campus-assignment-resolver.js";

export interface ReassignmentCandidateOption { id: string; label: string; activeLeadCount: number; capacity: number | null }
/** Manual reassignment is not automatic acquisition routing. An applicable pool
 * remains restrictive; without one, use only current eligible Commercials of
 * the canonical campus. Never expose an administrative directory or invent a
 * capacity/automatic rule. Commands re-evaluate this same projection under lock. */
export async function reassignmentCandidateOptions(tx: Prisma.TransactionClient, lead: { campus: string; source: string; campaign: string; assignedToId?: string | null }, permissions: readonly ConfigurationSnapshot[]): Promise<ReassignmentCandidateOption[]> {
  const campus = await canonicalCampus(tx, lead.campus), configuration = await readCampusRules(tx, campus.id);
  const rule = applicableCampusRule(configuration.rules, lead.source, lead.campaign);
  const options: ReassignmentCandidateOption[] = [];
  if (rule) {
    for (const candidate of rule.candidates) {
      if (candidate.userId === lead.assignedToId) continue;
      const current = await eligibleAssignmentCandidate(tx, candidate, campus.id, { commercialOnly: true, permissions });
      if (!current.active || current.suspended || current.excluded || current.activeLeadCount >= current.capacity) continue;
      const user = await tx.collaborator.findUnique({ where: { id: candidate.userId } });
      if (user) options.push({ id: user.id, label: user.professionalDisplayName?.trim() || "Conseiller sans nom professionnel", activeLeadCount: current.activeLeadCount, capacity: current.capacity });
    }
  } else if (configuration.version === 0) {
    const users = await tx.collaborator.findMany({ where: { active: true, firstLoginRequired: false, roles: { has: "ADMISSIONS" }, campusId: { in: campus.keys }, ...(lead.assignedToId ? { id: { not: lead.assignedToId } } : {}) }, select: { id: true, professionalDisplayName: true, roles: true }, orderBy: { id: "asc" }, take: 501 });
    if (users.length > 500) throw new ConflictException({ code: "assignment_candidates_limit" });
    for (const user of users) {
      if (!assignmentCandidateCapability(user.roles as Role[], permissions, { campus: campus.id, active: true, own: true, team: false, campusAllowed: true, globalAllowed: false })) continue;
      const activeLeadCount = await tx.lead.count({ where: { assignedToId: user.id, status: { notIn: ["CLOSED_LOST", "ENROLLED"] } } });
      options.push({ id: user.id, label: user.professionalDisplayName?.trim() || "Conseiller sans nom professionnel", activeLeadCount, capacity: null });
    }
  }
  return options.sort((left, right) => left.label.localeCompare(right.label, "fr") || left.id.localeCompare(right.id));
}
