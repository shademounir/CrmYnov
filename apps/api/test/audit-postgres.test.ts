import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { SessionService } from "../src/auth/session.service.js";
import { createApplication } from "../src/application.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { DynamicPermissionService } from "../src/permissions/dynamic-service.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import type { ConfigurationTarget, PermissionScope } from "../src/permissions/dynamic-contract.js";
import type { AuditPage } from "../src/audit/audit-reader.js";
import type { AuditView } from "../src/audit/audit-view.js";

// No external URL is accepted: every enabled execution owns a new tmpfs PostgreSQL.
const enabled = process.env.CRMY54_EPHEMERAL_TEST === "true" || process.env.CI === "true";
test("CRMY-54 HTTP/PostgreSQL: scoped immutable audit, live ceilings and redaction", { skip: !enabled, timeout: 240_000 }, async (t) => {
  const container = `crmy54-audit-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", container, "--label", "crmy.ticket=CRMY-54", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_DB=crm_crmy54", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 120_000 });
  const previousUrl = process.env.DATABASE_URL;
  t.after(() => {
    execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 });
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  });
  const port = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" }).trim().split(":").at(-1)!;
  assert.match(port, /^\d+$/);
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/crm_crmy54`;
  const prisma = new PrismaService(), client = prisma.client!;
  t.after(() => prisma.onModuleDestroy());
  for (let attempt = 0; ; attempt++) {
    try { await client.$queryRaw`SELECT 1`; break; } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { env: process.env, stdio: "pipe", timeout: 60_000 });
  async function campus(code: string): Promise<string> {
    return (await client.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code, label: code, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: code, version: 1 } } } })).id;
  }
  const campusA = await campus("SYNTHETIC-A"), campusB = await campus("SYNTHETIC-B");
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const sessions = app.get(SessionService);
  async function actor(roles: Role[]): Promise<{ principal: Principal; token: string }> {
    const id = randomUUID();
    await client.collaborator.create({ data: { id, professionalEmail: `${id}@example.invalid`, roles, campusId: campusA, firstLoginRequired: false } });
    const session = sessions.create(id, roles, [{ kind: "CAMPUS", id: campusA }]); await sessions.flush();
    return { token: session.token, principal: { userId: id, sessionId: session.sessionId, roles, scopes: [{ kind: "CAMPUS", id: campusA }] } };
  }
  const superAdmin = await actor(["SUPER_ADMIN"]), admin = await actor(["ADMIN"]), auditor = await actor(["AUDITOR"]);
  const manager = await actor(["MANAGER"]), adviser = await actor(["ADMISSIONS"]), mixed = await actor(["ADMIN", "AUDITOR", "MANAGER"]);
  const repository = new DynamicPermissionRepository(prisma), permissions = new DynamicPermissionService(repository);
  async function grant(target: ConfigurationTarget, scope: PermissionScope, expectedVersion = 0): Promise<void> {
    await permissions.save(superAdmin.principal, { ...target, grants: { ...defaultConfiguration(target), "audit.view": scope }, expectedVersion, confirmed: true, reason: "ACCESS_REVIEW" });
  }
  const roleTarget = (role: Role): ConfigurationTarget => ({ kind: "ROLE", role, campus: "GLOBAL" });
  await grant(roleTarget("MANAGER"), "GLOBAL"); await grant(roleTarget("ADMISSIONS"), "GLOBAL");
  const resourceId = randomUUID(), occurredAt = new Date("2026-09-01T12:00:00Z");
  async function evidence(campusId: string | null): Promise<string> {
    return (await client.auditEvent.create({ data: { campusId, eventType: "LEAD_UPDATED", actorId: admin.principal.userId, actorRoles: ["ADMIN"], resourceId, resourceType: "LEAD", correlationId: randomUUID(), sessionId: randomUUID(), idempotencyKey: randomUUID(), result: "SUCCESS", occurredAt, before: { version: 1, passwordHash: "synthetic-hidden" }, after: { version: 2, token: "synthetic-hidden", nested: { email: "synthetic@example.invalid" } } } })).id;
  }
  const a = await evidence(campusA), b = await evidence(campusB), global = await evidence(null);
  const baseline = await client.auditEvent.findMany({ where: { id: { in: [a, b, global] } }, orderBy: { id: "asc" } });
  function request(path: string, token?: string, method = "GET"): Promise<Response> {
    return fetch(`${base}/audit-events${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  }
  async function denied(path: string, token: string | undefined, status: number, code: string): Promise<void> {
    const count = await client.auditEvent.count(); const response = await request(path, token);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { code });
    assert.equal(await client.auditEvent.count(), count, "denied reads never append successful business audit");
  }
  async function page(token: string, suffix = ""): Promise<AuditPage> {
    const response = await request(`?eventType=LEAD_UPDATED${suffix}`, token); assert.equal(response.status, 200);
    return response.json() as Promise<AuditPage>;
  }
  await denied("", undefined, 401, "session_invalid");
  for (const user of [manager, adviser]) await denied("", user.token, 403, "role_forbidden");
  const local = await page(admin.token);
  assert.deepEqual(local.items.map((item) => item.id), [a]); assert.equal(local.total, 1); assert.equal(local.global, false);
  assert.deepEqual(local.campuses, [{ id: campusA }]);
  assert.deepEqual(local.items[0]?.before, { version: 1 }); assert.deepEqual(local.items[0]?.after, { version: 2 });
  for (const forbidden of ["synthetic-hidden", "synthetic@example.invalid", "sessionId", "passwordHash", "correlationId", campusB]) assert.equal(JSON.stringify(local).includes(forbidden), false);
  await denied(`?campus=${campusB}`, admin.token, 403, "permission_denied");
  await denied(`/${b}`, admin.token, 404, "audit_event_not_found");
  await denied(`/${randomUUID()}`, admin.token, 404, "audit_event_not_found");
  await denied(`/${global}`, admin.token, 404, "audit_event_not_found");
  assert.equal((await page(superAdmin.token)).total, 3, "Super Admin GLOBAL reads all synthetic evidence");
  assert.deepEqual((await page(auditor.token)).items.map((item) => item.id), [a]);
  for (const method of ["PATCH", "DELETE", "POST"]) {
    assert.equal((await request(`/${a}`, auditor.token, method)).status, 404, "no mutation route exists");
  }
  assert.deepEqual(await client.auditEvent.findMany({ where: { id: { in: [a, b, global] } }, orderBy: { id: "asc" } }), baseline);
  await grant(roleTarget("ADMIN"), "GLOBAL");
  const globallyAllowed = await request(`/${global}`, admin.token); assert.equal(globallyAllowed.status, 200);
  assert.equal((await globallyAllowed.json() as AuditView).id, global);
  await denied(`/${b}`, admin.token, 404, "audit_event_not_found",);
  await denied(`/${global}`, mixed.token, 404, "audit_event_not_found");
  assert.deepEqual((await page(mixed.token)).items.map((item) => item.id), [a], "AUDITOR CAMPUS restricts cumulative ADMIN GLOBAL");
  const ceiling: ConfigurationTarget = { kind: "CEILING", role: "*", campus: "GLOBAL" };
  await grant(ceiling, "CAMPUS");
  await denied(`/${global}`, admin.token, 404, "audit_event_not_found");
  assert.equal((await page(admin.token)).global, false, "live CAMPUS ceiling cannot be broadened by a GLOBAL grant");
  await grant(ceiling, "GLOBAL", 1);
  const first = await page(superAdmin.token, "&pageSize=1");
  const second = await page(superAdmin.token, `&pageSize=1&page=2&snapshot=${encodeURIComponent(first.snapshot)}`);
  assert.equal(first.total, 3); assert.equal(second.total, 3); assert.notEqual(first.items[0]?.id, second.items[0]?.id);
  const filters = new URLSearchParams({ campus: campusA, actorId: admin.principal.userId, resourceId, resourceType: "LEAD", result: "SUCCESS", from: "2026-09-01T00:00:00Z", to: "2026-09-01T23:59:59Z" });
  assert.deepEqual((await page(superAdmin.token, `&${filters}`)).items.map((item) => item.id), [a]);
  assert.ok(await client.auditEvent.count({ where: { eventType: "AUDIT_SEARCHED" } }) > 0);
  assert.ok(await client.auditEvent.count({ where: { eventType: "AUDIT_VIEWED" } }) > 0);
  await grant(roleTarget("AUDITOR"), "NONE");
  await denied("", auditor.token, 403, "permission_denied");
  assert.equal(await client.rolePermissionVersion.count({ where: { configurationId: "ROLE:MANAGER:GLOBAL" } }), 1, "historical erroneous grant is retained");
});
