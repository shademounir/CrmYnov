import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { SheetImportCoordinator } from "../src/sheet-import/sheet-import-coordinator.js";
import { PersistentIngestionService } from "../src/ingestion/persistent-ingestion.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { ForbiddenException } from "@nestjs/common";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { SheetImportExecutor } from "../src/sheet-import/sheet-import-executor.js";
import { SyntheticSheetSource, type SheetSource } from "../src/sheet-import/synthetic-sheet-source.js";
import { SheetsSourceError, type SheetValues } from "../src/sheet-import/google-sheets-adapter.js";
import { SheetImportScheduler } from "../src/sheet-import/sheet-import-scheduler.js";
import { ImportMappingService } from "../src/import-mapping/import-mapping.service.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { CampusAssignmentService } from "../src/assignment/campus-assignment.service.js";
import { prepareSheetAssignment, commitSheetAssignment } from "../src/sheet-import/sheet-import-assignment.js";
import { currentPrincipal } from "../src/permissions/dynamic-context.js";

test("CRMY-171 PostgreSQL: campus configuration, priority, restart, concurrency and atomic audit", { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 30_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService();
  t.after(async (): Promise<void> => prisma.onModuleDestroy());
  const client = prisma.client; assert.ok(client);
  const marker = randomUUID().slice(0, 8);
  const campuses = await Promise.all(["A", "B"].map((suffix) => {
    const code = `SYNTHETIC-ASSIGN-${marker}-${suffix}`;
    return client.crmReference.create({ data: { kind: "CAMPUS", code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL",
      keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const a = campuses[0], b = campuses[1]; assert.ok(a); assert.ok(b);
  const users = await Promise.all([a, b].map((campus) => client.collaborator.create({ data: {
    professionalEmail: `synthetic-admin-${campus.id}@example.invalid`, campusId: campus.id, roles: ["ADMIN"], firstLoginRequired: false } })));
  const adminA = users[0], adminB = users[1]; assert.ok(adminA); assert.ok(adminB);
  const principals = await client.$transaction((tx) => Promise.all(users.map(async (user) => {
    const sessionId = randomUUID();
    await tx.localSession.create({ data: { id: sessionId, collaboratorId: user.id, tokenDigest: createHash("sha256").update(sessionId).digest("hex"),
      roles: user.roles, scopes: [], authenticationVersion: user.authenticationVersion, expiresAt: new Date(Date.now() + 3_600_000) } });
    return currentPrincipal(tx, { userId: user.id, roles: ["ADMIN"], sessionId, scopes: [] });
  })));
  const actorA = principals[0], actorB = principals[1]; assert.ok(actorA); assert.ok(actorB);
  const advisers = await Promise.all([a, a, b].map((campus) => client.collaborator.create({ data: {
    professionalEmail: `synthetic-adviser-${randomUUID()}@example.invalid`, campusId: campus.id, roles: ["ADMISSIONS"], firstLoginRequired: false } })));
  const first = advisers[0], next = advisers[1], outside = advisers[2]; assert.ok(first); assert.ok(next); assert.ok(outside);
  const repository = new DynamicPermissionRepository(prisma);
  const service = new CampusAssignmentService(repository, new AssignmentService(new AuditService()));
  const candidate = (userId: string): { userId: string; active: boolean; capacity: number; activeLeadCount: number } => ({ userId, active: true, capacity: 100, activeLeadCount: 0 });
  const rules = [
    { id: "fallback", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [candidate(first.id), candidate(next.id)] },
    { id: "source", scope: "SOURCE", matchValue: "WEB_FORM", strategy: "ROUND_ROBIN", enabled: true, candidates: [candidate(first.id)] },
    { id: "campaign", scope: "CAMPAIGN", matchValue: "SYNTHETIC", strategy: "ROUND_ROBIN", enabled: true, candidates: [candidate(next.id)] },
  ];
  await service.configure(actorA, a.code, 0, rules, "synthetic-config-a");
  await service.configure(actorB, b.code, 0, [{ ...rules[0], candidates: [candidate(outside.id)] }], "synthetic-config-b");
  await assert.rejects(service.read(actorA, b.id), ForbiddenException);
  await assert.rejects(service.configure(actorA, b.id, 1, [], "synthetic-crosscampus"), ForbiddenException);
  await assert.rejects(service.configure(actorA, a.id, 1, [{ ...rules[0], candidates: [candidate(outside.id)] }], "synthetic-target-outside"), ForbiddenException);
  const restarted = new PrismaService();
  try {
    const fresh = new CampusAssignmentService(new DynamicPermissionRepository(restarted), new AssignmentService(new AuditService()));
    assert.deepEqual(await fresh.read(actorA, a.id), await service.read(actorA, a.id));
  } finally { await restarted.onModuleDestroy(); }
  const record = { lineNumber: 1, firstName: "Lead", lastName: "Synthétique", source: "WEB_FORM" as const, campaign: "SYNTHETIC", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR" };
  const pick = (source: "WEB_FORM" | "OTHER_CONTROLLED", campaign: string): ReturnType<typeof prepareSheetAssignment> => client.$transaction((tx) => prepareSheetAssignment(tx, { strategy: "ROUND_ROBIN" }, { ...record, source, campaign }, a.id, `synthetic-${randomUUID()}`));
  assert.equal((await pick("WEB_FORM", "SYNTHETIC")).selection?.ruleId, "campaign");
  assert.equal((await pick("WEB_FORM", "OTHER")).selection?.ruleId, "source");
  assert.equal((await pick("OTHER_CONTROLLED", "OTHER")).selection?.ruleId, "fallback");
  await client.collaborator.update({ where: { id: next.id }, data: { active: false } });
  await assert.rejects(pick("WEB_FORM", "SYNTHETIC"), /Conflict/u, "invalid Campaign must not fall back to eligible Source");
  await client.collaborator.update({ where: { id: next.id }, data: { active: true } });
  await assert.rejects(service.configure(actorA, a.id, 1, rules, "x".repeat(65)));
  assert.equal((await service.read(actorA, a.id)).version, 1, "audit failure rolls back configuration");
  assert.equal(await client.campusAssignmentVersion.count({ where: { campusId: a.id } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: a.id, eventType: "CAMPUS_ASSIGNMENT_CONFIGURED" } }), 1);
  const concurrent = await Promise.allSettled([service.configure(actorA, a.id, 1, rules, "synthetic-concurrent-a"), service.configure(actorA, a.id, 1, rules, "synthetic-concurrent-b")]);
  assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await service.read(actorA, a.id)).version, 2);
  const targets = await Promise.all([1, 2].map(() => client.$transaction(async (tx) => {
    const selected = await prepareSheetAssignment(tx, { strategy: "ROUND_ROBIN" }, { ...record, source: "OTHER_CONTROLLED", campaign: "OTHER" }, a.id, `synthetic-${randomUUID()}`);
    await commitSheetAssignment(tx, selected, randomUUID());
    return selected.targetUserId;
  })));
  assert.equal(new Set(targets).size, 2, "concurrent workers advance one campus cursor atomically");
  await service.configure(actorA, a.id, 2, [], "synthetic-disabled");
  const unassigned = await pick("WEB_FORM", "SYNTHETIC");
  assert.equal(unassigned.targetUserId, undefined); assert.equal(unassigned.reason, "assignment_configuration_absent");
  assert.equal((await service.read(actorB, b.id)).version, 1, "other campus unchanged");
});

test("CRMY-171 PostgreSQL: fenced takeover, atomic receipts and disable", { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 60_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/crmy171_synthetic");
  const first = new PrismaService(), second = new PrismaService();
  t.after(async (): Promise<void> => { await first.onModuleDestroy(); await second.onModuleDestroy(); });
  const client = first.client;
  assert.ok(client);
  let now = new Date();
  const workerA = new SheetImportCoordinator(first, () => now);
  const workerB = new SheetImportCoordinator(second, () => now);
  const connector = await client.sheetImportConnector.create({ data: {
    campusId: randomUUID(), workbookId: `synthetic_${randomUUID()}`, tab: "Synthétique", configuration: {}, updatedBy: randomUUID(), enabled: true,
    nextRunAt: new Date(now.valueOf() - 1),
  } });

  assert.equal(await workerA.claim(connector.id, "SCHEDULED", (): boolean => false), undefined,
    "an incapable instance leaves the due connector unclaimed");
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id } }), 0);
  assert.equal((await client.sheetImportConnector.findUniqueOrThrow({ where: { id: connector.id } })).leaseUntil, null);
  const attempts = await Promise.all([
    workerA.claim(connector.id, "MANUAL", (): boolean => false),
    workerB.claim(connector.id, "SCHEDULED", (): boolean => true),
  ]);
  assert.equal(attempts.filter(Boolean).length, 1, "manual and scheduled share the same database lock");
  const initial = attempts.find((item) => item !== undefined);
  assert.ok(initial);
  assert.deepEqual(initial.run.configurationSnapshot, { configuration: {}, workbookId: connector.workbookId,
    tab: connector.tab, campusId: connector.campusId, authorizedBy: connector.updatedBy });
  assert.equal(initial.run.configurationVersion, 1);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id } }), 1);

  await assert.rejects(workerA.transaction(initial.lease, async (tx): Promise<void> => {
    await tx.sheetImportSubmission.create({ data: { connectorId: connector.id, externalId: "synthetic-rollback", fingerprint: "a".repeat(64), outcome: "CREATED" } });
    throw new Error("synthetic_audit_write_failure");
  }), /synthetic_audit_write_failure/u);
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: connector.id } }), 0, "rollback leaves no receipt");

  now = new Date(now.valueOf() + 31_000);
  const takeover = await workerB.claim(connector.id, "SCHEDULED");
  assert.ok(takeover);
  assert.equal(takeover.lease.runId, initial.lease.runId, "resume original run without losing progress");
  assert.deepEqual(takeover.run.configurationSnapshot, initial.run.configurationSnapshot, "takeover retains the exact persisted mapping snapshot");
  assert.ok(takeover.lease.epoch > initial.lease.epoch);
  await assert.rejects(workerA.transaction(initial.lease, async (tx): Promise<number> => tx.sheetImportSubmission.count()), /sheet_lease_lost/u);
  await workerB.transaction(takeover.lease, async (tx): Promise<void> => {
    await tx.sheetImportSubmission.create({ data: { connectorId: connector.id, externalId: "synthetic-001", fingerprint: "b".repeat(64), outcome: "CREATED" } });
    await tx.sheetImportRun.update({ where: { id: takeover.lease.runId }, data: { createdCount: { increment: 1 } } });
  });
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: connector.id } }), 1);

  await assert.rejects(workerB.transaction(takeover.lease, async (tx): Promise<void> => {
    await tx.sheetImportSubmission.create({ data: { connectorId: connector.id, externalId: "synthetic-expired", fingerprint: "c".repeat(64), outcome: "CREATED" } });
    now = new Date(now.valueOf() + 31_000);
  }), /sheet_lease_lost/u);
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: connector.id } }), 1, "lease loss before commit rolls back writes");

  const resumed = await workerA.claim(connector.id, "SCHEDULED");
  assert.ok(resumed);
  await client.sheetImportConnector.update({ where: { id: connector.id }, data: { enabled: false, version: { increment: 1 } } });
  await assert.rejects(workerA.transaction(resumed.lease, async (tx): Promise<number> => tx.sheetImportSubmission.count()), /sheet_lease_lost/u);
  assert.equal(await workerB.claim(connector.id, "MANUAL"), undefined, "disabled connector cannot start manually either");
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: connector.id } }), 1, "disable preserves receipts");
  await client.sheetImportConnector.update({ where: { id: connector.id }, data: { enabled: true, leaseUntil: null, configuration: { syntheticVersion: 2 } } });
  const changed = await workerB.claim(connector.id, "MANUAL");
  assert.ok(changed);
  assert.notEqual(changed.run.id, initial.run.id, "changed configuration cannot resume the prior mapping");
  assert.equal((await client.sheetImportRun.findUniqueOrThrow({ where: { id: initial.run.id } })).status, "CANCELLED");
  assert.equal(changed.run.configurationVersion, 2);
  assert.deepEqual(changed.run.configurationSnapshot, { configuration: { syntheticVersion: 2 }, workbookId: connector.workbookId,
    tab: connector.tab, campusId: connector.campusId, authorizedBy: connector.updatedBy });
});

