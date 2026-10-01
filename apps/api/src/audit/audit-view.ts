import type { AuditEvent } from "@prisma/client";
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export function technicalId(value: string | null): string | null { return value && uuid.test(value) ? value : null; }
function classification(value: string | null): string | null { return value && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null; }
/** Closed allowlist, not a blacklist: arbitrary text and nested objects never leave the API. */
export function auditMetadata(value: unknown): Record<string, number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, number | boolean> = {};
  for (const key of ["version", "expectedVersion", "active", "count", "created", "total"]) {
    const item: unknown = Reflect.get(value, key);
    if (typeof item === "boolean" || typeof item === "number" && Number.isSafeInteger(item) && item >= 0) safe[key] = item;
  }
  return safe;
}
export interface AuditView { id: string; eventType: string; actorId: string | null; actorRoles: string[]; campusId: string | null; resourceType: string | null; resourceId: string | null; result: string; occurredAt: string; before: Record<string, number | boolean>; after: Record<string, number | boolean> }
export function auditView(row: AuditEvent): AuditView {
  return { id: row.id, eventType: classification(row.eventType) ?? "OTHER", actorId: technicalId(row.actorId),
    actorRoles: row.actorRoles.filter((role) => ["SUPER_ADMIN", "ADMIN", "AUDITOR", "MANAGER", "ADMISSIONS"].includes(role)),
    campusId: technicalId(row.campusId), resourceType: classification(row.resourceType), resourceId: technicalId(row.resourceId),
    result: ["SUCCESS", "DENIED", "FAILED"].includes(row.result) ? row.result : "UNKNOWN", occurredAt: row.occurredAt.toISOString(),
    before: auditMetadata(row.before), after: auditMetadata(row.after) };
}
