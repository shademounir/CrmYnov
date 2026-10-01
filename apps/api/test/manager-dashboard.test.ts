import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { LeadService } from "../src/leads/lead.service.js";
import type { CommercialFunnelService } from "../src/reporting/commercial-funnel.service.js";
import type { CommercialPerformanceService } from "../src/reporting/commercial-performance.service.js";
import { ManagerDashboardController, PersonalDashboardController } from "../src/reporting/manager-dashboard.controller.js";
import { ManagerDashboardService } from "../src/reporting/manager-dashboard.service.js";
import { normalizeReportingQuery, reportingSearchParams, sourceChannel } from "../src/reporting/reporting-filter.js";
import type { OperationalRiskService } from "../src/reporting/operational-risk.service.js";
import type { SharedContributionService } from "../src/reporting/shared-contribution.service.js";
import type { SourceEffectivenessService } from "../src/reporting/source-effectiveness.service.js";

const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-manager" };
const calls: Array<{ panel: string; query: unknown }> = [];
const dependency = <T>(panel: string, value: unknown): T => ({ read: (query: unknown) => { calls.push({ panel, query }); return value; } }) as T;
const hasCode = (code: string) => (error: unknown): boolean => typeof error === "object" && error !== null && "getResponse" in error
  && (error as { getResponse: () => unknown }).getResponse() !== null
  && (error as { getResponse: () => { code?: string } }).getResponse().code === code;

test("consolidates versioned reports with common filters and explicit safeguards", () => {
  calls.length = 0; const audit = new AuditService();
  const service = new ManagerDashboardService(
    dependency<CommercialFunnelService>("funnel", { definitionVersion: "commercial-funnel-v1", generatedAt: "2026-08-24T12:00:00.000Z", cohort: { totalUniqueLeads: 2 }, attainment: { enrolled: 1 }, breakdowns: { source: [{ value: "SYNTHETIC", count: 2 }, { value: "=FORMULA", count: 1 }], campaign: [], program: [], campus: [] } }),
    dependency<CommercialPerformanceService>("performance", { definitionVersion: "commercial-performance-v1", generatedAt: "2026-08-24T12:00:00.000Z" }),
    dependency<SourceEffectivenessService>("sources", { definitionVersion: "source-effectiveness-v1", generatedAt: "2026-08-24T12:00:00.000Z" }),
    dependency<OperationalRiskService>("risks", { definitionVersion: "operational-risk-v1", generatedAt: "2026-08-24T12:00:00.000Z", queues: { unassigned: 1, overdueFollowUps: 1 }, alerts: [{ code: "synthetic" }] }),
    dependency<SharedContributionService>("contributions", { definitionVersion: "shared-contribution-v1", generatedAt: "2026-08-24T12:00:00.000Z" }),
    { reportingSnapshot: () => [{ id: "lead-synthetic", createdAt: "2026-08-23T23:30:00.000Z", campus: "campus-a", activities: [{ type: "STATUS_CHANGED", result: "QUALIFIED->ENROLLED", occurredAt: "2026-08-24T00:30:00.000Z" }] }] } as unknown as LeadService,
    audit,
  );
  const query = { from: "2026-08-01", to: "2026-09-01", campus: "campus-a" };
  const result = service.read(query, manager, "corr-dashboard", new Date("2026-08-24T12:00:00.000Z"));
  assert.equal(result.definitionVersion, "manager-dashboard-v1"); assert.equal(result.navigation.length, 5);
  const normalized = { period: "custom", from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", view: "global", campus: "campus-a" };
  assert.deepEqual(calls.map((item) => item.query), Array.from({ length: 5 }, () => normalized));
  assert.deepEqual(result.safeguards, { singlePrimaryConversionAttribution: true, financialDecision: false, disciplinaryScore: false });
  assert.deepEqual(result.cards, { uniqueLeads: 2, enrolled: 1, unassigned: 1, overdueFollowUps: 1, activeAlerts: 1 });
  assert.deepEqual(result.trends, [{ date: "2026-08-24", leadsCreated: 1, leadsEnrolled: 1 }]);
  const csv = service.exportAggregated(query, manager, "corr-export", new Date("2026-08-24T12:00:00.000Z"));
  assert.equal(csv.includes("lead-synthetic"), false); assert.equal(csv.includes("manager-dashboard-export-v1"), true); assert.equal(csv.includes("distribution,source,\"SYNTHETIC\",2"), true);
  assert.equal(csv.includes("kpi,uniqueLeads,,2"), true);
  assert.equal(csv.includes("distribution,source,\"'=FORMULA\",1"), true);
  assert.equal(result.drillDowns.every((item) => item.href.includes("returnTo=")), true);
  assert.equal(audit.list().some((event) => event.eventType === "MANAGER_DASHBOARD_VIEWED"), true);
});

test("controller fails closed without a principal and preserves correlation", async () => {
  const service = { readForApi: (_query: unknown, _principal: Principal, correlationId: string) => Promise.resolve({ definitionVersion: "manager-dashboard-v1", correlationId }) } as unknown as ManagerDashboardService;
  const controller = new ManagerDashboardController(service);
  assert.throws(() => controller.read({}, {} as never));
  const response = await controller.read({}, { principal: manager, header: () => "corr-explicit" } as never) as unknown as { correlationId: string };
  assert.equal(response.correlationId, "corr-explicit");
  assert.throws(() => controller.export({}, {} as never));
});

test("normalizes presets, rejects unknown filters and enforces adviser and campus scopes", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const result = normalizeReportingQuery({ period: "7d", view: "global", channel: "DIGITAL" }, { ...manager, scopes: [{ kind: "GLOBAL" }] }, now);
  assert.deepEqual(result, { period: "7d", from: "2026-08-17T12:00:00.000Z", to: "2026-08-24T12:00:00.000Z", view: "global", channel: "DIGITAL" });
  assert.throws(() => normalizeReportingQuery({ unknown: "value" }, manager, now), hasCode("reporting_filter_unknown"));
  assert.throws(() => normalizeReportingQuery({ campus: "campus-b" }, manager, now), hasCode("reporting_campus_scope_forbidden"));
  const adviser: Principal = { userId: "adviser-synthetic", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-adviser" };
  assert.throws(() => normalizeReportingQuery({ view: "global" }, adviser, now), hasCode("reporting_global_view_forbidden"));
  assert.throws(() => normalizeReportingQuery({ view: "personal", adviserId: "another-adviser" }, adviser, now), hasCode("reporting_adviser_scope_forbidden"));
});

test("normalizes custom boundaries and refuses malformed or unsupported filters", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const globalManager = { ...manager, scopes: [{ kind: "GLOBAL" as const }] };
  assert.deepEqual(normalizeReportingQuery({ period: "custom", from: "2026-08-01", to: "2026-08-24", status: "contacted", channel: "PHONE" }, globalManager, now), {
    period: "custom", from: "2026-08-01T00:00:00.000Z", to: "2026-08-24T00:00:00.000Z", view: "global", channel: "PHONE", status: "CONTACTED",
  });
  for (const query of [
    { period: "1d" }, { period: "custom", from: "2026-08-01" }, { period: "custom", from: "invalid", to: "2026-08-24" },
    { period: "custom", from: "2026-08-24", to: "2026-08-01" }, { channel: "SMTP" }, { status: "UNKNOWN" },
    { source: "<script>alert(1)</script>" }, { campaign: "javascript:alert(1)" },
  ]) assert.throws(() => normalizeReportingQuery(query, globalManager, now));
});

