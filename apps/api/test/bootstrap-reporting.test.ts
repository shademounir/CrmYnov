import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { ReassignmentService } from "../src/assignment/reassignment.service.js";
import type { FollowUpService } from "../src/follow-up/follow-up.service.js";
import type { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { LeadService, type LeadActivityRecord, type LeadRecord } from "../src/leads/lead.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { acquisitionPartition, observedEnrollment } from "../src/reporting/acquisition-cohort.js";
import { CommercialFunnelService } from "../src/reporting/commercial-funnel.service.js";
import { CommercialPerformanceService } from "../src/reporting/commercial-performance.service.js";
import { ManagerDashboardService } from "../src/reporting/manager-dashboard.service.js";
import type { OperationalRiskService } from "../src/reporting/operational-risk.service.js";
import { SharedContributionService } from "../src/reporting/shared-contribution.service.js";
import { SourceEffectivenessService } from "../src/reporting/source-effectiveness.service.js";
import { sourceChannel } from "../src/reporting/reporting-filter.js";

// Synthetic projections only: these unit tests are not PostgreSQL import proofs.
const manager: Principal = { userId: "manager-synthetic", sessionId: "session-synthetic", roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: "campus-a" }] };
const adviser: Principal = { ...manager, userId: "adviser-synthetic", roles: ["ADMISSIONS"] };
const now = new Date("2026-10-07T13:00:00.000Z");
const query = { period: "custom", from: "2026-10-07T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", campus: "campus-a" };
const emptyFollowUps = { reportingSnapshot: (): [] => [] } as unknown as FollowUpService;
const emptyReassignments = { reportingSnapshot: (): [] => [] } as unknown as ReassignmentService;
const emptyIngestion = { reportingSnapshot: (): [] => [] } as unknown as IngestionService;

test("canonical bootstrap sources keep channel filters and reporting aligned with legacy sources", () => {
  const audit = new AuditService(); const leads = new LeadService(audit);
  const cases = [["PHONE", "PHONE"], ["PHONE_CALL", "PHONE"], ["IN_PERSON", "IN_PERSON"], ["PHYSICAL_VISIT", "IN_PERSON"],
    ["DIGITAL", "DIGITAL"], ["SOCIAL_MEDIA", "DIGITAL"], ["WEB_FORM", "DIGITAL"], ["YNOV_COM", "DIGITAL"], ["REFERRAL", "OTHER"]] as const;
  for (const [source, expected] of cases) {
    assert.equal(sourceChannel(source), expected);
    leads.registerLocalLead({ ...lead(`channel-${source}`, "BASELINE", "PROSPECT"), source });
  }
  const sources = new SourceEffectivenessService(leads, emptyIngestion, audit);
  for (const channel of ["PHONE", "IN_PERSON", "DIGITAL", "OTHER"] as const) {
    const expected = cases.filter(([, value]) => value === channel).length;
    const list = leads.listLeads({ page: 1, pageSize: 25, channel }, manager, "synthetic-channel-list");
    assert.equal(list.total, expected);
    const report = sources.read({ channel }, manager, "synthetic-channel-report", now);
    assert.equal(report.cohort.uniqueLeadCount, expected);
    assert.equal(report.breakdowns.channel[0]?.value, channel);
    assert.equal(report.breakdowns.channel[0]?.volumeReceived, 0);
  }
  for (const savedView of ["PHONE_CALLS", "PHYSICAL_VISITS"] as const) {
    const list = leads.listLeads({ page: 1, pageSize: 25, savedView }, manager, "synthetic-saved-channel-list");
    assert.equal(list.total, 2, "Canonical and pre-existing source aliases both remain accessible in the named work view");
  }
});

