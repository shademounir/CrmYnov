import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, type SheetImportConnector, type SheetLocalStream } from "@prisma/client";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { SheetImportExecutor } from "../src/sheet-import/sheet-import-executor.js";
import { SheetImportCoordinator } from "../src/sheet-import/sheet-import-coordinator.js";
import { PersistentIngestionService } from "../src/ingestion/persistent-ingestion.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import { ImportMappingService } from "../src/import-mapping/import-mapping.service.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { sheetStreamId } from "../src/sheet-import/sheet-local-ledger.js";
import type { SheetSource } from "../src/sheet-import/synthetic-sheet-source.js";
import type { SheetValues } from "../src/sheet-import/google-sheets-adapter.js";

function executor(prisma: PrismaService, source: SheetSource): { worker: SheetImportExecutor; mappings: ImportMappingService; ingestion: PersistentIngestionService } {
  const audit = new AuditService(), leads = new LeadService(audit);
  const ingestion = new PersistentIngestionService(prisma, audit);
  const assignments = new LeadAssignmentService(leads, new AssignmentService(audit), audit);
  const mappings = new ImportMappingService(new IngestionService(leads, assignments, audit), audit, ingestion);
  return { ingestion, mappings, worker: new SheetImportExecutor(prisma, new DynamicPermissionRepository(prisma), mappings, ingestion, source) };
}

