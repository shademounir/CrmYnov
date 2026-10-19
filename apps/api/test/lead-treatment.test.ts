import assert from "node:assert/strict";
import test from "node:test";
import { treatmentSummary, treatmentDay, validateTreatmentDay, normalizeTreatmentFilters, isTreatmentInactive, inactiveTreatmentBoundary } from "../src/leads/lead-treatment.js";
import { CommercialFunnelService } from "../src/reporting/commercial-funnel.service.js";
import { normalizeReportingQuery } from "../src/reporting/reporting-filter.js";
import { LeadService, type LeadActivityRecord, type LeadRecord } from "../src/leads/lead.service.js";
import type { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { Principal } from "../src/auth/auth.types.js";
import { needsNextAction } from "../src/follow-up/next-action.contract.js";

const manager: Principal = { userId: "manager-fixture", sessionId: "fixture", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }] };
const commercial: Principal = { ...manager, userId: "commercial-fixture", roles: ["ADMISSIONS"] };
const activity = (id: string, type: LeadActivityRecord["type"], occurredAt: string): LeadActivityRecord => ({ id, leadId: "lead-a", type, result: "COMPLETED", note: "Échange synthétique", occurredAt, authorId: commercial.userId, correlationId: "fixture" });
test("old dated business treatment uses a strict frozen instant and excludes terminal, never-treated and unknown history", () => {
  const cutoff = "2026-10-17T12:00:00.000Z";
  const row = { status: "CONTACTED", treatmentState: "DATED" as const, hasUndatedHistory: false, lastTreatmentAt: "2026-10-17T11:59:59.999Z", lastActivityAt: "2026-10-20T12:00:00.000Z" };
  assert.equal(isTreatmentInactive(row, cutoff), true, "technical lastActivityAt does not rejuvenate treatment");
  for (const change of [{ lastTreatmentAt: cutoff }, { lastTreatmentAt: "2026-10-18T12:00:00.000Z" }, { lastTreatmentAt: "invalid" }, { status: "CLOSED_LOST" }, { status: "ENROLLED" }, { treatmentState: "NONE" as const }, { treatmentState: "UNKNOWN_DATE" as const }, { hasUndatedHistory: true }]) assert.equal(isTreatmentInactive({ ...row, ...change }, cutoff), false);
  assert.equal(inactiveTreatmentBoundary(cutoff), cutoff);
  for (const invalid of ["", "invalid", "2026-02-30T12:00:00.000Z", "2026-10-17", "2026-10-17T13:00:00+01:00"]) assert.throws(() => inactiveTreatmentBoundary(invalid));
});

test("reporting retains explicit persistent action evidence instead of trusting a legacy deadline", async () => {
  const base: LeadRecord = { id: "legacy", leadCode: "SYNTH", firstName: "Synthetic", lastName: "Fixture", campus: "CASABLANCA", campaign: "Fixture", program: "Fixture", educationLevel: "Bac", source: "FIXTURE", status: "CONTACTED", createdAt: "2026-01-01T00:00:00Z", assignedToId: commercial.userId, nextActionAt: "2026-10-25T09:00:00Z" };
  const repository = { enabled: true, snapshot: () => Promise.resolve({ leads: [{ ...base, hasActiveNextAction: false }, { ...base, id: "active", hasActiveNextAction: true }, { ...base, id: "unknown" }], activities: [], historicalTreatments: [] }) } as unknown as LeadPersistenceRepository;
  const leads = new LeadService(new AuditService(), repository); await leads.onModuleInit();
  const rows = leads.reportingSnapshot(manager);
  assert.equal(rows.find((row) => row.id === "legacy")?.hasActiveNextAction, false);
  assert.equal(rows.find((row) => row.id === "active")?.hasActiveNextAction, true);
  assert.equal(Object.hasOwn(rows.find((row) => row.id === "unknown")!, "hasActiveNextAction"), false);
  assert.equal(needsNextAction(rows.find((row) => row.id === "legacy")!), true);
  assert.equal(needsNextAction(rows.find((row) => row.id === "active")!), false);
  assert.equal(leads.reportingSnapshot({ ...commercial, userId: "other" }).length, 0);
});

