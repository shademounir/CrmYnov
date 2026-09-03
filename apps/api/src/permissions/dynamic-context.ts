import { ForbiddenException } from "@nestjs/common";
import type { Principal, Role, Scope } from "../auth/auth.types.js";
import { roles } from "../auth/auth.types.js";
import type { ResourceContext } from "./permission.service.js";
import type { PermissionTransaction } from "./dynamic-repository.js";
import type { EvaluationContext } from "./dynamic-evaluator.js";
import { resolveReference } from "../references/reference.repository.js";

export function permissionDenied(): never { throw new ForbiddenException({ code: "permission_denied" }); }
async function currentCampusScopes(tx: PermissionTransaction, campusId: string | null): Promise<Scope[]> {
  if (!campusId) return [];
  const scopes: Scope[] = [{ kind: "CAMPUS", id: campusId }];
  const campus = /^[a-f\d-]{36}$/i.test(campusId)
    ? await tx.crmReference.findUnique({ where: { id: campusId } })
    : await resolveReference(tx, "CAMPUS", campusId);
  if (!campus) return scopes;
  for (const id of [campus.id, campus.code, campus.label]) {
    if (id !== campusId) scopes.push({ kind: "CAMPUS", id });
  }
  return scopes;
}
export async function currentPrincipal(tx: PermissionTransaction, principal: Principal): Promise<Principal> {
  const user = await tx.collaborator.findUnique({ where: { id: principal.userId } });
  const session = await tx.localSession.findUnique({ where: { id: principal.sessionId } });
  if (!user?.active || !session?.active || session.collaboratorId !== user.id || session.expiresAt <= new Date() || session.authenticationVersion !== user.authenticationVersion) permissionDenied();
  if (!user.roles.length || user.roles.some((role) => !(roles as readonly string[]).includes(role))) permissionDenied();
  const scopes: Scope[] = [];
  if (user.roles.includes("SUPER_ADMIN")) scopes.push({ kind: "GLOBAL" });
  scopes.push(...await currentCampusScopes(tx, user.campusId));
  if (user.teamId) scopes.push({ kind: "TEAM", id: user.teamId });
  return { ...principal, roles: user.roles as Role[], scopes, mustChangeSecret: user.firstLoginRequired || principal.mustChangeSecret };
}
export function campusContext(principal: Principal, campus: string): EvaluationContext {
  const globalAllowed = principal.roles.includes("SUPER_ADMIN");
  return { campus, active: true, own: false, team: false, globalAllowed, campusAllowed: globalAllowed || principal.scopes.some((scope) => scope.kind === "CAMPUS" && scope.id === campus) };
}
export async function resourceEvaluationContext(tx: PermissionTransaction, principal: Principal, resource: ResourceContext): Promise<EvaluationContext> {
  const campus = resource.campusKeys[0] ?? "GLOBAL";
  const context = campusContext(principal, campus);
  context.campusAllowed ||= principal.scopes.some((scope) => scope.kind === "CAMPUS" && resource.campusKeys.includes(scope.id));
  context.active = resource.active;
  context.own = resource.ownerId === principal.userId || resource.collaboratorIds?.includes(principal.userId) === true;
  if (!resource.ownerId) return context;
  const assigned = await tx.collaborator.findUnique({ where: { id: resource.ownerId } });
  const assignedInCampus = Boolean(assigned?.campusId && resource.campusKeys.includes(assigned.campusId));
  context.team = Boolean(assigned?.active && assignedInCampus && assigned.teamId && principal.scopes.some((scope) => scope.kind === "TEAM" && scope.id === assigned.teamId));
  context.managedTeam = false;
  if (assigned?.active && assignedInCampus && assigned.teamId && principal.roles.includes("MANAGER")) {
    const responsibility = await tx.teamResponsibility.findUnique({ where: { teamId_campusId_managerId: { teamId: assigned.teamId, campusId: campus, managerId: principal.userId } } });
    context.managedTeam = responsibility?.active === true;
  }
  return context;
}
