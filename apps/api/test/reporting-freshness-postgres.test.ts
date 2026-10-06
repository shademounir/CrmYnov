import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { INestApplication } from "@nestjs/common";
import type { Collaborator, CrmReference, Lead } from "@prisma/client";
import { createApplication } from "../src/application.js";
import { deriveSecret } from "../src/access-recovery/access-recovery.store.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { DynamicPermissionService } from "../src/permissions/dynamic-service.js";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { referenceKey } from "../src/references/reference.contract.js";
import type { ManagerDashboardReport, PersonalDashboardReport } from "../src/reporting/manager-dashboard.service.js";
import type { RecentDashboardLeads } from "../src/reporting/reporting-persistence.service.js";
import type { DashboardCapabilities } from "../src/reporting/reporting-persistence.service.js";
import type { PermissionScope } from "../src/permissions/dynamic-contract.js";

type Actor = Collaborator & { email: string; password: string };
type Session = { token: string; sessionId: string };
type HttpResult<T> = { status: number; body: T };
const options = { skip: process.env.CRMY162_EPHEMERAL_TEST !== "true", timeout: 120_000 };
const from = "2026-10-01T00:00:00.000Z", to = "2026-10-10T00:00:00.000Z";
const interval = { period: "custom", from, to, channel: "PHONE" };

/** The first write is behind both a loopback-only URL and an independently
 * created nonce marker. No recipe, preserved volume, DEV or real identity fits. */
