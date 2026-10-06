import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { INestApplication } from "@nestjs/common";
import type { Collaborator, CrmReference, Lead, Prisma } from "@prisma/client";
import { createApplication } from "../src/application.js";
import { deriveSecret } from "../src/access-recovery/access-recovery.store.js";
import type { Role } from "../src/auth/auth.types.js";
import { configurationKey, historicalGrants, type ConfigurationTarget, type PermissionScope } from "../src/permissions/dynamic-contract.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import type { ConfigurationResponse, PreviewResponse, SaveResponse } from "../src/permissions/dynamic-responses.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { ManagerDashboardService, type ManagerDashboardReport } from "../src/reporting/manager-dashboard.service.js";
import type { CommercialPerformanceReport } from "../src/reporting/commercial-performance.service.js";
import type { SharedContributionReport } from "../src/reporting/shared-contribution.service.js";
import type { DashboardCapabilities, RecentDashboardLeads } from "../src/reporting/reporting-persistence.service.js";
import { assertEmptyPilotageDatabase, pilotageDatabaseIdentity } from "./fixtures/pilotage-database-guard.js";

type Actor = Collaborator & { email: string; password: string };
type Session = { token: string; sessionId: string };
type HttpResult<T> = { status: number; body: T };
type StoredConfiguration = Prisma.RolePermissionConfigurationGetPayload<{ include: { versions: { include: { grants: true; audits: true } } } }>;
const options = { skip: process.env.CRMY178_EPHEMERAL_TEST !== "true", timeout: 180_000 };
const interval = { period: "custom", from: "2026-10-01T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z", channel: "PHONE" };

