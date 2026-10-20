import { ForbiddenException } from "@nestjs/common";
import type { AuditEvent, PrismaClient } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import type { PermissionService, ResourceContext } from "../permissions/permission.service.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { professionalDisplayName } from "../users/professional-display-name.js";
import { auditView, technicalId, type AuditActorDisplay, type AuditLeadDisplay, type AuditView } from "./audit-view.js";

type Access = Pick<PermissionService, "can">;
type CampusAccess = (value: string | null) => Promise<ResourceContext | null>;
const unavailableActor: AuditActorDisplay = { kind: "UNAVAILABLE", label: null };
const unavailableLead: AuditLeadDisplay = { kind: "UNAVAILABLE", id: null, label: null, reference: null };

function validName(value: unknown): string | null {
  try { return professionalDisplayName(value); } catch { return null; }
}
/** Request-local only. The HTTP interceptor's shared permission fence and Prisma
 * transaction cover the visible events, current identities and permission reads.
 * Never infer historical event campus or names from these current records. */
function campusAccess(client: PrismaClient, permissions: Access, principal: Principal): CampusAccess {
  const cache = new Map<string | null, Promise<ResourceContext | null>>();
  const resolve = async (value: string | null): Promise<ResourceContext | null> => {
    if (value !== null && !value.trim()) return null;
    let resource: ResourceContext;
    try {
      resource = value === null ? { scope: "GLOBAL", campusKeys: [], active: true }
        : { scope: "CAMPUS", campusKeys: (await canonicalCampus(client, value)).keys, active: true };
    } catch (error) { if (error instanceof ForbiddenException) return null; throw error; }
    return await permissions.can(principal, "audit.view", resource) ? resource : null;
  };
  return (value) => { let result = cache.get(value); if (!result) { result = resolve(value); cache.set(value, result); } return result; };
}
async function actors(client: PrismaClient, rows: readonly AuditEvent[], campus: CampusAccess): Promise<Map<string, AuditActorDisplay>> {
  const ids = [...new Set(rows.filter((row) => !row.actorRoles.includes("SYSTEM")).flatMap((row) => technicalId(row.actorId) ?? []))];
  const result = new Map<string, AuditActorDisplay>();
  if (!ids.length) return result;
  const records = await client.collaborator.findMany({ where: { id: { in: ids } }, select: { id: true, professionalDisplayName: true, campusId: true, active: true } });
  for (const record of records) {
    const label = validName(record.professionalDisplayName);
    if (record.active && label && await campus(record.campusId)) result.set(record.id, { kind: "CURRENT_PROFILE", label });
  }
  return result;
}
async function eventLeadIds(client: PrismaClient, rows: readonly AuditEvent[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const row of rows) if (row.resourceType === "LEAD" && technicalId(row.resourceId)) result.set(row.id, row.resourceId!);
  const ids = [...new Set(rows.filter((row) => row.resourceType === "APPOINTMENT").flatMap((row) => technicalId(row.resourceId) ?? []))];
  if (!ids.length) return result;
  const appointments = await client.appointment.findMany({ where: { id: { in: ids } }, select: { id: true, leadId: true } });
  const related = new Map(appointments.map((row) => [row.id, row.leadId]));
  for (const row of rows) if (row.resourceType === "APPOINTMENT" && row.resourceId && related.has(row.resourceId)) result.set(row.id, related.get(row.resourceId)!);
  return result;
}
async function leads(client: PrismaClient, ids: readonly string[], permissions: Access, principal: Principal, campus: CampusAccess): Promise<Map<string, AuditLeadDisplay>> {
  const result = new Map<string, AuditLeadDisplay>();
  if (!ids.length) return result;
  const records = await client.lead.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true, leadCode: true, campus: true, assignedToId: true, collaborators: { where: { active: true }, select: { userId: true } } } });
  for (const record of records) {
    const resource = await campus(record.campus);
    if (!resource || !await permissions.can(principal, "lead.view", { ...resource, ...(record.assignedToId ? { ownerId: record.assignedToId } : {}), collaboratorIds: record.collaborators.map((row) => row.userId), readableResource: true })) continue;
    const label = `${record.firstName} ${record.lastName}`.trim();
    if (!label || label.length > 201 || /\p{Cc}/u.test(label) || !/^[A-Za-z0-9_-]{1,32}$/.test(record.leadCode)) continue;
    result.set(record.id, { kind: "CURRENT_RECORD", id: record.id, label, reference: record.leadCode });
  }
  return result;
}
/** Enrich only the already authorized, bounded page; no directory endpoint, no
 * arbitrary before/after JSON or email fallback, no event/snapshot rewrite. */
export async function auditIdentities(client: PrismaClient, permissions: Access, principal: Principal, rows: readonly AuditEvent[]): Promise<AuditView[]> {
  if (rows.length > 100) throw new Error("audit_identity_page_unbounded");
  const campus = campusAccess(client, permissions, principal), actorLabels = await actors(client, rows, campus), relations = await eventLeadIds(client, rows);
  const leadLabels = await leads(client, [...relations.values()], permissions, principal, campus);
  return rows.map((row) => {
    const view = auditView(row), leadId = relations.get(row.id);
    if (view.actorDisplay.kind !== "SYSTEM") view.actorDisplay = actorLabels.get(row.actorId ?? "") ?? { ...unavailableActor };
    if (leadId) view.leadDisplay = leadLabels.get(leadId) ?? { ...unavailableLead };
    return view;
  });
}
