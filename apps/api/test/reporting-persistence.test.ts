import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import type { ReassignmentService } from "../src/assignment/reassignment.service.js";
import { ClosureService, type ClosureRequest } from "../src/closure/closure.service.js";
import { FollowUpService, type FollowUpRecord } from "../src/follow-up/follow-up.service.js";
import type { FollowUpPersistenceRepository } from "../src/follow-up/follow-up-persistence.repository.js";
import type { LeadWorkflowPersistenceRepository } from "../src/leads/lead-workflow-persistence.repository.js";
import { LeadService, type LeadRecord, type LeadReportingRow } from "../src/leads/lead.service.js";
import type { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import type { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { ReportingPersistenceGuard } from "../src/reporting/reporting-persistence.guard.js";
import { ReportingPersistenceService } from "../src/reporting/reporting-persistence.service.js";

const campusId = "00000000-0000-4000-8000-000000000162";
const foreignId = "00000000-0000-4000-8000-000000000163";
const manager: Principal = { userId: "00000000-0000-4000-8000-000000000164", roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: campusId }], sessionId: "synthetic-session" };
const hasCode = (code: string) => (error: unknown): boolean => typeof error === "object" && error !== null && "getResponse" in error
  && (error as { getResponse: () => { code?: string } }).getResponse().code === code;
const refreshNoop = { refreshReportingForApi: (): Promise<void> => Promise.resolve() };
const row = (id: string, campus: string, source = "WEB_FORM", assignedToId = manager.userId): LeadReportingRow => ({
  id, campus, campaign: "SYNTHETIC", program: "PROGRAM", source, assignedToId, status: "QUALIFIED", temperature: "WARM",
  createdAt: "2026-08-15T10:00:00.000Z", collaboratorIds: [], activities: [],
});

function fixture(): { service: ReportingPersistenceService; requests: Array<{ model: string; where: unknown }>;
  account: { id: string; active: boolean; roles: string[]; campusId: string; teamId: null; firstLoginRequired: boolean; authenticationVersion: number };
  rows: LeadReportingRow[]; configure: (role: "MANAGER" | "ADMISSIONS", grants: Record<string, "NONE" | "OWN" | "CAMPUS">) => void; fail: () => void } {
  const requests: Array<{ model: string; where: unknown }> = [];
  let configurations: ConfigurationSnapshot[] = [];
  let failCount = false;
  const account = { id: manager.userId, active: true, roles: ["MANAGER"], campusId, teamId: null, firstLoginRequired: false, authenticationVersion: 1 };
  const campus = { id: campusId, kind: "CAMPUS", state: "ACTIVE", code: "SYNTHETIC", label: "Campus synthétique" };
  const foreign = { ...campus, id: foreignId, code: "FOREIGN", label: "Campus étranger" };
  const rows = [row("lead-digital", campus.code), row("lead-phone", campus.code, "PHONE_CALL", "other-owner"), row("lead-foreign", foreign.code)];
  const count = (model: string, value: number): ((query: { where: unknown }) => Promise<number>) => (query): Promise<number> => {
    requests.push({ model, where: query.where }); if (failCount) throw new Error("synthetic DB failure");
    if (model === "lead") return Promise.resolve((query.where as { id: { in: string[] } }).id.in.length);
    return Promise.resolve(value);
  };
  const tx = {
    collaborator: { findUnique: ({ where }: { where: { id: string } }): Promise<typeof account> => Promise.resolve(where.id === manager.userId ? account : { ...account, id: where.id }),
      findMany: ({ where }: { where: { id: { in: string[] } } }): Promise<Array<{ id: string; professionalDisplayName: string | null }>> => Promise.resolve(where.id.in.map((id) => ({ id, professionalDisplayName: id === "other-owner" ? null : "Conseiller synthétique" }))) },
    localSession: { findUnique: (): Promise<{ active: boolean; collaboratorId: string; authenticationVersion: number; expiresAt: Date }> => Promise.resolve({ active: true, collaboratorId: manager.userId, authenticationVersion: 1, expiresAt: new Date("2099-01-01") }) },
    crmReference: { findUnique: ({ where }: { where: { id: string } }): Promise<typeof campus | undefined> => Promise.resolve([campus, foreign].find((value) => value.id === where.id)) },
    crmReferenceKey: { findMany: ({ where, include }: { where: { referenceId?: string; key?: string }; include?: unknown }): Promise<Array<{ reference: typeof campus } | { key: string }>> => {
      const reference = [campus, foreign].find((value) => include ? [value.code, value.label].some((key) => referenceKey(key) === where.key) : value.id === where.referenceId);
      return Promise.resolve(reference ? include ? [{ reference }] : [{ key: referenceKey(reference.code) }] : []);
    } },
    lead: { findMany: ({ where }: { where: { campus?: { in: string[] }; id?: { in: string[] } } }): Promise<Array<Record<string, unknown>>> => {
      if (where.id) { requests.push({ model: "recentProjection", where }); return Promise.resolve(rows.filter((value) => where.id!.in.includes(value.id))
        .map((value) => ({ ...value, createdAt: new Date(value.createdAt), leadCode: `LD-${value.id}`, firstName: "Lead", lastName: "Synthétique" }))); }
      return Promise.resolve(rows.filter((value) => !where.campus || where.campus.in.includes(value.campus))
        .map((value) => ({ ...value, collaborators: value.collaboratorIds.map((userId) => ({ userId })) })));
    }, count: count("lead", 0) },
    appointment: { count: count("appointment", 3) }, candidateDocument: { count: count("document", 2) }, ingestionBatch: { count: count("batch", 1) },
  };
  const repository = { readTransaction: <T>(action: (value: unknown) => Promise<T>): Promise<T> => action(tx), snapshots: (): Promise<ConfigurationSnapshot[]> => Promise.resolve(configurations) };
  const leads = { ...refreshNoop, reportingSnapshot: (principal: Principal): LeadReportingRow[] => rows.filter((value) => principal.permissionLeadIds?.has(value.id)) };
  const service = new ReportingPersistenceService({ client: tx } as unknown as PrismaService, leads as unknown as LeadService,
    refreshNoop as ReassignmentService, refreshNoop as FollowUpService, refreshNoop as ClosureService, repository as unknown as DynamicPermissionRepository);
  const configure = (role: "MANAGER" | "ADMISSIONS", grants: Record<string, "NONE" | "OWN" | "CAMPUS">): void => {
    const target: ConfigurationTarget = { kind: "ROLE", role, campus: "GLOBAL" };
    configurations = [{ ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), ...grants } }];
  };
  return { service, requests, account, rows, configure, fail: (): void => { failCount = true; } };
}

