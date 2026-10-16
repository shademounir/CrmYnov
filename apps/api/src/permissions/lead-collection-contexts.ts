import type { Principal } from "../auth/auth.types.js";
import type { PermissionTransaction } from "./dynamic-repository.js";
import type { EvaluationContext } from "./dynamic-evaluator.js";
import { permissionDenied, transactionResourceResolver } from "./dynamic-context.js";
import { canonicalCampus } from "./dynamic-resources.js";

/** Identical resource semantics to leadResource + resourceEvaluationContext,
 * with one Lead/collaborator projection and transaction-local identity lookups.
 * No cache survives the PostgreSQL permission fence. */
export async function leadCollectionContexts(tx: PermissionTransaction, principal: Principal): Promise<Map<string, EvaluationContext>> {
  const campusKeys = principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
  const leads = await tx.lead.findMany({
    where: principal.roles.includes("SUPER_ADMIN") ? {} : { campus: { in: campusKeys } },
    select: { id: true, campus: true, assignedToId: true, collaborators: { where: { active: true }, select: { userId: true } } },
  });
  const campuses = new Map<string, Promise<Awaited<ReturnType<typeof canonicalCampus>>>>();
  const resolve = transactionResourceResolver(tx, principal);
  const contexts = new Map<string, EvaluationContext>();
  for (const lead of leads) {
    if (!/^[a-f\d-]{36}$/i.test(lead.id)) permissionDenied();
    let campus = campuses.get(lead.campus);
    if (!campus) { campus = canonicalCampus(tx, lead.campus); campuses.set(lead.campus, campus); }
    const canonical = await campus;
    contexts.set(lead.id, await resolve({ scope: "CAMPUS", campusKeys: canonical.keys, active: true,
      ...(lead.assignedToId ? { ownerId: lead.assignedToId } : {}), collaboratorIds: lead.collaborators.map((item) => item.userId), readableResource: true }));
  }
  return contexts;
}
