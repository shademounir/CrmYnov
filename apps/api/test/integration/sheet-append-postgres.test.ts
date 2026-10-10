import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { deriveSecret, digestRecoveryValue } from "../../src/access-recovery/access-recovery.store.js";
import type { Principal } from "../../src/auth/auth.types.js";
import { DynamicPermissionRepository } from "../../src/permissions/dynamic-repository.js";
import { referenceKey } from "../../src/references/reference.contract.js";
import { BootstrapImportService } from "../../src/bootstrap-import/bootstrap-import.service.js";
import { PersistentIngestionService } from "../../src/ingestion/persistent-ingestion.service.js";
import { ImportMappingService } from "../../src/import-mapping/import-mapping.service.js";
import { SyntheticSheetSource } from "../../src/sheet-import/synthetic-sheet-source.js";
import { SheetImportAdminService } from "../../src/sheet-import/sheet-import-admin.service.js";
import { SheetImportExecutor } from "../../src/sheet-import/sheet-import-executor.js";
import { readSheetConfiguration, type SheetConfiguration } from "../../src/sheet-import/sheet-import-configuration.js";
import type { SheetValues } from "../../src/sheet-import/google-sheets-adapter.js";
import { APPEND_MODE, APPEND_POLICY, appendHash, appendPositions } from "../../src/sheet-import/sheet-append-contract.js";
import { appendRows, appendStream } from "../../src/sheet-import/sheet-append-ledger.js";
import { appendBootstrapProofHash, type SheetAppendQualificationArtifact } from "../../src/sheet-import/sheet-append-qualification.js";
import { sheetStreamId } from "../../src/sheet-import/sheet-local-ledger.js";
import { bytesHash, CHUNK_BYTES, HISTORICAL_SHEETS } from "../../src/bootstrap-import/bootstrap-import.contract.js";
import { syntheticHistoricalParts, syntheticZip } from "../fixtures/import/historical-workbook.synthetic.js";

const enabled = process.env.CRMY63_APPEND_EPHEMERAL_TEST === "true";
const errorCode = (error: unknown): string => error instanceof HttpException ? String((error.getResponse() as { code?: string }).code) : error instanceof Error ? error.message : "unknown";
class AppendFixtureSource extends SyntheticSheetSource {
  reads = 0; afterRead?: () => Promise<void>;
  constructor(public raw: string[][], private readonly range: string) { super(); }
  override async read(): Promise<SheetValues> {
    this.reads++; const values = structuredClone(this.raw), columns = values[0]!;
    await this.afterRead?.();
    return { columns, rows: values.slice(1).map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""]))), observation: { sheetId: 0, range: this.range, values } };
  }
}