test("CRMY-171 PostgreSQL: technical ingestion, receipt and audit commit or roll back together", { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 60_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService();
  t.after(() => prisma.onModuleDestroy());
  const client = prisma.client;
  assert.ok(client);
  const marker = randomUUID().slice(0, 8);
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYNTHETIC-${kind}-${marker}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL", keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs;
  assert.ok(campus); assert.ok(program); assert.ok(campaign);
  await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id } });
  const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_${marker}`, tab: "Synthétique", configuration: {}, updatedBy: randomUUID(), enabled: true } });
  const coordinator = new SheetImportCoordinator(prisma);
  const claim = await coordinator.claim(connector.id, "MANUAL");
  assert.ok(claim);
  const ingestion = new PersistentIngestionService(prisma, new AuditService());
  const mapping = { id: "mapping-1234567890abcdef12345678", version: 1 };
  const record = { lineNumber: 1, firstName: "Lead", lastName: "Synthétique", email: `synthetic-${marker}@example.invalid`, campus: campus.code, program: program.code,
    campaign: campaign.code, educationLevel: "BAC", source: "WEB_FORM" as const, technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", recentSource: "GOOGLE_SHEETS", externalId: `synthetic-${marker}` };
  await assert.rejects(coordinator.transaction(claim.lease, async (tx): Promise<void> => {
    await ingestion.persistSheetRecord(tx, connector.id, record, mapping, `synthetic-${marker}`);
    throw new Error("synthetic_receipt_failure");
  }), /synthetic_receipt_failure/u);
  assert.equal(await client.lead.count({ where: { email: record.email } }), 0);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id } }), 0);
  await assert.rejects(coordinator.transaction(claim.lease, (tx) => ingestion.persistSheetRecord(tx, connector.id, record, mapping, "x".repeat(65))), (error: unknown): boolean => {
    assert.ok(error instanceof Error && "code" in error);
    assert.equal(error.code, "P2000", "database enforces bounded correlation metadata");
    return true;
  });
  assert.equal(await client.lead.count({ where: { email: record.email } }), 0, "audit metadata failure rolls back business creation");
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id } }), 0);
  await coordinator.transaction(claim.lease, async (tx): Promise<void> => {
    const result = await ingestion.persistSheetRecord(tx, connector.id, record, mapping, `synthetic-${marker}`, { strategy: "ROUND_ROBIN" });
    assert.equal(result.outcome, "CREATED");
    assert.equal(result.assignmentReason, "assignment_configuration_absent");
    assert.equal((await tx.lead.findFirstOrThrow({ where: { email: record.email } })).assignedToId, null);
    await tx.sheetImportSubmission.create({ data: { connectorId: connector.id, externalId: record.externalId, fingerprint: "d".repeat(64), outcome: result.outcome, batchId: result.batchId } });
  });
  assert.equal(await client.lead.count({ where: { email: record.email } }), 1);
  const audits = await client.auditEvent.findMany({ where: { resourceId: connector.id } });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.actorId, `SYSTEM:SHEETS:${connector.id}`);
  assert.deepEqual(audits[0]?.actorRoles, ["SYSTEM"]);
  assert.equal(audits[0]?.sessionId, null);
  assert.equal(audits[0]?.campusId, campus.id);
  assert.equal(JSON.stringify(audits).includes(record.email), false);
  await assert.rejects(coordinator.transaction(claim.lease, (tx) => ingestion.persistSheetRecord(tx, connector.id, { ...record, campus: "OTHER" }, mapping, "synthetic-refused")), (error: unknown): boolean => {
    assert.ok(error instanceof ForbiddenException);
    assert.equal(error.getStatus(), 403);
    assert.deepEqual(error.getResponse(), { code: "sheet_connector_scope_refused" });
    return true;
  });
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id } }), 1);
  await coordinator.finish(claim.lease);
  assert.equal((await client.sheetImportRun.findUniqueOrThrow({ where: { id: claim.lease.runId } })).status, "COMPLETED");
  assert.equal(await coordinator.claim(connector.id, "SCHEDULED"), undefined, "scheduled run waits for next persisted due time");
});

function executor(prisma: PrismaService, source: SheetSource = new SyntheticSheetSource()): { worker: SheetImportExecutor; mappings: ImportMappingService } {
  const audit = new AuditService();
  const persistent = new PersistentIngestionService(prisma, audit);
  const leads = new LeadService(audit);
  const assignments = new LeadAssignmentService(leads, new AssignmentService(audit), audit);
  const mappings = new ImportMappingService(new IngestionService(leads, assignments, audit), audit, persistent);
  return { mappings, worker: new SheetImportExecutor(prisma, new DynamicPermissionRepository(prisma), mappings, persistent, source) };
}

test("CRMY-171 PostgreSQL: bounded external retry, revoked read, unknown reference and partial-run takeover", { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 60_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService(), second = new PrismaService();
  t.after(async (): Promise<void> => { await prisma.onModuleDestroy(); await second.onModuleDestroy(); });
  const client = prisma.client; assert.ok(client);
  const marker = randomUUID().slice(0, 8);
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYNTHETIC-RECOVERY-${kind}-${marker}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL", keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs; assert.ok(campus); assert.ok(program); assert.ok(campaign);
  await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id } });
  const author = await client.collaborator.create({ data: { professionalEmail: `synthetic-recovery-${marker}@example.invalid`, roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const mapping = executor(prisma).mappings.snapshot({ mappingKey: "synthetic-recovery", name: "Reprise synthétique", profile: "FORMINATOR_ZAPIER", expectedVersion: 0,
    columns: [{ sourceColumn: "Submission", targetField: "externalId", action: "TRIM", required: true }, { sourceColumn: "First", targetField: "firstName", action: "TRIM" }, { sourceColumn: "Last", targetField: "lastName", action: "TRIM" }] }, author.id, new Date().toISOString());
  const createConnector = (suffix: string, programCode = program.code): ReturnType<typeof client.sheetImportConnector.create> => client.sheetImportConnector.create({ data: {
    campusId: campus.id, workbookId: `synthetic_${marker}_${suffix}`, tab: "Synthétique", updatedBy: author.id, enabled: true,
    configuration: { mapping: { ...mapping, columns: mapping.columns.map((column) => ({ ...column })) }, assignment: { strategy: "UNASSIGNED" },
      context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", campus: campus.code, program: programCode, campaign: campaign.code, educationLevel: "BAC" } },
  } });
  const values: SheetValues = { columns: ["Submission", "First", "Last"], rows: [1, 2, 3].map((index) => ({ Submission: `synthetic-recovery-${marker}-${index}`, First: "Lead", Last: `Synthétique ${index}` })) };
  const retryConnector = await createConnector("retry"); let calls = 0;
  const unavailable = executor(prisma, { read: (): Promise<SheetValues> => { calls++; return Promise.reject(new SheetsSourceError("sheet_source_unavailable", 503)); } });
  await unavailable.worker.execute(retryConnector.id, "MANUAL");
  const deferred = await client.sheetImportConnector.findUniqueOrThrow({ where: { id: retryConnector.id } });
  assert.ok(deferred.activeRunId); assert.equal(deferred.leaseUntil, null); assert.ok(deferred.nextRunAt > new Date());
  await unavailable.worker.execute(retryConnector.id, "MANUAL"); assert.equal(calls, 1, "no retry before persisted backoff expires");
  for (let attempt = 2; attempt <= 3; attempt++) {
    const due = (await client.sheetImportConnector.findUniqueOrThrow({ where: { id: retryConnector.id } })).nextRunAt;
    await new Promise<void>((done) => setTimeout(done, Math.max(0, due.valueOf() - Date.now()) + 20));
    if (attempt === 3) await assert.rejects(unavailable.worker.execute(retryConnector.id, "SCHEDULED"), /sheet_source_unavailable/u);
    else await unavailable.worker.execute(retryConnector.id, "SCHEDULED");
  }
  assert.equal(calls, 3); assert.equal((await client.sheetImportRun.findUniqueOrThrow({ where: { id: deferred.activeRunId } })).status, "FAILED");
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 0);
  const revoked = await createConnector("revoked");
  const revokeDuringRead = executor(prisma, { read: async (): Promise<SheetValues> => { await client.collaborator.update({ where: { id: author.id }, data: { active: false } }); return values; } });
  await assert.rejects(revokeDuringRead.worker.execute(revoked.id, "MANUAL"), /sheet_authority_revoked/u);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: revoked.id } } }), 0);
  await client.collaborator.update({ where: { id: author.id }, data: { active: true } });
  const unknown = await createConnector("unknown", "SYNTHETIC-NOT-CONFIGURED");
  await executor(prisma, { read: (): Promise<SheetValues> => Promise.resolve(values) }).worker.execute(unknown.id, "MANUAL");
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 0);
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: unknown.id, outcome: "MANUAL_REVIEW" } }), 3);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: unknown.id, status: "COMPLETED", reviewCount: 3, createdCount: 0 } }), 1);
  assert.equal(await client.ingestionReviewItem.count({ where: { batch: { actorId: `SYSTEM:SHEETS:${unknown.id}` }, reasonCode: "REFERENCE_VALUE_UNKNOWN" } }), 3);
  const partial = await createConnector("partial"); let renewals = 0;
  const renewalCoordinator = new SheetImportCoordinator(prisma);
  const renew = renewalCoordinator.renew.bind(renewalCoordinator);
  const fault = t.mock.method(SheetImportCoordinator.prototype, "renew", async (lease: Parameters<typeof renew>[0]): Promise<void> => {
    if (lease.connectorId === partial.id && ++renewals === 3) {
      await client.sheetImportConnector.update({ where: { id: partial.id }, data: { leaseUntil: new Date(Date.now() - 1) } });
      throw new Error("sheet_lease_lost");
    }
    await renew(lease);
  });
  const source = { read: (): Promise<SheetValues> => Promise.resolve(values) };
  await assert.rejects(executor(prisma, source).worker.execute(partial.id, "MANUAL"), /sheet_lease_lost/u);
  fault.mock.restore();
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 2);
  const interrupted = await client.sheetImportRun.findFirstOrThrow({ where: { connectorId: partial.id } });
  assert.equal(interrupted.status, "RUNNING"); assert.equal(interrupted.createdCount, 2);
  await executor(second, source).worker.execute(partial.id, "SCHEDULED");
  const resumed = await client.sheetImportRun.findUniqueOrThrow({ where: { id: interrupted.id } });
  assert.equal(resumed.status, "COMPLETED"); assert.equal(resumed.createdCount, 3);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: partial.id } }), 1);
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 3);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { runId: interrupted.id } }), 3);
  assert.equal(await client.auditEvent.count({ where: { resourceId: partial.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 3);
});

test("CRMY-171 PostgreSQL: autonomous scheduler, two API workers, replay and revoked delegation", { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 30_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService(), second = new PrismaService();
  t.after(async (): Promise<void> => { await prisma.onModuleDestroy(); await second.onModuleDestroy(); });
  const client = prisma.client;
  assert.ok(client);
  const marker = randomUUID().slice(0, 8);
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYNTHETIC-AUTO-${kind}-${marker}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL", keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs;
  assert.ok(campus); assert.ok(program); assert.ok(campaign);
  await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id } });
  const author = await client.collaborator.create({ data: { professionalEmail: `synthetic-auto-${marker}@example.invalid`, roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const first = executor(prisma), other = executor(second);
  const mapping = first.mappings.snapshot({ mappingKey: "synthetic-auto", name: "Mapping synthétique", profile: "FORMINATOR_ZAPIER", expectedVersion: 0,
    columns: [{ sourceColumn: "Submission", targetField: "externalId", action: "TRIM", required: true },
      { sourceColumn: "First", targetField: "firstName", action: "TRIM", required: true },
      { sourceColumn: "Last", targetField: "lastName", action: "TRIM", required: true }] }, author.id, new Date().toISOString());
  const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_${marker}`, tab: "Synthétique", updatedBy: author.id, enabled: true,
    configuration: { mapping: { ...mapping, columns: mapping.columns.map((column) => ({ ...column })) }, assignment: { strategy: "UNASSIGNED" },
      context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", campus: campus.code, program: program.code, campaign: campaign.code, educationLevel: "BAC" } } } });
  const schedulerA = new SheetImportScheduler(prisma, first.worker), schedulerB = new SheetImportScheduler(second, other.worker);
  t.after(async (): Promise<void> => { await schedulerA.onModuleDestroy(); await schedulerB.onModuleDestroy(); });
  await client.$executeRaw`CREATE FUNCTION crmy171_controlled_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'SHEET_IMPORT_ROW_PROCESSED' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$`;
  await client.$executeRaw`CREATE TRIGGER crmy171_controlled_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION crmy171_controlled_audit_failure()`;
  t.after(async (): Promise<void> => {
    const cleanup = new PrismaService();
    const cleanupClient = cleanup.client;
    assert.ok(cleanupClient);
    try { await cleanupClient.$executeRaw`DROP TRIGGER IF EXISTS crmy171_controlled_audit_failure ON audit_events`; await cleanupClient.$executeRaw`DROP FUNCTION IF EXISTS crmy171_controlled_audit_failure()`; }
    finally { await cleanup.onModuleDestroy(); }
  });
  schedulerA.onModuleInit(); schedulerB.onModuleInit();
  // Real server timers, no browser and no direct invocation of the run handler.
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && await client.sheetImportRun.count({ where: { connectorId: connector.id, status: "FAILED" } }) === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await schedulerA.onModuleDestroy(); await schedulerB.onModuleDestroy();
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id, status: "FAILED" } }), 1);
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 0, "worker audit fault rolls back Lead");
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: connector.id } }), 0, "worker audit fault rolls back submission receipt");
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: connector.id } } }), 0, "worker audit fault rolls back progress");
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id } }), 0);
  await client.$executeRaw`DROP TRIGGER crmy171_controlled_audit_failure ON audit_events`;
  await client.$executeRaw`DROP FUNCTION crmy171_controlled_audit_failure()`;
  await first.worker.execute(connector.id, "MANUAL");
  const runStates = await client.sheetImportRun.findMany({ where: { connectorId: connector.id }, select: { status: true, errorCode: true } });
  assert.equal(runStates.filter((run) => run.status === "COMPLETED").length, 1, JSON.stringify(runStates));
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 1);
  assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: connector.id } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 1);
  await other.worker.execute(connector.id, "MANUAL");
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 1);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id, duplicateCount: 1, status: "COMPLETED" } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 1, "replay does not duplicate the business audit");
  await client.collaborator.update({ where: { id: author.id }, data: { active: false } });
  await assert.rejects(first.worker.execute(connector.id, "MANUAL"), /sheet_authority_revoked/u);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id, errorCode: "sheet_authority_revoked" } }), 1);
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 1);
  assert.equal(await client.localSession.count({ where: { collaboratorId: author.id } }), 0, "worker never creates a session");
});
