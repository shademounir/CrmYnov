import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadReportingRow } from "../leads/lead.service.js";
import { CommercialFunnelService, type CommercialFunnel } from "./commercial-funnel.service.js";
import { CommercialPerformanceService, type CommercialPerformanceReport } from "./commercial-performance.service.js";
import { OperationalRiskService, type OperationalRiskReport } from "./operational-risk.service.js";
import { SharedContributionService, type SharedContributionReport } from "./shared-contribution.service.js";
import { SourceEffectivenessService, type SourceEffectivenessReport } from "./source-effectiveness.service.js";
import { matchesInteractiveFilters, normalizeReportingQuery, reportingSearchParams, type InteractiveReportingQuery } from "./reporting-filter.js";

export const MANAGER_DASHBOARD_VERSION = "manager-dashboard-v1";
export type ManagerDashboardQuery = InteractiveReportingQuery;
export interface ManagerDashboardReport {
  definitionVersion: string; generatedAt: string; timezone: "Africa/Casablanca";
  filters: ManagerDashboardQuery;
  panels: {
    funnel: CommercialFunnel; performance: CommercialPerformanceReport; sourceEffectiveness: SourceEffectivenessReport;
    operationalRisks: OperationalRiskReport; sharedContributions: SharedContributionReport;
  };
  cards: { uniqueLeads: number; enrolled: number; unassigned: number; overdueFollowUps: number; activeAlerts: number };
  trends: Array<{ date: string; leadsCreated: number; leadsEnrolled: number }>;
  distributions: { source: Array<{ value: string; count: number }>; campaign: Array<{ value: string; count: number }>; program: Array<{ value: string; count: number }>; campus: Array<{ value: string; count: number }> };
  navigation: Array<{ key: string; href: string; definitionVersion: string }>;
  drillDowns: Array<{ key: string; count: number; href: string }>;
  export: { href: string; schemaVersion: "manager-dashboard-export-v1"; aggregatedOnly: true };
  safeguards: { singlePrimaryConversionAttribution: true; financialDecision: false; disciplinaryScore: false };
}
export interface PersonalDashboardReport {
  definitionVersion: "personal-dashboard-v1"; generatedAt: string; timezone: "Africa/Casablanca"; filters: ManagerDashboardQuery;
  performance: CommercialPerformanceReport; contributions: SharedContributionReport;
  safeguards: { personalScopeOnly: true; aggregatedOnly: true; financialDecision: false; disciplinaryScore: false };
}

@Injectable()
export class ManagerDashboardService {
  constructor(
    private readonly funnel: CommercialFunnelService,
    private readonly performance: CommercialPerformanceService,
    private readonly sources: SourceEffectivenessService,
    private readonly risks: OperationalRiskService,
    private readonly contributions: SharedContributionService,
    private readonly leads: LeadService,
    private readonly audit: AuditService,
  ) {}

