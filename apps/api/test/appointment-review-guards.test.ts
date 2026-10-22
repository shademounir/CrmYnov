import assert from "node:assert/strict";
import test from "node:test";
import { AppointmentService, type AppointmentRecord, type InterviewReport } from "../src/appointments/appointment.service.js";
import type { AppointmentPersistenceRepository, AppointmentSnapshot } from "../src/appointments/appointment-persistence.repository.js";
import { appointmentCreationSignature, creationSignatureFromAudit } from "../src/appointments/appointment-creation-signature.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import type { Principal } from "../src/auth/auth.types.js";

const adviser: Principal = { userId: "synthetic-adviser", sessionId: "synthetic-session", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "Synthetic A" }] };
const original: AppointmentRecord = { id: "synthetic-appointment", leadId: "synthetic-lead", type: "APPEL_INFORMATION", mode: "TELEPHONE", state: "PLANIFIE", startsAt: "2099-01-01T09:00:00.000Z", durationMinutes: 30, campus: "Synthetic A", adviserId: adviser.userId, organizerId: adviser.userId, participantIds: [], version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", conflictWarning: false, overloadWarning: false };
const creationAudit = (record: AppointmentRecord): Record<string, unknown> => ({ appointmentId: record.id, leadId: record.leadId, type: record.type, mode: record.mode, state: record.state, startsAt: record.startsAt, durationMinutes: record.durationMinutes, campus: record.campus, version: 1 });
const report = (appointmentId: string, result: InterviewReport["result"]): InterviewReport => ({ id: `report-${appointmentId}`, appointmentId, result, comment: "[REDACTED]", recommendation: "[REDACTED]", validatedAt: "2026-01-02T00:00:00.000Z", validatedBy: "synthetic-evaluator" });
function setup(snapshot: AppointmentSnapshot): { service: AppointmentService; leads: LeadService; persisted: AppointmentRecord[] } {
  const audit = new AuditService(), leads = new LeadService(audit), notifications = new NotificationService(audit);
  const persisted: AppointmentRecord[] = [];
  const persistence = { enabled: true, snapshot: (): Promise<AppointmentSnapshot> => Promise.resolve(structuredClone(snapshot)), persistCreate: (record: AppointmentRecord): Promise<void> => { persisted.push(record); return Promise.resolve(); } } as unknown as AppointmentPersistenceRepository;
  return { service: new AppointmentService(leads, notifications, audit, persistence), leads, persisted };
}

test("persistent KPI results use exactly the authorized appointment set, excluding other campuses and orphan reports", async () => {
  const foreign = { ...original, id: "foreign", campus: "Synthetic B", adviserId: "other" };
  const { service } = setup({ items: [original, foreign], events: [], reports: [report(original.id, "FAVORABLE"), report(foreign.id, "DEFAVORABLE"), report("orphan", "NON_DECIDE")] });
  for (const principal of [adviser, { ...adviser, roles: ["MANAGER" as const] }]) {
    const result = await service.kpisForApi(principal);
    assert.equal(result.counts.PLANIFIE, 1); assert.equal(result.results.FAVORABLE, 1);
    assert.equal(result.results.DEFAVORABLE, 0); assert.equal(result.results.NON_DECIDE, 0);
    assert.equal(Object.values(result.results).reduce((sum, count) => sum + count, 0), 1);
  }
  const all = await service.kpisForApi({ ...adviser, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }] });
  assert.equal(all.results.DEFAVORABLE, 1); assert.equal(all.results.NON_DECIDE, 0);
});

test("same-campus uninvolved adviser cannot infer report outcomes", async () => {
  const { service } = setup({ items: [original], events: [], reports: [report(original.id, "FAVORABLE")] });
  const result = await service.kpisForApi({ ...adviser, userId: "uninvolved" });
  assert.equal(result.counts.PLANIFIE, 0); assert.equal(result.results.FAVORABLE, 0);
});

for (const state of ["CONFIRME", "REPORTE", "ANNULE"] as const) {
  test(`creation evidence survives persisted ${state} and a fresh service instance`, async () => {
    const audit = new AuditService(), leads = new LeadService(audit);
    const lead = leads.registerLocalLead({ leadCode: "LD-SYNTHETIC-REPLAY", firstName: "Synthetic", lastName: "Only", campus: "Synthetic A", campaign: "Synthetic", educationLevel: "BAC", program: "Synthetic", source: "TEST", assignedToId: adviser.userId });
    const created = { ...original, leadId: lead.id };
    const current = { ...created, state, startsAt: state === "REPORTE" ? "2099-02-01T09:00:00.000Z" : created.startsAt, version: 2 };
    const key = "synthetic-creation-key";
    const signature = creationSignatureFromAudit(current, creationAudit(created)); assert.ok(signature);
    const snapshot: AppointmentSnapshot = { items: [current], events: [{ id: "event", appointmentId: current.id, type: "APPOINTMENT_CREATED", toState: "PLANIFIE", actorId: adviser.userId, occurredAt: created.createdAt, idempotencyKey: key }], reports: [], creationReceipts: [{ id: current.id, idempotencyKey: key, signature }] };
    const persistence = { enabled: true, snapshot: (): Promise<AppointmentSnapshot> => Promise.resolve(structuredClone(snapshot)), persistCreate: async (): Promise<void> => {} } as unknown as AppointmentPersistenceRepository;
    const service = new AppointmentService(leads, new NotificationService(audit), audit, persistence);
    const input = { type: created.type, mode: created.mode, startsAt: created.startsAt, durationMinutes: created.durationMinutes, adviserId: adviser.userId, idempotencyKey: key };
    const before = structuredClone(snapshot);
    const replay = await service.createForApi(lead.id, input, adviser, "synthetic-restart");
    assert.equal(replay.id, current.id); assert.equal(replay.state, state); assert.equal(replay.startsAt, current.startsAt);
    assert.deepEqual(snapshot, before);
    await assert.rejects(service.createForApi(lead.id, { ...input, durationMinutes: 45 }, adviser, "changed"), /Conflict/);
  });
}

test("immutable audit reconstruction is fail closed on missing, malformed, wrong identity or tampered signature evidence", () => {
  const current = { ...original, state: "ANNULE" as const, version: 2 };
  const after = creationAudit(original), expected = appointmentCreationSignature(original);
  assert.equal(creationSignatureFromAudit(current, after), expected);
  assert.equal(creationSignatureFromAudit(current, { ...after, creationSignature: expected }), expected);
  for (const bad of [undefined, null, [], {}, { ...after, appointmentId: "wrong" }, { ...after, leadId: "wrong" }, { ...after, state: "CONFIRME" }, { ...after, startsAt: "invalid" }, { ...after, creationSignature: "f".repeat(64) }]) assert.equal(creationSignatureFromAudit(current, bad), undefined);
});

test("canonical creation signature is order independent but distinguishes every request input", () => {
  const value = { ...original, participantIds: ["b", "a"] }, signature = appointmentCreationSignature(value);
  assert.equal(appointmentCreationSignature({ ...value, participantIds: ["a", "b"] }), signature);
  for (const change of [{ state: "BROUILLON" as const }, { startsAt: "2099-02-01T09:00:00.000Z" }, { durationMinutes: 45 }, { campus: "Synthetic B" }, { adviserId: "other" }, { evaluatorId: "other" }, { participantIds: ["a"] }, { leadId: "other" }]) assert.notEqual(appointmentCreationSignature({ ...value, ...change }), signature);
});
