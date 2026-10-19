import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { ClosureRequest, ClosureService } from "../src/closure/closure.service.js";
import type { FollowUpRecord, FollowUpService } from "../src/follow-up/follow-up.service.js";
import type { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { LeadService, type LeadRecord, type LeadReportingRow } from "../src/leads/lead.service.js";
import { projectCommercialWork } from "../src/reporting/commercial-work.js";
import { CommercialWorkService, workQueueKey } from "../src/reporting/commercial-work.service.js";
import { commercialWorkPaths } from "../src/reporting/commercial-work.openapi.js";
import { routePermissions, usesScopedReportingAuthorization } from "../src/permissions/dynamic-routes.js";
import { commercialWorkHref, normalizeWorkQuery } from "../src/reporting/commercial-work-query.js";

const now = new Date("2026-10-20T12:00:00Z");
const manager: Principal = { userId: "manager", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic" };
const row = (id: string, changes: Partial<LeadReportingRow> = {}): LeadReportingRow => ({ id, status: "PROSPECT", campus: "CAMPUS", campaign: "CAMPAIGN", program: "PROGRAM", source: "WEB_FORM", createdAt: "2026-10-19T00:00:00Z", receivedAt: "2026-10-19T00:00:00Z", receptionOrigin: "CRM_OBSERVATION", assignedToId: "adviser-a", assignedToLabel: "Conseiller A", collaboratorIds: [], temperature: "UNEVALUATED", activities: [], treatmentState: "NONE", hasUndatedHistory: false, hasActiveNextAction: false, ...changes });
const task = (id: string, leadId: string, dueAt: string, state: FollowUpRecord["state"] = "SCHEDULED"): FollowUpRecord => ({ id, leadId, dueAt, state, ownerId: "adviser-a", reason: "Suivi synthétique", version: 1, createdAt: "2026-10-19T12:00:00Z", updatedAt: "2026-10-19T12:00:00Z" });
const closure = (id: string, leadId: string, target: ClosureRequest["target"] = "CLOSED_LOST"): ClosureRequest => ({ id, leadId, target, state: "PENDING", reason: "NOT_INTERESTED", comment: "Synthétique", evidence: [], requesterId: "adviser-a", version: 1, createdAt: "2026-10-19T12:00:00Z" });

test("six queues use distinct Leads, preserve action/request units and separate performed/cancelled", () => {
  const rows = [row("untreated"), row("known-history", { hasUndatedHistory: true, treatmentState: "UNKNOWN_DATE" }), row("active", { status: "CONTACTED", hasActiveNextAction: true }), row("legacy", { status: "CONTACTED", nextActionAt: "2026-10-25T12:00:00Z" }), row("closed", { status: "ENROLLED" })];
  const tasks = [task("one", "active", "2026-10-20T10:00:00Z"), task("two", "active", "2026-10-20T11:00:00Z"), task("future", "active", "2026-10-21T12:00:00Z"), task("done", "closed", "2026-10-19T12:00:00Z", "COMPLETED"), task("cancel", "closed", "2026-10-19T12:00:00Z", "CANCELLED"), task("foreign", "outside", "2026-10-19T12:00:00Z")];
  const result = projectCommercialWork(rows, [...tasks, tasks[0]!], [closure("r1", "legacy"), closure("r2", "legacy"), closure("old-stage", "legacy", "QUALIFIED"), closure("foreign", "outside")], now);
  assert.deepEqual(result.queues.TO_CONTACT.leadIds, ["untreated"]);
  assert.deepEqual(result.queues.FIRST_TREATMENT_OVERDUE.leadIds, ["untreated"]);
  assert.deepEqual(result.queues.NEXT_ACTION_MISSING.leadIds, ["known-history", "legacy"]);
  assert.deepEqual(result.queues.ACTIVE_FOLLOW_UP, { leadIds: ["active"], itemCount: 3, itemUnit: "ACTIONS" });
  assert.deepEqual(result.queues.OVERDUE_FOLLOW_UP, { leadIds: ["active"], itemCount: 2, itemUnit: "ACTIONS" });
  assert.deepEqual(result.queues.PENDING_CLOSURE, { leadIds: ["legacy"], itemCount: 2, itemUnit: "REQUESTS" });
  assert.deepEqual(result.actions, { active: 3, future: 1, dueNow: 0, overdue: 2, invalidDeadline: 0, completed: 1, cancelled: 1 });
});

test("strict threshold and overdue equality compare instants, not string spelling or scheduler state", () => {
  const result = projectCommercialWork([row("equal", { receivedAt: "2026-10-19T12:00:00Z" }), row("late", { receivedAt: "2026-10-19T11:59:59.999Z" })], [task("equal", "equal", "2026-10-20T13:00:00+01:00", "DUE"), task("late", "equal", "2026-10-20T11:59:59.999Z"), task("future", "equal", "2026-10-21T12:00:00Z", "DUE"), task("invalid", "equal", "invalid")], [], now);
  assert.deepEqual(result.queues.FIRST_TREATMENT_OVERDUE.leadIds, ["late"]);
  assert.equal(result.actions.dueNow, 1); assert.equal(result.actions.overdue, 1); assert.equal(result.actions.future, 1); assert.equal(result.actions.invalidDeadline, 1);
});

async function setup(): Promise<CommercialWorkService> {
  const audit = new AuditService();
  const records: LeadRecord[] = [row("a"), row("b", { assignedToId: "adviser-b", assignedToLabel: "Conseiller B" }), row("secondary", { assignedToId: "adviser-b", collaboratorIds: ["adviser-a"] }), row("elsewhere", { campus: "OTHER" })].map((lead) => ({ ...lead, leadCode: `SYNTH-${lead.id}`, firstName: "Synthetic", lastName: "Fixture", educationLevel: "Bac" }));
  const repository = { enabled: true, snapshot: () => Promise.resolve({ leads: records, activities: [], historicalTreatments: [] }) } as unknown as LeadPersistenceRepository;
  const leads = new LeadService(audit, repository); await leads.onModuleInit();
  const followUps = { reportingSnapshot: () => [task("foreign", "invisible", "2026-10-20T10:00:00Z")] } as unknown as FollowUpService;
  const closures = { reportingSnapshot: () => [closure("foreign", "invisible")] } as unknown as ClosureService;
  return new CommercialWorkService(leads, followUps, closures, audit);
}

test("every summary and adviser drilldown reuses the exact paginated selection and filters", async () => {
  const service = await setup();
  const query = { from: "2026-10-01T00:00:00Z", to: "2026-10-21T00:00:00Z", campus: "CAMPUS", source: "WEB_FORM", view: "global" };
  const report = service.read(query, {}, manager, "fixture", now);
  assert.equal(report.cohort.leadCount, 3); assert.equal(report.advisers.length, 2);
  for (const summary of report.queues) {
    const params = Object.fromEntries(new URL(summary.href, "https://example.invalid").searchParams);
    const { queue, adviserScope, ...filters } = params;
    assert.equal(params.period, "custom", "drilldown freezes explicit cohort boundaries rather than recomputing a rolling window");
    const list = service.read(filters, { queue, adviserScope, page: "1", pageSize: "1" }, manager, "fixture", now);
    assert.equal(list.page.total, summary.leadCount);
    assert.ok(list.page.items.length <= 1);
    assert.equal(summary.leadShare.numerator, summary.leadCount); assert.equal(summary.leadShare.denominator, 3);
  }
  const adviser = report.advisers.find((item) => item.adviserId === "adviser-a")!;
  assert.equal(adviser.leadCount, 1, "secondary contribution not silently counted as primary portfolio");
  for (const summary of adviser.queues) {
    const { queue, adviserScope, ...filters } = Object.fromEntries(new URL(summary.href, "https://example.invalid").searchParams);
    const list = service.read(filters, { queue, adviserScope }, manager, "fixture", now);
    assert.equal(list.page.total, summary.leadCount); assert.equal(list.cohort.leadCount, adviser.leadCount);
  }
  const personal: Principal = { ...manager, userId: "adviser-a", roles: ["ADMISSIONS"] };
  const own = service.read({ ...query, adviserId: personal.userId }, {}, personal, "fixture", now);
  assert.deepEqual(own.page.items.map((lead) => lead.id), ["a"]);
  const fenced = service.read(query, {}, { ...manager, permissionLeadIds: new Set(["a"]) }, "fixture", now);
  assert.equal(fenced.cohort.leadCount, 1); assert.equal(JSON.stringify(fenced).includes("Conseiller B"), false);
});

test("explicit involved mode preserves collaborations without widening the authorized fence", async () => {
  const service = await setup(); const query = { campus: "CAMPUS", adviserId: "adviser-a" };
  const involved = service.read(query, { adviserScope: "INVOLVED" }, manager, "fixture", now);
  assert.equal(involved.cohort.attribution, "INVOLVED_ADVISER");
  assert.deepEqual(involved.page.items.map((lead) => lead.id), ["a", "secondary"]);
  const fenced = service.read(query, { adviserScope: "INVOLVED" }, { ...manager, permissionLeadIds: new Set(["a"]) }, "fixture", now);
  assert.equal(fenced.page.total, 1);
  assert.throws(() => service.read(query, { adviserScope: "BYPASS" }, manager, "fixture", now));
});

test("open work periods retain all-time/one-sided cohorts and shared filter denials", () => {
  const href = commercialWorkHref({ adviserId: "adviser-a" }, "OVERDUE_FOLLOW_UP", "INVOLVED");
  const params = new URL(href, "https://example.invalid").searchParams;
  assert.equal(params.get("period"), "open"); assert.equal(params.get("adviserScope"), "INVOLVED");
  const all = normalizeWorkQuery({ period: "open" }, manager, now); assert.equal(all.from, undefined); assert.equal(all.to, undefined);
  const one = normalizeWorkQuery({ period: "open", from: "2026-01-01" }, manager, now); assert.equal(one.from, "2026-01-01T00:00:00.000Z"); assert.equal(one.to, undefined);
  assert.throws(() => normalizeWorkQuery({ period: "open", unexpected: "true" }, manager, now));
  assert.throws(() => normalizeWorkQuery({ period: "open", from: "invalid" }, manager, now));
});

test("empty data is observed zero with unavailable ratio; invalid filters never select a default queue", async () => {
  const service = await setup();
  const empty = service.read({ campus: "MISSING" }, {}, manager, "fixture", now);
  assert.equal(empty.page.total, 0); assert.ok(empty.queues.every((queue) => queue.leadCount === 0 && queue.leadShare.value === null));
  for (const queue of ["bad", "__proto__", "toString", ""]) assert.throws(() => workQueueKey(queue));
  for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"]) assert.throws(() => service.read({}, { page: value }, manager, "fixture", now));
});

test("OpenAPI names the six exact queue units, strict overdue threshold and guarded response", () => {
  const route = commercialWorkPaths["/reports/commercial-work"].get;
  const schema = route.responses["200"].content["application/json"].schema;
  assert.equal(schema.properties.queues.minItems, 6);
  assert.deepEqual(schema.properties.queues.items.properties.itemUnit.enum, ["LEADS", "ACTIONS", "REQUESTS"]);
  assert.equal(schema.properties.queues.items.properties.leadShare.properties.value.nullable, true);
  assert.match(route.description, /dueAt < generatedAt.*equality is dueNow/);
  assert.ok(route.responses["403"]); assert.ok(route.responses["503"]);
});

test("commercial work only binds the read handler to existing fenced reporting permission", () => {
  assert.deepEqual(routePermissions("CommercialWorkController", "read"), ["reporting.view"]);
  assert.equal(usesScopedReportingAuthorization("CommercialWorkController", "read"), true);
  assert.equal(routePermissions("CommercialWorkController", "approve"), null);
  assert.equal(routePermissions("UnknownController", "read"), null);
});
