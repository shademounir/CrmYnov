import { BadRequestException } from "@nestjs/common";
export interface AuditQuery { page: number; pageSize: number; snapshot: Date; from?: Date; to?: Date; actorId?: string; eventType?: string; resourceId?: string; resourceType?: string; result?: string; campus?: string }
export function invalidAuditQuery(): never { throw new BadRequestException({ code: "audit_query_invalid" }); }
export function auditId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)) invalidAuditQuery();
  return value;
}
function number(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) invalidAuditQuery();
  const parsed = Number(value); if (parsed < 1 || parsed > max) invalidAuditQuery(); return parsed;
}
function date(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalidAuditQuery();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) invalidAuditQuery();
  return parsed;
}
export function parseAuditQuery(raw: Record<string, unknown>, now = new Date()): AuditQuery {
  const allowed = ["page", "pageSize", "snapshot", "from", "to", "actorId", "eventType", "resourceId", "resourceType", "result", "campus"];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) invalidAuditQuery();
  const query: AuditQuery = { page: number(raw.page, 1, 10000), pageSize: number(raw.pageSize, 25, 100), snapshot: raw.snapshot === undefined ? now : date(raw.snapshot) };
  if (query.snapshot > now) invalidAuditQuery();
  for (const key of ["from", "to"] as const) if (raw[key] !== undefined) query[key] = date(raw[key]);
  if (query.from && query.to && query.from > query.to) invalidAuditQuery();
  for (const key of ["actorId", "resourceId", "campus"] as const) if (raw[key] !== undefined) query[key] = auditId(raw[key]);
  for (const key of ["eventType", "resourceType"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(raw[key])) invalidAuditQuery();
    query[key] = raw[key];
  }
  if (raw.result !== undefined) {
    if (typeof raw.result !== "string" || !["SUCCESS", "DENIED", "FAILED"].includes(raw.result)) invalidAuditQuery();
    query.result = raw.result;
  }
  return query;
}