test("business treatment ignores import and technical refresh dates, preserves unknown history", () => {
  const actions = [activity("business", "COMMENT", "2026-01-02T12:00:00.000Z"), activity("import", "LEGACY_IMPORT", "2026-10-19T12:00:00.000Z"), activity("assignment", "ASSIGNMENT_CHANGED", "2026-10-19T13:00:00.000Z")];
  assert.deepEqual(treatmentSummary(actions, [{ occurredAt: null }]), { firstTreatmentAt: "2026-01-02T12:00:00.000Z", lastTreatmentAt: "2026-01-02T12:00:00.000Z", treatmentState: "UNKNOWN_DATE", hasUndatedHistory: true });
  assert.deepEqual(treatmentSummary([], [{ occurredAt: null }]), { treatmentState: "UNKNOWN_DATE", hasUndatedHistory: true });
  assert.deepEqual(treatmentSummary([], []), { treatmentState: "NONE", hasUndatedHistory: false });
  assert.equal(treatmentSummary([], [{ occurredAt: "2025-03-10T12:00:00.000Z" }]).lastTreatmentAt, "2025-03-10T12:00:00.000Z");
});

test("compensation never replaces original business date with a recent correction timestamp", () => {
  const original = activity("original", "PHONE_CALL", "2026-01-01T12:00:00.000Z");
  const correction: LeadActivityRecord = { ...activity("correction", "CORRECTION", "2026-10-19T12:00:00.000Z"), correction: { originalEventId: original.id, operation: "CORRECT", reasonCode: "WRONG_RESULT", previous: { type: "PHONE_CALL", result: "NO_ANSWER", noteState: "ABSENT" }, replacement: { type: "PHONE_CALL", result: "CONNECTED", noteState: "ABSENT" } } };
  assert.equal(treatmentSummary([original, correction], []).lastTreatmentAt, original.occurredAt);
  assert.equal(treatmentSummary([original, { ...correction, correction: { ...correction.correction!, operation: "CANCEL" } }], []).treatmentState, "NONE");
});

test("last treatment compares instants rather than the spelling of timezone offsets", () => {
  const latest = "2026-01-01T23:30:00-02:00";
  const earlier = "2026-01-02T00:00:00.000Z";
  assert.equal(treatmentSummary([], [{ occurredAt: latest }, { occurredAt: earlier }]).lastTreatmentAt, latest);
  assert.equal(treatmentSummary([activity("latest", "COMMENT", latest), activity("earlier", "COMMENT", earlier)], []).lastTreatmentAt, latest);
  assert.equal(treatmentDay(latest), "2026-01-02");
});

test("calendar boundaries follow Casablanca and reject impossible days", () => {
  assert.equal(treatmentDay("2026-01-01T23:30:00.000Z"), "2026-01-02");
  assert.equal(validateTreatmentDay("2026-01-02"), "2026-01-02");
  for (const value of ["2026-02-30", "2026-13-01", "2026-01-02T12:00:00Z", "yesterday"]) assert.throws(() => validateTreatmentDay(value));
});