test("CRMY-171 LOCAL_ROW executor PostgreSQL: atomic ingestion, two-instance replay, same-contact provenance and changed-row suspension", { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 60_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService(), second = new PrismaService();
  t.after(async (): Promise<void> => { await prisma.onModuleDestroy(); await second.onModuleDestroy(); });
  const client = prisma.client; assert.ok(client);
  const marker = randomUUID().slice(0, 8);
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYNTHETIC-LOCAL-${kind}-${marker}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL",
      keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs; assert.ok(campus); assert.ok(program); assert.ok(campaign);
  await client.crmProgramAvailability.create({ data: { campusId: campus.id, programId: program.id } });
  const author = await client.collaborator.create({ data: { professionalEmail: `synthetic-local-admin-${marker}@example.invalid`, roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const columns = ["First", "Last", "Email", "Campus", "Program", "Education", "Campaign"];
  const email = `synthetic-local-lead-${marker}@example.invalid`;
  const row = ["Lead", "Synthétique", email, campus.code, program.code, "BAC", campaign.code];
  let raw = [columns, row];
  const source: SheetSource = { read: (): Promise<SheetValues> => Promise.resolve({ columns, rows: raw.slice(1).map((cells) => Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]))), observation: { sheetId: 0, range: "A1:G6", values: raw } }) };
  const first = executor(prisma, source), other = executor(second, source);
  const mapping = first.mappings.snapshot({ mappingKey: `synthetic-local-${marker}`, name: "Mapping local synthétique", profile: "CUSTOM", expectedVersion: 0,
    columns: [
      { sourceColumn: "First", targetField: "firstName", action: "TRIM", required: true },
      { sourceColumn: "Last", targetField: "lastName", action: "TRIM", required: true },
      { sourceColumn: "Email", targetField: "email", action: "LOWERCASE" },
      { sourceColumn: "Campus", targetField: "campus", action: "TRIM", required: true },
      { sourceColumn: "Program", targetField: "program", action: "TRIM", required: true },
      { sourceColumn: "Education", targetField: "educationLevel", action: "TRIM", required: true },
      { sourceColumn: "Campaign", targetField: "campaign", action: "TRIM", required: true },
    ] }, author.id, new Date().toISOString());
  const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_local_${marker}`, tab: "Synthétique", updatedBy: author.id, enabled: true,
    configuration: { mapping: { ...mapping, columns: mapping.columns.map((column) => ({ ...column })) }, assignment: { strategy: "UNASSIGNED" },
      source: { mode: "SIMULATED", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:G6" },
      context: { source: "OTHER_CONTROLLED", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic controlled origin", campus: campus.code, program: program.code, campaign: campaign.code, educationLevel: "BAC" } } } });
  const streamId = sheetStreamId(connector.workbookId, 0);
  const actorId = `SYSTEM:SHEETS:${connector.id}`;

  // Existing deterministic fault mechanism: retain the real transaction and force
  // the PostgreSQL audit correlation-length constraint at the actual audit write.
  const persist = first.ingestion.persistSheetRecord.bind(first.ingestion);
  let auditConstraintObserved = false;
  const fault = t.mock.method(first.ingestion, "persistSheetRecord", async (...args: Parameters<typeof persist>): ReturnType<typeof persist> => {
    try { return await persist(args[0], args[1], args[2], args[3], "x".repeat(100), args[5]); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2000") auditConstraintObserved = true;
      throw error;
    }
  });
  await assert.rejects(first.worker.execute(connector.id, "MANUAL"), /sheet_execution_failed/u);
  assert.equal(auditConstraintObserved, true, "failure is the real PostgreSQL bounded-audit-metadata constraint");
  fault.mock.restore();
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), 0, "audit failure rolls back Lead");
  assert.equal(await client.ingestionBatch.count({ where: { actorId } }), 0, "audit failure rolls back batch and reports");
  assert.equal(await client.leadProvenance.count({ where: { batch: { actorId } } }), 0);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: connector.id } } }), 0);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id } }), 0);
  const pending = await client.sheetLocalRow.findFirstOrThrow({ where: { streamId } });
  assert.equal(pending.status, "PENDING"); assert.equal(pending.batchId, null, "observation may persist, but no ingestion success leaks");

  await first.worker.execute(connector.id, "MANUAL");
  const lead = await client.lead.findFirstOrThrow({ where: { email } });
  assert.equal(lead.campus, campus.code); assert.equal(lead.assignedToId, null);
  const tracked = await client.sheetLocalRow.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(tracked.status, "CREATED"); assert.ok(tracked.batchId);
  const provenance = await client.leadProvenance.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(provenance.externalId, tracked.id); assert.equal(provenance.technicalSystem, "GOOGLE_SHEETS_LOCAL");
  assert.equal(provenance.originalSource, "Synthetic controlled origin"); assert.equal(provenance.batchId, tracked.batchId);
  const processed = await client.auditEvent.findMany({ where: { resourceId: connector.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } });
  assert.equal(processed.length, 1); assert.equal(processed[0]?.actorId, actorId); assert.equal(processed[0]?.campusId, campus.id);
  assert.equal(processed[0]?.result, "SUCCESS"); assert.equal(processed[0]?.sessionId, null);
  assert.equal(JSON.stringify(processed).includes(email), false);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: connector.id }, outcome: "CREATED" } }), 1);

  await other.worker.execute(connector.id, "MANUAL");
  assert.equal(await client.lead.count({ where: { email } }), 1);
  assert.equal(await client.ingestionBatch.count({ where: { actorId } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 1);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id, status: "COMPLETED", duplicateCount: 1 } }), 1);

  raw = [columns, row, [...row]];
  await other.worker.execute(connector.id, "MANUAL");
  assert.equal(await client.lead.count({ where: { email } }), 1, "another source position with matching contact must not create a second Lead");
  const rows = await client.sheetLocalRow.findMany({ where: { streamId }, orderBy: { rowNumber: "asc" } });
  assert.equal(rows.length, 2); assert.notEqual(rows[0]?.id, rows[1]?.id);
  assert.deepEqual(rows.map((item) => item.status), ["CREATED", "DUPLICATE"]);
  assert.equal(await client.leadProvenance.count({ where: { leadId: lead.id, technicalSystem: "GOOGLE_SHEETS_LOCAL" } }), 2);
  assert.equal(await client.ingestionBatch.count({ where: { actorId } }), 2);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 2);
  assert.equal(await client.auditEvent.count({ where: { resourceId: lead.id, eventType: { in: ["LEAD_ASSIGNED", "LEAD_AUTO_ASSIGNED"] } } }), 0);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedToId, null);

  const beforeChange = await client.lead.findUniqueOrThrow({ where: { id: lead.id } });
  raw = [columns, ["Changed", ...row.slice(1)], [...row]];
  await first.worker.execute(connector.id, "MANUAL");
  assert.equal((await client.sheetLocalStream.findUniqueOrThrow({ where: { id: streamId } })).suspended, true);
  assert.equal(await client.auditEvent.count({ where: { resourceId: connector.id, eventType: "SHEET_RECONCILIATION_REQUIRED" } }), 1);
  assert.equal(await client.ingestionBatch.count({ where: { actorId } }), 2);
  assert.deepEqual(await client.lead.findUniqueOrThrow({ where: { id: lead.id } }), beforeChange);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).firstName, "Lead", "changed source cannot overwrite an imported Lead");
  assert.equal(await client.localSession.count({ where: { collaboratorId: author.id } }), 0, "technical worker never manufactures an administrative session");

  const configuration = connector.configuration; assert.ok(configuration);
  const manual = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_manual_${marker}`, tab: "Synthétique", updatedBy: author.id,
    enabled: false, manualRequested: true, nextRunAt: new Date(Date.now() - 1), configuration } });
  const manualEmail = `synthetic-local-manual-${marker}@example.invalid`;
  const secondEmail = `synthetic-local-resumed-${marker}@example.invalid`;
  raw = [columns, ["Lead", "Manuel synthétique", manualEmail, ...row.slice(3)], ["Lead", "Repris synthétique", secondEmail, ...row.slice(3)]];
  const coordinator = new SheetImportCoordinator(prisma);
  const renew = coordinator.renew.bind(coordinator);
  let renewals = 0;
  const expired = t.mock.method(SheetImportCoordinator.prototype, "renew", async (lease: Parameters<typeof renew>[0]): Promise<void> => {
    if (lease.connectorId === manual.id && ++renewals === 2) {
      await client.sheetImportConnector.update({ where: { id: manual.id }, data: { leaseUntil: new Date(Date.now() - 1), nextRunAt: new Date(Date.now() - 1) } });
      throw new Error("sheet_lease_lost");
    }
    await renew(lease);
  });
  await assert.rejects(first.worker.execute(manual.id, "SCHEDULED"), /sheet_lease_lost/u);
  expired.mock.restore();
  const partial = await client.sheetImportRun.findFirstOrThrow({ where: { connectorId: manual.id } });
  assert.equal(partial.trigger, "MANUAL", "scheduler consumes explicit manual request without enabling automatic connector");
  assert.equal(partial.status, "RUNNING"); assert.equal(partial.createdCount, 1);
  assert.equal(await client.lead.count({ where: { email: manualEmail } }), 1);
  assert.equal(await client.lead.count({ where: { email: secondEmail } }), 0);
  const queued = await client.sheetImportConnector.findUniqueOrThrow({ where: { id: manual.id } });
  assert.equal(queued.enabled, false); assert.equal(queued.manualRequested, false);
  await other.worker.execute(manual.id, "SCHEDULED");
  const resumed = await client.sheetImportRun.findUniqueOrThrow({ where: { id: partial.id } });
  assert.equal(resumed.status, "COMPLETED"); assert.equal(resumed.trigger, "MANUAL"); assert.equal(resumed.createdCount, 2);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: manual.id } }), 1);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { runId: partial.id } }), 2);
  assert.equal(await client.auditEvent.count({ where: { resourceId: manual.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 2);
  assert.equal(await client.lead.count({ where: { email: { in: [manualEmail, secondEmail] } } }), 2);
  assert.equal((await client.sheetImportConnector.findUniqueOrThrow({ where: { id: manual.id } })).enabled, false);
  await other.worker.execute(manual.id, "SCHEDULED");
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: manual.id } }), 1, "completed manual request does not activate subsequent scheduled imports");

  const noContact = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_nocontact_${marker}`, tab: "Synthétique", updatedBy: author.id,
    enabled: false, manualRequested: true, nextRunAt: new Date(Date.now() - 1), configuration } });
  raw = [columns, ["Synthetic", "No contact", "", ...row.slice(3)]];
  const leadsBeforeNoContact = await client.lead.count({ where: { campus: campus.code } });
  await first.worker.execute(noContact.id, "SCHEDULED");
  assert.equal(await client.lead.count({ where: { campus: campus.code } }), leadsBeforeNoContact);
  const noContactRow = await client.sheetLocalRow.findFirstOrThrow({ where: { streamId: sheetStreamId(noContact.workbookId, 0) } });
  assert.equal(noContactRow.status, "REVIEW"); assert.equal(noContactRow.errorCode, "CONTACT_IDENTITY_MISSING"); assert.equal(noContactRow.batchId, null);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: noContact.id, createdCount: 0, reviewCount: 1 } }), 1);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: noContact.id }, outcome: "REVIEW", errorCode: "CONTACT_IDENTITY_MISSING" } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: noContact.id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 0);

  for (const invalidRaw of [[], [["First", "First", "Email", "Campus", "Program", "Education", "Campaign"]]]) {
    const broken: SheetImportConnector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_headers_${randomUUID()}`, tab: "Synthétique", updatedBy: author.id,
      enabled: false, manualRequested: true, nextRunAt: new Date(Date.now() - 1), configuration } });
    raw = invalidRaw;
    await first.worker.execute(broken.id, "SCHEDULED");
    const stream: SheetLocalStream = await client.sheetLocalStream.findUniqueOrThrow({ where: { id: sheetStreamId(broken.workbookId, 0) } });
    assert.equal(stream.suspended, true); assert.equal(stream.errorCode, "headers_invalid");
    assert.equal(await client.sheetImportRun.count({ where: { connectorId: broken.id, status: "FAILED", errorCode: "sheet_reconciliation_required", trigger: "MANUAL" } }), 1);
    assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: broken.id } } }), 0);
    assert.equal(await client.ingestionBatch.count({ where: { actorId: `SYSTEM:SHEETS:${broken.id}` } }), 0);
    assert.equal(await client.auditEvent.count({ where: { resourceId: broken.id, eventType: "SHEET_RECONCILIATION_REQUIRED" } }), 1);
  }

  const denied = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_revoked_${marker}`, tab: "Synthétique", updatedBy: author.id,
    enabled: false, manualRequested: true, nextRunAt: new Date(Date.now() - 1), configuration } });
  const revokedSource: SheetSource = { read: async (): Promise<SheetValues> => {
    await client.collaborator.update({ where: { id: author.id }, data: { active: false } });
    return { columns, rows: [Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""]))], observation: { sheetId: 0, range: "A1:G6", values: [columns, row] } };
  } };
  await assert.rejects(executor(second, revokedSource).worker.execute(denied.id, "SCHEDULED"), /sheet_authority_revoked/u);
  assert.equal(await client.sheetLocalStream.count({ where: { id: sheetStreamId(denied.workbookId, 0) } }), 0, "revocation during external read is re-evaluated before local observation");
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: denied.id } } }), 0);
  assert.equal(await client.auditEvent.count({ where: { resourceId: denied.id } }), 0);
});

for (const secondIdentity of ["LOCAL_ROW", "EXTERNAL_ID"] as const) {
test(`CRMY-171 LOCAL_ROW / ${secondIdentity} concurrent distinct sources preserve one contact and two provenances`, { skip: process.env.CRMY171_EPHEMERAL_TEST !== "true", timeout: 60_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy171_synthetic");
  const prisma = new PrismaService(), second = new PrismaService();
  const cleanup: { removeGate?: () => Promise<void> } = {};
  t.after(async (): Promise<void> => {
    try { await cleanup.removeGate?.(); } finally { await prisma.onModuleDestroy(); await second.onModuleDestroy(); }
  });
  const client = prisma.client; assert.ok(client);
  const marker = randomUUID().replaceAll("-", "");
  const gateKey = Number.parseInt(marker.slice(0, 7), 16);
  const gateFunction = `synthetic_contact_gate_${marker}`;
  const email = `synthetic-source-race-${marker}@example.invalid`;
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYN-RACE-${kind}-${marker.slice(0, 8)}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL",
      keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs; assert.ok(campus && program && campaign);
  await client.crmProgramAvailability.create({ data: { campusId: campus.id, programId: program.id } });
  const author = await client.collaborator.create({ data: { professionalEmail: `synthetic-race-admin-${marker}@example.invalid`,
    roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const columns = ["First", "Last", "Email"];
  const reads = new Map<string, number>();
  const source: SheetSource = { read: (workbookId: string): Promise<SheetValues> => {
    reads.set(workbookId, (reads.get(workbookId) ?? 0) + 1);
    if (secondIdentity === "EXTERNAL_ID" && workbookId.endsWith("_second")) return Promise.resolve({ columns: [...columns, "Submission"],
      rows: [{ First: "Lead", Last: "Concurrence synthétique", Email: email, Submission: `synthetic-${marker}` }] });
    return Promise.resolve({ columns, rows: [],
      observation: { sheetId: 0, range: "A1:C6", values: [columns, ["Lead", "Concurrence synthétique", email]] } });
  } };
  const first = executor(prisma, source), other = executor(second, source);
  const mapping = first.mappings.snapshot({ mappingKey: `synthetic-race-${marker.slice(0, 8)}`, name: "Concurrence synthétique", profile: "CUSTOM", expectedVersion: 0,
    columns: [{ sourceColumn: "First", targetField: "firstName", action: "TRIM", required: true },
      { sourceColumn: "Last", targetField: "lastName", action: "TRIM", required: true },
      { sourceColumn: "Email", targetField: "email", action: "LOWERCASE", required: true }] }, author.id, new Date().toISOString());
  const configuration = { mapping: { ...mapping, columns: mapping.columns.map((column) => ({ ...column })) }, assignment: { strategy: "UNASSIGNED" },
    source: { mode: "SIMULATED", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:C6" },
    context: { source: "OTHER_CONTROLLED", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic concurrency",
      campus: campus.code, program: program.code, campaign: campaign.code, educationLevel: "BAC" } };
  const externalMapping = first.mappings.snapshot({ mappingKey: `synthetic-ext-${marker.slice(0, 8)}`, name: "Concurrence synthétique", profile: "FORMINATOR_ZAPIER", expectedVersion: 0,
    columns: [...mapping.columns, { sourceColumn: "Submission", targetField: "externalId", action: "TRIM", required: true }] }, author.id, new Date().toISOString());
  const externalConfiguration = { ...configuration, mapping: { ...externalMapping, columns: externalMapping.columns.map((column) => ({ ...column })) },
    source: { mode: "SIMULATED", identityMode: "EXTERNAL_ID" }, context: { ...configuration.context, source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR" } };
  const connectors = await Promise.all(["first", "second"].map((suffix) => client.sheetImportConnector.create({ data: {
    campusId: campus.id, workbookId: `synthetic_race_${marker}_${suffix}`, tab: "Synthétique", updatedBy: author.id,
    enabled: suffix === "second" && secondIdentity === "EXTERNAL_ID", manualRequested: true, nextRunAt: new Date(Date.now() - 1),
    configuration: suffix === "second" && secondIdentity === "EXTERNAL_ID" ? externalConfiguration : configuration } })));
  const [one, two] = connectors; assert.ok(one && two);

  // Test-only PostgreSQL gate before the actual Lead INSERT: both identity lookups
  // have already executed. A future contact lock may instead park the second worker
  // before its lookups. Neither case bypasses real authorization or transactions.
  await client.$executeRawUnsafe(`CREATE FUNCTION "${gateFunction}"() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.email = '${email}' THEN PERFORM pg_advisory_xact_lock(172, ${gateKey}); END IF; RETURN NEW; END $body$`);
  await client.$executeRawUnsafe(`CREATE TRIGGER "${gateFunction}" BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION "${gateFunction}"()`);
  cleanup.removeGate = async (): Promise<void> => {
    await client.$executeRawUnsafe(`DROP TRIGGER "${gateFunction}" ON leads`);
    await client.$executeRawUnsafe(`DROP FUNCTION "${gateFunction}"()`);
  };
  const pids = new Set<number>();
  const transactionFailures: string[] = [];
  for (const item of [first, other]) {
    const persist = item.ingestion.persistSheetRecord.bind(item.ingestion);
    t.mock.method(item.ingestion, "persistSheetRecord", async (...args: Parameters<typeof persist>): ReturnType<typeof persist> => {
      const [connection] = await args[0].$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      assert.ok(connection); pids.add(connection.pid);
      try { return await persist(...args); }
      catch (error) {
        const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "no_code";
        const meta = error !== null && typeof error === "object" && "meta" in error ? error.meta : undefined;
        const sqlState = meta !== null && typeof meta === "object" && "code" in meta ? String(meta.code) : "no_sqlstate";
        transactionFailures.push(`${code}:${sqlState}`);
        throw error;
      }
    });
  }
  let unlock: () => void = (): void => undefined;
  let ready: () => void = (): void => undefined;
  const released = new Promise<void>((resolve) => { unlock = resolve; });
  const held = new Promise<void>((resolve) => { ready = resolve; });
  const holder = client.$transaction(async (tx): Promise<void> => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(172, ${gateKey}::integer)`; ready(); await released; }, { timeout: 20_000 });
  await Promise.race([held, holder]);
  const work = [first.worker.execute(one.id, "SCHEDULED"), other.worker.execute(two.id, "SCHEDULED")];
  // Register rejection handlers while the deterministic gate is held.
  const settled = Promise.allSettled(work);
  let gateFailure: string | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      if (pids.size >= 2) {
        const [waiting] = await client.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid IN (${Prisma.join([...pids])}) AND wait_event = 'advisory'`);
        if (waiting?.count === 2) break;
      }
      if (attempt >= 200) {
        const states = pids.size === 0 ? [] : await client.$queryRaw<Array<{ pid: number; wait_event: string | null; state: string }>>(Prisma.sql`SELECT pid, wait_event, state FROM pg_stat_activity WHERE pid IN (${Prisma.join([...pids])})`);
        gateFailure = `synthetic_contact_concurrency_gate_not_reached:${JSON.stringify(states)}`;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  } finally { unlock(); await holder; await settled; }
  assert.deepEqual((await settled).map((result) => result.status === "fulfilled" ? "fulfilled" : String(result.reason)), ["fulfilled", "fulfilled"], `${gateFailure ?? "gate_reached"}; transaction failures=${transactionFailures.join(",")}`);
  assert.equal(reads.get(one.workbookId), 1, "transaction retry must not repeat the first external source read");
  assert.equal(reads.get(two.workbookId), 1, "transaction retry must not repeat the second external source read");
  assert.equal(await client.lead.count({ where: { email } }), 1, "two source positions for one concurrent contact must not create duplicate Leads");
  const lead = await client.lead.findFirstOrThrow({ where: { email } });
  assert.equal(lead.assignedToId, null, "concurrent provenance attachment must not assign the Lead");
  assert.equal(await client.auditEvent.count({ where: { resourceId: lead.id, eventType: "LEAD_ASSIGNED" } }), 0);
  assert.equal(await client.leadProvenance.count({ where: { leadId: lead.id } }), 2);
  assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: { in: [one.id, two.id] } } } }), 2);
  assert.equal(await client.auditEvent.count({ where: { resourceId: { in: [one.id, two.id] }, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 2);
  assert.equal(gateFailure, undefined);
});
}
