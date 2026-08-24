import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { LeadService } from "../src/leads/lead.service.js";
import type { CommercialFunnelService } from "../src/reporting/commercial-funnel.service.js";
import type { CommercialPerformanceService } from "../src/reporting/commercial-performance.service.js";
import { ManagerDashboardController } from "../src/reporting/manager-dashboard.controller.js";
import { ManagerDashboardService } from "../src/reporting/manager-dashboard.service.js";
import type { OperationalRiskService } from "../src/reporting/operational-risk.service.js";
import type { SharedContributionService } from "../src/reporting/shared-contribution.service.js";
import type { SourceEffectivenessService } from "../src/reporting/source-effectiveness.service.js";

const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "campus-a" }], sessionId: "session-manager" };
const calls: Array<{ panel: string; query: unknown }> = [];
const dependency = <T>(panel: string, value: unknown): T => ({ read: (query: unknown) => { calls.push({ panel, query }); return value; } }) as T;

test("consolidates versioned reports with common filters and explicit safeguards", () => {
  calls.length = 0; const audit = new AuditService();
  const service = new ManagerDashboardService(
    dependency<CommercialFunnelService>("funnel", { definitionVersion: "commercial-funnel-v1", generatedAt: "2026-08-24T12:00:00.000Z", cohort: { totalUniqueLeads: 2 }, attainment: { enrolled: 1 }, breakdowns: { source: [{ value: "SYNTHETIC", count: 2 }], campaign: [], program: [], campus: [] } }),
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
  assert.deepEqual(calls.map((item) => item.query), Array.from({ length: 5 }, () => query));
  assert.deepEqual(result.safeguards, { singlePrimaryConversionAttribution: true, financialDecision: false, disciplinaryScore: false });
  assert.deepEqual(result.cards, { uniqueLeads: 2, enrolled: 1, unassigned: 1, overdueFollowUps: 1, activeAlerts: 1 });
  assert.deepEqual(result.trends, [{ date: "2026-08-24", leadsCreated: 1, leadsEnrolled: 1 }]);
  const csv = service.exportAggregated(query, manager, "corr-export", new Date("2026-08-24T12:00:00.000Z"));
  assert.equal(csv.includes("lead-synthetic"), false); assert.equal(csv.includes("distribution,source,\"SYNTHETIC\",2"), true);
  assert.equal(audit.list().some((event) => event.eventType === "MANAGER_DASHBOARD_VIEWED"), true);
});

test("controller fails closed without a principal and preserves correlation", () => {
  const service = { read: (_query: unknown, _principal: Principal, correlationId: string) => ({ definitionVersion: "manager-dashboard-v1", correlationId }) } as unknown as ManagerDashboardService;
  const controller = new ManagerDashboardController(service);
  assert.throws(() => controller.read({}, {} as never));
  const response = controller.read({}, { principal: manager, header: () => "corr-explicit" } as never) as unknown as { correlationId: string };
  assert.equal(response.correlationId, "corr-explicit");
  assert.throws(() => controller.export({}, {} as never));
});
