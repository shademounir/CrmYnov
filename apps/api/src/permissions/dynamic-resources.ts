import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import type { ResourceContext } from "./permission.service.js";
import type { PermissionTransaction } from "./dynamic-repository.js";
import { permissionDenied, campusContext, resourceEvaluationContext } from "./dynamic-context.js";
import { resolveReference } from "../references/reference.repository.js";
import { definition, GLOBAL_CAMPUS } from "./dynamic-contract.js";
import type { EvaluationContext } from "./dynamic-evaluator.js";

export async function canonicalCampus(tx: PermissionTransaction, value: string): Promise<{ id: string; keys: string[] }> {
  const campus = /^[a-f\d-]{36}$/i.test(value) ? await tx.crmReference.findUnique({ where: { id: value } }) : await resolveReference(tx, "CAMPUS", value);
  if (!campus || campus.kind !== "CAMPUS" || campus.state !== "ACTIVE") permissionDenied();
  return { id: campus.id, keys: [campus.id, campus.code, campus.label, ...(await tx.crmReferenceKey.findMany({ where: { referenceId: campus.id } })).map((row) => row.key)] };
}
export async function leadResource(tx: PermissionTransaction, id: string): Promise<ResourceContext> {
  if (!/^[a-f\d-]{36}$/i.test(id)) permissionDenied();
  const lead = await tx.lead.findUnique({ where: { id }, include: { collaborators: { where: { active: true } } } });
  if (!lead) permissionDenied();
  const campus = await canonicalCampus(tx, lead.campus);
  return { scope: "CAMPUS", campusKeys: campus.keys, active: true, ...(lead.assignedToId ? { ownerId: lead.assignedToId } : {}), collaboratorIds: lead.collaborators.map((row) => row.userId), readableResource: true };
}
function scalar(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
async function relatedLeadId(tx: PermissionTransaction, request: AuthenticatedRequest, controller: string): Promise<string | undefined> {
  const id = scalar(request.params.id ?? request.params.requestId);
  if (!id) return undefined;
  if (controller === "ReassignmentController") return (await tx.reassignmentRequest.findUnique({ where: { id } }))?.leadId ?? permissionDenied();
  if (controller === "ClosureController") return (await tx.leadClosureRequest.findUnique({ where: { id } }))?.leadId ?? permissionDenied();
  if (controller === "LeadCollaborationController") return (await tx.leadCollaborationRequest.findUnique({ where: { id } }))?.leadId ?? permissionDenied();
  if (controller === "AppointmentController") return (await tx.appointment.findUnique({ where: { id } }))?.leadId ?? permissionDenied();
  if (controller === "DocumentVerificationController") return (await tx.candidateDocument.findUnique({ where: { id } }))?.leadId ?? permissionDenied();
  return undefined;
}
export async function routeContexts(tx: PermissionTransaction, request: AuthenticatedRequest, controller: string, key: string, principal: Principal, serverLeadIds: readonly string[] = []): Promise<EvaluationContext[]> {
  if (serverLeadIds.length) return Promise.all(serverLeadIds.map(async (id) => resourceEvaluationContext(tx, principal, await leadResource(tx, id))));
  const leadId = scalar(request.params.leadId) ?? await relatedLeadId(tx, request, controller);
  if (leadId) return [await resourceEvaluationContext(tx, principal, await leadResource(tx, leadId))];
  const rawBody: unknown = request.body;
  const body = rawBody && typeof rawBody === "object" ? rawBody as Record<string, unknown> : {};
  if (controller === "LeadAssignmentController" && Array.isArray(body.leadIds)) {
    if (!body.leadIds.length || body.leadIds.length > 100 || !body.leadIds.every((id): id is string => typeof id === "string")) permissionDenied();
    return Promise.all(body.leadIds.map(async (id) => resourceEvaluationContext(tx, principal, await leadResource(tx, id))));
  }
  if (definition(key)?.reserved || key.startsWith("users.")) return [campusContext(principal, GLOBAL_CAMPUS)];
  const selected = scalar(body.campus ?? body.campusId ?? request.query.campus ?? request.query.campusId);
  const records = Array.isArray(body.records) ? body.records as unknown[] : [];
  const campuses = records.map((record) => record && typeof record === "object" && "campus" in record ? scalar(record.campus) : undefined);
  if (records.length && campuses.some((campus) => !campus)) permissionDenied();
  if (selected) campuses.push(selected);
  if (!campuses.length) {
    const allowed = principal.roles.includes("SUPER_ADMIN")
      ? (await tx.crmReference.findMany({ where: { kind: "CAMPUS", state: "ACTIVE" }, select: { id: true } })).map((row) => row.id)
      : principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []);
    campuses.push(...allowed);
  }
  if (!campuses.length) return [campusContext(principal, GLOBAL_CAMPUS)];
  return Promise.all([...new Set(campuses)].map(async (value) => {
    const campus = await canonicalCampus(tx, value!);
    return resourceEvaluationContext(tx, principal, { scope: "CAMPUS", campusKeys: campus.keys, active: true });
  }));
}
