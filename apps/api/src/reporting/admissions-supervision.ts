import type { Principal } from "../auth/auth.types.js";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { GLOBAL_CAMPUS, type ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import { resolveGrants } from "../permissions/dynamic-evaluator.js";
import type { EvaluationContext } from "../permissions/dynamic-evaluator.js";

// A functional responsibility is not the Commercial ADMISSIONS role. This proof
// is loaded inside the current session/permission fence, never from a DTO/token.
const supervisedCampuses = new WeakMap<Principal, ReadonlySet<string>>();
export async function readAdmissionsSupervision(tx: PermissionTransaction, principal: Principal): Promise<ReadonlySet<string>> {
  const result = new Set<string>();
  if (principal.mustChangeSecret || !principal.roles.includes("ADMISSIONS")) return result;
  const user = await tx.collaborator.findUnique({ where: { id: principal.userId } });
  if (!user?.active || user.firstLoginRequired || !user.campusId || !user.roles.includes("ADMISSIONS")) return result;
  const campus = await canonicalCampus(tx, user.campusId);
  if (!principal.scopes.some(scope => scope.kind === "CAMPUS" && campus.keys.includes(scope.id))) return result;
  const profiles = await tx.admissionsResponsibility.findMany({ where: { userId: principal.userId, active: true, campus: { in: campus.keys } }, select: { campus: true } });
  if (profiles.length) result.add(campus.id);
  return result;
}
export function bindAdmissionsSupervision(principal: Principal, campuses: ReadonlySet<string>): () => void {
  supervisedCampuses.set(principal, new Set(campuses));
  return () => { supervisedCampuses.delete(principal); };
}
export function hasAdmissionsSupervision(principal: Principal): boolean { return Boolean(supervisedCampuses.get(principal)?.size); }

/** Additional read-only source granted by an active campus designation. Ordinary
 * role restrictions still govern lead.view/reporting.view. Explicit global or
 * campus pilotage ceilings can restrict this functional source. No export,
 * mutation, decision, administrative directory or cross-campus authority. */
export function admissionsPilotageAllowed(principal: Principal, key: string, rows: readonly ConfigurationSnapshot[], context: EvaluationContext): boolean {
  if (key !== "reporting.pilotage.view" || !context.active || !context.campusAllowed || context.restriction
    || !supervisedCampuses.get(principal)?.has(context.campus)) return false;
  return [GLOBAL_CAMPUS, context.campus].every(campus => {
    const scope = resolveGrants(rows, { kind: "CEILING", role: "*", campus })[key];
    return scope === "GLOBAL" || scope === "CAMPUS";
  });
}