function lead(id: string, acquisitionKind: "NEW" | "BASELINE", status: LeadRecord["status"], campus = "campus-a"): LeadRecord & { version: number } {
  return { id, leadCode: `LD-SYN-${id}`, firstName: "Inventé", lastName: "Synthétique", campus,
    campaign: "Campagne synthétique", program: "Programme synthétique", educationLevel: "BAC", source: "YNOV_COM",
    assignedToId: adviser.userId, acquisitionKind, status, createdAt: "2026-10-07T09:00:00.000Z", version: 1 };
}
function activity(leadId: string, type: LeadActivityRecord["type"], result: string, occurredAt: string): LeadActivityRecord {
  return { id: `${leadId}-${type}-${occurredAt}`, leadId, type, result, occurredAt, authorId: adviser.userId, correlationId: "synthetic-reporting" };
}
async function setup(): Promise<{ leads: LeadService; funnel: CommercialFunnelService; performance: CommercialPerformanceService; sources: SourceEffectivenessService; contributions: SharedContributionService; dashboard: ManagerDashboardService }> {
  const audit = new AuditService();
  const records = [lead("new-contact", "NEW", "CONTACTED"), lead("new-enrolled", "NEW", "ENROLLED"),
    lead("baseline-old", "BASELINE", "ENROLLED"), lead("baseline-work", "BASELINE", "ENROLLED"), lead("other-campus", "BASELINE", "ENROLLED", "campus-b")];
  const activities = [activity("new-contact", "PHONE_CALL", "ANSWERED", "2026-10-07T09:30:00.000Z"),
    activity("new-enrolled", "STATUS_CHANGED", "QUALIFIED->ENROLLED", "2026-10-07T10:00:00.000Z"),
    activity("baseline-old", "STATUS_CHANGED", "QUALIFIED->ENROLLED", "2025-10-07T10:00:00.000Z"),
    activity("baseline-work", "PHONE_CALL", "ANSWERED", "2026-10-07T11:00:00.000Z"),
    activity("baseline-work", "STATUS_CHANGED", "QUALIFIED->ENROLLED", "2026-10-07T12:00:00.000Z")];
  const persistence = { enabled: true, snapshot: (): Promise<{ leads: typeof records; activities: typeof activities }> => Promise.resolve({ leads: records, activities }) } as unknown as LeadPersistenceRepository;
  const leads = new LeadService(audit, persistence); await leads.onModuleInit();
  const funnel = new CommercialFunnelService(leads, audit);
  const performance = new CommercialPerformanceService(leads, emptyFollowUps, emptyReassignments, audit);
  const sources = new SourceEffectivenessService(leads, emptyIngestion, audit);
  const contributions = new SharedContributionService(leads, audit);
  const risks = { read: (): unknown => ({ queues: { unassigned: 0, overdueFollowUps: 0 }, alerts: [] }) } as unknown as OperationalRiskService;
  const dashboard = new ManagerDashboardService(funnel, performance, sources, risks, contributions, leads, audit);
  return { leads, funnel, performance, sources, contributions, dashboard };
}

test("baseline remains authorized portfolio stock, never an acquisition or imported enrollment event", async () => {
  const { dashboard } = await setup(); const report = dashboard.read(query, manager, "synthetic-dashboard", now);
  assert.equal(report.cards.uniqueLeads, 4); assert.equal(report.cards.enrolled, 3);
  assert.equal(report.acquisition.newAcquisitionCount, 2); assert.equal(report.acquisition.baselinePortfolioCount, 2);
  assert.deepEqual(report.trends, [{ date: "2026-10-07", leadsCreated: 2, leadsEnrolled: 2 }]);
  assert.notEqual(report.trends[0]!.leadsCreated, report.cards.uniqueLeads);
  assert.equal(report.panels.funnel.acquisition.currentNewEnrolledCount, 1);
  assert.equal(report.panels.funnel.acquisition.currentNewEnrollmentRate, 0.5);
  const csv = dashboard.exportAggregated(query, manager, "synthetic-export", now);
  assert.match(csv, /kpi,uniqueLeads,,4/); assert.match(csv, /acquisition,newAcquisitionCount,,2/);
  assert.match(csv, /portfolio,baselinePortfolioCount,,2/); assert.match(csv, /trend,leadsCreated,2026-10-07,2/);
  assert.match(csv, /imported status alone excluded/); assert.equal(csv.includes("baseline-old"), false);
});

test("source received volume and delays exclude baseline but stock and real current work remain", async () => {
  const { sources, performance, contributions } = await setup();
  const source = sources.read(query, manager, "synthetic-source", now);
  assert.equal(source.cohort.uniqueLeadCount, 4);
  assert.equal(source.breakdowns.source[0]!.volumeReceived, 2); assert.equal(source.breakdowns.source[0]!.uniqueLeadCount, 4);
  assert.equal(source.breakdowns.source[0]!.medianProcessingMinutes, 30);
  assert.equal(source.breakdowns.provenanceMode.find((row) => row.value === "IMPORTED")!.volumeReceived, 0);
  assert.equal(source.breakdowns.provenanceMode.find((row) => row.value === "IMPORTED")!.uniqueLeadCount, 2);
  const commercial = performance.read(query, manager, "synthetic-performance", now).advisers[0]!;
  assert.equal(commercial.primaryLeadCount, 4); assert.equal(commercial.acquisition.baselinePortfolioCount, 2);
  assert.equal(commercial.medianMinutes.firstHandling, 30); assert.equal(commercial.statusVolumes.enrolled, 3);
  const contribution = contributions.read(query, manager, "synthetic-contribution", now).contributors[0]!;
  assert.equal(contribution.primaryEnrollmentCount, 2); assert.equal(contribution.primaryBaselineEnrollmentStock, 2);
  assert.equal(contribution.primaryLeadCount, 4); assert.equal(contribution.primaryActionCount, 4);
});