test("refreshes all four persisted projections; missing PostgreSQL is unavailable, not zero", async () => {
  const calls: string[] = []; const projection = (name: string): { refreshReportingForApi: () => Promise<void> } => ({ refreshReportingForApi: (): Promise<void> => { calls.push(name); return Promise.resolve(); } });
  const service = new ReportingPersistenceService({ client: undefined } as PrismaService, projection("leads") as LeadService,
    projection("reassignments") as ReassignmentService, projection("followups") as FollowUpService, projection("closures") as ClosureService, {} as DynamicPermissionRepository);
  await service.refresh(); assert.deepEqual(calls.sort(), ["closures", "followups", "leads", "reassignments"]);
  const evidence = await service.evidence(manager, {});
  assert.equal(evidence.distinctLeadCount, null); assert.equal(evidence.importBatchCount, null);
  assert.equal(evidence.countsObservability.distinctLeadCount.reason, "POSTGRESQL_NOT_CONFIGURED");
  assert.equal(await new ReportingPersistenceGuard(service).canActivate(), true); assert.equal(calls.length, 8);
});

test("uses one authorized channel cohort for evidence and import batch provenance, never global batch totals", async () => {
  const f = fixture();
  const evidence = await f.service.evidence(manager, { channel: "DIGITAL", from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" });
  assert.equal(evidence.distinctLeadCount, 1); assert.equal(evidence.appointmentCount, 3); assert.equal(evidence.importBatchCount, 1);
  assert.equal(evidence.snapshotConsistency, "COMPOSITIONAL_READ_COMMITTED");
  assert.deepEqual(f.requests.find((value) => value.model === "lead")?.where, { id: { in: ["lead-digital"] } });
  const batch = f.requests.find((value) => value.model === "batch")?.where as { provenances: unknown; importedAt: unknown };
  assert.deepEqual(batch.provenances, { some: { leadId: { in: ["lead-digital"] } } });
  assert.deepEqual(batch.importedAt, { gte: new Date("2026-08-01T00:00:00.000Z"), lt: new Date("2026-09-01T00:00:00.000Z") });
});

test("a forbidden explicit campus cannot overwrite the persisted scope", async () => {
  const f = fixture(); await assert.rejects(() => f.service.evidence(manager, { campus: "FOREIGN" }), hasCode("permission_denied"));
  assert.equal(f.requests.length, 0);
});

test("UUID and code filters resolve the same persisted campus; unknown aliases fail closed", async () => {
  const f = fixture(); const uuid = await f.service.evidence(manager, { campus: campusId });
  const code = await f.service.evidence(manager, { campus: "SYNTHETIC" });
  assert.equal(uuid.distinctLeadCount, code.distinctLeadCount); assert.equal(uuid.distinctLeadCount, 2);
  assert.deepEqual(uuid.filterNormalizations, [{ field: "campus", requested: campusId, applied: "SYNTHETIC", source: "PERSISTED_CAMPUS_REFERENCE" }]);
  await assert.rejects(() => f.service.evidence(manager, { campus: "not-a-declared-alias" }), hasCode("permission_denied"));
});

test("OWN lead grant, activation and live revocation are enforced even when session payload claims GLOBAL", async () => {
  const f = fixture(); f.account.roles = ["ADMISSIONS"]; f.configure("ADMISSIONS", { "lead.view": "OWN", "import.view": "NONE", "appointment.manage": "NONE" });
  const staleActor: Principal = { ...manager, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }] };
  let observed: string[] = [];
  await f.service.withReportingScope(staleActor, (current) => { observed = [...current.permissionLeadIds!]; assert.deepEqual(current.roles, ["ADMISSIONS"]); });
  assert.deepEqual(observed, ["lead-digital"]);
  const evidence = await f.service.evidence(staleActor, {});
  assert.equal(evidence.appointmentCount, null); assert.equal(evidence.importBatchCount, null); assert.equal(f.requests.some((value) => value.model === "batch"), false);
  f.configure("ADMISSIONS", { "reporting.view": "NONE" }); await assert.rejects(() => f.service.evidence(staleActor, {}), hasCode("permission_denied"));
  f.configure("ADMISSIONS", {}); f.account.firstLoginRequired = true;
  await assert.rejects(() => f.service.evidence(staleActor, {}), hasCode("permission_denied"));
});

