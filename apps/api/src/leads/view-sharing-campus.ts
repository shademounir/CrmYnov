import type { Principal } from "../auth/auth.types.js";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import { permissionDenied } from "../permissions/dynamic-context.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";

const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

/** Server-produced scopes only. null is the separate, explicit Super Admin GLOBAL branch. */
export async function canonicalAudienceCampusIds(tx: PermissionTransaction, principal: Principal): Promise<string[] | null> {
  if (principal.roles.includes("SUPER_ADMIN") && principal.scopes.some((scope) => scope.kind === "GLOBAL")) return null;
  const ids = new Set<string>();
  for (const scope of principal.scopes) {
    if (scope.kind !== "CAMPUS") continue;
    // Do not let the legacy resolver's UUID detection send malformed UUID-like values to Prisma.
    if (scope.id === "GLOBAL" || (/^[a-f\d-]{36}$/i.test(scope.id) && !uuid.test(scope.id))) permissionDenied();
    const campus = await canonicalCampus(tx, scope.id);
    // Unknown/ambiguous/inactive references are refused by the existing resolver, never broadened.
    if (!uuid.test(campus.id)) permissionDenied();
    ids.add(campus.id);
  }
  return [...ids];
}
