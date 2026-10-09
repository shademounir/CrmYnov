import { ForbiddenException } from "@nestjs/common";
import type { Role, Scope } from "../auth/auth.types.js";
import { canonicalCampus, leadResource } from "../permissions/dynamic-resources.js";
import { resourceEvaluationContext, type PermissionIdentity } from "../permissions/dynamic-context.js";
import { scheduledCutoverCapability } from "../permissions/dynamic-evaluator.js";
import type { ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import type { DynamicPermissionRepository, PermissionTransaction } from "../permissions/dynamic-repository.js";

export interface CutoverDelegation {
  creatorId: string; authorizedBy: string; creatorAuthenticationVersion: number; authorizerAuthenticationVersion: number;
}
export interface CutoverRuntimeAuthority {
  delegation: CutoverDelegation; identities: PermissionIdentity[]; snapshots: ConfigurationSnapshot[];
  actorId: string; actorRoles: ["SYSTEM"];
}
export function runtimeDenied(): never { throw new ForbiddenException({ code: "cutover_runtime_authority_revoked" }); }
export async function assertCutoverRuntimeAuthority(tx: PermissionTransaction, permissions: Pick<DynamicPermissionRepository, "snapshots">,
  delegation: CutoverDelegation, campusId: string, manifestId: string, assignment: boolean): Promise<CutoverRuntimeAuthority> {
  const campus = await canonicalCampus(tx, campusId), snapshots = await permissions.snapshots(tx), identities: PermissionIdentity[] = [];
  if (delegation.creatorId === delegation.authorizedBy && delegation.creatorAuthenticationVersion !== delegation.authorizerAuthenticationVersion) runtimeDenied();
  for (const [userId, version] of [[delegation.creatorId, delegation.creatorAuthenticationVersion], [delegation.authorizedBy, delegation.authorizerAuthenticationVersion]] as const) {
    if (identities.some((identity) => identity.userId === userId)) continue;
    const user = await tx.collaborator.findUnique({ where: { id: userId } });
    if (!user?.active || user.firstLoginRequired || user.authenticationVersion !== version
      || !user.roles.some((role) => ["SUPER_ADMIN", "ADMIN"].includes(role))) runtimeDenied();
    const scopes: Scope[] = user.roles.includes("SUPER_ADMIN") ? [{ kind: "GLOBAL" }] : [];
    if (user.campusId) for (const key of (await canonicalCampus(tx, user.campusId)).keys) scopes.push({ kind: "CAMPUS", id: key });
    if (user.teamId) scopes.push({ kind: "TEAM", id: user.teamId });
    const identity: PermissionIdentity = { userId, roles: user.roles as Role[], scopes };
    const context = await resourceEvaluationContext(tx, identity, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
    const keys = ["settings.campus.manage", "import.view", "import.execute", "import.confirm", "lead.create", "lead.view", ...(assignment ? ["lead.assign"] : [])];
    if (!keys.every((key) => scheduledCutoverCapability(identity.roles, key, snapshots, context))) runtimeDenied();
    identities.push(identity);
  }
  return { delegation, identities, snapshots, actorId: `SYSTEM:CUTOVER:${manifestId}`, actorRoles: ["SYSTEM"] };
}
export async function assertCutoverRuntimeLead(tx: PermissionTransaction, authority: CutoverRuntimeAuthority, leadId: string): Promise<void> {
  const resource = await leadResource(tx, leadId);
  for (const identity of authority.identities) {
    const context = await resourceEvaluationContext(tx, identity, resource);
    if (!scheduledCutoverCapability(identity.roles, "lead.view", authority.snapshots, context)) runtimeDenied();
  }
}
