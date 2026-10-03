import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { assertDuration, assertKey, assertUuid, assertVersion, freeSlots, hashAdmissions, instant, interval, strictInput } from "../src/admissions/admissions.contract.js";
import { routePermissions } from "../src/permissions/dynamic-routes.js";
import { permissionTransactionMode } from "../src/permissions/permission-transaction-routes.js";
import { AdmissionsController } from "../src/admissions/admissions.controller.js";
import { AdmissionsService } from "../src/admissions/admissions.service.js";
import type { AuthenticatedRequest, Principal } from "../src/auth/auth.types.js";
import type { BookingDecisionInput, BookingInput, ResponsibilityInput, WindowInput, WithdrawWindowInput, AdmissionsReportInput } from "../src/admissions/admissions.contract.js";
import { AppointmentService, type AppointmentRecord } from "../src/appointments/appointment.service.js";
import type { AppointmentPersistenceRepository, AppointmentSnapshot } from "../src/appointments/appointment-persistence.repository.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";

const date = (value: string): Date => new Date(`2099-10-03T${value}:00.000Z`);
test("Admissions free slots use half-open intervals and do not return occupied details", () => {
  const available = [{ startsAt: date("09:00"), endsAt: date("11:00") }];
  const busy = [{ startsAt: date("09:30"), endsAt: date("10:00") }];
  const slots = freeSlots(available, busy, date("09:00"), date("11:00"), 30, date("08:00"));
  assert.deepEqual(slots.map((slot) => slot.startsAt), [date("09:00"), date("10:00"), date("10:15"), date("10:30")].map((value) => value.toISOString()));
  assert.ok(slots.every((slot) => Object.keys(slot).sort().join(",") === "endsAt,startsAt"));
});
test("Admissions duplicate availability windows never duplicate a slot", () => {
  const available = [{ startsAt: date("09:00"), endsAt: date("11:00") }, { startsAt: date("09:00"), endsAt: date("10:00") }];
  const slots = freeSlots(available, [], date("09:00"), date("11:00"), 30, date("09:02"));
  assert.equal(new Set(slots.map((slot) => slot.startsAt)).size, slots.length);
  assert.equal(slots[0]?.startsAt, date("09:15").toISOString());
  assert.equal(freeSlots(available, [], date("09:00"), date("11:00"), 480, date("08:00")).length, 0);
});
test("Admissions canonical idempotency fingerprint ignores object-key order but preserves payload", () => {
  assert.equal(hashAdmissions({ z: [1, { b: 2, a: 3 }], a: 5 }), hashAdmissions({ a: 5, z: [1, { a: 3, b: 2 }] }));
  assert.equal(hashAdmissions({ a: undefined, b: 1 }), hashAdmissions({ b: 1 }));
  assert.notEqual(hashAdmissions({ a: [1, 2] }), hashAdmissions({ a: [2, 1] }));
});
test("Admissions inputs require explicit timezone, bounds and strict fields", () => {
  assert.equal(instant("2099-10-03T10:00:00+01:00").toISOString(), date("09:00").toISOString());
  assert.throws(() => instant("2099-10-03T09:00:00"));
  assert.throws(() => instant("garbageZ"));
  assert.throws(() => interval(date("10:00").toISOString(), date("09:00").toISOString(), 7));
  assert.throws(() => interval(date("09:00").toISOString(), "2099-10-11T09:00:00Z", 7));
  assert.throws(() => strictInput({ state: "ACCEPTED", surprise: true }, ["state"]));
  assert.throws(() => strictInput(null, []));
  for (const invalid of [14, 481, 30.5, "30"]) assert.throws(() => assertDuration(invalid));
  for (const invalid of [0, -1, "1"]) assert.throws(() => assertVersion(invalid));
  assertVersion(0, true); assertVersion(1); assertDuration(15); assertDuration(480);
  assertUuid("00000000-0000-4000-8000-000000000175"); assertKey("synthetic-booking-175");
  assert.throws(() => assertUuid("not-uuid")); assert.throws(() => assertKey("short"));
});
test("Admissions routes are closed whitelisted, current permission fence never bypassed", () => {
  for (const handler of ["context", "responsibles", "configureResponsibility", "windows", "createWindow", "withdrawWindow", "slots", "createBooking", "bookings", "booking", "bookingSlots", "decide", "report"]) assert.deepEqual(routePermissions("AdmissionsController", handler), []);
  assert.equal(routePermissions("AdmissionsController", "makeAdmin"), null);
  for (const handler of ["context", "responsibles", "windows", "slots", "bookings", "booking", "bookingSlots"]) assert.equal(permissionTransactionMode("AdmissionsController", handler), "read");
  for (const handler of ["configureResponsibility", "createWindow", "withdrawWindow", "createBooking", "decide", "report"]) assert.equal(permissionTransactionMode("AdmissionsController", handler), "write");
});

