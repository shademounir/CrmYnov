import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Principal } from "../auth/auth.types.js";
import { leadStatuses, type LeadReportingRow, type LeadStatus } from "../leads/lead.service.js";

export const REPORTING_TIMEZONE = "Africa/Casablanca" as const;
export const reportingPeriods = ["7d", "30d", "90d", "custom"] as const;
export const reportingViews = ["global", "personal"] as const;
export const reportingChannels = ["DIGITAL", "PHONE", "IN_PERSON", "PARTNER", "OTHER"] as const;

export interface InteractiveReportingQuery {
  period?: string; from?: string; to?: string; campus?: string; campaign?: string; program?: string;
  source?: string; channel?: string; adviserId?: string; status?: string; view?: string;
}

const allowedKeys = new Set(["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view"]);
const SAFE_VALUE = /^[\p{L}\p{N} ._:/+-]{1,100}$/u;

export function normalizeReportingQuery(
  raw: Record<string, string | undefined>,
  principal: Principal,
  now = new Date(),
): InteractiveReportingQuery {
  const unknown = Object.keys(raw).filter((key) => !allowedKeys.has(key));
  if (unknown.length) throw new BadRequestException({ code: "reporting_filter_unknown", fields: unknown.sort() });
  const value = (key: keyof InteractiveReportingQuery): string | undefined => {
    const current = raw[key]?.trim();
    if (!current) return undefined;
    if (!SAFE_VALUE.test(current)) {
      throw new BadRequestException({ code: "reporting_filter_invalid", field: key });
    }
    return current;
  };
  const period = value("period") ?? (raw.from || raw.to ? "custom" : "30d");
  if (!reportingPeriods.includes(period as (typeof reportingPeriods)[number])) throw new BadRequestException({ code: "reporting_period_invalid" });
  const view = value("view") ?? (isAdviserOnly(principal) ? "personal" : "global");
  if (!reportingViews.includes(view as (typeof reportingViews)[number])) throw new BadRequestException({ code: "reporting_view_invalid" });
  if (isAdviserOnly(principal) && view !== "personal") throw new ForbiddenException({ code: "reporting_global_view_forbidden" });
  const adviserId = value("adviserId") ?? (view === "personal" ? principal.userId : undefined);
  if (isAdviserOnly(principal) && adviserId !== principal.userId) throw new ForbiddenException({ code: "reporting_adviser_scope_forbidden" });
  const campus = value("campus");
  const global = principal.scopes.some((scope) => scope.kind === "GLOBAL");
  const campuses = new Set(principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []));
  if (campus && !global && !campuses.has(campus)) throw new ForbiddenException({ code: "reporting_campus_scope_forbidden" });
  const channel = value("channel");
  if (channel && !reportingChannels.includes(channel as (typeof reportingChannels)[number])) throw new BadRequestException({ code: "reporting_channel_invalid" });
  const status = value("status")?.toUpperCase();
  if (status && !leadStatuses.includes(status as LeadStatus)) throw new BadRequestException({ code: "reporting_status_invalid" });
  let from = value("from"); let to = value("to");
  if (period === "custom" && (!from || !to)) throw new BadRequestException({ code: "reporting_custom_period_incomplete" });
  if (period !== "custom") {
    const days = Number.parseInt(period, 10); const end = new Date(now); const start = new Date(end.valueOf() - days * 86_400_000);
    from = start.toISOString(); to = end.toISOString();
  } else {
    from = boundary(from!, "reporting_from_invalid"); to = boundary(to!, "reporting_to_invalid");
  }
  if (!from || !to || from >= to) throw new BadRequestException({ code: "reporting_period_invalid" });
  const campaign = value("campaign"); const program = value("program"); const source = value("source");
  return {
    period, from, to, view, ...(campus ? { campus } : {}), ...(campaign ? { campaign } : {}),
    ...(program ? { program } : {}), ...(source ? { source } : {}),
    ...(channel ? { channel } : {}), ...(adviserId ? { adviserId } : {}), ...(status ? { status } : {}),
  };
}

export function matchesInteractiveFilters(row: LeadReportingRow, query: InteractiveReportingQuery): boolean {
  const exact = (actual: string, expected?: string): boolean => !expected || actual.localeCompare(expected, "fr", { sensitivity: "accent" }) === 0;
  return (!query.from || row.createdAt >= query.from) && (!query.to || row.createdAt < query.to)
    && exact(row.campus, query.campus) && exact(row.campaign, query.campaign) && exact(row.program, query.program)
    && exact(row.source, query.source) && (!query.channel || sourceChannel(row.source) === query.channel)
    && (!query.adviserId || row.assignedToId === query.adviserId || row.collaboratorIds.includes(query.adviserId))
    && (!query.status || row.status === query.status);
}

export function sourceChannel(source: string): (typeof reportingChannels)[number] {
  if (source === "PHONE_CALL") return "PHONE";
  if (source === "PHYSICAL_VISIT" || source === "EVENT") return "IN_PERSON";
  if (["WEB_FORM", "WEBSITE", "FORMINATOR_ZAPIER", "YNOV_COM"].includes(source)) return "DIGITAL";
  if (source === "PARTNER" || source === "JOBINTECH") return "PARTNER";
  return "OTHER";
}

export function reportingSearchParams(query: InteractiveReportingQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of [...allowedKeys].sort()) { const current = query[key as keyof InteractiveReportingQuery]; if (current) params.set(key, current); }
  return params;
}

function boundary(value: string, code: string): string {
  const parsed = new Date(value); if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code }); return parsed.toISOString();
}
function isAdviserOnly(principal: Principal): boolean {
  return principal.roles.includes("ADMISSIONS") && !principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
}