test("serializes reporting filters and channels deterministically without mutating input", () => {
  const query = { source: "WEB_FORM", period: "30d", campus: "campus-a", adviserId: "adviser-synthetic" };
  assert.equal(reportingSearchParams(query).toString(), "adviserId=adviser-synthetic&campus=campus-a&period=30d&source=WEB_FORM");
  assert.deepEqual(query, { source: "WEB_FORM", period: "30d", campus: "campus-a", adviserId: "adviser-synthetic" });
  assert.deepEqual(["PHONE_CALL", "PHYSICAL_VISIT", "WEB_FORM", "PARTNER", "UNKNOWN"].map(sourceChannel), ["PHONE", "IN_PERSON", "DIGITAL", "PARTNER", "OTHER"]);
});

test("personal dashboard exposes only authenticated adviser aggregates", () => {
  const adviser: Principal = { userId: "adviser-synthetic", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-adviser" };
  const service = new ManagerDashboardService(
    dependency<CommercialFunnelService>("funnel", {}),
    dependency<CommercialPerformanceService>("performance", { definitionVersion: "commercial-performance-v1", advisers: [{ adviserId: adviser.userId }] }),
    dependency<SourceEffectivenessService>("sources", {}), dependency<OperationalRiskService>("risks", {}),
    dependency<SharedContributionService>("contributions", { definitionVersion: "shared-contribution-v1", contributors: [{ contributorId: adviser.userId }] }),
    { reportingSnapshot: () => [] } as unknown as LeadService, new AuditService(),
  );
  const report = service.readPersonal({ period: "30d", view: "personal" }, adviser, "corr-personal", new Date("2026-08-24T12:00:00.000Z"));
  assert.equal(report.definitionVersion, "personal-dashboard-v1"); assert.equal(report.filters.adviserId, adviser.userId); assert.equal(report.safeguards.personalScopeOnly, true);
  const controller = new PersonalDashboardController({ readPersonalForApi: (...args: Parameters<ManagerDashboardService["readPersonal"]>) => Promise.resolve(service.readPersonal(...args)) } as unknown as ManagerDashboardService);
  assert.throws(() => controller.read({}, {} as never));
});

test("API reporting refreshes PostgreSQL-backed state and exposes scoped persistence evidence", async () => {
  const calls: string[] = [];
  const persistence = {
    refresh: (): Promise<void> => { calls.push("refresh"); return Promise.resolve(); },
    evidence: (): Promise<{ source: "POSTGRESQL"; distinctLeadCount: number; appointmentCount: number; documentMetadataCount: number; importBatchCount: number }> => Promise.resolve({ source: "POSTGRESQL", distinctLeadCount: 2, appointmentCount: 1, documentMetadataCount: 3, importBatchCount: 1 }),
  };
  const service = new ManagerDashboardService(
    dependency<CommercialFunnelService>("funnel", { definitionVersion: "commercial-funnel-v1", cohort: { totalUniqueLeads: 0 }, attainment: { enrolled: 0 }, breakdowns: { source: [], campaign: [], program: [], campus: [] } }),
    dependency<CommercialPerformanceService>("performance", {}), dependency<SourceEffectivenessService>("sources", {}),
    dependency<OperationalRiskService>("risks", { queues: { unassigned: 0, overdueFollowUps: 0 }, alerts: [] }),
    dependency<SharedContributionService>("contributions", {}),
    { reportingSnapshot: () => [] } as unknown as LeadService, new AuditService(), persistence as never,
  );
  const report = await service.readForApi({ period: "30d" }, { ...manager, scopes: [{ kind: "GLOBAL" }] }, "corr-persistent", new Date("2026-08-24T12:00:00.000Z"));
  assert.deepEqual(calls, ["refresh"]);
  assert.deepEqual(report.persistence, { source: "POSTGRESQL", distinctLeadCount: 2, appointmentCount: 1, documentMetadataCount: 3, importBatchCount: 1 });
});
