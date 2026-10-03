import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import type { Appointment, CrmReference, Lead, PrismaClient } from "@prisma/client";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { AdmissionsService } from "../src/admissions/admissions.service.js";
import type { BookingInput, BookingView, ResponsibilityView, WindowView } from "../src/admissions/admissions.contract.js";
import { AppointmentPersistenceRepository } from "../src/appointments/appointment-persistence.repository.js";
import { assertAppointmentFree, lockAppointmentParticipants } from "../src/appointments/appointment-locks.js";
import type { AppointmentEvent, AppointmentRecord } from "../src/appointments/appointment.service.js";
import { currentPrincipal } from "../src/permissions/dynamic-context.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { DynamicPermissionService } from "../src/permissions/dynamic-service.js";
import { PrismaService } from "../src/persistence/prisma.service.js";

const enabled = process.env.CRMY175_EPHEMERAL_TEST === "true";
const options = { skip: !enabled };
const future = "2099-10-03T09:00:00.000Z";
const end = "2099-10-03T17:00:00.000Z";
const at = (minutes: number): string => new Date(Date.parse(future) + minutes * 60_000).toISOString();

interface Fixture {
  first: PrismaService;
  second: PrismaService;
  client: PrismaClient;
  permissions: DynamicPermissionRepository;
  permissions2: DynamicPermissionRepository;
  service: AdmissionsService;
  peer: AdmissionsService;
  marker: string;
  campus: CrmReference;
  otherCampus: CrmReference;
  admin: Principal;
  responsible: Principal;
  requester: Principal;
  requester2: Principal;
  outsider: Principal;
  auditor: Principal;
  participant: Principal;
  lead1: Lead;
  lead2: Lead;
  otherLead: Lead;
  profile: ResponsibilityView;
  window: WindowView;
  input: (suffix: string, minutes?: number) => BookingInput;
  close: () => Promise<void>;
}

function responseCode(error: unknown): string {
  if (error && typeof error === "object" && "getResponse" in error && typeof error.getResponse === "function") {
    const response = error.getResponse() as { code?: string };
    return response.code ?? "";
  }
  return "";
}
const refused = (error: unknown): boolean => ["permission_denied", "admissions_profile_inactive", "admissions_self_approval_forbidden"].includes(responseCode(error));
const conflict = (error: unknown): boolean => ["admissions_booking_conflict", "permission_version_conflict", "admissions_version_conflict", "admissions_idempotency_conflict", "admissions_controlled_transition_required", "admissions_controlled_booking_required"].includes(responseCode(error));

async function assertIsolated(client: PrismaClient): Promise<void> {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname), "Only an explicitly isolated loopback database is allowed");
  if (database.pathname === "/crmy175_recipe_synthetic") {
    const nonce = process.env.CRMY175_DATABASE_NONCE;
    assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    assert.deepEqual(await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy175_test_identity.marker`, [{ nonce }]);
  } else {
    assert.equal(database.pathname, "/crmy171_synthetic", "No recipe, reference, shared DEV or production database is permitted");
    const nonce = process.env.CRMY171_DATABASE_NONCE;
    assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    assert.deepEqual(await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy171_test_identity.marker`, [{ nonce }]);
  }
}

