import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApplication } from "./synthetic-application.js";
import { digestRecoveryValue, LocalCredentialAdapter } from "../../src/access-recovery/access-recovery.store.js";
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

test("keeps access recovery non-enumerating and correlation-safe", async (context) => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address);
  const endpoint = `http://127.0.0.1:${address.port}/access-recovery/requests`;

  const requestRecovery = async (email: string, correlationId: string): Promise<{ response: Response; body: unknown }> => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": correlationId },
      body: JSON.stringify({ email, returnPath: "/access-recovery/complete" }),
    });
    return { response, body: await response.json() };
  };

  const known = await requestRecovery("known-user@example.invalid", "recovery-known");
  const unknown = await requestRecovery("unknown-user@example.invalid", "recovery-unknown");
  assert.equal(known.response.status, 202);
  assert.equal(unknown.response.status, 202);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(known.response.headers.get("x-correlation-id"), "recovery-known");
  assert.equal(JSON.stringify(known.body).includes("known-user"), false);

  const specification = await fetch(`http://127.0.0.1:${address.port}/docs-json`).then((response) => response.json()) as { paths: Record<string, unknown> };
  assert.ok(specification.paths["/access-recovery/requests"]);
  assert.ok(specification.paths["/access-recovery/completions"]);
});