test("CRMY-63 append PostgreSQL: immutable boundary, qualification, durable queue, row isolation, leases and replay", { skip: !enabled, timeout: 180000 }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid"), nonce = process.env.CRMY63_APPEND_DATABASE_NONCE;
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmy63_append_synthetic");
  assert.match(nonce ?? "", /^[a-f0-9-]{36}$/u);
  const original = { ...process.env }; process.env.CRM_BACKGROUND_WORKERS = "external"; process.env.SHEETS_ENABLED = "false"; process.env.SHEET_ROW_APPEND_ENABLED = "false"; process.env.FORMINATOR_WEBHOOK_ENABLED = "false";
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  const prisma = app.get(PrismaService), client = prisma.client!, permissions = app.get(DynamicPermissionRepository), bootstrap = app.get(BootstrapImportService), mappings = app.get(ImportMappingService);
  const directory = await mkdtemp(join(process.env.CRMY63_APPEND_ARTIFACT_ROOT ?? tmpdir(), "crmy63-append-synthetic-proof-"));
  const origin = await app.getUrl(), tag = randomUUID().slice(0, 8);
  try {
    const marker = await client.$queryRaw<Array<{ nonce: string; purpose: string }>>`SELECT nonce,purpose FROM crmy63_append_test_identity.marker`;
    assert.equal(marker.length, 1); assert.equal(marker[0]?.nonce, nonce); assert.equal(marker[0]?.purpose, "sheet-row-append-synthetic-qualification");
    const reference = async (kind: string): Promise<{ id: string; code: string }> => {
      const row = await client.crmReference.create({ data: { kind, code: `APPEND-${kind}-${tag}`, label: `Synthetic append ${kind}`, scope: "GLOBAL", scopeKey: "GLOBAL" } });
      await client.crmReferenceKey.create({ data: { referenceId: row.id, kind, scopeKey: "GLOBAL", key: referenceKey(row.code) } }); return row;
    };
    const campus = await reference("CAMPUS"), campaign = await reference("CAMPAIGN"), program = await reference("PROGRAM");
    await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id, active: true } });
    const password = `Synthetic!${randomBytes(12).toString("hex")}`, email = `append-${tag}@example.invalid`, salt = randomBytes(16).toString("hex");
    const user = await client.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: "Synthetic append operator", roles: ["SUPER_ADMIN"], campusId: campus.id, active: true, firstLoginRequired: false } });
    await client.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    const login = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 201); const session = await login.json() as { sessionId: string; token: string };
    const actor: Principal = { userId: user.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: session.sessionId };
    const delegation = { creatorId: user.id, authorizedBy: user.id, creatorAuthenticationVersion: user.authenticationVersion, authorizerAuthenticationVersion: user.authenticationVersion };
    const artifact = async (name: string, value: unknown, environmentKey: string): Promise<string> => {
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`), path = join(directory, `${name}.json`), sha = bytesHash(bytes);
      await writeFile(path, bytes, { flag: "wx" }); process.env[`${environmentKey}_FILE`] = path; process.env[`${environmentKey}_SHA256`] = sha; return sha;
    };
    const fixture = async (name: string): Promise<{ id: string; packId: string; streamId: string; configuration: SheetConfiguration; source: AppendFixtureSource; admin: SheetImportAdminService; worker: SheetImportExecutor }> => {
      const bytes = syntheticZip(syntheticHistoricalParts({ workbookExtra: `<definedNames data-append="${tag}-${name}"/>` })), sha256 = bytesHash(bytes);
      let pack = await bootstrap.create({ fileName: "append-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `append-${tag}-${name}` }, actor) as { id: string; version: number };
      for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK_BYTES) { const chunk = bytes.subarray(offset, offset + CHUNK_BYTES); pack = await bootstrap.chunk(pack.id, { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) }, actor) as typeof pack; }
      pack = await bootstrap.seal(pack.id, { sha256 }, actor) as typeof pack;
      pack = await bootstrap.mapping(pack.id, { expectedVersion: pack.version, mappingVersion: "R8-v1", sheets: HISTORICAL_SHEETS.map((sheet) => ({ name: sheet, campaign: campaign.code,
        fields: { lastName: "A", firstName: "B", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" }, commentColumns: ["I"], ownerAliases: {} })) }, actor) as typeof pack;
      const rows = await bootstrap.rows(pack.id, undefined, 50, actor) as { items: Array<{ id: string; version: number }> };
      for (const row of rows.items) await bootstrap.decide(pack.id, row.id, { expectedVersion: row.version, idempotencyKey: `append-ignore-${row.id}`, action: "IGNORE", reason: "Explicit synthetic-only exclusion to qualify append bootstrap guard" }, actor);
      await bootstrap.confirm(pack.id, { expectedVersion: pack.version, idempotencyKey: `append-confirm-${tag}-${name}`, confirmed: true, limit: 25 }, actor);
      const columns = [{ sourceColumn: "First", targetField: "firstName" as const, action: "TRIM" as const }, { sourceColumn: "Last", targetField: "lastName" as const, action: "TRIM" as const },
        { sourceColumn: "Email", targetField: "email" as const, action: "LOWERCASE" as const }, { sourceColumn: "Education", targetField: "educationLevel" as const, action: "TRIM" as const },
        { sourceColumn: "Program", targetField: "program" as const, action: "TRIM" as const }, { sourceColumn: "WhatsApp", action: "METADATA" as const, reason: "Private original metadata, never occurrence identity" }];
      const configuration = readSheetConfiguration({ source: { mode: "SIMULATED", identityMode: APPEND_MODE, sheetId: 0, range: "A1:CV10001" },
        mapping: mappings.snapshot({ mappingKey: `append-${tag}-${name}`, name: "Synthetic append", profile: "CUSTOM", expectedVersion: 0, columns }, user.id, new Date().toISOString()),
        context: { source: "WEB_FORM", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic declared channel", campus: campus.code, campaign: campaign.code }, assignment: { strategy: "UNASSIGNED" } });
      const source = new AppendFixtureSource([columns.map((column) => column.sourceColumn), ["Synthetic", "Old", `old-${name}-${tag}@example.invalid`, "BAC", program.code, ""]], configuration.source!.range!);
      const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_append_${tag}_${name}`, tab: "SYNTHETIC", configuration: configuration as unknown as Prisma.InputJsonValue, updatedBy: user.id } });
      const admin = new SheetImportAdminService(permissions, mappings, source, bootstrap), worker = new SheetImportExecutor(prisma, permissions, mappings, app.get(PersistentIngestionService), source, bootstrap);
      await artifact(`boundary-${name}`, { schemaVersion: 1, mode: APPEND_MODE, workbookId: connector.workbookId, sheetId: 0, tab: connector.tab, generation: randomUUID(), range: configuration.source!.range,
        capturedAt: "2026-01-01T00:00:00.000Z", boundaryRow: 2, values: source.raw }, "CRM_SHEET_APPEND_BOUNDARY");
      await admin.appendBoundary(actor, connector.id, { expectedVersion: 1, confirmed: true });
      const streamId = sheetStreamId(connector.workbookId, 0), stream = await permissions.readTransaction((tx) => appendStream(tx, streamId));
      const report = await permissions.readTransaction((tx) => bootstrap.reportCutoverRuntime(tx, pack.id, delegation, streamId, false));
      assert.equal((report as { cutoverBlocked: boolean }).cutoverBlocked, false);
      const qualification: SheetAppendQualificationArtifact = { schemaVersion: 1, mode: APPEND_MODE, policy: APPEND_POLICY,
        boundaryArtifactSha256: stream!.contract!.artifactSha256, bootstrapPackageId: pack.id, excelSha256: sha256, reportSha256: appendBootstrapProofHash(report),
        bindingSha256: stream!.contract!.bindingSha256, evidenceSha256: "a".repeat(64), qualifiedAt: "2026-01-01T00:00:01.000Z", producerCondition: { confirmedAt: "2026-01-01T00:00:00.000Z", evidenceSha256: "b".repeat(64) } };
      await artifact(`qualification-${name}`, qualification, "CRM_SHEET_APPEND_QUALIFICATION");
      return { id: connector.id, packId: pack.id, streamId, configuration, source, admin, worker };
    };
    const rowsFor = async (streamId: string): Promise<Awaited<ReturnType<typeof appendRows>>> => permissions.readTransaction((tx) => appendRows(tx, streamId));
    const business = async (): Promise<unknown> => ({ leads: await client.lead.count(), provenance: await client.leadProvenance.count(), batches: await client.ingestionBatch.count(), reports: await client.importReport.count(),
      processedAudits: await client.auditEvent.count({ where: { eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), reviews: await client.auditEvent.count({ where: { eventType: "SHEET_IMPORT_ROW_REVIEWED" } }), receipts: await client.sheetImportRunReceipt.count() });
    const row = (name: string, education = "BAC", metadata = ""): string[] => ["Synthetic", name, `${name}-${tag}@example.invalid`, education, program.code, metadata];
    const main = await fixture("main"), beforeOff = await business();
    await main.worker.execute(main.id, "MANUAL"); assert.equal(main.source.reads, 0); assert.deepEqual(await business(), beforeOff);
    await assert.rejects(() => main.admin.appendBoundary(actor, main.id, { expectedVersion: 1, confirmed: true, boundaryRow: 999 }), (error: unknown) => errorCode(error) === "sheet_append_confirmation_required");
    const unauthorized = await fetch(`${origin}/scheduled-sheets/${main.id}/append-reconciliation`); assert.equal(unauthorized.status, 401);
    await main.admin.qualifyAppend(actor, main.id, { expectedVersion: 1, confirmed: true });
    await main.admin.qualifyAppend(actor, main.id, { expectedVersion: 1, confirmed: true });
    assert.equal(await client.auditEvent.count({ where: { resourceId: main.id, eventType: "SHEET_APPEND_QUALIFIED" } }), 1);
    main.source.raw.push(row("created"), row("partial", ""), row("metadata", "BAC", "+212600000000"), row("following"), row("created"));
    await main.admin.observeAppend(actor, main.id, { expectedVersion: 1, confirmed: true }); assert.deepEqual(await business(), beforeOff);
    assert.equal((await rowsFor(main.streamId)).length, 5);
    // Completion before the first business worker is safe only for empty cells.
    main.source.raw[3]![3] = "BAC"; await main.admin.observeAppend(actor, main.id, { expectedVersion: 1, confirmed: true });
    main.source.raw.push(row("incomplete", "")); await main.admin.observeAppend(actor, main.id, { expectedVersion: 1, confirmed: true });
    process.env.SHEETS_ENABLED = "true"; process.env.SHEET_ROW_APPEND_ENABLED = "true"; process.env.CRM_SHEET_APPEND_POLICY_QUALIFIED = "true";
    await main.admin.requestRun(actor, main.id, 1);
    await Promise.all([main.worker.execute(main.id, "MANUAL"), main.worker.execute(main.id, "MANUAL")]);
    const persisted = await rowsFor(main.streamId);
    assert.deepEqual(persisted.map((entry) => entry.status), ["CREATED", "CREATED", "REVIEW", "CREATED", "REVIEW", "INCOMPLETE"]);
    assert.equal(await client.lead.count({ where: { campus: campus.code } }), 3);
    assert.equal(await client.leadProvenance.count({ where: { technicalSystem: "GOOGLE_SHEETS_LOCAL", occurredAt: { not: null } } }), 0);
    const projection = await main.admin.appendReconciliation(actor, main.id) as { lastConfirmedRow: number; producerConditionConfirmed: boolean; counts: { incomplete: number }; notCoverageCursor: boolean };
    assert.equal(projection.lastConfirmedRow, 6); assert.equal(projection.counts.incomplete, 1); assert.equal(projection.producerConditionConfirmed, true); assert.equal(projection.notCoverageCursor, true);
    const replayBefore = await business(); await main.admin.requestRun(actor, main.id, 1); await main.worker.execute(main.id, "MANUAL"); assert.deepEqual(await business(), replayBefore);
    main.source.raw[7]![3] = "BAC"; await main.admin.requestRun(actor, main.id, 1); await main.worker.execute(main.id, "MANUAL"); assert.equal(await client.lead.count({ where: { campus: campus.code } }), 4);
    const stableCount = await business(); main.source.raw[2]![1] = "Changed confirmed"; main.source.raw.push(row("quarantined-tail"));
    const simulation = await main.admin.simulate(actor, main.id); assert.equal(simulation.reconciliationRequired, true); assert.equal(simulation.mapped, 0);
    await main.admin.requestRun(actor, main.id, 1); await main.worker.execute(main.id, "MANUAL");
    assert.deepEqual(await business(), stableCount); const suspended = await permissions.readTransaction((tx) => appendStream(tx, main.streamId)); assert.equal(suspended?.suspended, true);
    assert.equal((await rowsFor(main.streamId)).at(-1)?.status, "REVIEW");
    const changedVersions = await client.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM sheet_append_observations WHERE stream_id=${main.streamId} AND row_number=3`;
    assert.equal(changedVersions[0]?.count, 2);
    assert.equal(await client.auditEvent.count({ where: { resourceId: main.id, eventType: "SHEET_APPEND_SUSPENDED" } }), 1);
    // Trusted bootstrap corruption refuses before any source I/O/effect.
    const guarded = await fixture("guarded");
    await assert.rejects(() => guarded.admin.requestRun(actor, guarded.id, 1), (error: unknown) => errorCode(error) === "sheet_append_qualification_required"); assert.equal(guarded.source.reads, 0);
    await guarded.admin.qualifyAppend(actor, guarded.id, { expectedVersion: 1, confirmed: true });
    const receipt = await client.bootstrapImportReceipt.findFirstOrThrow({ where: { packageId: guarded.packId, operation: "COMMIT_ROW" } });
    await client.bootstrapImportReceipt.update({ where: { id: receipt.id }, data: { fingerprint: "0".repeat(64) } });
    await assert.rejects(() => guarded.admin.requestRun(actor, guarded.id, 1), (error: unknown) => errorCode(error) === "sheet_append_bootstrap_reconciliation_required"); assert.equal(guarded.source.reads, 0);
    await client.bootstrapImportReceipt.update({ where: { id: receipt.id }, data: { fingerprint: receipt.fingerprint } });
    await guarded.admin.requestRun(actor, guarded.id, 1); guarded.source.afterRead = async (): Promise<void> => { await client.collaborator.update({ where: { id: user.id }, data: { active: false } }); };
    await assert.rejects(() => guarded.worker.execute(guarded.id, "MANUAL")); assert.equal((await rowsFor(guarded.streamId)).length, 0);
    await client.collaborator.update({ where: { id: user.id }, data: { active: true } });
    // Observation commits first. A later business fault rolls back ALL effects,
    // not the durable queue; a fresh worker can then resume exactly once.
    const interrupted = await fixture("interrupted"); await interrupted.admin.qualifyAppend(actor, interrupted.id, { expectedVersion: 1, confirmed: true });
    interrupted.source.raw.push(row("transaction-fault")); const beforeFault = await business();
    const ingestion = app.get(PersistentIngestionService), persist = ingestion.persistSheetRecord.bind(ingestion);
    ingestion.persistSheetRecord = async (...args: Parameters<PersistentIngestionService["persistSheetRecord"]>): Promise<Awaited<ReturnType<PersistentIngestionService["persistSheetRecord"]>>> => {
      await persist(...args); throw new Error("synthetic fault before transaction commit");
    };
    try { await interrupted.admin.requestRun(actor, interrupted.id, 1); await assert.rejects(() => interrupted.worker.execute(interrupted.id, "MANUAL"), /sheet_execution_failed/u); }
    finally { ingestion.persistSheetRecord = persist; }
    assert.deepEqual(await business(), beforeFault); assert.equal((await rowsFor(interrupted.streamId))[0]?.status, "PENDING");
    await interrupted.admin.requestRun(actor, interrupted.id, 1); await interrupted.worker.execute(interrupted.id, "MANUAL");
    assert.equal((await rowsFor(interrupted.streamId))[0]?.status, "CREATED");
    assert.equal(await client.lead.count({ where: { email: `transaction-fault-${tag}@example.invalid` } }), 1);
    const afterResume = await business(); await interrupted.admin.requestRun(actor, interrupted.id, 1); await interrupted.worker.execute(interrupted.id, "MANUAL"); assert.deepEqual(await business(), afterResume);
    // Bounded bulk observation progresses without 2 SQL round trips per row.
    // This is an observation capacity sample, not 1,000 acquisition mutations.
    const backlog = await fixture("backlog"); for (let index = 0; index < 1000; index++) backlog.source.raw.push(row(`queue-${index}`));
    const beforeBacklog = await business(), backlogStarted = performance.now();
    await backlog.admin.observeAppend(actor, backlog.id, { expectedVersion: 1, confirmed: true }); const backlogDurationMs = performance.now() - backlogStarted;
    assert.equal((await rowsFor(backlog.streamId)).length, 1000); assert.deepEqual(await business(), beforeBacklog);
    await backlog.admin.observeAppend(actor, backlog.id, { expectedVersion: 1, confirmed: true });
    const versions = await client.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM sheet_append_observations WHERE stream_id=${backlog.streamId}`;
    assert.equal(versions[0]?.count, 1000); assert.deepEqual(await business(), beforeBacklog);
    // The exact artifact replays; another generation cannot replace N0.
    const rebased = await fixture("rebase"); const registered = await rebased.admin.appendReconciliation(actor, rebased.id);
    await rebased.admin.appendBoundary(actor, rebased.id, { expectedVersion: 1, confirmed: true }); assert.deepEqual(await rebased.admin.appendReconciliation(actor, rebased.id), registered);
    const fake = { schemaVersion: 1, mode: APPEND_MODE, workbookId: `synthetic_append_${tag}_rebase`, sheetId: 0, tab: "SYNTHETIC", generation: randomUUID(), range: rebased.configuration.source!.range, capturedAt: "2026-01-01T00:00:00.000Z", boundaryRow: 2, values: rebased.source.raw };
    await artifact("rebaseline-refused", fake, "CRM_SHEET_APPEND_BOUNDARY");
    await assert.rejects(() => rebased.admin.appendBoundary(actor, rebased.id, { expectedVersion: 1, confirmed: true }), (error: unknown) => errorCode(error) === "sheet_append_rebaseline_refused");
    assert.equal(appendPositions(rebased.configuration.source!.range!, rebased.source.raw).lastOccupiedRow, 2);
    assert.match(appendHash(registered), /^[a-f0-9]{64}$/u);
    console.log(JSON.stringify({ proof: "sheet-append-postgres", syntheticOnly: true, mode: APPEND_MODE, boundaryExcluded: true, producerAttested: false, qualifiedFixtureOnly: true, noRealActivation: true,
      assertions: ["flags-off-zero-io", "server-boundary-and-no-rebaseline", "missing-qualification-refused", "qualification-replay", "durable-observation-zero-business", "pending-completion", "concurrent-workers", "row-content-isolation", "contact-match-review", "incomplete-resume", "no-duplicate-effects", "simulation-coherence", "conflicting-tail-quarantined", "bootstrap-receipt-corruption-refused", "authority-revoked-after-io", "transaction-fault-durable-resume", "bulk-1000-positions-replay"], backlogDurationMs, privateProofDirectory: directory }));
  }
  finally { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); await app.close(); }
});