test("PostgreSQL count failure is a controlled unavailable error, not a successful zero", async () => {
  const f = fixture(); f.fail(); await assert.rejects(() => f.service.evidence(manager, {}), hasCode("reporting_store_unavailable"));
});

test("recent leads share exact owner OR collaborator, channel and period cohort with a bounded authorized projection", async () => {
  const f = fixture();
  f.rows.push({ ...row("lead-secondary", "SYNTHETIC", "WEB_FORM", "other-owner"), collaboratorIds: [manager.userId], createdAt: "2026-08-16T10:00:00.000Z" });
  f.rows.push({ ...row("lead-outside-period", "SYNTHETIC"), createdAt: "2026-09-02T10:00:00.000Z" });
  const response = await f.service.recentLeads(manager, { campus: campusId, adviserId: manager.userId, channel: "DIGITAL", from: "2026-08-01", to: "2026-09-01" }, 5);
  assert.deepEqual(response.leads.map((lead) => lead.id), ["lead-secondary", "lead-digital"]);
  assert.equal(response.leads[0]?.assignedToLabel, undefined); assert.equal(response.leads[1]?.assignedToLabel, "Conseiller synthétique");
  assert.equal(response.filters.campus, "SYNTHETIC"); assert.deepEqual(response.capabilities, { canCreateLead: false, canReadRecentLeads: true, canViewManagerDashboard: true });
  const serialized = JSON.stringify(response); assert.equal(serialized.includes("other-owner"), false); assert.equal(serialized.includes("professionalEmail"), false);
  await assert.rejects(() => f.service.recentLeads(manager, {}, 11), hasCode("reporting_recent_limit_invalid"));
  f.configure("MANAGER", { "lead.view": "NONE" }); await assert.rejects(() => f.service.recentLeads(manager, {}), hasCode("permission_denied"));
});

test("personal recent leads cannot be widened by another adviser and expose no unowned identity", async () => {
  const f = fixture(); f.account.roles = ["ADMISSIONS"]; f.configure("ADMISSIONS", { "lead.view": "OWN" });
  const response = await f.service.recentLeads(manager, { view: "personal", adviserId: "other-owner", from: "2026-08-01", to: "2026-09-01" });
  assert.deepEqual(response.leads.map((lead) => lead.id), ["lead-digital"]); assert.equal(response.filters.adviserId, manager.userId);
  assert.equal(response.capabilities.canCreateLead, true);
  assert.equal(response.capabilities.canViewManagerDashboard, false);
  await assert.rejects(() => f.service.recentLeads(manager, { campus: "FOREIGN" }), hasCode("permission_denied"));
});