test("CRMY-178 real compiled HTTP: v3/v4 compatibility, scoped pilotage and two-instance live revocation", options, async (t) => {
  // TSX/esbuild omits the constructor metadata. This proof must execute the
  // emitted TSC JavaScript used by the real API, not a DI-patched test double.
  const metadata: unknown = Reflect.getMetadata("design:paramtypes", ManagerDashboardService);
  assert.ok(Array.isArray(metadata) && metadata.length === 8, "pilotage_fixture_requires_compiled_tsc_metadata");
  const identity = pilotageDatabaseIdentity(process.env);
  process.env.DATABASE_URL = identity.url;
  const prisma = new PrismaService(), db = prisma.client; assert.ok(db);
  const apps: INestApplication[] = [], origins: string[] = [];
  try {
    await assertEmptyPilotageDatabase(db, identity);
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const reference = async (kind: "CAMPUS" | "PROGRAM" | "CAMPAIGN", name: string): Promise<CrmReference> => {
      const code = `P178-${name}-${suffix}`;
      return db.crmReference.create({ data: { kind, code, label: `Synthetic ${name} ${suffix}`, scope: "GLOBAL", scopeKey: "GLOBAL",
        keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
    };
    const campus = await reference("CAMPUS", "A"), otherCampus = await reference("CAMPUS", "B");
    const program = await reference("PROGRAM", "PROGRAM"), campaign = await reference("CAMPAIGN", "CAMPAIGN");
    const actor = async (role: Role, label: string, campusId = campus.id): Promise<Actor> => {
      const email = `${label}-${suffix.toLowerCase()}@example.invalid`, password = randomBytes(24).toString("base64url"), salt = randomBytes(16).toString("hex");
      const row = await db.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Synthetic ${label}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
      await db.localPasswordHash.create({ data: { collaboratorId: row.id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
      return { ...row, email, password };
    };
    const commercial = await actor("ADMISSIONS", "commercial"), secondCommercial = await actor("ADMISSIONS", "second-commercial");
    const manager = await actor("MANAGER", "manager"), admin = await actor("SUPER_ADMIN", "admin"), reader = await actor("AUDITOR", "reader");
    const foreignOwner = await actor("ADMISSIONS", "foreign-owner", otherCampus.id);
    const rows = [
      { name: "commercial", owner: commercial.id, campus: campus.code }, { name: "second", owner: secondCommercial.id, campus: campus.code },
      { name: "manager", owner: manager.id, campus: campus.code }, { name: "foreign", owner: foreignOwner.id, campus: otherCampus.code },
    ];
    const leads: Lead[] = [];
    for (const row of rows) leads.push(await db.lead.create({ data: { firstName: "Synthetic", lastName: row.name, email: `${row.name}-${suffix.toLowerCase()}@lead.example.invalid`,
      leadCode: `P178-${suffix}-${row.name}`, campus: row.campus, assignedToId: row.owner, campaign: campaign.code, program: program.code,
      educationLevel: "BAC", source: "PHONE_CALL", status: "QUALIFIED", createdAt: new Date("2026-10-04T12:00:00.000Z") } }));
    const owned = leads[0]!, second = leads[1]!, managerLead = leads[2]!, foreign = leads[3]!;
    const legacyTargets: ConfigurationTarget[] = [
      ...(["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] as const).map((role) => ({ kind: "ROLE" as const, role, campus: "GLOBAL" })),
      { kind: "CEILING", role: "*", campus: "GLOBAL" }, { kind: "ROLE", role: "MANAGER", campus: campus.id },
    ];
    const historical = new Map<string, Record<string, string>>();
    for (const target of legacyTargets) {
      const grants: Record<string, string> = { ...defaultConfiguration(target) }; delete grants["reporting.pilotage.view"];
      const id = configurationKey(target); historical.set(id, grants);
      await db.rolePermissionConfiguration.create({ data: { id, ...target, version: 1, versions: { create: { number: 1,
        grants: { create: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })) } } } } });
    }
    const boot = async (instance: number): Promise<void> => {
      const app = await createApplication(); apps[instance] = app; await app.listen(0, "127.0.0.1");
      origins[instance] = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    };
    await Promise.all([boot(0), boot(1)]);
    const http = async <T = { code?: string }>(method: string, path: string, token?: string, body?: unknown, instance = 1): Promise<HttpResult<T>> => {
      const response = await fetch(`${origins[instance]}${path}`, { method, signal: AbortSignal.timeout(20_000), headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), "x-correlation-id": `pilotage-${suffix}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as T };
    };
    const login = async (value: Actor, instance = 0): Promise<Session> => {
      const result = await http<Session>("POST", "/sessions", undefined, { email: value.email, password: value.password }, instance);
      assert.equal(result.status, 201, "Synthetic login must succeed; credentials are never rendered"); return result.body;
    };
    // Below the real five-attempt limit on each instance.
    const adminSession = await login(admin), managerSession = await login(manager), commercialSession = await login(commercial), readerSession = await login(reader, 1);
    const query = (patch: Record<string, string> = {}): string => new URLSearchParams({ ...interval, campus: campus.id, ...patch }).toString();
    const dashboard = (token = managerSession.token, patch: Record<string, string> = {}, instance = 1): Promise<HttpResult<ManagerDashboardReport>> => http("GET", `/reports/manager-dashboard?${query(patch)}`, token, undefined, instance);
    const capabilities = (token: string, instance = 1): Promise<HttpResult<DashboardCapabilities>> => http("GET", "/reports/dashboard/capabilities", token, undefined, instance);
    const config = async (target: ConfigurationTarget): Promise<ConfigurationResponse> => {
      const result = await http<ConfigurationResponse>("GET", `/admin/role-permissions/configuration?${new URLSearchParams({ ...target })}`, adminSession.token, undefined, 0);
      assert.equal(result.status, 200); return result.body;
    };
    const setGrants = async (role: Role, patch: Record<string, PermissionScope>, value = campus.id): Promise<number> => {
      const target = { kind: "ROLE" as const, role, campus: value }, previous = await config(target);
      const result = await http<SaveResponse>("POST", "/admin/role-permissions/configuration", adminSession.token,
        { ...target, expectedVersion: previous.version, grants: { ...previous.grants, ...patch }, confirmed: true, reason: "ACCESS_REVIEW" }, 0);
      assert.equal(result.status, 201); return result.body.version;
    };
    const adaptiveRoutes = ["/reports/commercial-performance", "/reports/shared-contributions", "/reports/dashboard/recent-leads"];

    await t.test("concurrent boot appends one v4 compatibility version without editing v3 history or granting ordinary roles", async () => {
      for (const target of legacyTargets) {
        const id = configurationKey(target);
        const stored: StoredConfiguration = await db.rolePermissionConfiguration.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { number: "asc" }, include: { grants: true, audits: true } } } });
        assert.equal(stored.version, 2); assert.equal(stored.versions.length, 2);
        assert.deepEqual(Object.fromEntries(stored.versions[0]!.grants.map((grant) => [grant.permission, grant.scope])), historical.get(id));
        assert.equal(stored.versions[1]!.grants.find((grant) => grant.permission === "reporting.pilotage.view")?.scope,
          historicalGrants(historical.get(id)!, target)["reporting.pilotage.view"]);
        assert.equal(stored.versions[1]!.audits.length, 1); assert.equal(stored.versions[1]!.audits[0]!.reason, "CATALOGUE_UPGRADE");
        assert.equal(Object.hasOwn(stored.versions[1]!.audits[0]!.previous as object, "reporting.pilotage.view"), false);
      }
      assert.equal((await dashboard()).status, 200); assert.equal((await dashboard()).body.cards.uniqueLeads, 3);
      assert.equal((await dashboard(commercialSession.token)).status, 403); assert.equal((await dashboard(readerSession.token)).status, 403);
      await db.admissionsResponsibility.create({ data: { userId: commercial.id, campus: campus.code, active: true } });
      assert.equal((await dashboard(commercialSession.token)).status, 403, "Agenda eligibility cannot manufacture director authority");
      assert.equal((await capabilities(commercialSession.token)).body.canViewPersonalDashboard, true);
      assert.equal((await capabilities(commercialSession.token)).body.canViewPilotageDashboard, false);
    });

    await t.test("revoked Manager default/global adapters fail closed across two instances; personal always forces the current account", async () => {
      const revokedVersion = await setGrants("MANAGER", { "reporting.pilotage.view": "NONE" });
      for (const instance of [0, 1]) {
        assert.equal((await dashboard(managerSession.token, {}, instance)).status, 403);
        assert.equal((await capabilities(managerSession.token, instance)).body.canViewPilotageDashboard, false);
        for (const route of adaptiveRoutes) for (const mode of ["", "&view=global"]) assert.equal((await http("GET", `${route}?${query()}${mode}`, managerSession.token, undefined, instance)).status, 403, route);
        const personal = await http<CommercialPerformanceReport>("GET", `/reports/commercial-performance?${query({ view: "personal", adviserId: secondCommercial.id })}`, managerSession.token, undefined, instance);
        assert.equal(personal.status, 200); assert.equal(personal.body.cohort.uniqueLeadCount, 1); assert.deepEqual(personal.body.advisers.map((row) => row.adviserId), [manager.id]);
        const contribution = await http<SharedContributionReport>("GET", `/reports/shared-contributions?${query({ view: "personal", adviserId: secondCommercial.id })}`, managerSession.token, undefined, instance);
        assert.equal(contribution.status, 200); assert.equal(contribution.body.uniqueLeadCount, 1); assert.deepEqual(contribution.body.contributors.map((row) => row.contributorId), [manager.id]);
        const recent = await http<RecentDashboardLeads>("GET", `/reports/dashboard/recent-leads?${query({ view: "personal", adviserId: secondCommercial.id })}`, managerSession.token, undefined, instance);
        assert.equal(recent.status, 200); assert.deepEqual(recent.body.leads.map((row) => row.id), [managerLead.id]);
      }
      (apps[1]!.getHttpServer() as Server).closeAllConnections(); await apps[1]!.close(); await boot(1);
      assert.equal((await dashboard()).status, 403);
      const target: ConfigurationTarget = { kind: "ROLE", role: "MANAGER", campus: campus.id };
      assert.equal((await config(target)).version, revokedVersion, "Restart cannot overwrite an explicit v4 NONE");
      const restoration = { ...target, expectedVersion: revokedVersion, restoreVersion: 1, reason: "RESTORE_VERSION", confirmed: false };
      assert.equal((await http("POST", "/admin/role-permissions/restore", adminSession.token, restoration, 0)).status, 403);
      assert.equal((await config(target)).version, revokedVersion);
      const preview = await http<PreviewResponse>("POST", "/admin/role-permissions/preview", adminSession.token,
        { ...target, expectedVersion: revokedVersion, grants: historicalGrants(historical.get(configurationKey(target))!, target), reason: "ACCESS_REVIEW", confirmed: false }, 0);
      assert.equal(preview.status, 201); assert.equal(preview.body.mutated, false);
      assert.ok(preview.body.changes.some((change) => change.permission === "reporting.pilotage.view" && change.widening));
      assert.equal((await http("POST", "/admin/role-permissions/restore", adminSession.token, { ...restoration, confirmed: true }, 0)).status, 201);
      assert.equal((await dashboard()).status, 200, "A deliberate confirmed historical restore can restore formerly authorized access");
    });

    await t.test("explicit Commercial full pilotage has KPI parity, foreign exclusion and no admin/decision/export authority", async () => {
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "CAMPUS" }, "GLOBAL");
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "CAMPUS", "reporting.export": "NONE" });
      const dueAt = new Date(Date.now() - 60_000);
      for (const lead of [owned, second, foreign]) await db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: lead.assignedToId!, dueAt, createdAt: new Date(dueAt.valueOf() - 60_000), state: "DUE", reason: "Synthetic reporting projection", idempotencyKey: `p178-${suffix}-${lead.id}`, fingerprint: createHash("sha256").update(lead.id).digest("hex") } });
      for (const lead of [second, foreign]) await db.leadClosureRequest.create({ data: { leadId: lead.id, target: "ENROLLED", reason: "ADMISSION_CONFIRMED", comment: "Synthetic projection only", evidence: ["SYNTHETIC"], requesterId: lead.assignedToId! } });
      await db.reassignmentRequest.create({ data: { leadId: second.id, currentOwnerId: secondCommercial.id, targetUserId: commercial.id, reason: "Synthetic projection only", moveOpenTasks: false, requestedBy: secondCommercial.id } });
      const expected = await dashboard(), actual = await dashboard(commercialSession.token);
      assert.equal(expected.status, 200); assert.equal(actual.status, 200); assert.deepEqual(actual.body.cards, expected.body.cards);
      assert.deepEqual(actual.body.panels.performance.advisers, expected.body.panels.performance.advisers);
      assert.deepEqual(actual.body.panels.operationalRisks.queues, expected.body.panels.operationalRisks.queues);
      assert.equal(actual.body.cards.uniqueLeads, 3); assert.equal(actual.body.cards.overdueFollowUps, 2);
      assert.equal(actual.body.panels.operationalRisks.queues.pendingClosures, 1); assert.equal(actual.body.panels.operationalRisks.queues.pendingReassignments, 1);
      assert.ok(!JSON.stringify(actual.body.panels).includes(foreign.id));
      const shell = await capabilities(commercialSession.token); assert.equal(shell.status, 200); assert.equal(shell.body.canViewPilotageDashboard, true); assert.equal(shell.body.canExportReporting, false);
      assert.ok(Object.values(shell.body).every((value) => typeof value === "boolean")); assert.equal(JSON.stringify(shell.body).includes(commercial.id), false);
      assert.equal((await capabilities("invalid-synthetic-token")).status, 401); assert.equal((await http("GET", "/reports/dashboard/capabilities")).status, 401);
      assert.equal((await http("GET", "/reports/dashboard/capabilities?view=global", commercialSession.token)).status, 400);
      assert.equal((await dashboard(commercialSession.token, { campus: otherCampus.id })).status, 403);
      assert.equal((await dashboard(commercialSession.token, { role: "SUPER_ADMIN" })).status, 400);
      assert.equal((await http("GET", "/admin/role-permissions/catalogue", commercialSession.token)).status, 403);
      assert.equal((await http("GET", "/users", commercialSession.token)).status, 403);
      const pendingClosure = await db.leadClosureRequest.findFirstOrThrow({ where: { leadId: second.id } });
      const pendingReassignment = await db.reassignmentRequest.findFirstOrThrow({ where: { leadId: second.id } });
      assert.equal((await http("PATCH", `/closure-requests/${pendingClosure.id}/decision`, commercialSession.token, { decision: "APPROVE", expectedVersion: 1, reason: "Synthetic refusal" })).status, 403);
      assert.equal((await http("PATCH", `/reassignment-requests/${pendingReassignment.id}/decision`, commercialSession.token, { decision: "APPROVE", expectedVersion: 1, reason: "Synthetic refusal" })).status, 403);
      assert.equal((await db.leadClosureRequest.findUniqueOrThrow({ where: { id: pendingClosure.id } })).state, "PENDING");
      assert.equal((await db.reassignmentRequest.findUniqueOrThrow({ where: { id: pendingReassignment.id } })).status, "PENDING");
      assert.deepEqual((await db.collaborator.findUniqueOrThrow({ where: { id: commercial.id } })).roles, ["ADMISSIONS"]);
      for (const route of adaptiveRoutes) assert.equal((await http("GET", `${route}?${query({ view: "global" })}`, commercialSession.token)).status, 200, route);
      const deniedExport = await fetch(`${origins[1]}/reports/manager-dashboard/export?${query()}`, { headers: { authorization: `Bearer ${commercialSession.token}` }, signal: AbortSignal.timeout(20_000) });
      assert.equal(deniedExport.status, 403); assert.equal((await dashboard(commercialSession.token)).status, 200);
    });

    await t.test("OWN includes only current ownership or active collaboration; withdrawals and NONE are immediate on existing sessions", async () => {
      await setGrants("ADMISSIONS", { "reporting.view": "OWN", "reporting.pilotage.view": "OWN", "lead.view": "OWN" });
      assert.equal((await dashboard(commercialSession.token)).body.cards.uniqueLeads, 1);
      await db.leadCollaborator.create({ data: { leadId: second.id, userId: commercial.id, active: true } });
      assert.equal((await dashboard(commercialSession.token)).body.cards.uniqueLeads, 2);
      await db.leadCollaborator.update({ where: { leadId_userId: { leadId: second.id, userId: commercial.id } }, data: { active: false } });
      assert.equal((await dashboard(commercialSession.token)).body.cards.uniqueLeads, 1);
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "NONE" });
      for (const instance of [0, 1]) {
        assert.equal((await dashboard(commercialSession.token, {}, instance)).status, 403);
        assert.equal((await capabilities(commercialSession.token, instance)).body.canViewPilotageDashboard, false);
      }
      const personal = await http<CommercialPerformanceReport>("GET", `/reports/commercial-performance?${query()}`, commercialSession.token);
      assert.equal(personal.status, 200); assert.equal(personal.body.cohort.uniqueLeadCount, 1);
      await setGrants("ADMISSIONS", { "reporting.view": "NONE" });
      const creation = await capabilities(commercialSession.token); assert.equal(creation.body.canCreateLead, true); assert.equal(creation.body.canViewPersonalDashboard, false);
      assert.equal((await http("GET", `/reports/personal-dashboard?${query()}`, commercialSession.token)).status, 403);
    });

    await t.test("configured Lecteur reads every linked full adapter without receiving mutations or personal-route fiction", async () => {
      await setGrants("AUDITOR", { "reporting.pilotage.view": "CAMPUS" }, "GLOBAL");
      await setGrants("AUDITOR", { "reporting.pilotage.view": "CAMPUS" });
      const actual = await dashboard(readerSession.token); assert.equal(actual.status, 200); assert.equal(actual.body.cards.uniqueLeads, 3);
      for (const route of [...adaptiveRoutes, "/reports/commercial-funnel", "/reports/source-effectiveness", "/reports/operational-risks"]) assert.equal((await http("GET", `${route}?${query({ view: "global" })}`, readerSession.token)).status, 200, route);
      const shell = await capabilities(readerSession.token); assert.equal(shell.body.canViewPilotageDashboard, true); assert.equal(shell.body.canViewPersonalDashboard, false); assert.equal(shell.body.canCreateLead, false);
      assert.equal((await http("GET", "/admin/role-permissions/catalogue", readerSession.token)).status, 403);
      assert.equal((await http("POST", `/leads/${owned.id}/closure-requests`, readerSession.token, { target: "ENROLLED", reason: "ADMISSION_CONFIRMED", comment: "Synthetic refusal", evidence: ["SYNTHETIC"] })).status, 403);
      await setGrants("AUDITOR", { "reporting.pilotage.view": "NONE" });
      for (const route of adaptiveRoutes) assert.equal((await http("GET", `${route}?${query()}`, readerSession.token)).status, 403, route);
    });

    await t.test("TEAM requires explicit persisted management responsibility; reporting.global.view stays independently reserved", async () => {
      const teamId = `p178-team-${suffix}`;
      for (const user of [manager, commercial]) await db.collaborator.update({ where: { id: user.id }, data: { teamId } });
      await setGrants("MANAGER", { "reporting.view": "TEAM", "reporting.pilotage.view": "TEAM", "lead.view": "TEAM" });
      assert.equal((await dashboard()).status, 403); assert.equal((await capabilities(managerSession.token)).body.canViewPilotageDashboard, false);
      const responsibility = { teamId, campusId: campus.id, managerId: manager.id, active: true, expectedVersion: 0, confirmed: true };
      assert.equal((await http("POST", "/admin/role-permissions/team-responsibilities", adminSession.token, responsibility, 0)).status, 201);
      const allowed = await dashboard(); assert.equal(allowed.status, 200); assert.equal(allowed.body.cards.uniqueLeads, 2);
      assert.equal((await capabilities(managerSession.token)).body.canViewPilotageDashboard, true);
      assert.equal((await http("POST", "/admin/role-permissions/team-responsibilities", adminSession.token, { ...responsibility, active: false, expectedVersion: 1 }, 0)).status, 201);
      assert.equal((await dashboard()).status, 403);
      await setGrants("SUPER_ADMIN", { "reporting.global.view": "NONE" }, "GLOBAL");
      assert.equal((await http("GET", `/reports/manager-dashboard?${new URLSearchParams(interval)}`, adminSession.token)).status, 403);
      assert.equal((await capabilities(adminSession.token)).body.canViewPilotageDashboard, false);
      assert.equal((await dashboard(adminSession.token)).status, 200, "Explicit campus reporting remains distinct from cross-campus reporting");
      await db.localSession.update({ where: { id: commercialSession.sessionId }, data: { active: false } });
      assert.equal((await capabilities(commercialSession.token)).status, 401);
      assert.equal(await db.lead.count(), 4, "Read/refusal tests cannot create additional business leads");
    });
  } finally {
    for (const app of apps) { (app.getHttpServer() as Server).closeAllConnections(); await app.close(); }
    await prisma.onModuleDestroy(); delete process.env.DATABASE_URL;
  }
});