async function fixture(): Promise<{ prisma: PrismaService; db: NonNullable<PrismaService["client"]>; suffix: string;
  campus: CrmReference; otherCampus: CrmReference; commercial: Actor; secondCommercial: Actor; manager: Actor;
  otherManager: Actor; admin: Actor; leads: Lead[] }> {
  assert.equal(process.env.CRMY162_EPHEMERAL_TEST, "true");
  assert.equal(process.env.SHEETS_ENABLED, "false");
  assert.equal(process.env.CRM_BACKGROUND_WORKERS, "external");
  let url: URL;
  try { url = new URL(process.env.DATABASE_URL ?? ""); } catch { throw new Error("reporting_fixture_database_url_invalid"); }
  // Do not render a rejected URL or its credentials in assertion diagnostics.
  assert.ok(url.protocol === "postgresql:" && url.hostname === "127.0.0.1" && url.pathname === "/crmy162_reporting_synthetic"
    && url.username === "postgres" && url.password === "" && url.search === "" && url.hash === "" && /^\d+$/u.test(url.port), "reporting_fixture_database_scope_refused");
  const nonce = process.env.CRMY162_DATABASE_NONCE;
  assert.match(nonce ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  const prisma = new PrismaService(), db = prisma.client; assert.ok(db);
  assert.deepEqual(await db.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy162_test_identity.marker`, [{ nonce }]);
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const reference = async (kind: "CAMPUS" | "PROGRAM" | "CAMPAIGN", name: string): Promise<CrmReference> => {
    const code = `RPT-${name}-${suffix}`;
    return db.crmReference.create({ data: { kind, code, label: `Synthetic ${name} ${suffix}`, scope: "GLOBAL", scopeKey: "GLOBAL",
      keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  };
  const campus = await reference("CAMPUS", "A"), otherCampus = await reference("CAMPUS", "B");
  const program = await reference("PROGRAM", "PROGRAM"), campaign = await reference("CAMPAIGN", "CAMPAIGN");
  const identity = async (role: Role, label: string, campusId = campus.id): Promise<Actor> => {
    const email = `${label}-${suffix.toLowerCase()}@example.invalid`, password = randomBytes(24).toString("base64url"), salt = randomBytes(16).toString("hex");
    const row = await db.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Synthetic ${label}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    await db.localPasswordHash.create({ data: { collaboratorId: row.id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    return { ...row, email, password };
  };
  const commercial = await identity("ADMISSIONS", "owner"), secondCommercial = await identity("ADMISSIONS", "second-owner");
  const manager = await identity("MANAGER", "manager"), otherManager = await identity("MANAGER", "foreign-manager", otherCampus.id), admin = await identity("SUPER_ADMIN", "admin");
  const rows = [
    { label: "owned-phone", campus: campus.code, owner: commercial.id, source: "PHONE_CALL", createdAt: "2026-10-04T23:30:00.000Z" },
    { label: "other-phone", campus: campus.code, owner: secondCommercial.id, source: "PHONE_CALL", createdAt: "2026-10-04T10:00:00.000Z" },
    { label: "owned-digital", campus: campus.code, owner: commercial.id, source: "WEB_FORM", createdAt: "2026-10-03T10:00:00.000Z" },
    { label: "foreign-phone", campus: otherCampus.code, owner: otherManager.id, source: "PHONE_CALL", createdAt: "2026-10-04T11:00:00.000Z" },
    { label: "before-period", campus: campus.code, owner: commercial.id, source: "PHONE_CALL", createdAt: "2026-09-30T23:59:59.999Z" },
    { label: "exclusive-boundary", campus: campus.code, owner: commercial.id, source: "PHONE_CALL", createdAt: to },
  ];
  const leads: Lead[] = [];
  for (const row of rows) leads.push(await db.lead.create({ data: { firstName: "Synthetic", lastName: row.label, email: `${row.label}-${suffix.toLowerCase()}@lead.example.invalid`,
    leadCode: `RPT-${suffix}-${row.label}`, campus: row.campus, assignedToId: row.owner, campaign: campaign.code, program: program.code,
    educationLevel: "BAC", source: row.source, status: "QUALIFIED", createdAt: new Date(row.createdAt) } }));
  return { prisma, db, suffix, campus, otherCampus, commercial, secondCommercial, manager, otherManager, admin, leads };
}

test("CRMY-162 real PostgreSQL dashboard freshness, cohort parity and live authorization across two API instances", options, async (t) => {
  const f = await fixture(), apps: INestApplication[] = [];
  try {
    for (let i = 0; i < 2; i++) { const app = await createApplication(); apps.push(app); await app.listen(0, "127.0.0.1"); }
    const origins = apps.map((app) => `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`);
    const http = async <T = { code?: string }>(method: string, path: string, token?: string, body?: unknown, instance = 0): Promise<HttpResult<T>> => {
      const response = await fetch(`${origins[instance]}${path}`, { method, signal: AbortSignal.timeout(20_000), headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), "x-correlation-id": `reporting-${f.suffix}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as T };
    };
    const login = async (actor: Actor, instance = 0): Promise<Session> => {
      const response = await http<Session>("POST", "/sessions", undefined, { email: actor.email, password: actor.password }, instance);
      assert.equal(response.status, 201, "Synthetic activated fixture login must succeed; credentials are never asserted or printed"); return response.body;
    };
    // Four successful attempts on instance zero, below the real five-attempt cap.
    const admin = await login(f.admin), manager = await login(f.manager), commercial = await login(f.commercial), otherManager = await login(f.otherManager);
    const query = (campus = f.campus.code): string => new URLSearchParams({ ...interval, campus }).toString();
    const dashboard = (token = manager.token, campus = f.campus.code, instance = 1): Promise<HttpResult<ManagerDashboardReport>> => http("GET", `/reports/manager-dashboard?${query(campus)}`, token, undefined, instance);
    const recent = (token = manager.token, campus = f.campus.code, instance = 1): Promise<HttpResult<RecentDashboardLeads>> => http("GET", `/reports/dashboard/recent-leads?${query(campus)}&limit=10`, token, undefined, instance);
    const setGrants = async (role: "MANAGER" | "ADMISSIONS" | "SUPER_ADMIN", patch: Record<string, PermissionScope>, campus = f.campus.id): Promise<void> => {
      const permissions = apps[0]!.get(DynamicPermissionService), actor: Principal = { userId: f.admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: admin.sessionId };
      const target = { kind: "ROLE" as const, role, campus }, previous = await permissions.read(actor, target);
      await permissions.save(actor, { ...target, expectedVersion: previous.version, grants: { ...previous.grants, ...patch }, confirmed: true, reason: "ACCESS_REVIEW" });
    };
    const owned = f.leads[0]!, second = f.leads[1]!, digital = f.leads[2]!, foreign = f.leads[3]!;

    await t.test("period, channel, canonical campus and recent rows represent the same authorized cohort", async () => {
      const byCode = await dashboard(), byUuid = await dashboard(manager.token, f.campus.id);
      assert.equal(byCode.status, 200); assert.equal(byUuid.status, 200);
      assert.equal(byCode.body.cards.uniqueLeads, 2); assert.equal(byCode.body.persistence?.distinctLeadCount, 2);
      assert.equal(byUuid.body.cards.uniqueLeads, 2); assert.equal(byUuid.body.filters.campus, f.campus.code);
      assert.deepEqual(byUuid.body.persistence?.filterNormalizations, [{ field: "campus", requested: f.campus.id, applied: f.campus.code, source: "PERSISTED_CAMPUS_REFERENCE" }]);
      assert.equal(byCode.body.persistence?.source, "POSTGRESQL"); assert.equal(byCode.body.persistence?.snapshotConsistency, "COMPOSITIONAL_READ_COMMITTED");
      assert.equal(byCode.body.timezone, "Africa/Casablanca");
      const localCounts = new Map<string, number>();
      for (const lead of [owned, second]) {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(lead.createdAt);
        const localDay = ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
        localCounts.set(localDay, (localCounts.get(localDay) ?? 0) + 1);
      }
      const expectedTrends = [...localCounts].sort(([left], [right]) => left.localeCompare(right)).map(([date, leadsCreated]) => ({ date, leadsCreated, leadsEnrolled: 0 }));
      assert.deepEqual(byCode.body.trends, expectedTrends, "Every cohort timestamp uses the actual IANA date; no fixed offset or presumed midnight crossing");
      assert.equal(byCode.body.trends.reduce((sum, row) => sum + row.leadsCreated, 0), byCode.body.cards.uniqueLeads);
      const rows = await recent(); assert.equal(rows.status, 200); assert.equal(rows.body.availability, "OBSERVED");
      assert.deepEqual(rows.body.leads.map((row) => row.id), [owned.id, second.id]); assert.equal(rows.body.leads.length, byCode.body.persistence?.distinctLeadCount);
      assert.ok(rows.body.leads.every((row) => !Object.hasOwn(row, "email") && !Object.hasOwn(row, "phone")));
      assert.equal((await dashboard(manager.token, f.otherCampus.id)).status, 403);
      const other = await dashboard(otherManager.token, f.otherCampus.id); assert.equal(other.status, 200); assert.equal(other.body.cards.uniqueLeads, 1);
      assert.equal((await dashboard(otherManager.token, f.campus.id)).status, 403);
      const global = await http<ManagerDashboardReport>("GET", `/reports/manager-dashboard?${new URLSearchParams(interval)}`, admin.token, undefined, 1);
      assert.equal(global.status, 200); assert.equal(global.body.cards.uniqueLeads, 3);
      assert.equal((await http("GET", `/reports/dashboard/recent-leads?${query()}&limit=11`, manager.token, undefined, 1)).status, 400);
    });

    await t.test("committed DUE follow-ups, closure request and metadata written after initialization refresh on the other API", async () => {
      const before = await dashboard(); assert.equal(before.status, 200); assert.equal(before.body.cards.overdueFollowUps, 0);
      assert.equal(before.body.panels.operationalRisks.queues.pendingClosures, 0);
      assert.equal(before.body.persistence?.appointmentCount, 0); assert.equal(before.body.persistence?.documentMetadataCount, 0);
      // Projection fixtures, not a claim that a user can schedule a past reminder.
      // DUE data stays intact until the entire owned tmpfs database is stopped.
      const dueAt = new Date(Date.now() - 60_000);
      for (const lead of [owned, digital, foreign]) await f.db.leadFollowUp.create({ data: { leadId: lead.id, ownerId: lead.assignedToId!, dueAt, createdAt: new Date(dueAt.valueOf() - 60_000), state: "DUE", reason: "Synthetic persisted projection", idempotencyKey: `reporting-${f.suffix}-${lead.id}`, fingerprint: createHash("sha256").update(lead.id).digest("hex") } });
      const requested = await http<{ id: string; state: string }>("POST", `/leads/${owned.id}/closure-requests`, commercial.token,
        { target: "ENROLLED", reason: "ADMISSION_CONFIRMED", comment: "Synthetic pending closure for dashboard refresh", evidence: ["Synthetic fixture evidence"] }, 0);
      assert.equal(requested.status, 201); assert.equal(requested.body.state, "PENDING");
      assert.equal(await f.db.leadClosureRequest.count({ where: { id: requested.body.id, leadId: owned.id, state: "PENDING" } }), 1);
      for (const lead of [owned, foreign]) {
        await f.db.appointment.create({ data: { leadId: lead.id, type: "INFORMATION", mode: "DISTANCIEL", startsAt: new Date(), durationMinutes: 30, adviserId: lead.assignedToId!, organizerId: f.manager.id } });
        await f.db.candidateDocument.create({ data: { leadId: lead.id, documentType: "SYNTHETIC", sanitizedFileName: "synthetic.txt", extension: ".txt", declaredMime: "text/plain", detectedMime: "text/plain", byteSize: 1, sha256: "0".repeat(64), storageReference: `synthetic/${randomUUID()}`, uploadedBy: f.manager.id } });
      }
      const after = await dashboard(); assert.equal(after.status, 200); assert.equal(after.body.cards.overdueFollowUps, 1);
      assert.equal(after.body.panels.operationalRisks.queues.pendingClosures, 1);
      assert.equal(after.body.persistence?.appointmentCount, 1); assert.equal(after.body.persistence?.documentMetadataCount, 1);
      assert.equal(after.body.panels.operationalRisks.sourceQualityAvailability, "UNAVAILABLE_NOT_DURABLY_RECONSTRUCTED");
      assert.equal((await recent()).body.leads.length, after.body.cards.uniqueLeads);
      assert.equal(await f.db.leadFollowUp.count({ where: { state: "DUE", idempotencyKey: { startsWith: `reporting-${f.suffix}-` } } }), 3);
    });

    await t.test("import batches are distinct and provenance-bound; restricted counts are unavailable instead of false zero", async () => {
      const batch = async (label: string, leadIds: string[], importedAt = new Date("2026-10-04T12:00:00.000Z")): Promise<void> => {
        await f.db.ingestionBatch.create({ data: { idempotencyKey: `reporting-${f.suffix}-${label}`, profile: "SYNTHETIC", assignmentMode: "UNASSIGNED", actorId: f.admin.id,
          totalCount: leadIds.length, createdCount: 0, attachedCount: leadIds.length, reviewCount: 0, invalidCount: 0, importedAt,
          provenances: { create: leadIds.map((leadId) => ({ leadId, sourceType: "PHONE_CALL", technicalSystem: `synthetic-${f.suffix}-${label}`, originalSource: "SYNTHETIC", recentSource: "SYNTHETIC" })) } } });
      };
      await batch("shared", [owned.id, second.id, foreign.id]); await batch("foreign", [foreign.id]); await batch("digital", [digital.id]);
      await batch("before", [owned.id], new Date("2026-09-30T23:59:59.999Z"));
      assert.equal(await f.db.ingestionBatch.count(), 4);
      const scoped = await dashboard(); assert.equal(scoped.status, 200); assert.equal(scoped.body.persistence?.importBatchCount, 1);
      assert.equal(scoped.body.persistence?.countsObservability.importBatchCount.state, "OBSERVED");
      await setGrants("MANAGER", { "import.view": "NONE", "appointment.manage": "NONE" });
      const restricted = await dashboard(); assert.equal(restricted.status, 200); assert.equal(restricted.body.persistence?.distinctLeadCount, 2);
      assert.equal(restricted.body.persistence?.importBatchCount, null); assert.equal(restricted.body.persistence?.appointmentCount, null);
      assert.deepEqual(restricted.body.persistence?.countsObservability.importBatchCount, { state: "UNAVAILABLE", reason: "IMPORT_VIEW_RESTRICTED" });
      assert.deepEqual(restricted.body.persistence?.countsObservability.appointmentCount, { state: "UNAVAILABLE", reason: "APPOINTMENT_MANAGE_RESTRICTED" });
      await setGrants("MANAGER", { "import.view": "CAMPUS", "appointment.manage": "CAMPUS" });
    });

    await t.test("OWN leads and a revoked reporting grant gate existing sessions on the second instance", async () => {
      await setGrants("ADMISSIONS", { "lead.view": "OWN" });
      const personal = await http<PersonalDashboardReport>("GET", `/reports/personal-dashboard?${query()}`, commercial.token, undefined, 1);
      assert.equal(personal.status, 200); assert.equal(personal.body.persistence?.distinctLeadCount, 1);
      assert.equal(personal.body.performance.cohort.uniqueLeadCount, 1); assert.equal(personal.body.filters.adviserId, f.commercial.id);
      const rows = await recent(commercial.token); assert.equal(rows.status, 200); assert.deepEqual(rows.body.leads.map((row) => row.id), [owned.id]);
      assert.equal((await recent(commercial.token, f.otherCampus.id)).status, 403);
      assert.equal((await http("GET", `/reports/personal-dashboard?${query()}&view=global`, commercial.token, undefined, 1)).status, 200, "Personal endpoint always forces the caller's own view");
      await setGrants("ADMISSIONS", { "reporting.view": "NONE" });
      assert.equal((await http("GET", `/reports/personal-dashboard?${query()}`, commercial.token, undefined, 1)).status, 403);
      assert.equal((await recent(commercial.token)).status, 403);
      assert.equal(await f.db.lead.count(), 6, "Read/refusal checks cannot manufacture additional business rows");
    });

    await t.test("CRMY-178 explicit Commercial pilotage uses the same real dashboard, with live revocation and no admin authority", async () => {
      await setGrants("ADMISSIONS", { "reporting.view": "CAMPUS", "lead.view": "CAMPUS" });
      await f.db.admissionsResponsibility.create({ data: { userId: f.commercial.id, campus: f.campus.code, active: true } });
      assert.equal((await dashboard(commercial.token)).status, 403, "An active Admissions agenda profile is not director/pilotage authority");
      const shell = (): Promise<HttpResult<DashboardCapabilities>> => http("GET", "/reports/dashboard/capabilities", commercial.token, undefined, 1);
      assert.equal((await shell()).body.canViewPilotageDashboard, false);
      // A Super Admin must first open the role envelope; a campus toggle cannot
      // override the global NONE. Only this nonce-verified synthetic DB changes.
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "CAMPUS" }, "GLOBAL");
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "CAMPUS" });
      const dueAt = new Date(Date.now() - 60_000);
      await f.db.leadFollowUp.create({ data: { leadId: second.id, ownerId: f.secondCommercial.id, dueAt, createdAt: new Date(dueAt.valueOf() - 60_000), state: "DUE", reason: "Synthetic pilotage projection", idempotencyKey: `pilotage-${f.suffix}-${second.id}`, fingerprint: createHash("sha256").update(second.id).digest("hex") } });
      for (const lead of [second, foreign]) await f.db.leadClosureRequest.create({ data: { leadId: lead.id, target: "ENROLLED", reason: "ADMISSION_CONFIRMED", comment: "Synthetic projection only", evidence: ["SYNTHETIC"], requesterId: lead.assignedToId! } });
      await f.db.reassignmentRequest.create({ data: { leadId: second.id, currentOwnerId: f.secondCommercial.id, targetUserId: f.commercial.id, reason: "Synthetic projection only", moveOpenTasks: false, requestedBy: f.secondCommercial.id } });
      const expected = await dashboard(), actual = await dashboard(commercial.token);
      assert.equal(actual.status, 200); assert.equal(actual.body.definitionVersion, expected.body.definitionVersion);
      assert.deepEqual(actual.body.cards, expected.body.cards);
      assert.deepEqual(actual.body.panels.operationalRisks.queues, expected.body.panels.operationalRisks.queues);
      assert.deepEqual(actual.body.panels.performance.advisers, expected.body.panels.performance.advisers);
      assert.equal(actual.body.cards.uniqueLeads, 2); assert.equal(actual.body.cards.overdueFollowUps, 2);
      assert.equal(actual.body.panels.operationalRisks.queues.pendingClosures, 2); assert.equal(actual.body.panels.operationalRisks.queues.pendingReassignments, 1);
      assert.equal((await shell()).body.canViewPilotageDashboard, true);
      assert.deepEqual((await f.db.collaborator.findUniqueOrThrow({ where: { id: f.commercial.id } })).roles, ["ADMISSIONS"]);
      assert.equal((await http("GET", "/admin/role-permissions/catalogue", commercial.token, undefined, 1)).status, 403);
      assert.equal((await http("GET", "/users", commercial.token, undefined, 1)).status, 403);
      assert.equal((await dashboard(commercial.token, f.otherCampus.id)).status, 403);
      assert.equal((await http("GET", `/reports/manager-dashboard?${query()}&role=SUPER_ADMIN`, commercial.token, undefined, 1)).status, 400);
      const fullRecent = await http<RecentDashboardLeads>("GET", `/reports/dashboard/recent-leads?${query()}&view=global`, commercial.token, undefined, 1);
      assert.equal(fullRecent.status, 200); assert.deepEqual(new Set(fullRecent.body.leads.map((row) => row.id)), new Set([owned.id, second.id]));
      await setGrants("ADMISSIONS", { "reporting.export": "NONE" });
      assert.equal((await shell()).body.canExportReporting, false);
      const deniedExport = await fetch(`${origins[1]}/reports/manager-dashboard/export?${query()}`, { headers: { authorization: `Bearer ${commercial.token}` }, signal: AbortSignal.timeout(20_000) });
      assert.equal(deniedExport.status, 403); assert.equal((await dashboard(commercial.token)).status, 200);
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "OWN" });
      assert.equal((await dashboard(commercial.token)).body.cards.uniqueLeads, 1);
      await setGrants("ADMISSIONS", { "reporting.pilotage.view": "NONE" });
      assert.equal((await dashboard(commercial.token)).status, 403); assert.equal((await shell()).body.canViewPilotageDashboard, false);
      await setGrants("ADMISSIONS", { "reporting.view": "NONE" });
      const creationOnly = await shell(); assert.equal(creationOnly.status, 200); assert.equal(creationOnly.body.canCreateLead, true); assert.equal(creationOnly.body.canViewPersonalDashboard, false);
    });

    await t.test("CRMY-178 TEAM pilotage uses explicit persisted responsibility, not historical teamId, and reserved GLOBAL stays independent", async () => {
      const teamId = `pilotage-team-${f.suffix}`;
      for (const user of [f.manager, f.commercial]) await f.db.collaborator.update({ where: { id: user.id }, data: { teamId } });
      await setGrants("MANAGER", { "reporting.view": "TEAM", "reporting.pilotage.view": "TEAM", "lead.view": "TEAM" });
      assert.equal((await dashboard()).status, 403);
      const permissions = apps[0]!.get(DynamicPermissionService), actor: Principal = { userId: f.admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: admin.sessionId };
      const input = { teamId, campusId: f.campus.id, managerId: f.manager.id, active: true, expectedVersion: 0, confirmed: true };
      await permissions.teamResponsibilities(actor, input);
      const allowed = await dashboard(); assert.equal(allowed.status, 200); assert.equal(allowed.body.cards.uniqueLeads, 1);
      await permissions.teamResponsibilities(actor, { ...input, active: false, expectedVersion: 1 });
      assert.equal((await dashboard()).status, 403);
      await setGrants("SUPER_ADMIN", { "reporting.global.view": "NONE" }, "GLOBAL");
      assert.equal((await http("GET", `/reports/manager-dashboard?${new URLSearchParams(interval)}`, admin.token, undefined, 1)).status, 403);
      assert.equal((await dashboard(admin.token)).status, 200, "A reserved global revocation does not erase explicitly campus-bounded reporting");
    });
  } finally {
    for (const app of apps) { (app.getHttpServer() as Server).closeAllConnections(); await app.close(); }
    await f.prisma.onModuleDestroy();
  }
});
