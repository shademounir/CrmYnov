import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Role } from "../src/auth/auth.types.js";
import type { BookingView, ResponsibilityView, WindowView } from "../src/admissions/admissions.contract.js";
import { createApplication } from "../src/application.js";
import { deriveSecret } from "../src/access-recovery/access-recovery.store.js";
import { PrismaService } from "../src/persistence/prisma.service.js";

const options = { skip: process.env.CRMY175_EPHEMERAL_TEST !== "true", timeout: 60_000 };
interface HttpResult<T> { status: number; body: T }
interface TestIdentity { id: string; email: string; password: string }
interface ErrorResult { code?: string }

test("CRMY-175 real Nest HTTP → API → PostgreSQL: request, distinct decision, reload, replay and access refusal", options, async (context) => {
  const prisma = new PrismaService(); const db = prisma.client!; assert.ok(db);
  const url = new URL(process.env.DATABASE_URL ?? ""); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const recipe = url.pathname === "/crmy175_recipe_synthetic";
  assert.ok(recipe || url.pathname === "/crmy171_synthetic", "No shared DEV, source recipe or production database is permitted");
  const nonce = process.env[recipe ? "CRMY175_DATABASE_NONCE" : "CRMY171_DATABASE_NONCE"];
  assert.match(nonce ?? "", /^[0-9a-f-]{36}$/u);
  const marker = recipe ? await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy175_test_identity.marker` : await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy171_test_identity.marker`;
  assert.deepEqual(marker, [{ nonce }]);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const campus = await db.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: `HTP-${suffix}`, label: `Synthetic HTTP ${suffix}`, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: `HTP-${suffix}` } } } });
  const otherCampus = await db.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code: `HPO-${suffix}`, label: `Synthetic other HTTP ${suffix}`, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: `HPO-${suffix}` } } } });

  // Only nonce-guarded synthetic identity/Lead setup is direct fixture data.
  // Every designation, agenda write, reservation and decision below uses real HTTP.
  const identity = async (role: Role, name: string, campusId = campus.id): Promise<TestIdentity> => {
    const email = `${name.toLowerCase()}-${suffix.toLowerCase()}@example.invalid`;
    const row = await db.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Synthetic HTTP ${name}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    const password = randomBytes(24).toString("base64url"); const salt = randomBytes(16).toString("hex");
    await db.localPasswordHash.create({ data: { collaboratorId: row.id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    return { id: row.id, email, password };
  };
  const admin = await identity("SUPER_ADMIN", "Admin"); const responsible = await identity("ADMISSIONS", "Responsible"); const commercial = await identity("ADMISSIONS", "Commercial");
  const outsider = await identity("ADMISSIONS", "Other", otherCampus.id); const reader = await identity("AUDITOR", "Reader");
  const lead = await db.lead.create({ data: { leadCode: `HTP-${suffix}`, firstName: "Synthetic", lastName: "HTTP Journey", campus: campus.code, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: commercial.id } });
  let application: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    context.diagnostic("Synthetic fixtures ready; starting the actual Nest application");
    application = await createApplication(); await application.listen(0, "127.0.0.1");
    context.diagnostic("Nest application listening on an ephemeral loopback port");
    const address = application.getHttpServer().address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}`;
    let requestCount = 0;
    const http = async <T>(method: string, path: string, token?: string, body?: unknown): Promise<HttpResult<T>> => {
      const number = ++requestCount;
      const started = performance.now();
      if (process.env.CRMY175_HTTP_TRACE === "true") process.stderr.write(`Synthetic HTTP request ${number} ${method} started\n`);
      const response = await fetch(`${endpoint}${path}`, { method, signal: AbortSignal.timeout(10_000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "x-correlation-id": `synthetic-http-${randomUUID()}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (process.env.CRMY175_HTTP_TRACE === "true") process.stderr.write(`Synthetic HTTP request ${number} completed ${response.status} in ${Math.round(performance.now() - started)} ms\n`);
      return { status: response.status, body: await response.json() as T };
    };
    const login = async (account: TestIdentity): Promise<string> => {
      const response = await http<{ token: string; mustChangeSecret: boolean }>("POST", "/sessions", undefined, { email: account.email, password: account.password });
      assert.equal(response.status, 201, "A real activated synthetic account must authenticate through the session endpoint"); assert.equal(response.body.mustChangeSecret, false); assert.equal(typeof response.body.token, "string"); return response.body.token;
    };
    const adminToken = await login(admin); const responsibleToken = await login(responsible); const commercialToken = await login(commercial); const outsiderToken = await login(outsider); const readerToken = await login(reader);
    context.diagnostic("Real session authentication complete for all synthetic roles");
    assert.equal((await http("GET", "/admissions/context")).status, 401);
    assert.equal((await http("GET", "/admissions/context", readerToken)).status, 403);
    const configured = await http<ResponsibilityView>("POST", "/admissions/responsibles", adminToken, { userId: responsible.id, campus: campus.id, active: true, expectedVersion: 0, idempotencyKey: `http-profile-${suffix}` });
    assert.equal(configured.status, 201); assert.equal(configured.body.userId, responsible.id); assert.equal(configured.body.campus, campus.code);
    const startsAt = "2099-10-03T09:00:00.000Z"; const endsAt = "2099-10-03T17:00:00.000Z";
    const available = await http<WindowView>("POST", "/admissions/windows", responsibleToken, { responsibilityId: configured.body.id, kind: "AVAILABLE", startsAt, endsAt, idempotencyKey: `http-window-${suffix}` });
    assert.equal(available.status, 201); assert.equal(available.body.active, true);
    assert.deepEqual((await http<{ items: WindowView[] }>("GET", "/admissions/windows", commercialToken)).body.items, []);
    const slotsPath = `/admissions/slots?leadId=${lead.id}&responsibilityId=${configured.body.id}&from=${encodeURIComponent(startsAt)}&to=${encodeURIComponent(endsAt)}&durationMinutes=30`;
    const slots = await http<{ items: Array<{ startsAt: string; endsAt: string }>; redacted: boolean }>("GET", slotsPath, commercialToken);
    assert.equal(slots.status, 200); assert.equal(slots.body.redacted, true); assert.ok(slots.body.items.some((slot) => slot.startsAt === startsAt));
    assert.equal((await http("GET", slotsPath, outsiderToken)).status, 403);
    const request = { responsibilityId: configured.body.id, startsAt, durationMinutes: 30, type: "ENTRETIEN_ADMISSION", mode: "TELEPHONE", idempotencyKey: `http-request-${suffix}` };
    const requested = await http<BookingView>("POST", `/leads/${lead.id}/admissions-bookings`, commercialToken, request);
    assert.equal(requested.status, 201); assert.equal(requested.body.state, "PENDING"); assert.equal(requested.body.canDecide, false);
    const path = `/admissions/bookings/${requested.body.id}`;
    const immediate = await http<BookingView>("GET", path, commercialToken); assert.equal(immediate.status, 200); assert.equal(immediate.body.state, "PENDING");
    const decision = { action: "ACCEPT", expectedVersion: 1, idempotencyKey: `http-accept-${suffix}` };
    const self = await http<ErrorResult>("PATCH", path, commercialToken, decision); assert.equal(self.status, 403); assert.equal(self.body.code, "admissions_self_approval_forbidden");
    assert.equal((await http("PATCH", path, outsiderToken, decision)).status, 403);
    const legacy = await http<ErrorResult>("PATCH", `/appointments/${requested.body.id}/state`, adminToken, { state: "CONFIRME", expectedVersion: 1, idempotencyKey: `http-legacy-${suffix}` });
    assert.equal(legacy.status, 409); assert.equal(legacy.body.code, "admissions_controlled_transition_required");
    const accepted = await http<BookingView>("PATCH", path, responsibleToken, decision); assert.equal(accepted.status, 200); assert.equal(accepted.body.state, "ACCEPTED"); assert.equal(accepted.body.appointmentState, "CONFIRME");
    const reload = await http<BookingView>("GET", path, commercialToken); assert.equal(reload.status, 200); assert.equal(reload.body.state, "ACCEPTED"); assert.equal(reload.body.version, 2);
    const received = await http<{ items: BookingView[] }>("GET", "/admissions/bookings", responsibleToken); assert.ok(received.body.items.some((item) => item.id === requested.body.id && item.state === "ACCEPTED"));
    const readPg = await db.appointment.findUniqueOrThrow({ where: { id: requested.body.id }, include: { admissionsBooking: true } }); assert.equal(readPg.state, "CONFIRME"); assert.equal(readPg.admissionsBooking?.state, "ACCEPTED");
    const snapshot = async (): Promise<{ activities: number; events: number; audits: number; notifications: number; receipts: number }> => ({ activities: await db.leadActivity.count({ where: { leadId: lead.id } }), events: await db.appointmentEvent.count({ where: { appointmentId: requested.body.id } }), audits: await db.auditEvent.count({ where: { resourceId: requested.body.id } }), notifications: await db.internalNotification.count({ where: { resourceId: requested.body.id } }), receipts: await db.admissionsMutationReceipt.count({ where: { actorId: { in: [commercial.id, responsible.id] }, operation: { startsWith: "BOOKING_" } } }) });
    const beforeReplay = await snapshot(); assert.deepEqual(beforeReplay, { activities: 2, events: 2, audits: 2, notifications: 4, receipts: 2 });
    const replayRequest = await http<BookingView>("POST", `/leads/${lead.id}/admissions-bookings`, commercialToken, request); assert.equal(replayRequest.status, 201); assert.equal(replayRequest.body.state, "PENDING"); assert.equal(replayRequest.body.id, requested.body.id);
    const replayDecision = await http<BookingView>("PATCH", path, responsibleToken, decision); assert.equal(replayDecision.status, 200); assert.equal(replayDecision.body.version, accepted.body.version);
    const changedPayload = await http<ErrorResult>("POST", `/leads/${lead.id}/admissions-bookings`, commercialToken, { ...request, durationMinutes: 45 }); assert.equal(changedPayload.status, 409); assert.equal(changedPayload.body.code, "admissions_idempotency_conflict");
    assert.deepEqual(await snapshot(), beforeReplay, "Authenticated replay and refusal must not add PostgreSQL effects");
    const revoke = await http("POST", "/admissions/responsibles", adminToken, { userId: responsible.id, campus: campus.id, active: false, expectedVersion: 1, idempotencyKey: `http-revoke-${suffix}` }); assert.equal(revoke.status, 201);
    assert.equal((await http("PATCH", path, responsibleToken, decision)).status, 403, "The same previously valid decision is refused after current designation revocation");
    const cancelled = await http<BookingView>("PATCH", path, commercialToken, { action: "CANCEL", expectedVersion: 2, reason: "SYNTHETIC_REVOKED", idempotencyKey: `http-cancel-${suffix}` }); assert.equal(cancelled.status, 200); assert.equal(cancelled.body.state, "CANCELLED");
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: requested.body.id } })).state, "ANNULE");
  } finally {
    try {
      if (application) {
        const server = application.getHttpServer() as Server;
        server.closeAllConnections();
        try { await application.close(); }
        finally { if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
      }
    } finally { await prisma.onModuleDestroy(); }
  }
});
