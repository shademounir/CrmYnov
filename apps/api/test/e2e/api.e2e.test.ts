import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApplication } from "./synthetic-application.js";
import { digestRecoveryValue, LocalCredentialAdapter, LocalIdentityDirectory, LocalRecoveryChallengeStore } from "../../src/access-recovery/access-recovery.store.js";
import { UserService } from "../../src/users/user.service.js";

test("serves health, correlation and OpenAPI endpoints", async (context) => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);

  const health = await fetch(`http://127.0.0.1:${address.port}/health`, {
    headers: { "x-correlation-id": "e2e-123" },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-correlation-id"), "e2e-123");
  assert.equal((await health.json() as { status: string }).status, "ok");

  const specification = await fetch(`http://127.0.0.1:${address.port}/docs-json`);
  assert.equal(specification.status, 200);
  assert.equal((await specification.json() as { info: { title: string } }).info.title, "CRM Admissions API");
});

test("enforces roles, ownership, scopes and immediate session revocation", async (context) => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);
  const base = `http://127.0.0.1:${address.port}`;
  const users = app.get(UserService);
  const credentials = app.get(LocalCredentialAdapter);

  const create = async (name: string, roles: ("AUDITOR" | "SUPER_ADMIN")[]): Promise<{ token: string; sessionId: string; userId: string }> => {
    const email = `${name}@example.invalid`;
    const user = users.create({ professionalEmail: email, roles }, "bootstrap", `create-${name}`);
    credentials.provisionTemporary(user.id, "Temporary1!E2eValue", digestRecoveryValue(email));
    credentials.replace(user.id, "Temporary1!E2eValue");
    users.completeFirstLogin(user.id);
    const response = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": `create-${name}` },
      body: JSON.stringify({ email, password: "Temporary1!E2eValue" }),
    });
    assert.equal(response.status, 201);
    return { ...await response.json() as { token: string; sessionId: string }, userId: user.id };
  };

  const auditor = await create("synthetic-auditor", ["AUDITOR"]);
  const auditorMutation = await fetch(`${base}/resources/resource-a`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${auditor.token}`, "content-type": "application/json" },
    body: JSON.stringify({ ownerId: auditor.userId, scope: { kind: "GLOBAL" } }),
  });
  assert.equal(auditorMutation.status, 403);

  const admin = await create("synthetic-admin", ["SUPER_ADMIN"]);
  const allowedMutation = await fetch(`${base}/resources/resource-a`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${admin.token}`, "content-type": "application/json" },
    body: JSON.stringify({ ownerId: "another-synthetic-user", scope: { kind: "GLOBAL" } }),
  });
  assert.equal(allowedMutation.status, 200);

  const revoke = await fetch(`${base}/sessions/users/${auditor.userId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(revoke.status, 201);
  assert.equal((await revoke.json() as { revokedSessions: number }).revokedSessions, 1);

  const afterRevocation = await fetch(`${base}/sessions/${auditor.sessionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${auditor.token}` },
  });
  assert.equal(afterRevocation.status, 401);
  const body = JSON.stringify(await afterRevocation.json());
  assert.equal(body.includes(auditor.token), false);
  assert.equal(body.includes(auditor.userId), false);
});

test("keeps HTTP recovery fail-closed and correlation-safe without persistent authority", async (context) => {
  const originalRecoveryEnabled = process.env.CRM_ACCESS_RECOVERY_ENABLED;
  context.after(() => {
    if (originalRecoveryEnabled === undefined) delete process.env.CRM_ACCESS_RECOVERY_ENABLED;
    else process.env.CRM_ACCESS_RECOVERY_ENABLED = originalRecoveryEnabled;
  });
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);
  const endpoint = `http://127.0.0.1:${address.port}/access-recovery/requests`;
  const subject = digestRecoveryValue("known-user@example.invalid");
  assert.equal(app.get(LocalIdentityDirectory).has(subject), true);
  const challenges = app.get(LocalRecoveryChallengeStore);
  const localToken = challenges.issue(subject, "/access-recovery/complete");
  const credentials = app.get(LocalCredentialAdapter);
  const originalSecret = "Existing1!SyntheticE2e", nextSecret = "Changed1!SyntheticE2e";
  credentials.replace(subject, originalSecret);

  const requestRecovery = async (email: string, correlationId: string): Promise<{ response: Response; body: unknown }> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": correlationId },
      body: JSON.stringify({ email, returnPath: "/access-recovery/complete" }),
    });
    return { response, body: await response.json() };
  };

  // This explicit memory harness is not recovery authority. The 202 eligible /
  // ineligible contract is covered by the separate two-instance PostgreSQL tests.
  for (const mode of [
    { enabled: undefined, code: "recovery_disabled", label: "default" },
    { enabled: "false", code: "recovery_disabled", label: "disabled" },
    { enabled: "true", code: "recovery_store_unavailable", label: "store-missing" },
  ]) {
    if (mode.enabled === undefined) delete process.env.CRM_ACCESS_RECOVERY_ENABLED;
    else process.env.CRM_ACCESS_RECOVERY_ENABLED = mode.enabled;
    const correlationId = `recovery-${mode.label}`;
    const known = await requestRecovery("known-user@example.invalid", correlationId);
    const unknown = await requestRecovery("unknown-user@example.invalid", `${correlationId}-unknown`);
    assert.equal(known.response.status, 503);
    assert.equal(unknown.response.status, 503);
    assert.deepEqual(known.body, { code: mode.code });
    assert.deepEqual(known.body, unknown.body);
    assert.equal(known.response.headers.get("x-correlation-id"), correlationId);
    assert.equal(JSON.stringify(known.body).includes("known-user"), false);

    const completion: Response = await fetch(`http://127.0.0.1:${address.port}/access-recovery/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": `${correlationId}-completion` },
      body: JSON.stringify({ token: localToken, returnPath: "/access-recovery/complete", nextSecret }),
    });
    assert.equal(completion.status, 503);
    assert.deepEqual(await completion.json(), { code: mode.code });
    assert.equal(completion.headers.get("x-correlation-id"), `${correlationId}-completion`);
  }
  assert.ok(credentials.verifyIdentity(subject, originalSecret));
  assert.equal(credentials.verifyIdentity(subject, nextSecret), undefined);
  assert.equal(challenges.consume(localToken, "/access-recovery/complete"), subject);

  const specification = await fetch(`http://127.0.0.1:${address.port}/docs-json`).then((response) => response.json()) as { paths: Record<string, unknown> };
  assert.ok(specification.paths["/access-recovery/requests"]);
  assert.ok(specification.paths["/access-recovery/completions"]);
});
