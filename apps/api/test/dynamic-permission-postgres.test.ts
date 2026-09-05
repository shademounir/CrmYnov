import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { DynamicPermissionService } from "../src/permissions/dynamic-service.js";
import { DynamicGrantProvider } from "../src/permissions/dynamic-provider.js";
import { PermissionService } from "../src/permissions/permission.service.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey, type ConfigurationInput, type ConfigurationTarget, type Grants } from "../src/permissions/dynamic-contract.js";
import { currentPrincipal, resourceEvaluationContext } from "../src/permissions/dynamic-context.js";
import { canonicalCampus, leadResource } from "../src/permissions/dynamic-resources.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { createApplication } from "../src/application.js";
import { SessionService } from "../src/auth/session.service.js";
import { HttpException } from "@nestjs/common";
import type { AddressInfo } from "node:net";

const enabled = process.env.CRMY169_EPHEMERAL_TEST === "true" || process.env.CI === "true";
function prepareDatabase(): string | undefined {
  if (process.env.CRMY169_EPHEMERAL_TEST === "true") return undefined;
  const name = `crmy169-test-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", name, "--label", "crmy.ticket=CRMY-169", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_DB=crm_crmy169", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 120_000 });
  const port = execFileSync("docker", ["port", name, "5432"], { encoding: "utf8" }).trim().split(":").at(-1)!;
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/crm_crmy169`;
  return name;
}
test("CRMY-169 ephemeral PostgreSQL: authorization, versions, restore, rollback and two-instance revocation", { skip: !enabled, timeout: 240_000 }, async (t) => {
  const container = prepareDatabase();
  if (container) t.after(() => { execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }); });
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname)); assert.equal(url.pathname, "/crm_crmy169");
  const prisma = new PrismaService(); const client = prisma.client!;
  t.after(() => prisma.onModuleDestroy());
  if (container) {
    for (let attempts = 0; ; attempts++) {
      try { await client.$queryRaw`SELECT 1`; break; } catch (error) { if (attempts >= 20) throw error; await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { cwd: process.cwd(), env: process.env, stdio: "pipe", timeout: 60_000 });
  }
  const repository = new DynamicPermissionRepository(prisma), service = new DynamicPermissionService(repository);
  const secondPrisma = new PrismaService(), second = new DynamicPermissionService(new DynamicPermissionRepository(secondPrisma));
  t.after(() => secondPrisma.onModuleDestroy());
  const marker = randomUUID().slice(0, 8).toUpperCase();
  async function campus(code: string): Promise<string> {
    const row = await client.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code, label: code, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: code.toUpperCase(), version: 1 } } } }); return row.id;
  }
  const campusId = await campus(`SYN-${marker}`), otherCampus = await campus(`OTHER-${marker}`);
  async function actor(roles: Role[], assignedCampus = campusId, teamId = "synthetic-team"): Promise<Principal> {
    const userId = randomUUID(), sessionId = randomUUID();
    await client.collaborator.create({ data: { id: userId, professionalEmail: `${userId}@example.invalid`, roles, campusId: assignedCampus, teamId, firstLoginRequired: false } });
    await client.localSession.create({ data: { id: sessionId, collaboratorId: userId, roles, scopes: [{ kind: "CAMPUS", id: assignedCampus }], tokenDigest: createHash("sha256").update(sessionId).digest("hex"), authenticationVersion: 1, expiresAt: new Date(Date.now() + 3_600_000) } });
    return { userId, sessionId, roles, scopes: [{ kind: "CAMPUS", id: assignedCampus }] };
  }
  const superAdmin = await actor(["SUPER_ADMIN"]), admin = await actor(["ADMIN"]), manager = await actor(["MANAGER"]), adviser = await actor(["ADMISSIONS"]), reader = await actor(["AUDITOR"]);
  const globalTarget: ConfigurationTarget = { kind: "ROLE", role: "MANAGER", campus: "GLOBAL" };
  // Unique campus isolates repeated local runs; global snapshots are restored at the end.
  const target: ConfigurationTarget = { ...globalTarget, campus: campusId };
  function change(target: ConfigurationTarget, grants: Grants, expectedVersion = 0): ConfigurationInput { return { ...target, grants, expectedVersion, confirmed: true, reason: "ACCESS_REVIEW" }; }
  const lead = await client.lead.create({ data: { leadCode: `SYN-${marker}`, firstName: "Lead", lastName: "Synthétique", campus: `SYN-${marker}`, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: adviser.userId } });
  await t.test("fresh identity, current TEAM/OWN and withdrawn collaboration", async () => {
    const evaluate = async (who: Principal): Promise<Awaited<ReturnType<typeof resourceEvaluationContext>>> => repository.transaction(async (tx) => resourceEvaluationContext(tx, await currentPrincipal(tx, who), await leadResource(tx, lead.id)));
    assert.equal((await evaluate(manager)).team, true); assert.equal((await evaluate(adviser)).own, true);
    assert.equal((await evaluate(manager)).managedTeam, false, "membership alone never grants management responsibility");
    const responsibility = { teamId: "synthetic-team", campusId, managerId: manager.userId, active: true, expectedVersion: 0, confirmed: true };
    await assert.rejects(() => service.teamResponsibilities(admin, responsibility));
    await service.teamResponsibilities(superAdmin, responsibility);
    assert.equal((await evaluate(manager)).managedTeam, true);
    await service.teamResponsibilities(superAdmin, { ...responsibility, active: false, expectedVersion: 1 });
    assert.equal((await evaluate(manager)).managedTeam, false, "revoked responsibility stops immediately");
    await service.teamResponsibilities(superAdmin, { ...responsibility, expectedVersion: 2 });
    await assert.rejects(() => service.teamResponsibilities(superAdmin, responsibility));
    await client.collaborator.update({ where: { id: adviser.userId }, data: { teamId: "old-team" } });
    assert.equal((await evaluate(manager)).team, false);
    assert.equal((await evaluate(manager)).managedTeam, false);
    await client.leadCollaborator.create({ data: { leadId: lead.id, userId: manager.userId, active: true } });
    assert.equal((await evaluate(manager)).own, true); assert.equal((await evaluate(manager)).team, false, "secondary collaborator cannot change primary team");
    await client.leadCollaborator.update({ where: { leadId_userId: { leadId: lead.id, userId: manager.userId } }, data: { active: false } });
    assert.equal((await evaluate(manager)).own, false);
    await client.lead.update({ where: { id: lead.id }, data: { assignedToId: null } }); assert.equal((await evaluate(manager)).team, false);
    await client.lead.update({ where: { id: lead.id }, data: { assignedToId: adviser.userId } });
    await client.collaborator.update({ where: { id: adviser.userId }, data: { teamId: "synthetic-team" } });
  });
  await t.test("catalogue, defaults, admin boundaries and inaccessible identifiers", async () => {
    assert.equal((await service.list(superAdmin)).roles.length, 5);
    assert.equal((await service.list(admin)).campus, campusId);
    for (const who of [manager, adviser, reader]) await assert.rejects(() => service.list(who));
    assert.equal((await service.read(admin, target)).inherited, true);
    await assert.rejects(() => service.read(admin, { ...target, campus: otherCampus }));
    await assert.rejects(() => service.read(superAdmin, { ...target, campus: randomUUID() }));
    for (const role of ["ADMIN", "SUPER_ADMIN"] as const) await assert.rejects(() => service.save(admin, change({ ...target, role }, defaultConfiguration({ ...target, role }))));
    const exceeds = { ...defaultConfiguration(target), "users.create": "CAMPUS" as const };
    await assert.rejects(() => service.preview(admin, change(target, exceeds)));
    await assert.rejects(() => service.save(superAdmin, change({ ...target, role: "AUDITOR" }, { ...defaultConfiguration({ ...target, role: "AUDITOR" }), "lead.edit": "CAMPUS" })));
  });
  await t.test("preview never changes grants; concurrent version has exactly one winner", async () => {
    const grants = { ...defaultConfiguration(target), "lead.edit": "NONE" as const };
    const before = await client.rolePermissionAuditEvent.count();
    assert.equal((await service.preview(admin, change(target, grants))).mutated, false);
    assert.equal(await client.rolePermissionAuditEvent.count(), before);
    const results = await Promise.allSettled([service.save(admin, change(target, grants)), second.save(admin, change(target, grants))]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await service.read(superAdmin, target)).version, 1);
    assert.equal(await client.rolePermissionAuditEvent.count(), before + 1);
    const resource = await leadResource(client, lead.id);
    assert.equal((await second.decision(manager, "lead.edit", resource)).allowed, false);
    assert.equal((await client.localSession.findUniqueOrThrow({ where: { id: manager.sessionId } })).active, true);
  });
  await t.test("restore creates a new version, retains immutable audit and revalidates old version", async () => {
    const enabled = defaultConfiguration(target);
    assert.equal((await service.save(superAdmin, change(target, enabled, 1))).version, 2);
    assert.equal((await second.decision(manager, "lead.edit", await leadResource(client, lead.id))).allowed, true);
    const restored = await service.restore(superAdmin, { ...target, restoreVersion: 1, expectedVersion: 2, reason: "RESTORE_VERSION", confirmed: true });
    assert.equal(restored.version, 3);
    const history = await service.history(superAdmin, target); assert.deepEqual(history.map((item) => item.number), [3, 2, 1]);
    assert.equal(history[0]?.audits[0]?.reason, "RESTORE_VERSION"); assert.equal(history[0]?.audits[0]?.actorId, superAdmin.userId);
    await assert.rejects(() => service.restore(superAdmin, { ...target, restoreVersion: 99, expectedVersion: 3, reason: "RESTORE_VERSION", confirmed: true }));
    await assert.rejects(() => service.save(superAdmin, change(target, enabled, 2)));
  });
  await t.test("last Super Admin management and unknown grants are protected atomically", async () => {
    const ceiling: ConfigurationTarget = { kind: "CEILING", role: "*", campus: "GLOBAL" };
    const grants = { ...defaultConfiguration(ceiling), "roles.permissions.manage": "NONE" as const };
    const before = await client.rolePermissionAuditEvent.count();
    await assert.rejects(() => service.save(superAdmin, change(ceiling, grants)), (error: unknown) => error instanceof Error && error.message.includes("Conflict"));
    assert.equal(await client.rolePermissionAuditEvent.count(), before);
    assert.equal(await client.rolePermissionConfiguration.findUnique({ where: { id: configurationKey(ceiling) } }), null);
  });
  await t.test("business writes and permission writes share a rollback transaction", async () => {
    const before = await client.rolePermissionAuditEvent.count();
    await assert.rejects(() => repository.transaction(async () => {
      await prisma.client!.$transaction(async (tx) => { await tx.lead.update({ where: { id: lead.id }, data: { campaign: "ROLLBACK-SYNTHETIC" } }); });
      await service.save(superAdmin, change(target, defaultConfiguration(target), 3));
      throw new Error("synthetic-rollback");
    }));
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).campaign, "SYNTHETIC");
    assert.equal((await service.read(superAdmin, target)).version, 3); assert.equal(await client.rolePermissionAuditEvent.count(), before);
  });
  await t.test("provider, resource checks and effective explanation retain source and ceiling", async () => {
    const provider = new PermissionService(new DynamicGrantProvider(service));
    const resource = await leadResource(client, lead.id);
    assert.equal(await provider.can(manager, "lead.tags.assign", resource), true);
    assert.equal(await provider.can(manager, "lead.view", resource), true, "PermissionService exposes the entire dynamic registry");
    assert.equal(await provider.can(manager, "lead.delete", resource), false);
    assert.equal(await provider.can(manager, "lead.tags.assign", { ...resource, campusKeys: [otherCampus] }), false);
    const explained = await service.explain(manager, campusId, lead.id);
    assert.equal(explained.permissions.find((item) => item.permission === "lead.edit")?.allowed, false);
    assert.equal(explained.permissions.find((item) => item.permission === "lead.tags.assign")?.sources[0]?.role, "MANAGER");
    assert.equal((await canonicalCampus(client, campusId)).id, campusId);
    await assert.rejects(() => service.explain(manager, otherCampus, undefined));
    await assert.rejects(() => service.explain(manager, campusId, randomUUID()));
    await client.localSession.update({ where: { id: manager.sessionId }, data: { active: false } });
    assert.equal(await provider.can(manager, "lead.tags.assign", resource), false);
  });
  await t.test("production HTTP stack enforces live grants without invalidating the session", async (httpTest) => {
    const app = await createApplication(); await app.listen(0, "127.0.0.1"); httpTest.after(() => app.close());
    const other = await createApplication(); await other.listen(0, "127.0.0.1"); httpTest.after(() => other.close());
    const secondBase = `http://127.0.0.1:${(other.getHttpServer().address() as AddressInfo).port}`;
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const sessions = app.get(SessionService);
    const adminSession = sessions.create(superAdmin.userId, superAdmin.roles, [{ kind: "GLOBAL" }]);
    const adviserSession = sessions.create(adviser.userId, adviser.roles, [{ kind: "CAMPUS", id: campusId }]);
    await sessions.flush();
    const headers = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
    const read = (path: string, token = adminSession.token): Promise<Response> => fetch(`${base}/${path}`, { headers: headers(token) });
    const post = (path: string, body: unknown, token = adminSession.token): Promise<Response> => fetch(`${base}/${path}`, { method: "POST", headers: headers(token), body: JSON.stringify(body) });
    assert.equal((await fetch(`${base}/admin/role-permissions/catalogue`)).status, 401);
    const catalogue = await read("admin/role-permissions/catalogue"); assert.equal(catalogue.status, 200);
    assert.equal((await catalogue.json() as { roles: unknown[] }).roles.length, 5);
    assert.equal((await read("admin/role-permissions/catalogue", adviserSession.token)).status, 403);
    assert.equal((await read(`leads/${lead.id}`, adviserSession.token)).status, 200);
    const adviserTarget: ConfigurationTarget = { ...target, role: "ADMISSIONS" };
    const denied = change(adviserTarget, { ...defaultConfiguration(adviserTarget), "lead.view": "NONE" });
    assert.equal((await post("admin/role-permissions/preview", denied)).status, 201);
    assert.equal((await post("admin/role-permissions/configuration", denied)).status, 201);
    assert.equal((await read(`leads/${lead.id}`, adviserSession.token)).status, 403);
    const query = new URLSearchParams({ ...adviserTarget });
    const concurrentReads = await Promise.all([read(`admin/role-permissions/configuration?${query}`), read(`admin/role-permissions/history?${query}`), read("admin/role-permissions/catalogue")]);
    assert.deepEqual(concurrentReads.map((response) => response.status), [200, 200, 200], "parallel editor reads must not conflict");
    assert.equal((await fetch(`${secondBase}/leads/${lead.id}`, { headers: headers(adviserSession.token) })).status, 403, "second API sees revocation with the same still-valid session");
    assert.equal((await read(`admin/role-permissions/configuration?${query}`)).status, 200);
    const history = await read(`admin/role-permissions/history?${query}`);
    assert.equal(history.status, 200); assert.equal((await history.json() as { versions: unknown[] }).versions.length, 1);
    assert.equal((await read(`admin/role-permissions/effective?campus=${campusId}&leadId=${lead.id}`)).status, 200);
    assert.equal((await post("admin/role-permissions/configuration", denied)).status, 409);
    assert.equal((await post("admin/role-permissions/configuration", change(adviserTarget, defaultConfiguration(adviserTarget), 1))).status, 201);
    assert.equal((await read(`leads/${lead.id}`, adviserSession.token)).status, 200, "same session sees restored grants");
    assert.equal((await post("admin/role-permissions/restore", { ...adviserTarget, expectedVersion: 2, restoreVersion: 1, confirmed: true, reason: "RESTORE_VERSION" })).status, 201);
    assert.equal((await read(`leads/${lead.id}`, adviserSession.token)).status, 403);
    assert.equal((await client.localSession.findUniqueOrThrow({ where: { id: adviserSession.sessionId } })).active, true);
    const restricted = { ...defaultConfiguration(adviserTarget), "lead.view": "OWN" as const };
    assert.equal((await post("admin/role-permissions/configuration", change(adviserTarget, restricted, 3))).status, 201);
    const otherLead = await client.lead.create({ data: { leadCode: `SYN-OTHER-${marker}`, firstName: "Autre", lastName: "Synthétique", campus: `SYN-${marker}`, campaign: "SYNTHETIC", program: "SYNTHETIC", educationLevel: "BAC", source: "TEST", assignedToId: admin.userId } });
    const list = async (suffix = ""): Promise<{ total: number; items: { id: string }[] }> => {
      const response = await read(`leads?pageSize=1${suffix}`, adviserSession.token); assert.equal(response.status, 200);
      return response.json() as Promise<{ total: number; items: { id: string }[] }>;
    };
    assert.deepEqual((await list()).items.map((item) => item.id), [lead.id]);
    assert.equal((await list()).total, 1, "OWN is applied before totals and pagination");
    assert.equal((await list(`&search=${otherLead.leadCode}`)).total, 0);
    assert.equal((await read(`leads/${otherLead.id}`, adviserSession.token)).status, 403);
    await client.leadCollaborator.create({ data: { leadId: otherLead.id, userId: adviser.userId, active: true } });
    assert.equal((await list()).total, 2);
    await client.leadCollaborator.update({ where: { leadId_userId: { leadId: otherLead.id, userId: adviser.userId } }, data: { active: false } });
    assert.equal((await list()).total, 1, "withdrawn collaboration is effective immediately");
    const managerSession = sessions.create(manager.userId, manager.roles, [{ kind: "CAMPUS", id: campusId }]); await sessions.flush();
    assert.equal((await post("admin/role-permissions/configuration", change(target, { ...defaultConfiguration(target), "lead.view": "TEAM" }, 3))).status, 201);
    assert.equal((await read(`leads/${lead.id}`, managerSession.token)).status, 200);
    await service.teamResponsibilities(superAdmin, { teamId: "synthetic-team", campusId, managerId: manager.userId, active: false, expectedVersion: 3, confirmed: true });
    assert.equal((await read(`leads/${lead.id}`, managerSession.token)).status, 403, "same membership without responsibility cannot grant TEAM");
  });
  await t.test("administrative delegation is separate from runtime ownership (CRMY-170 PO arbitration)", async (delegation) => {
    const delegationCampus = await campus(`DELEGATION-${marker}`);
    const campusAdmin = await actor(["ADMIN"], delegationCampus);
    const campusManager = await actor(["MANAGER"], delegationCampus);
    const campusAdviser = await actor(["ADMISSIONS"], delegationCampus);
    const campusReader = await actor(["AUDITOR"], delegationCampus);
    const configured: ConfigurationTarget = { kind: "ROLE", role: "MANAGER", campus: delegationCampus };
    const adminTarget: ConfigurationTarget = { ...configured, role: "ADMIN" };
    const configurationId = configurationKey(configured);
    function forbidden(error: unknown): boolean {
      return error instanceof HttpException && error.getStatus() === 403 && JSON.stringify(error.getResponse()) === JSON.stringify({ code: "permission_denied" });
    }
    let version = 0;
    for (const scope of ["OWN", "TEAM", "CAMPUS"] as const) {
      await delegation.test(`Admin CAMPUS with administrative grant configures ${scope}`, async () => {
        const grants: Grants = { ...defaultConfiguration(configured), "lead.view": scope };
        assert.equal(grants["lead.views.revoke.own"], "OWN", "keep the original grant, do not bypass the regression");
        const before = await client.rolePermissionAuditEvent.count();
        assert.equal((await service.preview(campusAdmin, change(configured, grants, version))).mutated, false);
        assert.equal(await client.rolePermissionAuditEvent.count(), before);
        // The third transition restores CAMPUS; every version is a real changed configuration.
        assert.equal((await service.save(campusAdmin, change(configured, grants, version))).version, ++version);
        assert.equal((await second.read(campusAdmin, configured)).grants["lead.view"], scope);
        assert.equal(await client.rolePermissionAuditEvent.count(), before + 1);
      });
    }
    await delegation.test("Admin cannot configure GLOBAL or another campus and failures append nothing", async () => {
      const before = await service.history(campusAdmin, configured);
      await assert.rejects(() => service.save(campusAdmin, change({ ...configured, campus: "GLOBAL" }, { ...defaultConfiguration({ ...configured, campus: "GLOBAL" }), "lead.view": "GLOBAL" })), forbidden);
      await assert.rejects(() => service.save(campusAdmin, change(configured, { ...defaultConfiguration(configured), "lead.view": "GLOBAL" }, version)), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
      await assert.rejects(() => service.preview(campusAdmin, change({ ...configured, campus: otherCampus }, defaultConfiguration(configured))), forbidden);
      assert.deepEqual(await service.history(campusAdmin, configured), before);
    });
    await delegation.test("Admin without roles.permissions.manage cannot preview or save even OWN", async () => {
      const disabled = { ...defaultConfiguration(adminTarget), "roles.permissions.manage": "NONE" as const };
      await service.save(superAdmin, change(adminTarget, disabled));
      const input = change(configured, { ...defaultConfiguration(configured), "lead.view": "OWN" }, version);
      await assert.rejects(() => service.preview(campusAdmin, input), forbidden);
      await assert.rejects(() => service.save(campusAdmin, input), forbidden);
      assert.equal((await service.read(superAdmin, configured)).version, version);
      await service.save(superAdmin, change(adminTarget, defaultConfiguration(adminTarget), 1));
    });
    await delegation.test("Manager, Conseiller and AUDITOR cannot configure role permissions", async () => {
      for (const who of [campusManager, campusAdviser, campusReader]) {
        await assert.rejects(() => service.save(who, change(configured, { ...defaultConfiguration(configured), "lead.view": "OWN" }, version)), forbidden);
      }
      const readerTarget: ConfigurationTarget = { ...configured, role: "AUDITOR" };
      await assert.rejects(() => service.save(superAdmin, change(readerTarget, { ...defaultConfiguration(readerTarget), "lead.views.revoke.own": "OWN" })), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
    });
    await delegation.test("runtime revoke.own requires the actual owner despite administrative authority", async () => {
      const ownView = await client.savedLeadView.create({ data: { ownerId: campusAdmin.userId, name: "Vue synthétique propriétaire", filters: {} } });
      const otherView = await client.savedLeadView.create({ data: { ownerId: campusManager.userId, name: "Vue synthétique autre propriétaire", filters: {} } });
      const provider = new PermissionService(new DynamicGrantProvider(service));
      const ownResource = { scope: "CAMPUS" as const, campusKeys: [delegationCampus], active: true, ownerId: ownView.ownerId };
      assert.equal(await provider.can(campusAdmin, "lead.views.revoke.own", ownResource), true);
      assert.equal(await provider.can(campusAdmin, "lead.views.revoke.own", { ...ownResource, ownerId: otherView.ownerId }), false);
      await assert.rejects(() => provider.assertCan(campusAdmin, "lead.views.revoke.own", { ...ownResource, ownerId: otherView.ownerId }), forbidden);
      assert.equal(await provider.can(campusAdmin, "lead.views.revoke.own", { ...ownResource, campusKeys: [otherCampus] }), false);
      assert.equal(await provider.can(campusReader, "lead.views.revoke.own", { ...ownResource, ownerId: campusReader.userId }), false);
    });
    await delegation.test("delegation cannot exceed a narrower administrative campus ceiling", async () => {
      const ceilingTarget: ConfigurationTarget = { kind: "CEILING", role: "*", campus: delegationCampus };
      await service.save(superAdmin, change(ceilingTarget, { ...defaultConfiguration(ceilingTarget), "roles.permissions.manage": "NONE" }));
      await assert.rejects(() => service.save(campusAdmin, change(configured, { ...defaultConfiguration(configured), "lead.view": "OWN" }, version)), forbidden);
    });
    await delegation.test("configuration versions and author audits are append-only", async () => {
      const history = await service.history(campusAdmin, configured);
      assert.deepEqual(history.map((entry) => entry.number), [3, 2, 1]);
      for (const entry of history) {
        assert.equal(entry.audits.length, 1); assert.equal(entry.audits[0]?.actorId, campusAdmin.userId);
        assert.equal(entry.grants.find((grant) => grant.permission === "lead.views.revoke.own")?.scope, "OWN");
      }
      assert.equal(await client.rolePermissionVersion.count({ where: { configurationId } }), 3);
    });
    await delegation.test("Super Admin can configure GLOBAL within the global ceiling", async () => {
      const globalRole: ConfigurationTarget = { kind: "ROLE", role: "ADMISSIONS", campus: "GLOBAL" };
      const saved = await service.save(superAdmin, change(globalRole, { ...defaultConfiguration(globalRole), "lead.view": "GLOBAL" }));
      assert.equal(saved.version, 1);
      assert.equal((await service.read(superAdmin, globalRole)).grants["lead.view"], "GLOBAL");
      await assert.rejects(() => service.read(campusAdmin, globalRole), forbidden);
    });
  });
});