async function fixture(): Promise<Fixture> {
  const first = new PrismaService();
  const second = new PrismaService();
  const client = first.client!;
  assert.ok(client && second.client);
  await assertIsolated(client);
  const marker = randomUUID().slice(0, 8).toUpperCase();
  const campus = await client.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: `SEC-${marker}`, label: `Synthetic Admissions ${marker}`, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: `SEC-${marker}` } } } });
  const otherCampus = await client.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: `OTH-${marker}`, label: `Other synthetic campus ${marker}`, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: `OTH-${marker}` } } } });
  const identity = async (role: Role, label: string, campusId = campus.id): Promise<Principal> => {
    const user = await client.collaborator.create({ data: { professionalEmail: `${label.toLowerCase()}-${marker.toLowerCase()}@example.invalid`, professionalDisplayName: `Synthetic ${label}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    const sessionId = randomUUID();
    await client.localSession.create({ data: { id: sessionId, collaboratorId: user.id, tokenDigest: createHash("sha256").update(sessionId).digest("hex"), roles: [role], scopes: role === "SUPER_ADMIN" ? [{ kind: "GLOBAL" }] : [{ kind: "CAMPUS", id: campusId }], authenticationVersion: user.authenticationVersion, expiresAt: new Date("2099-12-31T00:00:00.000Z") } });
    return { userId: user.id, sessionId, roles: [role], scopes: role === "SUPER_ADMIN" ? [{ kind: "GLOBAL" }] : [{ kind: "CAMPUS", id: campusId }] };
  };
  const admin = await identity("SUPER_ADMIN", "Administrator");
  const responsible = await identity("ADMISSIONS", "Responsible");
  const requester = await identity("ADMISSIONS", "Requester");
  const requester2 = await identity("ADMISSIONS", "RequesterTwo");
  const outsider = await identity("ADMISSIONS", "OtherCampus", otherCampus.id);
  const auditor = await identity("AUDITOR", "Auditor");
  const participant = await identity("ADMISSIONS", "Participant");
  const lead = async (owner: Principal, suffix: string, code = campus.code): Promise<Lead> => client.lead.create({ data: { leadCode: `SEC-${marker}-${suffix}`, firstName: "Synthetic", lastName: suffix, campus: code, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: owner.userId } });
  const lead1 = await lead(requester, "ONE");
  const lead2 = await lead(requester2, "TWO");
  const otherLead = await lead(outsider, "OTHER", otherCampus.code);
  const permissions = new DynamicPermissionRepository(first);
  const permissions2 = new DynamicPermissionRepository(second);
  const service = new AdmissionsService(permissions);
  const peer = new AdmissionsService(permissions2);
  const profile = await service.configureResponsibility({ userId: responsible.userId, campus: campus.id, active: true, expectedVersion: 0, idempotencyKey: `profile-${marker}` }, admin, "synthetic-profile");
  const window = await service.createWindow({ responsibilityId: profile.id, kind: "AVAILABLE", startsAt: future, endsAt: end, idempotencyKey: `available-${marker}` }, responsible, "synthetic-window");
  const input = (suffix: string, minutes = 0): BookingInput => ({ responsibilityId: profile.id, startsAt: at(minutes), durationMinutes: 30, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", idempotencyKey: `book-${marker}-${suffix}` });
  return { first, second, client, permissions, permissions2, service, peer, marker, campus, otherCampus, admin, responsible, requester, requester2, outsider, auditor, participant, lead1, lead2, otherLead, profile, window, input, close: async (): Promise<void> => { await first.onModuleDestroy(); await second.onModuleDestroy(); } };
}

async function assertExactlyOneDecisionEffects(client: PrismaClient, booking: BookingView, decisions: number): Promise<void> {
  assert.equal(await client.appointmentEvent.count({ where: { appointmentId: booking.id } }), decisions);
  assert.equal(await client.leadActivity.count({ where: { leadId: booking.leadId, result: { startsWith: "ADMISSIONS_" } } }), decisions);
  assert.equal(await client.auditEvent.count({ where: { resourceId: booking.id, eventType: { startsWith: "ADMISSIONS_" } } }), decisions);
  assert.equal(await client.internalNotification.count({ where: { resourceId: booking.id } }), decisions * 2);
}

test("CRMY-175 PostgreSQL: two independent API services cannot reserve the same responsible slot", options, async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.allSettled([
      f.service.createBooking(f.lead1.id, f.input("ONE"), f.requester, "two-service-one"),
      f.peer.createBooking(f.lead2.id, f.input("TWO"), f.requester2, "two-service-two"),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected" && conflict(rejected.reason));
    const winner = attempts.find((result) => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    assert.equal(await f.client.admissionsBooking.count({ where: { responsibilityId: f.profile.id } }), 1);
    await assertExactlyOneDecisionEffects(f.client, winner.value, 1);
    assert.equal(await f.client.admissionsMutationReceipt.count({ where: { actorId: { in: [f.requester.userId, f.requester2.userId] }, operation: "BOOKING_CREATE" } }), 1);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: READ COMMITTED participant locks recheck after waiting on another connection", options, async () => {
  const f = await fixture();
  try {
    let participantsAtBarrier = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const backendIds: number[] = [];
    const write = (index: number, prisma: PrismaService): Promise<Appointment> => prisma.client!.$transaction(async (tx) => {
      const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      backendIds.push(pid!.pid);
      participantsAtBarrier += 1;
      if (participantsAtBarrier === 2) releaseBarrier();
      await barrier;
      await lockAppointmentParticipants(tx, [f.participant.userId]);
      await assertAppointmentFree(tx, [f.participant.userId], new Date(future), 30);
      return tx.appointment.create({ data: { leadId: index === 1 ? f.lead1.id : f.lead2.id, type: "VISITE_CAMPUS", mode: "SUR_SITE", state: "PLANIFIE", startsAt: new Date(future), durationMinutes: 30, campus: f.campus.code, adviserId: index === 1 ? f.requester.userId : f.requester2.userId, organizerId: index === 1 ? f.requester.userId : f.requester2.userId, participants: { create: { userId: f.participant.userId, role: "PARTICIPANT" } } } });
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
    const results = await Promise.allSettled([write(1, f.first), write(2, f.second)]);
    assert.equal(new Set(backendIds).size, 2, "The proof must use two real PostgreSQL connections");
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected" && responseCode(rejected.reason) === "admissions_booking_conflict");
    assert.equal(await f.client.appointment.count({ where: { participants: { some: { userId: f.participant.userId } } } }), 1);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: the legacy appointment writer participates in the same reservation fence", options, async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const record: AppointmentRecord = { id, leadId: f.lead2.id, type: "VISITE_CAMPUS", mode: "SUR_SITE", state: "PLANIFIE", startsAt: future, durationMinutes: 30, campus: f.campus.code, adviserId: f.participant.userId, organizerId: f.requester2.userId, participantIds: [f.responsible.userId], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), conflictWarning: false, overloadWarning: false };
    const event: AppointmentEvent = { id: randomUUID(), appointmentId: id, type: "APPOINTMENT_CREATED", toState: "PLANIFIE", actorId: f.requester2.userId, occurredAt: new Date().toISOString(), idempotencyKey: `legacy-${f.marker}` };
    const legacy = new AppointmentPersistenceRepository(f.second);
    const attempts = await Promise.allSettled([
      f.service.createBooking(f.lead1.id, f.input("MODERN"), f.requester, "modern-booking"),
      f.permissions2.transaction(async (tx) => { const actor = await currentPrincipal(tx, f.requester2); await legacy.persistCreate(record, event, actor, "legacy-booking"); return id; }),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected" && conflict(rejected.reason));
    assert.equal(await f.client.appointment.count({ where: { OR: [{ adviserId: f.responsible.userId }, { participants: { some: { userId: f.responsible.userId } } }], state: { notIn: ["ANNULE", "REALISE", "ABSENT", "REFUSE"] } } }), 1);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: a new legacy appointment cannot bypass a designated responsible's controlled request", options, async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const record: AppointmentRecord = { id, leadId: f.lead1.id, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", state: "PLANIFIE", startsAt: future, durationMinutes: 30, campus: f.campus.code, adviserId: f.responsible.userId, organizerId: f.requester.userId, participantIds: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), conflictWarning: false, overloadWarning: false };
    const event: AppointmentEvent = { id: randomUUID(), appointmentId: id, type: "APPOINTMENT_CREATED", toState: "PLANIFIE", actorId: f.requester.userId, occurredAt: new Date().toISOString(), idempotencyKey: `legacy-controlled-bypass-${f.marker}` };
    const legacy = new AppointmentPersistenceRepository(f.second);
    await assert.rejects(() => f.permissions2.transaction(async (tx) => {
      const actor = await currentPrincipal(tx, f.requester);
      await legacy.persistCreate(record, event, actor, "legacy-direct-request-bypass");
    }), (error: unknown) => responseCode(error) === "admissions_controlled_booking_required");
    assert.equal(await f.client.appointment.count({ where: { id } }), 0);
    assert.equal(await f.client.appointmentEvent.count({ where: { appointmentId: id } }), 0);
    assert.equal(await f.client.leadActivity.count({ where: { leadId: f.lead1.id } }), 0);
    assert.equal(await f.client.auditEvent.count({ where: { resourceId: id } }), 0);
    assert.equal(await f.client.internalNotification.count({ where: { resourceId: id } }), 0);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: a new manual block and a booking cannot commit an inconsistent slot", options, async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.allSettled([
      f.service.createBooking(f.lead1.id, f.input("RACE"), f.requester, "block-race-book"),
      f.peer.createWindow({ responsibilityId: f.profile.id, kind: "BLOCKED", startsAt: future, endsAt: at(30), idempotencyKey: `block-${f.marker}` }, f.responsible, "block-race-window"),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = attempts.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected" && conflict(rejected.reason));
    const bookings = await f.client.admissionsBooking.count({ where: { responsibilityId: f.profile.id } });
    const blocks = await f.client.admissionsWindow.count({ where: { responsibilityId: f.profile.id, kind: "BLOCKED", active: true } });
    assert.equal(bookings + blocks, 1);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: request and decision replay retain the immutable result and emit no duplicate effects", options, async () => {
  const f = await fixture();
  try {
    const input = f.input("REPLAY");
    const requested = await f.service.createBooking(f.lead1.id, input, f.requester, "request-original");
    await assert.rejects(() => f.service.decide(requested.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: `self-${f.marker}` }, f.requester, "self-approval"), refused);
    const decision = { action: "ACCEPT" as const, expectedVersion: 1, idempotencyKey: `accept-${f.marker}` };
    const accepted = await f.peer.decide(requested.id, decision, f.responsible, "accept-original");
    assert.equal(accepted.state, "ACCEPTED");
    assert.equal(accepted.appointmentState, "CONFIRME");
    assert.deepEqual(await f.service.createBooking(f.lead1.id, input, f.requester, "request-replay"), requested);
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as unknown as BookingInput;
    assert.deepEqual(await f.peer.createBooking(f.lead1.id, reordered, f.requester, "request-reordered-json"), requested);
    assert.deepEqual(await f.service.decide(requested.id, decision, f.responsible, "accept-replay"), accepted);
    await assert.rejects(() => f.service.createBooking(f.lead1.id, { ...input, durationMinutes: 45 }, f.requester, "changed-replay"), conflict);
    await assertExactlyOneDecisionEffects(f.client, accepted, 2);
    assert.equal(await f.client.admissionsMutationReceipt.count({ where: { actorId: f.requester.userId, operation: "BOOKING_CREATE" } }), 1);
    assert.equal(await f.client.admissionsMutationReceipt.count({ where: { actorId: f.responsible.userId, operation: "BOOKING_ACCEPT" } }), 1);
    assert.equal((await f.client.appointment.findUniqueOrThrow({ where: { id: requested.id } })).state, "CONFIRME");
    const legacy = new AppointmentPersistenceRepository(f.second);
    const record: AppointmentRecord = { id: accepted.id, leadId: accepted.leadId, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", state: "CONFIRME", startsAt: accepted.startsAt, durationMinutes: accepted.durationMinutes, campus: f.campus.code, adviserId: f.responsible.userId, organizerId: f.requester.userId, participantIds: [], version: accepted.version + 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), conflictWarning: false, overloadWarning: false };
    const event: AppointmentEvent = { id: randomUUID(), appointmentId: accepted.id, type: "APPOINTMENT_CONFIRME", toState: "CONFIRME", actorId: f.admin.userId, occurredAt: new Date().toISOString(), idempotencyKey: `legacy-bypass-${f.marker}` };
    await assert.rejects(() => f.permissions2.transaction(() => legacy.persistTransition(record, event, f.admin, "legacy-bypass")), conflict);
    await assertExactlyOneDecisionEffects(f.client, accepted, 2);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: withdrawing availability preserves existing reservations; adjacent half-open slots stay available", options, async () => {
  const f = await fixture();
  try {
    const first = await f.service.createBooking(f.lead1.id, f.input("FIRST"), f.requester, "half-open-one");
    const adjacent = await f.peer.createBooking(f.lead2.id, f.input("ADJACENT", 30), f.requester2, "half-open-two");
    assert.equal(adjacent.startsAt, first.endsAt);
    await assert.rejects(() => f.service.withdrawWindow(f.window.id, { active: false, expectedVersion: 1, idempotencyKey: `withdraw-${f.marker}` }, f.responsible, "withdraw-in-use"), (error: unknown) => responseCode(error) === "admissions_window_in_use");
    assert.equal((await f.client.admissionsWindow.findUniqueOrThrow({ where: { id: f.window.id } })).active, true);
    const slots = await f.service.slots(f.lead1.id, f.profile.id, future, end, 30, f.requester);
    assert.equal(slots.redacted, true);
    assert.equal(slots.timezone, "Africa/Casablanca");
    assert.ok(slots.items.every((slot) => slot.startsAt >= at(60)));
    assert.deepEqual(Object.keys(slots.items[0]!).sort(), ["endsAt", "startsAt"]);
    assert.doesNotMatch(JSON.stringify(slots), /leadLabel|responsibleId|requesterId|reason|busyRanges/u);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: designation, session and campus revocation are checked before an authenticated replay", options, async () => {
  const f = await fixture();
  try {
    const input = f.input("REVOKE");
    const booking = await f.service.createBooking(f.lead1.id, input, f.requester, "revoke-original");
    await f.peer.configureResponsibility({ userId: f.responsible.userId, campus: f.campus.id, active: false, expectedVersion: 1, idempotencyKey: `deactivate-${f.marker}` }, f.admin, "revoke-designation");
    await assert.rejects(() => f.service.createBooking(f.lead1.id, input, f.requester, "replay-after-designation-revoke"), refused);
    await assert.rejects(() => f.service.decide(booking.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: `accept-${f.marker}` }, f.responsible, "accept-after-revoke"), refused);
    await f.service.configureResponsibility({ userId: f.responsible.userId, campus: f.campus.id, active: true, expectedVersion: 2, idempotencyKey: `reactivate-${f.marker}` }, f.admin, "restore-synthetic-designation");
    assert.equal((await f.service.booking(booking.id, f.requester)).canReschedule, true);
    await f.permissions.transaction((tx) => tx.collaborator.update({ where: { id: f.responsible.userId }, data: { campusId: f.otherCampus.id } }));
    const movedCampusView = await f.peer.booking(booking.id, f.requester);
    assert.equal(movedCampusView.canCancel, true, "The requester retains the controlled cancellation path");
    assert.deepEqual({
      canDecide: movedCampusView.canDecide,
      canReschedule: movedCampusView.canReschedule,
      canComplete: movedCampusView.canComplete,
      canNoShow: movedCampusView.canNoShow,
      canWriteReport: movedCampusView.canWriteReport,
    }, { canDecide: false, canReschedule: false, canComplete: false, canNoShow: false, canWriteReport: false });
    await assert.rejects(() => f.peer.decide(booking.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: `moved-campus-${f.marker}` }, f.responsible, "responsible-moved-campus"), refused);
    await assert.rejects(() => f.peer.createBooking(f.lead1.id, input, f.requester, "replay-after-responsible-campus-move"), refused);
    await f.permissions.transaction((tx) => tx.collaborator.update({ where: { id: f.responsible.userId }, data: { campusId: f.campus.id } }));
    await f.permissions.transaction((tx) => tx.localSession.update({ where: { id: f.requester.sessionId }, data: { active: false, revokedAt: new Date() } }));
    await assert.rejects(() => f.peer.createBooking(f.lead1.id, input, f.requester, "replay-after-session-revoke"), refused);
    await assertExactlyOneDecisionEffects(f.client, booking, 1);
    assert.equal((await f.client.appointment.findUniqueOrThrow({ where: { id: booking.id } })).state, "PLANIFIE");
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: revoking effective appointment.manage removes owner reads, edits and decisions without changing role", options, async () => {
  const f = await fixture();
  try {
    const input = f.input("GRANT");
    const requested = await f.service.createBooking(f.lead1.id, input, f.requester, "grant-original");
    const dynamic = new DynamicPermissionService(f.permissions);
    const target = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: f.campus.id };
    const inherited = await dynamic.read(f.admin, target);
    await dynamic.save(f.admin, { ...target, grants: { ...defaultConfiguration(target), "appointment.manage": "NONE" }, expectedVersion: inherited.version, reason: "CAMPUS_RESTRICTION", confirmed: true });
    assert.deepEqual((await f.client.collaborator.findUniqueOrThrow({ where: { id: f.responsible.userId } })).roles, ["ADMISSIONS"]);
    await assert.rejects(() => f.peer.createBooking(f.lead1.id, input, f.requester, "request-replay-revoked-grant"), refused);
    await assert.rejects(() => f.peer.decide(requested.id, { action: "ACCEPT", expectedVersion: 1, idempotencyKey: `no-grant-${f.marker}` }, f.responsible, "decision-revoked-grant"), refused);
    await assert.rejects(() => f.service.createWindow({ responsibilityId: f.profile.id, kind: "BLOCKED", startsAt: at(120), endsAt: at(150), idempotencyKey: `no-grant-window-${f.marker}` }, f.responsible, "window-revoked-grant"), refused);
    assert.equal((await f.service.windows(f.responsible)).items.length, 0);
    assert.equal((await f.peer.windows(f.responsible, f.campus.id)).items.length, 0);
    assert.equal((await f.service.bookings(f.responsible)).items.length, 0);
    assert.equal((await f.peer.bookings(f.responsible, undefined, f.campus.id)).items.length, 0);
    await assertExactlyOneDecisionEffects(f.client, requested, 1);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: campus isolation, Auditor invariants and self-designation prevent IDOR or privilege expansion", options, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.service.responsibles(f.requester, f.otherLead.id), refused);
    await assert.rejects(() => f.service.slots(f.otherLead.id, f.profile.id, future, end, 30, f.outsider), refused);
    await assert.rejects(() => f.service.configureResponsibility({ userId: f.requester.userId, campus: f.campus.id, active: true, expectedVersion: 0, idempotencyKey: `self-profile-${f.marker}` }, f.requester, "self-designation"), refused);
    await assert.rejects(() => f.service.createWindow({ responsibilityId: f.profile.id, kind: "BLOCKED", startsAt: at(120), endsAt: at(150), idempotencyKey: `idor-window-${f.marker}` }, f.requester, "other-owner-window"), refused);
    await assert.rejects(() => f.service.context(f.auditor), refused);
    await assert.rejects(() => f.service.createBooking(f.lead1.id, f.input("AUDITOR"), f.auditor, "auditor-write"), refused);
    assert.equal(await f.client.admissionsBooking.count({ where: { responsibilityId: f.profile.id } }), 0);
    assert.equal((await f.client.collaborator.findUniqueOrThrow({ where: { id: f.requester.userId } })).roles.length, 1);
  } finally { await f.close(); }
});

test("CRMY-175 PostgreSQL: more than 200 foreign-campus or unrelated-actor bookings cannot hide an authorized request", options, async () => {
  const f = await fixture();
  try {
    const campusPeer = await f.service.configureResponsibility({ userId: f.requester2.userId, campus: f.campus.id, active: true, expectedVersion: 0, idempotencyKey: `page-peer-${f.marker}` }, f.admin, "synthetic-pagination-peer");
    const foreignPeer = await f.service.configureResponsibility({ userId: f.outsider.userId, campus: f.otherCampus.id, active: true, expectedVersion: 0, idempotencyKey: `page-foreign-${f.marker}` }, f.admin, "synthetic-pagination-foreign");
    const noise = [
      { profile: foreignPeer, lead: f.otherLead, campus: f.otherCampus, adviser: f.outsider, organizer: f.outsider },
      { profile: campusPeer, lead: f.lead2, campus: f.campus, adviser: f.requester2, organizer: f.participant },
    ];
    // Preserved load fixtures, not simulated business writes: the target below is
    // created through the real service. These historical cancelled rows intentionally
    // precede it and exercise SQL audience filtering before the bounded collection.
    for (const group of noise) {
      const appointmentIds = Array.from({ length: 201 }, () => randomUUID());
      await f.client.appointment.createMany({ data: appointmentIds.map((id, index) => ({ id, leadId: group.lead.id, type: "VISITE_CAMPUS", mode: "SUR_SITE", state: "ANNULE", startsAt: new Date(Date.UTC(2098, 9, 3, 9, index * 30)), durationMinutes: 30, campus: group.campus.code, adviserId: group.adviser.userId, organizerId: group.organizer.userId })) });
      await f.client.admissionsBooking.createMany({ data: appointmentIds.map((appointmentId) => ({ appointmentId, responsibilityId: group.profile.id, state: "CANCELLED" })) });
      assert.equal(await f.client.admissionsBooking.count({ where: { responsibilityId: group.profile.id } }), 201);
    }
    const target = await f.service.createBooking(f.lead1.id, f.input("PAGINATION"), f.requester, "synthetic-pagination-real-request");
    const collections = [
      await f.service.bookings(f.requester),
      await f.peer.bookings(f.requester, undefined, f.campus.id),
      await f.service.bookings(f.requester, f.lead1.id),
      await f.peer.bookings(f.responsible),
    ];
    for (const result of collections) {
      assert.deepEqual(result.items.map((item) => item.id), [target.id], "SQL campus and actor predicates must precede any collection limit");
      assert.ok(result.items.every((item) => item.leadId === f.lead1.id && item.leadIdentifier === f.lead1.leadCode && item.campus === f.campus.code));
      const serialized = JSON.stringify(result);
      for (const privateValue of [f.otherLead.id, f.otherLead.leadCode, f.lead2.id, f.lead2.leadCode, f.requester2.userId, f.outsider.userId, campusPeer.id, foreignPeer.id]) {
        assert.equal(serialized.includes(privateValue), false, "No foreign lead, actor or responsibility may be disclosed");
      }
    }
    await assertExactlyOneDecisionEffects(f.client, target, 1);
  } finally { await f.close(); }
});
