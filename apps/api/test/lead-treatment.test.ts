import assert from "node:assert/strict";
import test from "node:test";
import { treatmentSummary, treatmentDay, validateTreatmentDay } from "../src/leads/lead-treatment.js";
import { LeadService, type LeadActivityRecord, type LeadRecord } from "../src/leads/lead.service.js";
import type { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { Principal } from "../src/auth/auth.types.js";

const manager: Principal = { userId: "manager-fixture", sessionId: "fixture", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }] };
const commercial: Principal = { ...manager, userId: "commercial-fixture", roles: ["ADMISSIONS"] };
const activity = (id: string, type: LeadActivityRecord["type"], occurredAt: string): LeadActivityRecord => ({ id, leadId: "lead-a", type, result: "COMPLETED", note: "Échange synthétique", occurredAt, authorId: commercial.userId, correlationId: "fixture" });

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
  assert.throws(() => leads.listLeads({ ...query, treatmentFrom: "2026-01-03", treatmentTo: "2026-01-02" }, manager, "read"));
});
