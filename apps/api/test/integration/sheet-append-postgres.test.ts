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
import { DynamicPermissionService } from "../../src/permissions/dynamic-service.js";
import { referenceKey } from "../../src/references/reference.contract.js";
import { BootstrapImportService } from "../../src/bootstrap-import/bootstrap-import.service.js";
import { PersistentIngestionService } from "../../src/ingestion/persistent-ingestion.service.js";
import { ImportMappingService, type ImportMappingColumnInput } from "../../src/import-mapping/import-mapping.service.js";
import { SyntheticSheetSource } from "../../src/sheet-import/synthetic-sheet-source.js";
import { SheetImportAdminService } from "../../src/sheet-import/sheet-import-admin.service.js";
import { SheetImportExecutor } from "../../src/sheet-import/sheet-import-executor.js";
import { readSheetConfiguration, type SheetConfiguration } from "../../src/sheet-import/sheet-import-configuration.js";
import type { SheetValues } from "../../src/sheet-import/google-sheets-adapter.js";
import { APPEND_MODE, APPEND_POLICY, appendHash, appendPositions } from "../../src/sheet-import/sheet-append-contract.js";
import { appendRows, appendStream } from "../../src/sheet-import/sheet-append-ledger.js";
import { appendBootstrapProofHash, type SheetAppendQualificationArtifact } from "../../src/sheet-import/sheet-append-qualification.js";
import { BOUNDED_BOOTSTRAP_POLICY } from "../../src/bootstrap-import/bounded-bootstrap.js";
import { deferredHistoricalCollision } from "../../src/bootstrap-import/bootstrap-create-guards.js";
import { DEFERRED_RESERVATION_POLICY } from "../../src/sheet-import/sheet-append-qualification.js";
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
    const fixture = async (name: string, bounded = false): Promise<{ id: string; packId: string; streamId: string; configuration: SheetConfiguration; source: AppendFixtureSource; admin: SheetImportAdminService; worker: SheetImportExecutor; deferred?: { id: string; version: number } }> => {
      const parts = syntheticHistoricalParts({ workbookExtra: `<definedNames data-append="${tag}-${name}"/>` });
      // Preserve edge whitespace in the source BEFORE seal/DEFER. All three real
      // worker branches below must reserve the normalized email/name, while an
      // unmapped raw phone exercises the same PostgreSQL guard directly.
      const bytes = syntheticZip(bounded ? parts.map(([path, xml]): [string, string] => [path, path.startsWith("xl/worksheets/") ? xml
        .replaceAll("synthetic@example.invalid", "&#x9;&#xD;&#xA;synthetic@example.invalid&#xA0;")
        .replaceAll(">Synthétique</t>", ">&#xD;&#xA;Synthétique&#xFEFF;</t>")
        .replaceAll(">Exemple</t>", ">&#x9;Exemple&#xA0;</t>")
        .replace("</row></sheetData>", '<c r="L9" t="inlineStr"><is><t>&#xA0;&#xD;&#xA;+212 (6) 98.76-54 32&#x9;</t></is></c><c r="M9" t="inlineStr"><is><t>internal@exa&#x9;mple.invalid</t></is></c><c r="N9" t="inlineStr"><is><t>+21260&#xA0;1234567</t></is></c></row></sheetData>') : xml]) : parts), sha256 = bytesHash(bytes);
      let pack = await bootstrap.create({ fileName: "append-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `append-${tag}-${name}` }, actor) as { id: string; version: number };
      for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK_BYTES) { const chunk = bytes.subarray(offset, offset + CHUNK_BYTES); pack = await bootstrap.chunk(pack.id, { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) }, actor) as typeof pack; }
      pack = await bootstrap.seal(pack.id, { sha256 }, actor) as typeof pack;
      pack = await bootstrap.mapping(pack.id, { expectedVersion: pack.version, mappingVersion: "R8-v1", sheets: HISTORICAL_SHEETS.map((sheet) => ({ name: sheet, campaign: campaign.code,
        fields: { lastName: "A", firstName: "B", email: bounded ? "K" : "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" }, commentColumns: ["I"], ownerAliases: {} })) }, actor) as typeof pack;
      const rows = await bootstrap.rows(pack.id, undefined, 50, actor) as { items: Array<{ id: string; version: number }> };
      let deferred: { id: string; version: number } | undefined;
      for (const row of rows.items) {
        const defer = bounded && row.id === rows.items[0]!.id;
        const changed = await bootstrap.decide(pack.id, row.id, { expectedVersion: row.version, idempotencyKey: `append-${defer ? "defer" : "ignore"}-${row.id}`,
          action: defer ? "DEFER" : "IGNORE", ...(defer ? { confirmed: true as const } : {}), reason: defer ? "Explicit synthetic unresolved identity; raw contact and exact comments remain deferred" : "Explicit synthetic-only exclusion to qualify append bootstrap guard" }, actor) as { id: string; version: number };
        if (defer) deferred = changed;
      }
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
      assert.equal((report as { cutoverBlocked: boolean }).cutoverBlocked, bounded);
      const boundedReport = (report as { boundedReconciliation: { qualified: boolean; inventorySha256: string; deferredOccurrences: number; deferredWithoutUsableContact: number } }).boundedReconciliation;
      assert.equal(boundedReport.qualified, true);
      const qualification: SheetAppendQualificationArtifact = { schemaVersion: bounded ? 2 : 1, mode: APPEND_MODE, policy: APPEND_POLICY,
        boundaryArtifactSha256: stream!.contract!.artifactSha256, bootstrapPackageId: pack.id, excelSha256: sha256, reportSha256: appendBootstrapProofHash(report, bounded ? 2 : 1),
        bindingSha256: stream!.contract!.bindingSha256, evidenceSha256: "a".repeat(64), qualifiedAt: "2026-01-01T00:00:01.000Z", producerCondition: { confirmedAt: "2026-01-01T00:00:00.000Z", evidenceSha256: "b".repeat(64) } };
      if (bounded) qualification.boundedBootstrap = { policy: BOUNDED_BOOTSTRAP_POLICY, inventorySha256: boundedReport.inventorySha256,
        deferredOccurrences: boundedReport.deferredOccurrences, deferredWithoutUsableContact: boundedReport.deferredWithoutUsableContact, reservationPolicy: DEFERRED_RESERVATION_POLICY };
      await artifact(`qualification-${name}`, qualification, "CRM_SHEET_APPEND_QUALIFICATION");
      return { id: connector.id, packId: pack.id, streamId, configuration, source, admin, worker, ...(deferred ? { deferred } : {}) };
    };
    const rowsFor = async (streamId: string): Promise<Awaited<ReturnType<typeof appendRows>>> => permissions.readTransaction((tx) => appendRows(tx, streamId));
    const business = async (): Promise<unknown> => ({ leads: await client.lead.count(), provenance: await client.leadProvenance.count(), batches: await client.ingestionBatch.count(), reports: await client.importReport.count(),
      processedAudits: await client.auditEvent.count({ where: { eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), reviews: await client.auditEvent.count({ where: { eventType: "SHEET_IMPORT_ROW_REVIEWED" } }), receipts: await client.sheetImportRunReceipt.count() });
    const row = (name: string, education = "BAC", metadata = ""): string[] => ["Synthetic", name, `${name}-${tag}@example.invalid`, education, program.code, metadata];
    const main = await fixture("main");
    // Exercise the production HTTP middleware, RBAC and global interceptor, not
    // only direct service calls: all four reviewed split-phase handlers must be
    // reachable without granting any new role or campus capability.
    const routes = [
      { method: "GET", path: "append-reconciliation" },
      { method: "POST", path: "append-boundary" },
      { method: "POST", path: "append-qualification" },
      { method: "POST", path: "append-observations" },
    ];
    const http = async (route: typeof routes[number], id: string, token?: string): Promise<{ status: number; body: Record<string, unknown> }> => {
      const response = await fetch(`${origin}/scheduled-sheets/${id}/${route.path}`, {
        method: route.method, signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(route.method === "POST" ? { body: JSON.stringify({ confirmed: true, expectedVersion: 1 }) } : {}),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const readRoute = routes[0]!;
    const visible = await http(readRoute, main.id, session.token);
    assert.equal(visible.status, 200, JSON.stringify(visible.body));
    assert.equal(visible.body.boundaryRegistered, true);
    for (const route of routes) {
      const absent = await http(route, randomUUID(), session.token);
      assert.equal(absent.status, 404, `${route.path}: ${JSON.stringify(absent.body)}`);
      assert.equal(absent.body.code, "sheet_connector_not_found", "authorized HTTP reaches the resource-aware service");
      assert.equal((await http(route, main.id)).status, 401, "no anonymous append administration");
    }
    const adminEmail = `append-http-admin-${tag}@example.invalid`, adminSalt = randomBytes(16).toString("hex");
    const adminUser = await client.collaborator.create({ data: { professionalEmail: adminEmail, roles: ["ADMIN"], campusId: campus.id, active: true, firstLoginRequired: false } });
    await client.localPasswordHash.create({ data: { collaboratorId: adminUser.id, identityDigest: digestRecoveryValue(adminEmail), passwordSalt: adminSalt,
      passwordDigest: deriveSecret(password, adminSalt), mustChange: false } });
    const adminLogin = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, password }) });
    assert.equal(adminLogin.status, 201);
    const adminSession = await adminLogin.json() as { sessionId: string; token: string };
    assert.equal((await http(readRoute, main.id, adminSession.token)).status, 200, "Admin retains its own-campus capability");
    for (const route of routes) {
      const absent = await http(route, randomUUID(), adminSession.token);
      assert.equal(absent.status, 404); assert.equal(absent.body.code, "sheet_connector_not_found");
    }
    const outsideCampus = await client.crmReference.create({ data: { kind: "CAMPUS", code: `APPEND-OUTSIDE-${tag}`, label: "Synthetic outside campus", scope: "GLOBAL", scopeKey: "GLOBAL" } });
    await client.crmReferenceKey.create({ data: { referenceId: outsideCampus.id, kind: "CAMPUS", scopeKey: "GLOBAL", key: referenceKey(outsideCampus.code) } });
    await client.collaborator.update({ where: { id: adminUser.id }, data: { campusId: outsideCampus.id } });
    const auditBeforeDenied = await client.auditEvent.count();
    for (const route of routes) {
      const hidden = await http(route, main.id, adminSession.token), absent = await http(route, randomUUID(), adminSession.token);
      assert.equal(hidden.status, 404); assert.deepEqual(hidden, absent, "cross-campus resources disclose no existence");
    }
    for (const role of ["ADMISSIONS", "MANAGER", "AUDITOR"]) {
      await client.collaborator.update({ where: { id: adminUser.id }, data: { roles: [role], campusId: campus.id } });
      for (const route of routes) assert.equal((await http(route, main.id, adminSession.token)).status, 403, `${role} cannot administer ${route.path}`);
    }
    assert.equal(await client.auditEvent.count(), auditBeforeDenied, "denied HTTP calls emit no success audit");
    await client.collaborator.update({ where: { id: adminUser.id }, data: { roles: ["ADMIN"] } });
    const dynamic = app.get(DynamicPermissionService), target = { kind: "ROLE" as const, role: "ADMIN" as const, campus: campus.id };
    const initial = await dynamic.read(actor, target);
    await dynamic.save(actor, { ...target, expectedVersion: initial.version, grants: { ...initial.grants, "import.confirm": "NONE" }, confirmed: true, reason: "ACCESS_REVIEW" });
    assert.equal((await http(readRoute, main.id, adminSession.token)).status, 200, "read is not accidentally coupled to import confirmation");
    for (const route of routes.slice(1)) assert.equal((await http(route, main.id, adminSession.token)).status, 403, "current persisted mutation grant is required");
    const restricted = await dynamic.read(actor, target);
    await dynamic.save(actor, { ...target, expectedVersion: restricted.version, grants: { ...initial.grants, "import.view": "NONE" }, confirmed: true, reason: "ACCESS_REVIEW" });
    for (const route of routes) {
      const denied = await http(route, main.id, adminSession.token);
      assert.equal(denied.status, 404); assert.equal(denied.body.code, "sheet_connector_not_found");
    }
    const last = await dynamic.read(actor, target);
    await dynamic.save(actor, { ...target, expectedVersion: last.version, grants: initial.grants, confirmed: true, reason: "ACCESS_REVIEW" });
    assert.equal((await http(readRoute, main.id, adminSession.token)).status, 200);
    await client.localSession.update({ where: { id: adminSession.sessionId }, data: { active: false, revokedAt: new Date() } });
    for (const route of routes) assert.equal((await http(route, main.id, adminSession.token)).status, 401, "revoked session cannot use a newly allowlisted handler");
    const beforeOff = await business();
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
    // A trusted V2 inventory can keep unresolved identities/comments, without
    // disguising strict complete or letting Sheets duplicate that portfolio.
    const bounded = await fixture("bounded", true);
    const boundedReport = await bootstrap.report(bounded.packId, actor) as { cutoverBlocked: boolean; sourceCoverage: { complete: boolean }; reconciliation: { complete: boolean }; boundedReconciliation: { qualified: boolean; deferredOccurrences: number } };
    assert.equal(boundedReport.cutoverBlocked, true); assert.equal(boundedReport.reconciliation.complete, false); assert.equal(boundedReport.sourceCoverage.complete, false);
    assert.equal(boundedReport.boundedReconciliation.qualified, true); assert.equal(boundedReport.boundedReconciliation.deferredOccurrences, 1);
    await bounded.admin.qualifyAppend(actor, bounded.id, { expectedVersion: 1, confirmed: true });
    const whitespaceCollision = (email: string | null, phone: string | null): Promise<unknown> => permissions.readTransaction(tx => deferredHistoricalCollision(tx, {
      campusId: campus.id, email, phone, firstName: "Contradictory", lastName: "Whitespace identity" }));
    assert.equal(await whitespaceCollision(null, "+212698765432"), "sheet_append_deferred_contact_review", "NBSP/CRLF/tab around an unmapped raw phone use ECMAScript edge trimming");
    assert.equal(await whitespaceCollision("internal@example.invalid", null), null, "internal email tab is not stripped into a contact");
    assert.equal(await whitespaceCollision(null, "+212601234567"), null, "internal phone NBSP is not joined into a contact");
    const beforeBounded = { leads: await client.lead.count(), notes: await client.importedHistoricalNote.count(), provenance: await client.leadProvenance.count() };
    bounded.source.raw.push(["Contradictory", "Person", "synthetic@example.invalid", "BAC", program.code, ""], ["Exemple", "Synthétique", `other-name-${tag}@example.invalid`, "BAC", program.code, ""], row("bounded-independent"));
    await bounded.admin.requestRun(actor, bounded.id, 1); await bounded.worker.execute(bounded.id, "MANUAL");
    const boundedRows = await rowsFor(bounded.streamId);
    assert.deepEqual(boundedRows.map(value => value.status), ["REVIEW", "REVIEW", "CREATED"]);
    const boundedReasons = await client.sheetLocalRow.findMany({ where: { streamId: bounded.streamId }, select: { errorCode: true }, orderBy: { rowNumber: "asc" } });
    assert.equal(boundedReasons[0]!.errorCode, "sheet_append_deferred_contact_review"); assert.equal(boundedReasons[1]!.errorCode, "sheet_append_deferred_name_review");
    assert.equal(await client.lead.count(), beforeBounded.leads + 1); assert.equal(await client.importedHistoricalNote.count(), beforeBounded.notes);
    assert.equal(await client.leadProvenance.count(), beforeBounded.provenance + 1); assert.equal(await client.lead.count({ where: { email: "synthetic@example.invalid" } }), 0);
    const boundedAfter = await business(); await bounded.admin.requestRun(actor, bounded.id, 1); await bounded.worker.execute(bounded.id, "MANUAL"); assert.deepEqual(await business(), boundedAfter);
    // Exercise BOTH legacy production worker branches against the same actual
    // DEFERRED ledger, not only the shared SQL query or a mocked processRow.
    const legacyEffects = async (): Promise<{ leads: number; notes: number; provenance: number; batches: number; reports: number }> => ({
      leads: await client.lead.count(), notes: await client.importedHistoricalNote.count(), provenance: await client.leadProvenance.count(),
      batches: await client.ingestionBatch.count(), reports: await client.importReport.count() });
    const legacyWorkers: Array<{ mode: "LOCAL_ROW" | "EXTERNAL_ID"; id: string; source: AppendFixtureSource; run: () => Promise<void>; held: () => Promise<unknown>; initialHeld: unknown }> = [];
    for (const mode of ["LOCAL_ROW", "EXTERNAL_ID"] as const) {
      const local = mode === "LOCAL_ROW", slug = local ? "local" : "external";
      const columns: ImportMappingColumnInput[] = [
        { sourceColumn: "First", targetField: "firstName", action: "TRIM", required: true },
        { sourceColumn: "Last", targetField: "lastName", action: "TRIM", required: true },
        { sourceColumn: "Email", targetField: "email", action: "LOWERCASE" },
        { sourceColumn: "Education", targetField: "educationLevel", action: "TRIM", required: true },
        { sourceColumn: "Program", targetField: "program", action: "TRIM", required: true },
        ...(!local ? [{ sourceColumn: "Submission ID", targetField: "externalId" as const, action: "TRIM" as const, required: true }] : []),
      ];
      const range = local ? "A1:E3" : "A1:F3", externalId = `deferred-${slug}-${tag}`, independentId = `independent-${slug}-${tag}`;
      const configuration = readSheetConfiguration({ source: { mode: "SIMULATED", identityMode: mode, sheetId: 0, range },
        mapping: mappings.snapshot({ mappingKey: `deferred-${slug}-${tag}`, name: "Synthetic deferred legacy worker", profile: local ? "CUSTOM" : "FORMINATOR_ZAPIER", expectedVersion: 0, columns }, user.id, new Date().toISOString()),
        context: { source: "WEB_FORM", technicalSystem: local ? "GOOGLE_SHEETS_LOCAL" : "FORMINATOR_ZAPIER", originalSource: "Synthetic declared channel", campus: campus.code, campaign: campaign.code }, assignment: { strategy: "UNASSIGNED" } });
      const source = new AppendFixtureSource([columns.map(column => column.sourceColumn),
        ["Contradictory", `Legacy ${slug}`, "synthetic@example.invalid", "BAC", program.code, ...(!local ? [externalId] : [])],
        ["Synthetic", `Independent ${slug}`, `legacy-${slug}-${tag}@example.invalid`, "BAC", program.code, ...(!local ? [independentId] : [])]], range);
      // EXTERNAL_ID's existing manual request contract requires enabled=true;
      // only this nonce-owned synthetic connector is enabled, never a real source.
      const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_deferred_${slug}_${tag}`, tab: "SYNTHETIC", enabled: !local,
        configuration: configuration as unknown as Prisma.InputJsonValue, updatedBy: user.id } });
      const admin = new SheetImportAdminService(permissions, mappings, source, bootstrap), worker = new SheetImportExecutor(prisma, permissions, mappings, app.get(PersistentIngestionService), source, bootstrap);
      const run = async (): Promise<void> => { await admin.requestRun(actor, connector.id, 1); await worker.execute(connector.id, "MANUAL"); };
      const held = (): Promise<unknown> => local
        ? client.sheetLocalRow.findUniqueOrThrow({ where: { streamId_rowNumber: { streamId: sheetStreamId(connector.workbookId, 0), rowNumber: 2 } }, select: { id: true, status: true, fingerprint: true, batchId: true, errorCode: true } })
        : client.sheetImportSubmission.findUniqueOrThrow({ where: { connectorId_externalId: { connectorId: connector.id, externalId } }, select: { id: true, outcome: true, fingerprint: true, batchId: true } });
      const beforeLegacy = await legacyEffects(); await run();
      assert.deepEqual(await legacyEffects(), { leads: beforeLegacy.leads + 1, notes: beforeLegacy.notes, provenance: beforeLegacy.provenance + 1, batches: beforeLegacy.batches + 1, reports: beforeLegacy.reports + 1 });
      assert.equal(await client.lead.count({ where: { email: "synthetic@example.invalid" } }), 0, `${mode} must not create the reserved identity`);
      assert.equal(await client.lead.count({ where: { email: `legacy-${slug}-${tag}@example.invalid`, assignedToId: null } }), 1, `${mode} continues the independent row without assignment`);
      const initialHeld = await held() as { status?: string; outcome?: string; batchId: string | null; errorCode?: string };
      assert.equal(local ? initialHeld.status : initialHeld.outcome, "REVIEW"); assert.equal(initialHeld.batchId, null);
      if (local) assert.equal(initialHeld.errorCode, "sheet_append_deferred_contact_review");
      assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: connector.id }, outcome: "REVIEW", errorCode: "sheet_append_deferred_contact_review" } }), 1);
      assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id, status: "COMPLETED", createdCount: 1, reviewCount: 1 } }), 1);
      legacyWorkers.push({ mode, id: connector.id, source, run, held, initialHeld });
    }
    const readsBeforeReopen = bounded.source.reads, beforeBoundedReopen = await business();
    await bootstrap.reopen(bounded.packId, bounded.deferred!.id, { expectedVersion: bounded.deferred!.version, idempotencyKey: `bounded-reopen-${tag}`, reason: "Explicit synthetic reopening must invalidate readiness before any new source I/O" }, actor);
    await assert.rejects(() => bounded.admin.requestRun(actor, bounded.id, 1), (error: unknown) => errorCode(error) === "sheet_append_bootstrap_reconciliation_required");
    assert.equal(bounded.source.reads, readsBeforeReopen); assert.deepEqual(await business(), beforeBoundedReopen);
    // A separately qualified connector of the same campus must still respect
    // the reservation during REVIEW, without relying on the old artifact.
    const otherBounded = await fixture("bounded-other"); await otherBounded.admin.qualifyAppend(actor, otherBounded.id, { expectedVersion: 1, confirmed: true });
    otherBounded.source.raw.push(["Another", "Identity", "synthetic@example.invalid", "BAC", program.code, ""]);
    const beforeOther = { leads: await client.lead.count(), provenance: await client.leadProvenance.count(), batches: await client.ingestionBatch.count() };
    await otherBounded.admin.requestRun(actor, otherBounded.id, 1); await otherBounded.worker.execute(otherBounded.id, "MANUAL");
    assert.equal((await rowsFor(otherBounded.streamId))[0]!.status, "REVIEW");
    assert.deepEqual({ leads: await client.lead.count(), provenance: await client.leadProvenance.count(), batches: await client.ingestionBatch.count() }, beforeOther);
    // Explicit terminal disposition removes the historical reservation. A held
    // Sheet REVIEW must nevertheless stay held: resolving history is not a new
    // authorization to create or link an earlier quarantined submission.
    const reopenedDeferred = await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: bounded.deferred!.id } });
    await bootstrap.decide(bounded.packId, reopenedDeferred.id, { expectedVersion: reopenedDeferred.version, idempotencyKey: `bounded-terminal-ignore-${tag}`, action: "IGNORE", reason: "Explicit synthetic terminal exclusion; source and prior deferral receipt remain preserved" }, actor);
    const currentPackage = await client.bootstrapImportPackage.findUniqueOrThrow({ where: { id: bounded.packId } });
    await bootstrap.confirm(bounded.packId, { expectedVersion: currentPackage.version, idempotencyKey: `bounded-terminal-confirm-${tag}`, confirmed: true, limit: 1 }, actor);
    assert.equal((await bootstrap.report(bounded.packId, actor) as { cutoverBlocked: boolean }).cutoverBlocked, false);
    assert.equal(await permissions.readTransaction(tx => deferredHistoricalCollision(tx, { campusId: campus.id, email: "synthetic@example.invalid", phone: null, firstName: "Contradictory", lastName: "Legacy local" })), null, "actual SQL confirms reservation was removed before replay");
    for (const legacy of legacyWorkers) {
      const beforeReplay = await legacyEffects(); await legacy.run();
      assert.deepEqual(await legacyEffects(), beforeReplay, `${legacy.mode} replay cannot create a formerly held identity or duplicate the independent row`);
      assert.deepEqual(await legacy.held(), legacy.initialHeld, `${legacy.mode} durable REVIEW/fingerprint/null batch stays unchanged`);
      assert.equal(legacy.source.reads, 2, "both proofs traverse the real worker/source/lease path");
      assert.equal(await client.sheetImportRun.count({ where: { connectorId: legacy.id, status: "COMPLETED", createdCount: 0, duplicateCount: 1, reviewCount: 1 } }), 1);
      assert.equal(await client.sheetImportRunReceipt.count({ where: { run: { connectorId: legacy.id }, outcome: "REVIEW", errorCode: legacy.mode === "LOCAL_ROW" ? "sheet_append_deferred_contact_review" : "sheet_append_deferred_review_pending" } }), legacy.mode === "LOCAL_ROW" ? 2 : 1);
      if (legacy.mode === "EXTERNAL_ID") {
        assert.equal(await client.sheetImportSubmission.count({ where: { connectorId: legacy.id } }), 2, "one held and one successful stable submission, no replay duplicate");
        await client.sheetImportConnector.update({ where: { id: legacy.id }, data: { enabled: false } });
      } else assert.equal(await client.sheetLocalRow.count({ where: { streamId: sheetStreamId(`synthetic_deferred_local_${tag}`, 0) } }), 2);
    }
    assert.equal(await client.lead.count({ where: { email: "synthetic@example.invalid" } }), 0);
    console.log(JSON.stringify({ proof: "sheet-append-postgres", syntheticOnly: true, mode: APPEND_MODE, boundaryExcluded: true, producerAttested: false, qualifiedFixtureOnly: true, noRealActivation: true,
      assertions: ["authenticated-http-four-append-handlers", "http-admin-superadmin-notfound", "http-campus-role-grant-session-revocation", "flags-off-zero-io", "server-boundary-and-no-rebaseline", "missing-qualification-refused", "qualification-replay", "durable-observation-zero-business", "pending-completion", "concurrent-workers", "row-content-isolation", "contact-match-review", "incomplete-resume", "no-duplicate-effects", "simulation-coherence", "conflicting-tail-quarantined", "bootstrap-receipt-corruption-refused", "authority-revoked-after-io", "transaction-fault-durable-resume", "bulk-1000-positions-replay", "bounded-v2-preserves-strict-global-guard", "deferred-local-row-real-worker-and-replay", "deferred-external-id-real-worker-and-replay", "terminal-historical-disposition-never-auto-creates-held-sheet-review", "ecmascript-edge-whitespace-reserved-real-workers", "internal-whitespace-never-joined-into-contact"], backlogDurationMs, privateProofDirectory: directory }));
  }
  finally { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); await app.close(); }
});
