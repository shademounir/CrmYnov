import type { Prisma } from "@prisma/client";
import { isRole, type Scope } from "../auth/auth.types.js";
import { resourceEvaluationContext, type PermissionIdentity } from "../permissions/dynamic-context.js";
import { canonicalCampus, leadResource } from "../permissions/dynamic-resources.js";
import { businessMailRecipientCapability } from "../permissions/dynamic-evaluator.js";
import type { ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import type { BusinessMailFacts, InternalMailMember, InternalMailActionOwner } from "./business-mail-policy.js";

/** Persisted, activated account identity only. No session or mutation authority. */
export async function currentMailIdentity(tx: Prisma.TransactionClient, userId: string): Promise<{ identity: PermissionIdentity; email: string } | null> {
  const user = await tx.collaborator.findUnique({ where: { id: userId } });
  if (!user?.active || user.firstLoginRequired || !user.roles.length || !user.roles.every(isRole)) return null;
  const scopes: Scope[] = user.roles.includes("SUPER_ADMIN") ? [{ kind: "GLOBAL" }] : [];
  if (user.campusId) { const campus = await canonicalCampus(tx, user.campusId); scopes.push(...campus.keys.map(id => ({ kind: "CAMPUS" as const, id }))); }
  if (user.teamId) scopes.push({ kind: "TEAM", id: user.teamId });
  return { identity: { userId, roles: user.roles, scopes }, email: user.professionalEmail };
}
export async function currentMailRecipients(tx: Prisma.TransactionClient, facts: BusinessMailFacts, leadId: string, snapshots: readonly ConfigurationSnapshot[]): Promise<{ members: InternalMailMember[]; owners: InternalMailActionOwner[] }> {
  const resource = await leadResource(tx, leadId);
  const responsibility = facts.type.startsWith("FOLLOW_UP_") ? "FOLLOW_UP_OWNER" as const : facts.type === "FIRST_TREATMENT_OVERDUE" ? "LEAD_PRIMARY" as const : "ADMISSIONS_RESPONSIBLE" as const;
  const memberships = await tx.businessMailMembership.findMany({ where: { campusId: facts.scope.campusId, campaignId: facts.scope.campaignId ?? "", active: true }, orderBy: { userId: "asc" } });
  const members: InternalMailMember[] = [], owners: InternalMailActionOwner[] = [];
  for (const userId of [...new Set([facts.actionOwnerId, ...memberships.map(row => row.userId)])]) {
    if (!userId) continue;
    const current = await currentMailIdentity(tx, userId); if (!current) continue;
    const context = await resourceEvaluationContext(tx, current.identity, resource);
    if (userId === facts.actionOwnerId) owners.push({ userId, email: current.email, active: true, scope: facts.scope, responsibility,
      hasRequiredPermission: businessMailRecipientCapability(current.identity.roles, responsibility, snapshots, context) });
    if (memberships.some(row => row.userId === userId)) members.push({ userId, email: current.email, active: true,
      hasLeadAccess: businessMailRecipientCapability(current.identity.roles, "COPY", snapshots, context), memberships: [facts.scope] });
  }
  return { members, owners };
}
