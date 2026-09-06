import type { Prisma } from "@prisma/client";
import { roles, type Role } from "../auth/auth.types.js";
import { DynamicPermissionRepository } from "../permissions/dynamic-repository.js";
import { scheduledImportCapability, type EvaluationContext } from "../permissions/dynamic-evaluator.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";

/** Called inside the permission fence and the row's business transaction on every execution. */
export async function assertSheetAuthority(tx: Prisma.TransactionClient, repository: DynamicPermissionRepository,
  authorizedBy: string, campusId: string, assignment: boolean): Promise<void> {
  const user = await tx.collaborator.findUnique({ where: { id: authorizedBy } });
  const campus = await tx.crmReference.findUnique({ where: { id: campusId } });
  if (!user?.active || user.firstLoginRequired || campus?.kind !== "CAMPUS" || campus.state !== "ACTIVE"
    || !user.roles.length || user.roles.some((role) => !isRole(role))) throw new Error("sheet_authority_revoked");
  const currentRoles = user.roles.filter(isRole);
  const assignedCampus = user.campusId ? await canonicalCampus(tx, user.campusId) : undefined;
  const globalAllowed = currentRoles.includes("SUPER_ADMIN");
  const context: EvaluationContext = { campus: campus.id, active: true, own: false, team: false,
    globalAllowed, campusAllowed: globalAllowed || assignedCampus?.id === campus.id };
  const snapshots = await repository.snapshots(tx);
  const permissions = ["settings.campus.manage", "import.execute", "import.confirm"] as const;
  if (!permissions.every((key) => scheduledImportCapability(currentRoles, key, snapshots, context))
    || assignment && !scheduledImportCapability(currentRoles, "lead.assign", snapshots, context)) throw new Error("sheet_authority_revoked");
}

function isRole(value: string): value is Role { return (roles as readonly string[]).includes(value); }
