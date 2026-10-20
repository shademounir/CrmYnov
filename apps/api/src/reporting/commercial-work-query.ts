import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { isPersonalReportingRequest, normalizeScopedReportingQuery, reportingSearchParams, type InteractiveReportingQuery } from "./reporting-filter.js";
import type { CommercialWorkQueue } from "./commercial-work.js";

export type WorkAdviserScope = "PRIMARY" | "INVOLVED";
/** Explicit intersection: an existing involved-adviser cohort is not replaced
 * when a primary-owner drilldown adds assignedToId. Creation end is exclusive. */
export function portfolioLeadHref(query: InteractiveReportingQuery, refinements: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams();
  const mapping = { from: "createdFrom", to: "createdBefore", campus: "campus", campaign: "campaign", program: "program", source: "source", channel: "channel", adviserId: "adviserId", status: "status", treatmentFrom: "treatmentFrom", treatmentTo: "treatmentTo", treatmentState: "treatmentState" } as const;
  for (const [key, field] of Object.entries(mapping)) { const value = query[key as keyof typeof mapping]; if (value) params.set(field, value); }
  for (const [key, value] of Object.entries(refinements)) params.set(key, value);
  return `/leads?${params.toString()}`;
}
export function workAdviserScope(value = "PRIMARY"): WorkAdviserScope {
  if (value !== "PRIMARY" && value !== "INVOLVED") throw new BadRequestException({ code: "commercial_work_adviser_scope_invalid" });
  return value;
}
export function workTaskOwner(value: string | undefined, query: InteractiveReportingQuery, principal: Principal): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[\p{L}\p{N}_.-]{1,100}$/u.test(value)) throw new BadRequestException({ code: "commercial_work_task_owner_invalid" });
  if (isPersonalReportingRequest(query, principal) && value !== principal.userId) throw new ForbiddenException({ code: "commercial_work_task_owner_forbidden" });
  return value;
}
/** Preserve even an all-time or one-sided older reporting cohort, without fake
 * date bounds and without reinterpreting involvement as primary ownership. */
export function commercialWorkHref(query: InteractiveReportingQuery, queue: CommercialWorkQueue, adviserScope: WorkAdviserScope, taskOwnerId?: string): string {
  const params = reportingSearchParams(query);
  params.set("period", query.from && query.to ? "custom" : "open");
  params.set("queue", queue); params.set("adviserScope", adviserScope);
  if (taskOwnerId) params.set("taskOwnerId", taskOwnerId);
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
