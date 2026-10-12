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

test("CRMY-28 governed identities: durable create/role audit, replay and failure atomicity", { skip: process.env.CRMY28_FIRST_LOGIN_EPHEMERAL_TEST !== "true", timeout: 180000 }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy28_first_login_synthetic");
  assert.equal(url.username, "postgres"); assert.equal(url.password, ""); assert.equal(process.env.SHEETS_ENABLED, "false");
  const prisma = new PrismaService(), db = prisma.client!;
  let app: INestApplication | undefined;
  try {
    assert.deepEqual(await db.$queryRaw`SELECT nonce FROM crmy28_first_login_test_identity.marker`, [{ nonce: process.env.CRMY28_FIRST_LOGIN_DATABASE_NONCE }]);
    const email = `governed-admin-${randomUUID()}@example.invalid`, secret = `Synthetic-Admin!9${randomBytes(20).toString("hex")}`, salt = randomBytes(16).toString("hex");
    const admin = await db.collaborator.create({ data: { professionalEmail: email, roles: ["SUPER_ADMIN"], active: true, firstLoginRequired: false } });
    await db.localPasswordHash.create({ data: { collaboratorId: admin.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(secret, salt), mustChange: false } });
    const campus = await db.crmReference.create({ data: { kind: "CAMPUS", code: `SYNTHETIC-${randomUUID()}`, label: "Synthetic governed campus", scope: "GLOBAL", scopeKey: "GLOBAL" } });
    app = await createApplication(); await app.listen(0, "127.0.0.1"); const origin = await app.getUrl();
    const login = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: secret }) }); assert.equal(login.status, 201);
    const session = await login.json() as { token: string; sessionId: string };
    const request = (method: string, path: string, body: object, token = session.token): Promise<Response> => fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const create = { professionalEmail: `governed-commercial-${randomUUID()}@example.invalid`, roles: ["ADMISSIONS"], campusId: campus.id };
    assert.equal((await request("POST", "/users", { ...create, campusId: randomUUID() })).status, 403);
    const created = await request("POST", "/users", create); assert.equal(created.status, 201);
    const target = await created.json() as { id: string };
    assert.equal(await db.auditEvent.count({ where: { eventType: "COLLABORATOR_CREATED", resourceId: target.id } }), 1);
    assert.equal((await request("POST", "/users", create)).status, 409);
    assert.equal(await db.collaborator.count({ where: { professionalEmail: create.professionalEmail } }), 1);
    const targetSession = await db.localSession.create({ data: { id: randomUUID(), collaboratorId: target.id, tokenDigest: randomBytes(32).toString("hex"), roles: ["ADMISSIONS"], scopes: [{ kind: "CAMPUS", id: campus.id }], expiresAt: new Date(Date.now() + 60000), authenticationVersion: 1 } });
    const change = { roles: ["SUPER_ADMIN", "ADMISSIONS"], campusId: campus.id, reason: "RESPONSIBILITY_CHANGE", confirmed: true };
    assert.equal((await request("PATCH", `/users/${target.id}/authorization`, { ...change, campusId: randomUUID() })).status, 403);
    assert.equal((await request("PATCH", `/users/${target.id}/authorization`, change)).status, 200);
    const persisted = await db.collaborator.findUniqueOrThrow({ where: { id: target.id } });
    assert.deepEqual(persisted.roles, change.roles); assert.equal(persisted.campusId, campus.id); assert.equal(persisted.authenticationVersion, 2);
    assert.equal((await db.localSession.findUniqueOrThrow({ where: { id: targetSession.id } })).active, false);
    assert.equal(await db.auditEvent.count({ where: { eventType: "COLLABORATOR_AUTHORIZATION_CHANGED", resourceId: target.id } }), 1);
    assert.equal((await request("PATCH", `/users/${target.id}/authorization`, { ...change, roles: [...change.roles].reverse() })).status, 200);
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: target.id } })).authenticationVersion, 2);
    assert.equal(await db.auditEvent.count({ where: { eventType: "COLLABORATOR_AUTHORIZATION_CHANGED", resourceId: target.id } }), 1);
    const state = async (): Promise<unknown> => ({ user: await db.collaborator.findUnique({ where: { id: target.id } }), sessions: await db.localSession.findMany({ where: { collaboratorId: target.id } }), audits: await db.auditEvent.count({ where: { eventType: "COLLABORATOR_AUTHORIZATION_CHANGED", resourceId: target.id } }) });
    const before = await state(); assert.match(target.id, /^[a-f0-9-]{36}$/u);
    await db.$executeRawUnsafe(`ALTER TABLE audit_events ADD CONSTRAINT crmy28_reject_role_success CHECK (NOT (event_type = 'COLLABORATOR_AUTHORIZATION_CHANGED' AND resource_id = '${target.id}')) NOT VALID`);
    const correction = { ...change, roles: ["ADMISSIONS"] };
    try { assert.equal((await request("PATCH", `/users/${target.id}/authorization`, correction)).status, 503); assert.deepEqual(await state(), before); }
    finally { await db.$executeRawUnsafe("ALTER TABLE audit_events DROP CONSTRAINT crmy28_reject_role_success"); }
    assert.equal((await request("PATCH", `/users/${target.id}/authorization`, correction)).status, 200);
    await db.$executeRawUnsafe("ALTER TABLE audit_events ADD CONSTRAINT crmy28_reject_creation_success CHECK (event_type <> 'COLLABORATOR_CREATED') NOT VALID");
    const failedEmail = `governed-create-rollback-${randomUUID()}@example.invalid`;
    try { assert.equal((await request("POST", "/users", { ...create, professionalEmail: failedEmail })).status, 503); assert.equal(await db.collaborator.count({ where: { professionalEmail: failedEmail } }), 0); }
    finally { await db.$executeRawUnsafe("ALTER TABLE audit_events DROP CONSTRAINT crmy28_reject_creation_success"); }
    assert.equal((await request("POST", "/users", { ...create, professionalEmail: failedEmail })).status, 201);
    // A real active Commercial session cannot use the governed Super Admin routes.
    const commercialSecret = `Synthetic-Commercial!9${randomBytes(20).toString("hex")}`, commercialSalt = randomBytes(16).toString("hex");
    await db.collaborator.update({ where: { id: target.id }, data: { firstLoginRequired: false } });
    await db.localPasswordHash.create({ data: { collaboratorId: target.id, identityDigest: digestRecoveryValue(create.professionalEmail), passwordSalt: commercialSalt, passwordDigest: deriveSecret(commercialSecret, commercialSalt), mustChange: false } });
    const commercialLogin = await request("POST", "/sessions", { email: create.professionalEmail, password: commercialSecret }); assert.equal(commercialLogin.status, 201);
    const commercial = await commercialLogin.json() as { token: string };
    assert.equal((await request("PATCH", `/users/${target.id}/authorization`, change, commercial.token)).status, 403);
    assert.equal((await request("POST", "/users", { ...create, professionalEmail: `refused-${randomUUID()}@example.invalid` }, commercial.token)).status, 403);
    console.log("CRMY28_GOVERNED_IDENTITY_ASSERTIONS", JSON.stringify({ creationAuditUnique: true, creationReplayNoDuplicate: true, twoRolesPersisted: true, sessionsRevoked: true, authorizationAuditUnique: true, semanticReplayNoAdditionalEffect: true, authorizationFailureAtomic: true, creationFailureAtomic: true, retryAfterRollback: true, commercialDenied: true, realIdentitiesUntouched: true }));
  } finally { await app?.close(); await prisma.onModuleDestroy(); }
});