test("scope and server-projected lead restriction remain effective for both acquisition kinds", async () => {
  const { leads, funnel } = await setup();
  const scoped = { ...manager, permissionLeadIds: new Set(["new-contact", "baseline-work"]) };
  const report = funnel.read(query, scoped, "synthetic-restricted");
  assert.equal(report.cohort.totalUniqueLeads, 2); assert.equal(report.acquisition.newAcquisitionCount, 1);
  assert.equal(report.acquisition.baselinePortfolioCount, 1);
  assert.equal(leads.reportingSnapshot(adviser).length, 4);
  assert.equal(leads.reportingSnapshot({ ...adviser, userId: "other-synthetic" }).length, 0);
});

test("baseline-only stock has no false acquisition rate or creation trend", async () => {
  const { funnel, dashboard } = await setup(); const scoped = { ...manager, permissionLeadIds: new Set(["baseline-old"]) };
  const report = funnel.read(query, scoped, "synthetic-baseline-only");
  assert.equal(report.cohort.totalUniqueLeads, 1); assert.equal(report.currentState.ENROLLED, 1);
  assert.equal(report.acquisition.currentNewEnrollmentRate, null);
  assert.deepEqual(dashboard.read(query, scoped, "synthetic-baseline-trends", now).trends, []);
});

test("legacy projection defaults to NEW and only observed in-period later enrollment qualifies", async () => {
  const { leads } = await setup(); const baseline = leads.reportingSnapshot(manager).find((row) => row.id === "baseline-work")!;
  assert.equal(observedEnrollment(baseline, { type: "STATUS_CHANGED", result: "QUALIFIED->ENROLLED", authorId: adviser.userId, occurredAt: "2026-10-06T12:00:00.000Z" }, query.from, query.to), false);
  assert.equal(observedEnrollment(baseline, { type: "STATUS_CHANGED", result: "QUALIFIED->ENROLLED", authorId: adviser.userId, occurredAt: query.to }, query.from, query.to), false);
  const legacy = { ...baseline }; delete legacy.acquisitionKind;
  assert.equal(acquisitionPartition([legacy]).newAcquisitionCount, 1);
});

test("persistence projects explicit baseline temperature without manufacturing a human qualification", async () => {
  const row = (id: string, kind: string, baselineTemperature: string | null, qualifications: unknown[] = []): Record<string, unknown> => ({
    ...lead(id, kind as "NEW" | "BASELINE", "PROSPECT"), acquisitionKind: kind, baselineTemperature, assignedToId: null,
    createdAt: new Date("2026-10-07T09:00:00.000Z"), nextActionAt: null, lastActivityAt: null, collaborators: [], commercialQualifications: qualifications,
  });
  const rows = [row("baseline", "BASELINE", "HOT"), row("human", "BASELINE", "HOT", [{ temperature: "COLD", version: 1, reason: "Qualification synthétique", authorId: adviser.userId, createdAt: now }]),
    row("new", "NEW", "HOT"), row("unknown", "BASELINE", null)];
  const client = { lead: { findMany: (): Promise<typeof rows> => Promise.resolve(rows) }, leadActivity: { findMany: (): Promise<[]> => Promise.resolve([]) },
    $transaction: (operations: Promise<unknown>[]): Promise<unknown[]> => Promise.all(operations) };
  const repository = new LeadPersistenceRepository({ enabled: true, client } as unknown as PrismaService);
  const snapshot = await repository.snapshot(); const [baseline, human, fresh, unknown] = snapshot.leads;
  assert.equal(baseline!.acquisitionKind, "BASELINE"); assert.equal(baseline!.temperature, "HOT"); assert.equal(baseline!.temperatureSource, "HISTORICAL_BASELINE");
  assert.equal(baseline!.qualificationVersion, 0); assert.equal(baseline!.qualifiedAt, undefined); assert.equal(baseline!.qualifiedBy, undefined);
  assert.equal(human!.temperature, "COLD"); assert.equal(human!.temperatureSource, "HUMAN_QUALIFICATION"); assert.equal(human!.qualifiedBy, adviser.userId);
  assert.equal(fresh!.temperature, "UNEVALUATED"); assert.equal(unknown!.temperature, "UNEVALUATED");
  assert.equal(snapshot.activities.length, 0);
});