test("À contacter uses the same status predicate, own/collaborator scope and exits after new contact or manual status", () => {
  const leads = new LeadService(new AuditService());
  const base = { firstName: "Synthetic", lastName: "Fixture", campus: "CASABLANCA", campaign: "Fixture", program: "Fixture", educationLevel: "Bac", source: "FIXTURE" };
  const mine = leads.registerLocalLead({ ...base, leadCode: "SYNTH-A", assignedToId: commercial.userId });
  const shared = leads.registerLocalLead({ ...base, leadCode: "SYNTH-B", assignedToId: "other", collaboratorIds: [commercial.userId] });
  leads.registerLocalLead({ ...base, leadCode: "SYNTH-C", assignedToId: "other" });
  const query = { page: 1, pageSize: 25, view: "TO_CONTACT" };
  assert.equal(leads.listLeads(query, manager, "read").total, 3);
  assert.equal(leads.listLeads(query, commercial, "read").total, 2);
  leads.addActivity(mine.id, { type: "COMMENT", result: "COMPLETED", note: "Échange réel synthétique" }, commercial, "interaction");
  leads.changeStatus(shared.id, { status: "CONTACTED" }, commercial, "manual");
  assert.equal(leads.listLeads(query, commercial, "read").total, 0);
  assert.equal(leads.listLeads(query, { ...manager, permissionLeadIds: new Set([mine.id]) }, "read").total, 0);
});

test("persistent treatment projection combines filters, inclusive Casablanca days and stable oldest-first ordering", async () => {
  const row = (id: string): LeadRecord => ({ id, leadCode: id, firstName: "Synthetic", lastName: "Fixture", campus: "CASABLANCA", campaign: "Fixture", program: "Fixture", educationLevel: "Bac", source: "FIXTURE", status: "PROSPECT", createdAt: "2026-01-01T00:00:00.000Z", assignedToId: commercial.userId });
  const repository = { enabled: true, snapshot: () => Promise.resolve({ leads: [row("lead-a"), row("lead-b"), row("lead-c")], activities: [], historicalTreatments: [{ leadId: "lead-a", occurredAt: "2026-01-01T23:30:00.000Z" }, { leadId: "lead-b", occurredAt: null }] }) } as unknown as LeadPersistenceRepository;
  const leads = new LeadService(new AuditService(), repository);
  await leads.onModuleInit();
  const query = { page: 1, pageSize: 25, sortBy: "lastTreatmentAt", sortDirection: "asc" };
  const page = leads.listLeads(query, manager, "read");
  assert.deepEqual(page.items.map((item) => item.id), ["lead-a", "lead-b", "lead-c"]);
  assert.equal(page.items[1]?.treatmentState, "UNKNOWN_DATE");
  assert.equal(page.items[2]?.treatmentState, "NONE");
  assert.equal(leads.listLeads({ ...query, treatmentFrom: "2026-01-02", treatmentTo: "2026-01-02", campus: "CASABLANCA", source: "FIXTURE", assignedToId: commercial.userId }, manager, "read").total, 1);
  assert.equal(leads.listLeads({ ...query, treatmentState: "NONE" }, manager, "read").total, 1);
  assert.equal(leads.listLeads({ ...query, treatmentState: "UNKNOWN_DATE" }, manager, "read").total, 1);
  const funnel = new CommercialFunnelService(leads, new AuditService());
  for (const treatment of [{ treatmentFrom: "2026-01-02", treatmentTo: "2026-01-02" }, { treatmentState: "UNKNOWN_DATE" }, { treatmentState: "NONE" }]) {
    const filter = { campus: "CASABLANCA", source: "FIXTURE", adviserId: commercial.userId, ...treatment };
    assert.equal(funnel.read(filter, manager, "funnel").cohort.totalUniqueLeads, leads.listLeads({ ...query, ...filter }, manager, "list").total);
    const normalized = normalizeReportingQuery({ ...filter, period: "custom", from: "2026-01-01", to: "2027-01-01" }, manager);
    for (const [key, value] of Object.entries(treatment)) assert.equal(normalized[key as keyof typeof normalized], value);
  }
  assert.throws(() => normalizeTreatmentFilters({ treatmentFrom: "2026-02-30" }));
  assert.throws(() => normalizeTreatmentFilters({ treatmentFrom: "2026-01-03", treatmentTo: "2026-01-02" }));
  assert.throws(() => normalizeTreatmentFilters({ treatmentState: "UNKNOWN" }));
  assert.throws(() => leads.listLeads({ ...query, treatmentFrom: "2026-01-03", treatmentTo: "2026-01-02" }, manager, "read"));
});