test("Admissions controller binds each real route to the principal and correlation, without accepting client grants", async () => {
  // This is an isolated adapter unit test, not an HTTP or PostgreSQL persistence proof.
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const service = new Proxy({} as AdmissionsService, { get: (_target, key): unknown => (...args: unknown[]): Promise<unknown> => { calls.push({ operation: String(key), args }); return Promise.resolve({}); } });
  const controller = new AdmissionsController(service);
  const actor: Principal = { userId: "00000000-0000-4000-8000-000000000175", sessionId: "00000000-0000-4000-8000-000000000176", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "SYNTHETIC" }] };
  const request = { principal: actor, header: (): string => "synthetic-correlation" } as unknown as AuthenticatedRequest;
  const responsibility: ResponsibilityInput = { userId: actor.userId, campus: "SYNTHETIC", active: true, expectedVersion: 0, idempotencyKey: "synthetic-profile" };
  const window: WindowInput = { responsibilityId: actor.userId, kind: "AVAILABLE", startsAt: "2099-10-03T09:00:00Z", endsAt: "2099-10-03T17:00:00Z", idempotencyKey: "synthetic-window" };
  const withdraw: WithdrawWindowInput = { active: false, expectedVersion: 1, idempotencyKey: "synthetic-withdraw" };
  const booking: BookingInput = { responsibilityId: actor.userId, startsAt: window.startsAt, durationMinutes: 30, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", idempotencyKey: "synthetic-request" };
  const decision: BookingDecisionInput = { action: "ACCEPT", expectedVersion: 1, idempotencyKey: "synthetic-decision" };
  const report: AdmissionsReportInput = { expectedVersion: 2, idempotencyKey: "synthetic-report", result: "NON_DECIDE", comment: "Synthetic", recommendation: "Manual review" };
  await controller.context("SYNTHETIC", request); await controller.responsibles(actor.userId, "SYNTHETIC", request); await controller.configureResponsibility(responsibility, request);
  await controller.windows("SYNTHETIC", request); await controller.createWindow(window, request); await controller.withdrawWindow(actor.userId, withdraw, request);
  await controller.slots({ leadId: actor.userId, responsibilityId: actor.userId, from: window.startsAt, to: window.endsAt, durationMinutes: "30" }, request);
  await controller.createBooking(actor.userId, booking, request); await controller.bookings(actor.userId, "SYNTHETIC", request); await controller.booking(actor.userId, request); await controller.bookingSlots(actor.userId, window.startsAt, window.endsAt, request); await controller.decide(actor.userId, decision, request); await controller.report(actor.userId, report, request);
  assert.deepEqual(calls.map((call) => call.operation), ["context", "responsibles", "configureResponsibility", "windows", "createWindow", "withdrawWindow", "slots", "createBooking", "bookings", "booking", "bookingSlots", "decide", "report"]);
  assert.ok(calls.every((call) => call.args.includes(actor)));
  assert.ok(calls.filter((call) => ["configureResponsibility", "createWindow", "withdrawWindow", "createBooking", "decide", "report"].includes(call.operation)).every((call) => call.args.includes("synthetic-correlation")));
  assert.throws(() => controller.context(undefined, { header: (): undefined => undefined } as unknown as AuthenticatedRequest));
  await controller.slots({}, { principal: actor, header: (): undefined => undefined } as unknown as AuthenticatedRequest);
  await controller.configureResponsibility(responsibility, { principal: actor, header: (): undefined => undefined } as unknown as AuthenticatedRequest);
  assert.equal(calls.at(-1)?.args.at(-1), "missing-correlation");
});

test("Legacy persisted warning recalculation counts only active appointments, not historic terminal rows", async () => {
  // Pure warning calculation over a synthetic snapshot, not a persistence proof.
  const actor: Principal = { userId: "synthetic-responsible", sessionId: "synthetic-session", roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: "SYNTHETIC" }] };
  const record = (id: string, minutes: number, state: AppointmentRecord["state"]): AppointmentRecord => ({ id, leadId: "synthetic-lead", type: "RENDEZ_VOUS_LIBRE", mode: "TELEPHONE", state, startsAt: new Date(date("09:00").valueOf() + minutes * 60_000).toISOString(), durationMinutes: 15, campus: "SYNTHETIC", adviserId: actor.userId, organizerId: actor.userId, participantIds: [], version: 1, createdAt: date("08:00").toISOString(), updatedAt: date("08:00").toISOString(), conflictWarning: false, overloadWarning: false });
  const rows = [...Array.from({ length: 8 }, (_, index) => record(`active-${index}`, index * 30, "PLANIFIE")), ...Array.from({ length: 300 }, (_, index) => record(`historic-${index}`, 0, "ANNULE"))];
  const persistence = { enabled: true, snapshot: (): Promise<AppointmentSnapshot> => Promise.resolve({ items: rows, events: [], reports: [] }) } as unknown as AppointmentPersistenceRepository;
  const audit = new AuditService(); const service = new AppointmentService(new LeadService(audit), new NotificationService(audit), audit, persistence);
  await service.onModuleInit();
  const eight = service.list({ page: 1, pageSize: 10, state: "PLANIFIE" }, actor);
  assert.equal(eight.total, 8); assert.ok(eight.items.every((item) => item.overloadWarning)); assert.ok(eight.items.every((item) => !item.conflictWarning), "300 historic overlaps must not become active conflicts");
  rows[7]!.state = "ANNULE"; await service.onModuleInit();
  const seven = service.list({ page: 1, pageSize: 10, state: "PLANIFIE" }, actor);
  assert.equal(seven.total, 7); assert.ok(seven.items.every((item) => !item.overloadWarning), "Threshold remains seven other active appointments, not historic ones");
});
