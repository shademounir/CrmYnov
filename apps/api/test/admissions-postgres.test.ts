import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { AdmissionsService } from "../src/admissions/admissions.service.js";
import type { BookingInput } from "../src/admissions/admissions.contract.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import type { CrmReference, Lead } from "@prisma/client";
import type { ResponsibilityView, WindowView } from "../src/admissions/admissions.contract.js";

const options = { skip: process.env.CRMY175_EPHEMERAL_TEST !== "true" };
const base = Date.parse("2099-10-03T09:00:00Z");
const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString();
const errorCode = (error: unknown): string => error && typeof error === "object" && "getResponse" in error && typeof error.getResponse === "function" ? (error.getResponse() as { code: string }).code : "";
interface Fixture {
  prisma: PrismaService; db: NonNullable<PrismaService["client"]>; suffix: string; campus: CrmReference; admin: Principal; responsible: Principal; requester: Principal;
  lead: Lead; service: AdmissionsService; key: (operation: string) => string; profile: ResponsibilityView; window: WindowView; input: (minutes?: number, operation?: string) => BookingInput;
  effects: (appointmentId: string) => Promise<{ appointments: number; events: number; activities: number; notifications: number; audits: number }>; close: () => Promise<void>;
}
async function fixture(): Promise<Fixture> {
  const prisma = new PrismaService(); const db = prisma.client!;
  assert.ok(db); const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const recipe = url.pathname === "/crmy175_recipe_synthetic";
  assert.ok(recipe || url.pathname === "/crmy171_synthetic", "No shared or private source database allowed");
  const nonce = process.env[recipe ? "CRMY175_DATABASE_NONCE" : "CRMY171_DATABASE_NONCE"];
  assert.match(nonce ?? "", /^[0-9a-f-]{36}$/u);
  const marker = recipe ? await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy175_test_identity.marker` : await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy171_test_identity.marker`;
  assert.deepEqual(marker, [{ nonce }]);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const campus = await db.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: `JNY-${suffix}`, label: `Synthetic journey ${suffix}`, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: `JNY-${suffix}` } } } });
  const identity = async (role: Role, name: string): Promise<Principal> => {
    const row = await db.collaborator.create({ data: { professionalEmail: `${name.toLowerCase()}-${suffix.toLowerCase()}@example.invalid`, professionalDisplayName: `Synthetic ${name}`, active: true, firstLoginRequired: false, roles: [role], campusId: campus.id } }); const sessionId = randomUUID();
    await db.localSession.create({ data: { id: sessionId, collaboratorId: row.id, tokenDigest: createHash("sha256").update(sessionId).digest("hex"), roles: [role], scopes: [], authenticationVersion: row.authenticationVersion, expiresAt: new Date("2099-12-31T00:00:00Z") } });
    return { userId: row.id, sessionId, roles: [role], scopes: role === "SUPER_ADMIN" ? [{ kind: "GLOBAL" }] : [{ kind: "CAMPUS", id: campus.id }] };
  };
  const admin = await identity("SUPER_ADMIN", "Admin"); const responsible = await identity("ADMISSIONS", "Responsible"); const requester = await identity("ADMISSIONS", "Requester");
  const lead = await db.lead.create({ data: { leadCode: `JNY-${suffix}`, firstName: "Synthetic", lastName: "Journey", campus: campus.code, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: requester.userId } });
  const service = new AdmissionsService(new DynamicPermissionRepository(prisma));
  const key = (operation: string): string => `${operation}-${suffix}`;
  const profile = await service.configureResponsibility({ userId: responsible.userId, campus: campus.id, active: true, expectedVersion: 0, idempotencyKey: key("profile") }, admin, key("correlation"));
  const window = await service.createWindow({ responsibilityId: profile.id, kind: "AVAILABLE", startsAt: at(0), endsAt: at(480), idempotencyKey: key("available") }, responsible, key("correlation"));
  const input = (minutes = 0, operation = "request"): BookingInput => ({ responsibilityId: profile.id, startsAt: at(minutes), durationMinutes: 30, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", idempotencyKey: key(operation) });
  const effects = async (appointmentId: string): ReturnType<Fixture["effects"]> => ({ appointments: await db.appointment.count({ where: { id: appointmentId } }), events: await db.appointmentEvent.count({ where: { appointmentId } }), activities: await db.leadActivity.count({ where: { leadId: lead.id } }), notifications: await db.internalNotification.count({ where: { resourceId: appointmentId } }), audits: await db.auditEvent.count({ where: { resourceId: appointmentId } }) });
  return { prisma, db, suffix, campus, admin, responsible, requester, lead, service, key, profile, window, input, effects, close: (): Promise<void> => prisma.onModuleDestroy() };
}

test("CRMY-175 PostgreSQL journey: owner agenda is private and commercial slots only contain declared free time", options, async () => {
  const f = await fixture(); try {
    const context = await f.service.context(f.admin); assert.equal(context.canManageResponsibilities, true); assert.ok(context.eligibleUsers.some((row) => row.id === f.responsible.userId && row.campus === f.campus.code));
    assert.equal((await f.service.context(f.responsible)).ownResponsibilities[0]?.id, f.profile.id);
    assert.deepEqual((await f.service.windows(f.requester)).items, []);
    assert.ok((await f.service.windows(f.responsible)).items.some((row) => row.id === f.window.id));
    await f.service.createWindow({ responsibilityId: f.profile.id, kind: "BLOCKED", startsAt: at(60), endsAt: at(90), idempotencyKey: f.key("blocked") }, f.responsible, "synthetic-block");
    const result = await f.service.slots(f.lead.id, f.profile.id, at(0), at(480), 30, f.requester);
    assert.equal(result.redacted, true); assert.equal(result.timezone, "Africa/Casablanca");
    assert.ok(result.items.some((slot) => slot.startsAt === at(0)));
    assert.ok(!result.items.some((slot) => slot.startsAt < at(90) && slot.endsAt > at(60)));
    assert.ok(result.items.every((slot) => Object.keys(slot).sort().join(",") === "endsAt,startsAt"));
    await assert.rejects(() => f.service.createWindow({ responsibilityId: f.profile.id, kind: "BLOCKED", startsAt: at(120), endsAt: at(150), idempotencyKey: f.key("private-write") }, f.requester, "denied"), (error) => errorCode(error) === "permission_denied");
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL journey: failed report keeps the old reservation, successful report becomes pending and cancel releases it", options, async () => {
  const f = await fixture(); try {
    const requested = await f.service.createBooking(f.lead.id, f.input(), f.requester, "synthetic-request");
    const accepted = await f.service.decide(requested.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: f.key("accept") }, f.responsible, "synthetic-accept");
    const blocked = await f.service.createWindow({ responsibilityId: f.profile.id, kind: "BLOCKED", startsAt: at(60), endsAt: at(90), idempotencyKey: f.key("block-report") }, f.responsible, "synthetic-block");
    const before = await f.effects(requested.id);
    const report = { action: "RESCHEDULE" as const, startsAt: at(60), reason: "SYNTHETIC_CONFLICT", expectedVersion: accepted.version, idempotencyKey: f.key("report-conflict") };
    await assert.rejects(() => f.service.decide(requested.id, report, f.requester, "synthetic-report-conflict"), (error) => errorCode(error) === "admissions_booking_conflict");
    assert.equal((await f.service.booking(requested.id, f.requester)).startsAt, at(0)); assert.deepEqual(await f.effects(requested.id), before);
    assert.equal(await f.db.admissionsMutationReceipt.count({ where: { actorId: f.requester.userId, key: report.idempotencyKey } }), 0);
    await f.service.withdrawWindow(blocked.id, { active: false, expectedVersion: blocked.version, idempotencyKey: f.key("withdraw-block") }, f.responsible, "synthetic-withdraw");
    const rescheduled = await f.service.decide(requested.id, report, f.requester, "synthetic-report"); assert.equal(rescheduled.state, "PENDING"); assert.equal(rescheduled.appointmentState, "REPORTE"); assert.equal(rescheduled.startsAt, at(60));
    const slots = await f.service.bookingSlots(requested.id, at(0), at(180), f.responsible); assert.ok(slots.items.some((row) => row.startsAt === at(60)), "Own reservation is excluded only for its controlled reschedule");
    assert.equal((await f.service.decide(requested.id, report, f.requester, "replay-report")).version, rescheduled.version);
    const cancelled = await f.service.decide(requested.id, { action: "CANCEL", reason: "SYNTHETIC_CANCEL", expectedVersion: rescheduled.version, idempotencyKey: f.key("cancel") }, f.requester, "synthetic-cancel"); assert.equal(cancelled.state, "CANCELLED");
    assert.ok((await f.service.slots(f.lead.id, f.profile.id, at(0), at(180), 30, f.requester)).items.some((row) => row.startsAt === at(60)));
    assert.deepEqual(await f.effects(requested.id), { appointments: 1, events: 4, activities: 4, notifications: 8, audits: 4 });
    assert.equal((await f.service.createBooking(f.lead.id, f.input(), f.requester, "replay-original")).state, "PENDING", "Receipt returns the original request, not a fabricated current result");
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL journey: an occupied availability cannot be silently withdrawn, and refusal frees it", options, async () => {
  const f = await fixture(); try {
    const requested = await f.service.createBooking(f.lead.id, f.input(), f.requester, "synthetic-request");
    await assert.rejects(() => f.service.withdrawWindow(f.window.id, { active: false, expectedVersion: 1, idempotencyKey: f.key("withdraw") }, f.responsible, "synthetic-withdraw"), (error) => errorCode(error) === "admissions_window_in_use");
    const refused = await f.service.decide(requested.id, { action: "REFUSE", reason: "SYNTHETIC_UNAVAILABLE", expectedVersion: 1, idempotencyKey: f.key("refuse") }, f.responsible, "synthetic-refuse"); assert.equal(refused.state, "REFUSED");
    const withdrawn = await f.service.withdrawWindow(f.window.id, { active: false, expectedVersion: 1, idempotencyKey: f.key("withdraw") }, f.responsible, "synthetic-withdraw"); assert.equal(withdrawn.active, false);
    assert.deepEqual((await f.service.slots(f.lead.id, f.profile.id, at(0), at(180), 30, f.requester)).items, []);
    assert.deepEqual(await f.effects(requested.id), { appointments: 1, events: 2, activities: 2, notifications: 4, audits: 2 });
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL journey: bounded Admin decisions preserve requester separation and release a revoked profile booking", options, async () => {
  const f = await fixture(); try {
    const request = await f.service.createBooking(f.lead.id, f.input(), f.requester, "synthetic-request");
    const adminView = await f.service.booking(request.id, f.admin); assert.equal(adminView.canDecide, true);
    await f.service.configureResponsibility({ userId: f.responsible.userId, campus: f.campus.id, active: false, expectedVersion: 1, idempotencyKey: f.key("revoke") }, f.admin, "synthetic-revoke");
    await assert.rejects(() => f.service.decide(request.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: f.key("revoked-accept") }, f.responsible, "denied"));
    const cancelled = await f.service.decide(request.id, { action: "CANCEL", expectedVersion: 1, reason: "SYNTHETIC_REVOKED", idempotencyKey: f.key("revoked-cancel") }, f.requester, "synthetic-cancel");
    assert.equal(cancelled.state, "CANCELLED"); assert.deepEqual(await f.effects(request.id), { appointments: 1, events: 2, activities: 2, notifications: 4, audits: 2 });
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL journey: outcome is refused before the scheduled end and recorded once after it", options, async (context) => {
  const f = await fixture(); try {
    const request = await f.service.createBooking(f.lead.id, f.input(), f.requester, "synthetic-request"); const accepted = await f.service.decide(request.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: f.key("accept") }, f.responsible, "synthetic-accept");
    const completed = { action: "COMPLETE" as const, expectedVersion: accepted.version, idempotencyKey: f.key("complete") };
    assert.equal(accepted.canComplete, false); await assert.rejects(() => f.service.decide(request.id, completed, f.responsible, "too-early"), (error) => errorCode(error) === "admissions_transition_refused");
    context.mock.timers.enable({ apis: ["Date"], now: base + 31 * 60_000 });
    assert.equal((await f.service.booking(request.id, f.responsible)).canComplete, true);
    const final = await f.service.decide(request.id, completed, f.responsible, "synthetic-complete"); assert.equal(final.appointmentState, "REALISE"); assert.equal(final.canComplete, false);
    assert.equal((await f.service.decide(request.id, completed, f.responsible, "replay-complete")).version, final.version);
    assert.deepEqual(await f.effects(request.id), { appointments: 1, events: 3, activities: 3, notifications: 6, audits: 3 });
    assert.equal(final.canWriteReport, true);
    const report = { expectedVersion: final.version, idempotencyKey: f.key("interview-report"), result: "NON_DECIDE", comment: "Synthetic report without personal data", recommendation: "Synthetic manual review", followUpAt: at(120) };
    await assert.rejects(() => f.service.report(request.id, report, f.requester, "denied-report"), (error) => errorCode(error) === "permission_denied");
    const reported = await f.service.report(request.id, report, f.responsible, "synthetic-report"); assert.equal(reported.reportResult, "NON_DECIDE"); assert.equal(reported.canWriteReport, false);
    assert.equal((await f.service.report(request.id, report, f.responsible, "replay-report")).version, reported.version);
    const persisted = await f.db.interviewReport.findMany({ where: { appointmentId: request.id } }); assert.equal(persisted.length, 1); assert.equal(persisted[0]?.redactedComment, "[REDACTED]");
    assert.equal((await f.db.lead.findUniqueOrThrow({ where: { id: f.lead.id } })).status, "PROSPECT", "A report never auto-enrolls a Lead");
    assert.deepEqual(await f.effects(request.id), { appointments: 1, events: 4, activities: 4, notifications: 8, audits: 4 });
  } finally { context.mock.timers.reset(); await f.close(); }
});

test("CRMY-175 PostgreSQL journey: no-show is traced only after the appointment end, without automatic retry", options, async (context) => {
  const f = await fixture(); try {
    const request = await f.service.createBooking(f.lead.id, f.input(), f.requester, "synthetic-request"); const accepted = await f.service.decide(request.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: f.key("accept") }, f.responsible, "synthetic-accept");
    const input = { action: "NO_SHOW" as const, reason: "SYNTHETIC_NO_SHOW", expectedVersion: accepted.version, idempotencyKey: f.key("no-show") };
    await assert.rejects(() => f.service.decide(request.id, input, f.responsible, "early"), (error) => errorCode(error) === "admissions_transition_refused");
    context.mock.timers.enable({ apis: ["Date"], now: base + 31 * 60_000 });
    const absent = await f.service.decide(request.id, input, f.responsible, "synthetic-no-show"); assert.equal(absent.appointmentState, "ABSENT"); assert.equal(absent.canNoShow, false); assert.equal(absent.canWriteReport, false);
    assert.equal((await f.service.decide(request.id, input, f.responsible, "replay")).version, absent.version);
    assert.deepEqual(await f.effects(request.id), { appointments: 1, events: 3, activities: 3, notifications: 6, audits: 3 });
  } finally { context.mock.timers.reset(); await f.close(); }
});

test("CRMY-175 PostgreSQL journey: authorized agenda pagination is stable, explicit and campus-alias consistent", options, async () => {
  const f = await fixture(); try {
    const expected = [];
    for (let index = 0; index < 3; index++) expected.push(await f.service.createBooking(f.lead.id, f.input(index * 60, `page-${index}`), f.requester, "synthetic-pagination"));
    const first = await f.service.bookings(f.requester, undefined, f.campus.id, undefined, 1);
    assert.deepEqual(first.items.map((item) => item.id), [expected[0]!.id]); assert.equal(first.hasMore, true); assert.equal(typeof first.nextCursor, "string");
    const second = await f.service.bookings(f.requester, undefined, f.campus.code, first.nextCursor, 1);
    assert.deepEqual(second.items.map((item) => item.id), [expected[1]!.id]); assert.equal(second.hasMore, true);
    const last = await f.service.bookings(f.requester, f.lead.id, f.campus.label, second.nextCursor, 1);
    assert.deepEqual(last.items.map((item) => item.id), [expected[2]!.id]); assert.equal(last.hasMore, false); assert.equal(last.nextCursor, undefined);
    assert.deepEqual((await f.service.bookings(f.requester, f.lead.id)).items.map((item) => item.id), expected.map((item) => item.id));
    for (const cursor of ["not-a-cursor", "invalid$cursor", Buffer.from(JSON.stringify({ startsAt: at(0), id: "malformed" })).toString("base64url")]) await assert.rejects(() => f.service.bookings(f.requester, undefined, undefined, cursor), (error) => errorCode(error) === "admissions_invalid");
    for (const limit of [0, 101, 1.5, Number.NaN]) await assert.rejects(() => f.service.bookings(f.requester, undefined, undefined, undefined, limit), (error) => errorCode(error) === "admissions_invalid");
  } finally { await f.close(); }
});
