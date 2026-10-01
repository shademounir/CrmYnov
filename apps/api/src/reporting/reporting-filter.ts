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

const allowedKeyList = ["period", "from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view"] as const;
const allowedKeys = new Set<string>(allowedKeyList);
const SAFE_VALUE = /^[\p{L}\p{N} ._:/+-]{1,100}$/u;
const compareText = (left: string, right: string): number => left.localeCompare(right, "fr", { sensitivity: "accent", numeric: true });

export function normalizeReportingQuery(
  raw: Record<string, string | undefined>,
  principal: Principal,
  now = new Date(),
): InteractiveReportingQuery {
  refuseUnknownKeys(raw);
  const value = (key: keyof InteractiveReportingQuery): string | undefined => safeValue(raw, key);
  const period = normalizePeriod(value("period"), raw);
  const view = normalizeView(value("view"), principal);
  const adviserId = normalizeAdviser(value("adviserId"), view, principal);
  const campus = normalizeCampus(value("campus"), principal);
  const channel = normalizeChannel(value("channel"));
  const status = normalizeStatus(value("status"));
  const { from, to } = normalizeBoundaries(period, value("from"), value("to"), now);
  const campaign = value("campaign");
  const program = value("program");
  const source = value("source");
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
  const sortedKeys = [...allowedKeyList];
  sortedKeys.sort(compareText);
  for (const key of sortedKeys) {
    const current = query[key];
    if (current) params.set(key, current);
  }
  return params;
}

function refuseUnknownKeys(raw: Record<string, string | undefined>): void {
  const unknown = Object.keys(raw).filter((key) => !allowedKeys.has(key));
  unknown.sort(compareText);
  if (unknown.length > 0) throw new BadRequestException({ code: "reporting_filter_unknown", fields: unknown });
}

function safeValue(raw: Record<string, string | undefined>, key: keyof InteractiveReportingQuery): string | undefined {
  const current = raw[key]?.trim();
  if (!current) return undefined;
  if (!SAFE_VALUE.test(current)) throw new BadRequestException({ code: "reporting_filter_invalid", field: key });
  return current;
}

function normalizePeriod(current: string | undefined, raw: Record<string, string | undefined>): string {
  const period = current ?? (raw.from || raw.to ? "custom" : "30d");
  if (!reportingPeriods.includes(period as (typeof reportingPeriods)[number])) throw new BadRequestException({ code: "reporting_period_invalid" });
  return period;
}

function normalizeView(current: string | undefined, principal: Principal): string {
  const adviserOnly = isAdviserOnly(principal);
  const view = current ?? (adviserOnly ? "personal" : "global");
  if (!reportingViews.includes(view as (typeof reportingViews)[number])) throw new BadRequestException({ code: "reporting_view_invalid" });
  if (adviserOnly && view !== "personal") throw new ForbiddenException({ code: "reporting_global_view_forbidden" });
  return view;
}

function normalizeAdviser(current: string | undefined, view: string, principal: Principal): string | undefined {
  const adviserId = current ?? (view === "personal" ? principal.userId : undefined);
  if (isAdviserOnly(principal) && adviserId !== principal.userId) throw new ForbiddenException({ code: "reporting_adviser_scope_forbidden" });
  return adviserId;
}

function normalizeCampus(campus: string | undefined, principal: Principal): string | undefined {
  const global = principal.scopes.some((scope) => scope.kind === "GLOBAL");
  const campuses = new Set(principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []));
  if (campus && !global && !campuses.has(campus)) throw new ForbiddenException({ code: "reporting_campus_scope_forbidden" });
  return campus;
}

function normalizeChannel(channel: string | undefined): string | undefined {
  if (channel && !reportingChannels.includes(channel as (typeof reportingChannels)[number])) throw new BadRequestException({ code: "reporting_channel_invalid" });
  return channel;
}

function normalizeStatus(value: string | undefined): string | undefined {
  const status = value?.toUpperCase();
  if (status && !leadStatuses.includes(status as LeadStatus)) throw new BadRequestException({ code: "reporting_status_invalid" });
  return status;
}

function normalizeBoundaries(period: string, rawFrom: string | undefined, rawTo: string | undefined, now: Date): { from: string; to: string } {
  if (period === "custom") {
    if (!rawFrom || !rawTo) throw new BadRequestException({ code: "reporting_custom_period_incomplete" });
    return orderedBoundaries(boundary(rawFrom, "reporting_from_invalid"), boundary(rawTo, "reporting_to_invalid"));
  }
  const days = Number.parseInt(period, 10);
  const to = new Date(now).toISOString();
  const from = new Date(now.valueOf() - days * 86_400_000).toISOString();
  return orderedBoundaries(from, to);
}

function orderedBoundaries(from: string, to: string): { from: string; to: string } {
  if (from >= to) throw new BadRequestException({ code: "reporting_period_invalid" });
  return { from, to };
}

function boundary(value: string, code: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code });
  return parsed.toISOString();
}
function isAdviserOnly(principal: Principal): boolean {
  return principal.roles.includes("ADMISSIONS") && !principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
}