  read(raw: Record<string, string | undefined>, principal: Principal, correlationId: string, now = new Date()): ManagerDashboardReport {
    const query = normalizeReportingQuery(raw, principal, now);
    const common = { ...query };
    const panels = {
      funnel: this.funnel.read(common, principal, correlationId),
      performance: this.performance.read(common, principal, correlationId, now),
      sourceEffectiveness: this.sources.read(common, principal, correlationId, now),
      operationalRisks: this.risks.read(common, principal, correlationId, now),
      sharedContributions: this.contributions.read(common, principal, correlationId, now),
    };
    const rows = this.filteredRows(query, principal);
    const cards = { uniqueLeads: panels.funnel.cohort.totalUniqueLeads, enrolled: panels.funnel.attainment.enrolled,
      unassigned: panels.operationalRisks.queues.unassigned, overdueFollowUps: panels.operationalRisks.queues.overdueFollowUps,
      activeAlerts: panels.operationalRisks.alerts.length };
    const trends = this.trends(rows);
    const distributions = { source: panels.funnel.breakdowns.source, campaign: panels.funnel.breakdowns.campaign,
      program: panels.funnel.breakdowns.program, campus: panels.funnel.breakdowns.campus };
    const suffix = reportingSearchParams(query).toString();
    const navigation = [
      { key: "funnel", href: `/manager/reports/commercial-funnel?${suffix}`, definitionVersion: panels.funnel.definitionVersion },
      { key: "performance", href: `/manager/reports/commercial-performance?${suffix}`, definitionVersion: panels.performance.definitionVersion },
      { key: "sourceEffectiveness", href: `/manager/reports/source-effectiveness?${suffix}`, definitionVersion: panels.sourceEffectiveness.definitionVersion },
      { key: "operationalRisks", href: `/manager/reports/operational-risks?${suffix}`, definitionVersion: panels.operationalRisks.definitionVersion },
      { key: "sharedContributions", href: `/manager/reports/shared-contributions?${suffix}`, definitionVersion: panels.sharedContributions.definitionVersion },
    ];
    const drillDowns = [
      { key: "uniqueLeads", count: cards.uniqueLeads, href: this.leadHref(query) },
      { key: "enrolled", count: cards.enrolled, href: this.leadHref({ ...query, status: "ENROLLED" }) },
      { key: "unassigned", count: cards.unassigned, href: this.leadHref(query, { view: "UNASSIGNED" }) },
      { key: "overdueFollowUps", count: cards.overdueFollowUps, href: this.leadHref(query, { view: "FOLLOW_UP" }) },
    ];
    const exportHref = `/reports/manager-dashboard/export?${suffix}`;
    const report: ManagerDashboardReport = { definitionVersion: MANAGER_DASHBOARD_VERSION, generatedAt: now.toISOString(), timezone: "Africa/Casablanca",
      filters: common, panels, cards, trends, distributions, navigation,
      drillDowns, export: { href: exportHref, schemaVersion: "manager-dashboard-export-v1", aggregatedOnly: true },
      safeguards: { singlePrimaryConversionAttribution: true, financialDecision: false, disciplinaryScore: false } };
    this.audit.record({ eventType: "MANAGER_DASHBOARD_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { definitionVersion: MANAGER_DASHBOARD_VERSION, panelCount: navigation.length,
        activeFilterNames: Object.keys(common).sort((a, b) => a.localeCompare(b, "en")) }, result: "SUCCESS", idempotencyKey: `manager-dashboard:${randomUUID()}` });
    return report;
  }

  readPersonal(raw: Record<string, string | undefined>, principal: Principal, correlationId: string, now = new Date()): PersonalDashboardReport {
    const query = normalizeReportingQuery({ ...raw, view: "personal", adviserId: principal.userId }, principal, now);
    const report: PersonalDashboardReport = { definitionVersion: "personal-dashboard-v1", generatedAt: now.toISOString(), timezone: "Africa/Casablanca",
      filters: query, performance: this.performance.read(query, principal, `${correlationId}:performance`, now),
      contributions: this.contributions.read(query, principal, `${correlationId}:contributions`, now),
      safeguards: { personalScopeOnly: true, aggregatedOnly: true, financialDecision: false, disciplinaryScore: false } };
    this.audit.record({ eventType: "PERSONAL_DASHBOARD_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { definitionVersion: report.definitionVersion, activeFilterNames: this.sortedKeys(query) }, result: "SUCCESS",
      idempotencyKey: `personal-dashboard:${randomUUID()}` });
    return report;
  }

  exportAggregated(raw: Record<string, string | undefined>, principal: Principal, correlationId: string, now = new Date()): string {
    const report = this.read(raw, principal, correlationId, now);
    const lines = ["schemaVersion,timezone,period,from,to", ["manager-dashboard-export-v1", report.timezone, report.filters.period ?? "", report.filters.from ?? "", report.filters.to ?? ""].map((value) => this.csv(value)).join(","), "section,dimension,value,count"];
    for (const [key, value] of Object.entries(report.cards).sort(([left], [right]) => left.localeCompare(right, "en"))) lines.push(`kpi,${key},,${value}`);
    for (const trend of report.trends) { lines.push(`trend,leadsCreated,${trend.date},${trend.leadsCreated}`); lines.push(`trend,leadsEnrolled,${trend.date},${trend.leadsEnrolled}`); }
    for (const [dimension, values] of Object.entries(report.distributions).sort(([left], [right]) => left.localeCompare(right, "en"))) {
      for (const item of values) lines.push(`distribution,${dimension},${this.csv(item.value)},${item.count}`);
    }
    return `${lines.join("\n")}\n`;
  }

  private filteredRows(query: ManagerDashboardQuery, principal: Principal): LeadReportingRow[] { return this.leads.reportingSnapshot(principal).filter((lead) => matchesInteractiveFilters(lead, query)); }
  private trends(rows: LeadReportingRow[]): Array<{ date: string; leadsCreated: number; leadsEnrolled: number }> {
    const values = new Map<string, { leadsCreated: Set<string>; leadsEnrolled: Set<string> }>();
    const bucket = (date: string): { leadsCreated: Set<string>; leadsEnrolled: Set<string> } => { const key = this.localDate(date); const current = values.get(key) ?? { leadsCreated: new Set<string>(), leadsEnrolled: new Set<string>() }; values.set(key, current); return current; };
    for (const row of rows) { bucket(row.createdAt).leadsCreated.add(row.id); for (const activity of row.activities.filter((item) => item.type === "STATUS_CHANGED" && item.result.split("->")[1] === "ENROLLED")) bucket(activity.occurredAt).leadsEnrolled.add(row.id); }
    return [...values].sort(([left], [right]) => left.localeCompare(right, "en")).map(([date, counts]) => ({ date, leadsCreated: counts.leadsCreated.size, leadsEnrolled: counts.leadsEnrolled.size }));
  }
  private localDate(value: string): string { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? ""; return `${part("year")}-${part("month")}-${part("day")}`; }
  private sortedKeys(value: object): string[] { const keys = Object.keys(value); keys.sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" })); return keys; }
  private leadHref(query: ManagerDashboardQuery, overrides: Record<string, string> = {}): string {
    const params = new URLSearchParams();
    const mapping: Array<[keyof ManagerDashboardQuery, string]> = [["from", "createdFrom"], ["to", "createdTo"], ["campus", "campus"], ["campaign", "campaign"], ["program", "program"], ["source", "source"], ["channel", "channel"], ["adviserId", "assignedToId"], ["status", "status"]];
    for (const [source, target] of mapping) {
      const value = query[source];
      if (value) params.set(target, value);
    }
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    params.set("returnTo", `/manager/reports/dashboard?${reportingSearchParams(query).toString()}`);
    return `/leads?${params.toString()}`;
  }
  private csv(value: string): string { const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
}
