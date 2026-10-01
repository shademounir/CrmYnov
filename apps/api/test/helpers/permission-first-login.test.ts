import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { SharingFixture } from "./view-sharing-cycle.test.js";

interface AuthenticatedSession { token: string; sessionId: string }

/** Real HTTP authentication and first-login; only the synthetic credential is fixture data. */
export async function assertFirstLoginAcrossApis(
  client: PrismaClient, bases: string[], fixture: SharingFixture,
  awaitRateLimit: (response: Response) => Promise<void>, report: (message: string) => void,
): Promise<void> {
  const email = `${randomUUID()}@example.invalid`;
  const temporary = `Synth!9${randomBytes(24).toString("hex")}`;
  const replacement = `Synth!8${randomBytes(24).toString("hex")}`;
  async function request(instance: number, path: string, method: string, body?: object, token?: string): Promise<Response> {
    return fetch(`${bases[instance]}${path}`, {
      method, headers: { "content-type": "application/json", "x-correlation-id": `first-login-synthetic-${randomUUID()}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000),
    });
  }
  const created = await request(0, "/users", "POST", { professionalEmail: email, roles: ["ADMISSIONS"], campusId: fixture.campusA, teamId: "SYNTHETIC-TEAM" }, fixture.superAdmin.token);
  assert.equal(created.status, 201, "Super Admin creates the dedicated first-login collaborator through HTTP");
  const identity: unknown = await created.json();
  assert.ok(identity && typeof identity === "object" && "id" in identity && typeof identity.id === "string");
  const userId = identity.id;
  const initial = await client.collaborator.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(initial.firstLoginRequired, true); assert.equal(initial.authenticationVersion, 1);
  assert.deepEqual(initial.roles, ["ADMISSIONS"]); assert.equal(initial.campusId, fixture.campusA);
  const passwordSalt = randomBytes(16).toString("hex");
  await client.localPasswordHash.create({ data: { collaboratorId: userId, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt, passwordDigest: scryptSync(temporary, passwordSalt, 32).toString("hex"), mustChange: true } });

  async function loginResponse(instance: number, password: string): Promise<Response> {
    const login = (): Promise<Response> => request(instance, "/sessions", "POST", { email, password });
    const response = await login();
    if (response.status !== 429) return response;
    await awaitRateLimit(response);
    const retried = await login(); // One retry only, after the existing real-time server window.
    assert.notEqual(retried.status, 429, "login still rate-limited after the bounded real-time wait");
    return retried;
  }
  async function login(instance: number, password: string, expectedVersion: number): Promise<AuthenticatedSession> {
    const response = await loginResponse(instance, password);
    assert.equal(response.status, 201, "dedicated synthetic first-login authentication");
    const session: unknown = await response.json();
    assert.ok(session && typeof session === "object" && "token" in session && "sessionId" in session);
    assert.equal(typeof session.token, "string"); assert.equal(typeof session.sessionId, "string");
    assert.ok(typeof session.token === "string" && typeof session.sessionId === "string");
    const persisted = await client.localSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    assert.equal(persisted.collaboratorId, userId); assert.equal(persisted.active, true);
    assert.equal(persisted.authenticationVersion, expectedVersion);
    assert.deepEqual(persisted.roles, ["ADMISSIONS"]);
    assert.ok(persisted.tokenDigest === createHash("sha256").update(session.token).digest("hex"), "response token belongs to its persisted synthetic session");
    return { token: session.token, sessionId: session.sessionId };
  }
  async function refusesSession(instance: number, session: AuthenticatedSession): Promise<void> {
    const response = await request(instance, "/lead-views", "GET", undefined, session.token);
    assert.equal(response.status, 401, "old first-login session must not become usable on either API");
    assert.deepEqual(await response.json(), { code: "session_invalid" });
  }

  const first = await login(0, temporary, 1);
  const other = await login(1, temporary, 1); // Both APIs have observed the old temporary identity.
  const changed = await request(1, `/users/${userId}/authorization`, "PATCH", {
    roles: ["ADMISSIONS"], campusId: fixture.campusA, teamId: "SYNTHETIC-FIRST-LOGIN", reason: "TEAM_CHANGE", confirmed: true,
  }, fixture.superAdmin.token);
  assert.equal(changed.status, 200); await changed.arrayBuffer();
  const beforeFirstLogin = await client.collaborator.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(beforeFirstLogin.authenticationVersion, 2); assert.equal(beforeFirstLogin.firstLoginRequired, true);
  for (const instance of [0, 1]) { await refusesSession(instance, first); await refusesSession(instance, other); }

  const current = await login(1, temporary, 2);
  const pending = await request(0, "/lead-views", "GET", undefined, current.token);
  assert.equal(pending.status, 403); assert.deepEqual(await pending.json(), { code: "secret_change_required" });
  const completion = await request(0, "/first-login/change-secret", "POST", { currentSecret: temporary, nextSecret: replacement }, current.token);
  assert.equal(completion.status, 201, "first-login on API1 must refresh the identity changed on API2");
  assert.deepEqual(await completion.json(), { revokedSessions: 1 });
  const afterFirstLogin = await client.collaborator.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(afterFirstLogin.authenticationVersion, beforeFirstLogin.authenticationVersion + 1, "first-login must not reuse the older cached authentication version");
  assert.equal(afterFirstLogin.firstLoginRequired, false);
  assert.deepEqual(afterFirstLogin.roles, ["ADMISSIONS"]); assert.equal(afterFirstLogin.campusId, fixture.campusA);
  assert.equal(afterFirstLogin.teamId, "SYNTHETIC-FIRST-LOGIN");
  assert.equal((await client.localPasswordHash.findUniqueOrThrow({ where: { collaboratorId: userId } })).mustChange, false);
  assert.equal(await client.localSession.count({ where: { collaboratorId: userId, active: true } }), 0);

  for (const instance of [0, 1]) {
    for (const session of [first, other, current]) await refusesSession(instance, session);
    const before = await client.localSession.count({ where: { collaboratorId: userId } });
    const refused = await loginResponse(instance, temporary);
    assert.equal(refused.status, 403, "old temporary credential must be rejected even on the other API");
    assert.deepEqual(await refused.json(), { code: "identity_invalid" });
    assert.equal(await client.localSession.count({ where: { collaboratorId: userId } }), before, "rejected temporary credential creates no session");
    const accepted = await login(instance, replacement, 3);
    const readable = await request(instance, "/lead-views", "GET", undefined, accepted.token);
    assert.equal(readable.status, 200); assert.ok(Array.isArray(await readable.json()));
  }
  report("Cross-API first-login: authenticated version 1 -> administrative version 2 -> first-login version 3; all old sessions and temporary credentials refused on both APIs; replacement credential and scoped reads succeed.");
}
