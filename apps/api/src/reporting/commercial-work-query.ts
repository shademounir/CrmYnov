import { BadRequestException } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { normalizeScopedReportingQuery, reportingSearchParams, type InteractiveReportingQuery } from "./reporting-filter.js";
import type { CommercialWorkQueue } from "./commercial-work.js";

export type WorkAdviserScope = "PRIMARY" | "INVOLVED";
export function workAdviserScope(value = "PRIMARY"): WorkAdviserScope {
  if (value !== "PRIMARY" && value !== "INVOLVED") throw new BadRequestException({ code: "commercial_work_adviser_scope_invalid" });
  return value;
}
/** Preserve even an all-time or one-sided older reporting cohort, without fake
 * date bounds and without reinterpreting involvement as primary ownership. */
export function commercialWorkHref(query: InteractiveReportingQuery, queue: CommercialWorkQueue, adviserScope: WorkAdviserScope): string {
  const params = reportingSearchParams(query);
  params.set("period", query.from && query.to ? "custom" : "open");
  params.set("queue", queue); params.set("adviserScope", adviserScope);
  return `/manager/reports/commercial-work?${params.toString()}`;
}
export function normalizeWorkQuery(raw: Record<string, string | undefined>, principal: Principal, now: Date): InteractiveReportingQuery {
  if (raw.period !== "open") return normalizeScopedReportingQuery(raw, principal, now);
  const { from, to, ...fields } = raw;
  const normalized = normalizeScopedReportingQuery({ ...fields, period: "30d" }, principal, now);
  const scope = { ...normalized }; delete scope.from; delete scope.to;
  const boundary = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    if (!value.trim() || !Number.isFinite(Date.parse(value))) throw new BadRequestException({ code: "commercial_work_boundary_invalid" });
    return new Date(value).toISOString();
  };
  const start = boundary(from), end = boundary(to);
  if (start && end && start >= end) throw new BadRequestException({ code: "commercial_work_period_invalid" });
  return { ...scope, period: "open", ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) };
}