test("list drilldown preserves owner OR collaborator and exact exclusive instant without changing inclusive legacy filter", async () => {
  const fields = { firstName: "Lead", lastName: "Synthétique", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC", program: "PROGRAM", source: "WEB_FORM" };
  const fixtures: Array<LeadRecord & { version: number }> = [
    { ...fields, version: 1, status: "PROSPECT", id: "primary", leadCode: "LD-PRIMARY", assignedToId: manager.userId, createdAt: "2026-08-15T10:59:59.999Z" },
    { ...fields, version: 1, status: "PROSPECT", id: "secondary", leadCode: "LD-SECONDARY", assignedToId: "other-owner", collaboratorIds: [manager.userId], createdAt: "2026-08-15T10:59:59.999Z" },
    { ...fields, version: 1, status: "PROSPECT", id: "boundary", leadCode: "LD-BOUNDARY", assignedToId: manager.userId, createdAt: "2026-08-15T11:00:00.000Z" },
    { ...fields, version: 1, status: "PROSPECT", id: "forbidden", leadCode: "LD-FORBIDDEN", assignedToId: manager.userId, campus: "FOREIGN", createdAt: "2026-08-15T10:00:00.000Z" },
  ];
  const store = { enabled: true, snapshot: (): Promise<{ leads: typeof fixtures; activities: [] }> => Promise.resolve({ leads: fixtures, activities: [] }) } as unknown as LeadPersistenceRepository;
  const leads = new LeadService(new AuditService(), store); await leads.onModuleInit();
  const principal: Principal = { ...manager, scopes: [{ kind: "CAMPUS", id: "SYNTHETIC" }], permissionLeadIds: new Set(["primary", "secondary", "boundary", "forbidden"]) };
  const query = { page: 1, pageSize: 10, adviserId: manager.userId, createdFrom: "2026-08-15T10:00:00Z", createdBefore: "2026-08-15T12:00:00+01:00" };
  assert.deepEqual(leads.listLeads(query, principal, "corr-exclusive").items.map((lead) => lead.id).sort(), ["primary", "secondary"]);
  assert.equal(leads.listLeads({ page: 1, pageSize: 10, createdTo: query.createdBefore }, principal, "corr-inclusive").total, 3);
  assert.throws(() => leads.listLeads({ ...query, createdBefore: "invalid" }, principal, "corr-invalid"), hasCode("lead_created_before_invalid"));
});

test("independent read caches observe changed followups and closure decisions after reporting refresh", async () => {
  let followups: FollowUpRecord[] = [];
  let closures: ClosureRequest[] = [];
  const followupStore = { enabled: true, snapshot: (): Promise<FollowUpRecord[]> => Promise.resolve(followups) } as FollowUpPersistenceRepository;
  const closureStore = { enabled: true, snapshot: (): Promise<{ closures: ClosureRequest[]; collaborations: []; reassignments: [] }> => Promise.resolve({ closures, collaborations: [], reassignments: [] }) } as unknown as LeadWorkflowPersistenceRepository;
  const create = (): { followups: FollowUpService; closures: ClosureService } => ({ followups: new FollowUpService({} as never, {} as never, {} as never, followupStore), closures: new ClosureService({} as never, {} as never, {} as never, closureStore) });
  const first = create(); const second = create(); await Promise.all([first.followups.onModuleInit(), first.closures.onModuleInit(), second.followups.onModuleInit(), second.closures.onModuleInit()]);
  followups = [{ id: "followup", leadId: "lead-digital", ownerId: manager.userId, dueAt: "2026-08-14T10:00:00.000Z", state: "DUE", reason: "SYNTHETIC", version: 2, createdAt: "2026-08-13T10:00:00.000Z", updatedAt: "2026-08-14T10:00:00.000Z" }];
  closures = [{ id: "closure", leadId: "lead-digital", target: "ENROLLED", state: "PENDING", requesterId: manager.userId, reason: "ADMISSION_CONFIRMED", comment: "SYNTHETIC", evidence: [], version: 1, createdAt: "2026-08-13T10:00:00.000Z" }];
  await Promise.all([first.followups.refreshReportingForApi(), first.closures.refreshReportingForApi()]);
  assert.equal(first.followups.reportingSnapshot(manager).length, 1); assert.equal(second.followups.reportingSnapshot(manager).length, 0);
  await Promise.all([second.followups.refreshReportingForApi(), second.closures.refreshReportingForApi()]);
  assert.equal(second.followups.reportingSnapshot(manager)[0]?.state, "DUE"); assert.equal(second.closures.list(manager)[0]?.state, "PENDING");
  closures = [{ ...closures[0]!, state: "APPROVED", version: 2 }]; await second.closures.refreshReportingForApi();
  assert.equal(second.closures.list(manager)[0]?.state, "APPROVED"); assert.equal(first.closures.list(manager)[0]?.state, "PENDING");
});
