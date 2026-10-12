import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { createApplication } from "../../src/application.js";
import { deriveSecret, digestRecoveryValue } from "../../src/access-recovery/access-recovery.store.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";

test("CRMY-28 first login: durable atomic audit, fresh instance, replay and rollback", { skip: process.env.CRMY28_FIRST_LOGIN_EPHEMERAL_TEST !== "true", timeout: 180000 }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy28_first_login_synthetic");
  assert.equal(url.username, "postgres"); assert.equal(url.password, "");
  assert.equal(process.env.SHEETS_ENABLED, "false"); assert.equal(process.env.CRM_BACKGROUND_WORKERS, "external");
  const nonce = process.env.CRMY28_FIRST_LOGIN_DATABASE_NONCE;
  assert.match(nonce ?? "", /^[a-f0-9-]{36}$/u);
  const prisma = new PrismaService(), db = prisma.client!;
  const apps: INestApplication[] = [];
  try {
    assert.deepEqual(await db.$queryRaw`SELECT nonce FROM crmy28_first_login_test_identity.marker`, [{ nonce }]);
    const fixture = async (name: string): Promise<{ id: string; email: string; temporary: string }> => {
      const email = `${name}-${randomUUID()}@example.invalid`, temporary = `Synthetic!9${randomBytes(20).toString("hex")}`, salt = randomBytes(16).toString("hex");
      const user = await db.collaborator.create({ data: { professionalEmail: email, roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: true } });
      await db.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(temporary, salt), mustChange: true } });
      return { id: user.id, email, temporary };
    };
    const positive = await fixture("first-positive"), rollback = await fixture("first-rollback"), loginRollback = await fixture("login-rollback"), expired = await fixture("first-expired");
    const open = async (): Promise<string> => { const app = await createApplication(); apps.push(app); await app.listen(0, "127.0.0.1"); return app.getUrl(); };
    const origin = await open();
    const request = (base: string, route: string, body: object, token?: string): Promise<Response> => fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const login = async (subject: typeof positive, base = origin): Promise<{ token: string; sessionId: string }> => {
      const response = await request(base, "/sessions", { email: subject.email, password: subject.temporary }); assert.equal(response.status, 201);
      return response.json() as Promise<{ token: string; sessionId: string }>;
    };
    const oldSession = await login(positive);
    assert.equal(await db.auditEvent.count({ where: { eventType: "SESSION_CREATED", sessionId: oldSession.sessionId } }), 1);
    const nextSecret = `Synthetic-New!9${randomBytes(20).toString("hex")}`;
    const changed = await request(origin, "/first-login/change-secret", { currentSecret: positive.temporary, nextSecret }, oldSession.token);
    assert.equal(changed.status, 201); assert.deepEqual(await changed.json(), { revokedSessions: 1 });
    const user = await db.collaborator.findUniqueOrThrow({ where: { id: positive.id } });
    assert.equal(user.firstLoginRequired, false); assert.equal(user.authenticationVersion, 2);
    assert.equal((await db.localPasswordHash.findUniqueOrThrow({ where: { collaboratorId: user.id } })).mustChange, false);
    assert.equal((await db.localSession.findUniqueOrThrow({ where: { id: oldSession.sessionId } })).active, false);
    const audits = await db.auditEvent.findMany({ where: { actorId: positive.id, eventType: "FIRST_LOGIN_SECRET_CHANGED" } });
    assert.equal(audits.length, 1); assert.equal(audits[0]!.result, "SUCCESS");
    assert.ok(!JSON.stringify(audits).includes(positive.temporary)); assert.ok(!JSON.stringify(audits).includes(nextSecret));
    // Start a distinct application after commit: no in-memory audit/session can supply this proof.
    const freshOrigin = await open();
    assert.equal(await apps[1]!.get(PrismaService).client!.auditEvent.count({ where: { actorId: positive.id, eventType: "FIRST_LOGIN_SECRET_CHANGED" } }), 1);
    assert.equal((await request(freshOrigin, "/sessions", { email: positive.email, password: positive.temporary })).status, 403);
    const current = await request(freshOrigin, "/sessions", { email: positive.email, password: nextSecret }); assert.equal(current.status, 201);
    const currentSession = await current.json() as { token: string; sessionId: string; mustChangeSecret: boolean };
    assert.equal(currentSession.mustChangeSecret, false);
    assert.equal((await fetch(`${freshOrigin}/sessions/current`, { headers: { authorization: `Bearer ${oldSession.token}` } })).status, 401);
    assert.equal((await fetch(`${freshOrigin}/sessions/current`, { headers: { authorization: `Bearer ${currentSession.token}` } })).status, 200);
    assert.equal((await request(freshOrigin, "/first-login/change-secret", { currentSecret: positive.temporary, nextSecret }, oldSession.token)).status, 401);
    assert.equal((await request(freshOrigin, "/first-login/change-secret", { currentSecret: nextSecret, nextSecret: `${nextSecret}More` }, currentSession.token)).status, 403);
    assert.equal(await db.auditEvent.count({ where: { actorId: positive.id, eventType: "FIRST_LOGIN_SECRET_CHANGED" } }), 1);

    const failedSession = await login(rollback);
    const effects = async (): Promise<unknown> => ({ user: await db.collaborator.findUnique({ where: { id: rollback.id } }), credential: await db.localPasswordHash.findUnique({ where: { collaboratorId: rollback.id } }), sessions: await db.localSession.findMany({ where: { collaboratorId: rollback.id } }), audit: await db.auditEvent.count({ where: { actorId: rollback.id, eventType: "FIRST_LOGIN_SECRET_CHANGED" } }) });
    const before = await effects(); assert.match(rollback.id, /^[a-f0-9-]{36}$/u);
    await db.$executeRawUnsafe(`ALTER TABLE audit_events ADD CONSTRAINT crmy28_reject_fixture_success CHECK (NOT (event_type = 'FIRST_LOGIN_SECRET_CHANGED' AND resource_id = '${rollback.id}'))`);
    try {
      assert.equal((await request(origin, "/first-login/change-secret", { currentSecret: rollback.temporary, nextSecret }, failedSession.token)).status, 503);
      assert.deepEqual(await effects(), before, "audit failure rolls back credential, version, activation and revocation");
    } finally { await db.$executeRawUnsafe("ALTER TABLE audit_events DROP CONSTRAINT crmy28_reject_fixture_success"); }
    assert.equal((await request(origin, "/first-login/change-secret", { currentSecret: rollback.temporary, nextSecret }, failedSession.token)).status, 201, "failed transaction must not poison caches or deferred writes");

    assert.match(loginRollback.id, /^[a-f0-9-]{36}$/u);
    await db.$executeRawUnsafe(`ALTER TABLE audit_events ADD CONSTRAINT crmy28_reject_login_success CHECK (NOT (event_type = 'SESSION_CREATED' AND resource_id = '${loginRollback.id}'))`);
    try {
      assert.equal((await request(origin, "/sessions", { email: loginRollback.email, password: loginRollback.temporary })).status, 503);
      assert.equal(await db.localSession.count({ where: { collaboratorId: loginRollback.id } }), 0, "no session survives its failed success audit");
    } finally { await db.$executeRawUnsafe("ALTER TABLE audit_events DROP CONSTRAINT crmy28_reject_login_success"); }
    const expiredSession = await login(expired);
    await db.localSession.update({ where: { id: expiredSession.sessionId }, data: { expiresAt: new Date(0), active: true } });
    assert.equal((await request(origin, "/first-login/change-secret", { currentSecret: expired.temporary, nextSecret }, expiredSession.token)).status, 401);
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: expired.id } })).firstLoginRequired, true);
    console.log("CRMY28_FIRST_LOGIN_ASSERTIONS", JSON.stringify({ durableAuditUnique: true, newInstanceRead: true, oldSessionRevoked: true, oldFixtureSecretRefused: true, replayNoDuplicate: true, firstLoginAuditFailureAtomic: true, loginAuditFailureAtomic: true, retryAfterRollback: true, expiredActiveSessionRefused: true, historicalAccountUntouched: true }));
  } finally { for (const app of apps.reverse()) await app.close(); await prisma.onModuleDestroy(); }
});
