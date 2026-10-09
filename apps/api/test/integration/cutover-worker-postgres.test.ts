import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { deriveSecret, digestRecoveryValue } from "../../src/access-recovery/access-recovery.store.js";
import type { Principal } from "../../src/auth/auth.types.js";
import { DynamicPermissionRepository } from "../../src/permissions/dynamic-repository.js";
import { defaultConfiguration } from "../../src/permissions/dynamic-evaluator.js";
import { referenceKey } from "../../src/references/reference.contract.js";
import { BootstrapImportService } from "../../src/bootstrap-import/bootstrap-import.service.js";
import { CutoverService } from "../../src/cutover/cutover.service.js";
import { CutoverRuntimeService, assertCutoverFixtureDatabase } from "../../src/cutover/cutover-runtime.service.js";
import { assertCutoverRuntimeAuthority } from "../../src/cutover/cutover-runtime-authority.js";
import { PersistentIngestionService } from "../../src/ingestion/persistent-ingestion.service.js";
import { ImportMappingService } from "../../src/import-mapping/import-mapping.service.js";
import { SyntheticSheetSource } from "../../src/sheet-import/synthetic-sheet-source.js";
import { SheetImportCoordinator } from "../../src/sheet-import/sheet-import-coordinator.js";
import { bytesHash, CHUNK_BYTES, HISTORICAL_SHEETS } from "../../src/bootstrap-import/bootstrap-import.contract.js";
import { syntheticHistoricalParts, syntheticZip } from "../fixtures/import/historical-workbook.synthetic.js";
import type { SheetConfiguration } from "../../src/sheet-import/sheet-import-configuration.js";
import type { SheetValues } from "../../src/sheet-import/google-sheets-adapter.js";

interface Manifest { id: string; version: number; state: string; counts: Record<string, number>; submissions: Array<{ key: string; externalId: string; classification: string; issue: string | null; decision: string | null }> }
interface Runtime { version: number; state: string; delegation: { creatorId: string; authorizedBy: string }; }
class ServerFixtureSource extends SyntheticSheetSource {
  reads = 0; afterRead: (() => Promise<void>) | undefined;
  constructor(public values: SheetValues) { super(); }
  override async read(): Promise<SheetValues> { this.reads++; const snapshot = structuredClone(this.values); await this.afterRead?.(); return snapshot; }
}
const enabled = process.env.CRMY63_EPHEMERAL_TEST === "true";
const code = (value: unknown): string => value instanceof HttpException ? String((value.getResponse() as { code?: string }).code) : "unknown";

test("CRMY-63 PostgreSQL T0-aware one-shot: dual authority, synthetic qualification, fencing and durable shared effects", { skip: !enabled, timeout: 180000 }, async () => {
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  const prisma = app.get(PrismaService), client = prisma.client!, permissions = app.get(DynamicPermissionRepository), bootstrap = app.get(BootstrapImportService);
  const original = { sheets: process.env.SHEETS_ENABLED, cutover: process.env.SHEET_CUTOVER_ENABLED, background: process.env.CRM_BACKGROUND_WORKERS, nonce: process.env.CRMY63_DATABASE_NONCE };
  const nonce = randomUUID().slice(0, 8), origin = await app.getUrl();
  try {
    await permissions.readTransaction(assertCutoverFixtureDatabase);
    const reference = async (kind: string, name: string): Promise<{ id: string; code: string }> => {
      const row = await client.crmReference.create({ data: { kind, code: `${name}-${nonce}`, label: `Synthetic ${name}`, scope: "GLOBAL", scopeKey: "GLOBAL" } });
      await client.crmReferenceKey.create({ data: { referenceId: row.id, kind, scopeKey: "GLOBAL", key: referenceKey(row.code) } }); return row;
    };
    const campus = await reference("CAMPUS", "WORKER63"), otherCampus = await reference("CAMPUS", "OTHERWORKER63"), campaign = await reference("CAMPAIGN", "WORKER63"), program = await reference("PROGRAM", "WORKER63");
    await client.crmProgramAvailability.createMany({ data: [{ programId: program.id, campusId: campus.id, active: true }, { programId: program.id, campusId: otherCampus.id, active: true }] });
    const account = async (role: "SUPER_ADMIN" | "ADMIN"): Promise<Principal> => {
      const password = `Synthetic!${randomBytes(12).toString("hex")}`, email = `worker-${randomUUID()}@example.invalid`, salt = randomBytes(16).toString("hex");
      const user = await client.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: "Synthetic worker authority", roles: [role], campusId: campus.id, active: true, firstLoginRequired: false } });
      await client.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
      const response = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 201); const session = await response.json() as { sessionId: string };
      return { userId: user.id, roles: [role], scopes: role === "SUPER_ADMIN" ? [{ kind: "GLOBAL" }] : [{ kind: "CAMPUS", id: campus.id }], sessionId: session.sessionId };
    };
    const creator = await account("ADMIN"), authorizer = await account("SUPER_ADMIN");
    const columns = [{ sourceColumn: "ID", targetField: "externalId" as const, action: "DIRECT" as const }, { sourceColumn: "Original UTC", targetField: "occurredAt" as const, action: "DIRECT" as const },
      { sourceColumn: "First", targetField: "firstName" as const, action: "DIRECT" as const }, { sourceColumn: "Last", targetField: "lastName" as const, action: "DIRECT" as const },
      { sourceColumn: "Email", targetField: "email" as const, action: "DIRECT" as const }, { sourceColumn: "Education", targetField: "educationLevel" as const, action: "DIRECT" as const },
      { sourceColumn: "Program", targetField: "program" as const, action: "DIRECT" as const }];
    const sourceRow = (id: string, at = "2026-09-05T12:00:00Z"): Record<string, string> => ({ ID: id, "Original UTC": at, First: "Synthetic", Last: id, Email: `${id}-${nonce}@example.invalid`, Education: "BAC", Program: program.code });
    const packageIds = new Set<string>();
    const prepare = async (tag: string, google = false, mappedCampus = false): Promise<{ manifest: Manifest; source: ServerFixtureSource; worker: CutoverRuntimeService; manual: CutoverService; connectorId: string; configuration: SheetConfiguration }> => {
      const parts = syntheticHistoricalParts({ workbookExtra: `<definedNames data-worker="${nonce}-${tag}"/>` });
      const bytes = syntheticZip(parts), sha256 = bytesHash(bytes);
      let pack = await bootstrap.create({ fileName: "worker-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `worker-${nonce}-${tag}` }, creator) as { id: string; version: number };
      assert.ok(!packageIds.has(pack.id), "Each fixture must have its own sealed package, not replay another scenario"); packageIds.add(pack.id);
      for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK_BYTES) { const chunk = bytes.subarray(offset, offset + CHUNK_BYTES); pack = await bootstrap.chunk(pack.id, { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) }, creator) as typeof pack; }
      pack = await bootstrap.seal(pack.id, { sha256 }, creator) as typeof pack;
      pack = await bootstrap.mapping(pack.id, { expectedVersion: pack.version, mappingVersion: "R8-v1", sheets: HISTORICAL_SHEETS.map((name) => ({ name, campaign: campaign.code,
        fields: { lastName: "A", firstName: "B", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" }, commentColumns: ["I"], ownerAliases: {} })) }, creator) as typeof pack;
      const rows = await bootstrap.rows(pack.id, undefined, 50, creator) as { items: Array<{ id: string; version: number }> };
      for (const row of rows.items) await bootstrap.decide(pack.id, row.id, { expectedVersion: row.version, idempotencyKey: `worker-ignore-${row.id}`, action: "IGNORE", reason: "Explicit synthetic exclusion for isolated worker qualification" }, creator);
      await bootstrap.confirm(pack.id, { expectedVersion: pack.version, idempotencyKey: `worker-confirm-${nonce}-${tag}`, confirmed: true, limit: 25 }, creator);
      const mappings = app.get(ImportMappingService), sourceColumns = mappedCampus ? [...columns, { sourceColumn: "Campus", targetField: "campus" as const, action: "DIRECT" as const }] : columns;
      const configuration: SheetConfiguration = { source: google ? { mode: "GOOGLE", identityMode: "EXTERNAL_ID", sheetId: 0, range: "A1:G20" } : { mode: "SIMULATED", identityMode: "EXTERNAL_ID" },
        mapping: mappings.snapshot({ mappingKey: `worker-${nonce}-${tag}`, name: "Synthetic worker", profile: "FORMINATOR_ZAPIER", expectedVersion: 0, columns: sourceColumns }, creator.userId, new Date().toISOString()),
        context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", recentSource: "GOOGLE_SHEETS", campus: campus.code, campaign: campaign.code }, assignment: { strategy: "UNASSIGNED" } };
      const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_worker_${nonce}_${tag}`, tab: "SYNTHETIC", configuration: configuration as unknown as Prisma.InputJsonValue, updatedBy: creator.userId } });
      const source = new ServerFixtureSource({ columns: sourceColumns.map((column) => column.sourceColumn), rows: [{ ...sourceRow(`initial-${tag}`), ...(mappedCampus ? { Campus: campus.code } : {}) }] });
      if (google) source.values.observation = { sheetId: 0, range: "A1:G20", values: [source.values.columns, ...source.values.rows.map((row) => source.values.columns.map((column) => row[column] ?? ""))] };
      const ingestion = app.get(PersistentIngestionService), manual = new CutoverService(permissions, bootstrap, source, ingestion, mappings), worker = new CutoverRuntimeService(permissions, bootstrap, ingestion, mappings, source);
      let manifest = await manual.create({ bootstrapPackageId: pack.id, connectorId: connector.id, sourceSheetId: 0, t0: "2026-09-05T12:00:00Z", excelFrozenAt: "2026-09-05T12:00:00Z", timeZone: "Africa/Casablanca", originalArrivalColumn: "Original UTC", identityEvidenceSha256: "a".repeat(64), idempotencyKey: `manifest-${nonce}-${tag}` }, creator) as Manifest;
      manifest = await manual.observe(manifest.id, { expectedVersion: manifest.version, idempotencyKey: `observe-${nonce}-${tag}` }, creator) as Manifest;
      for (const entry of manifest.submissions) manifest = await manual.decide(manifest.id, { expectedVersion: manifest.version, idempotencyKey: `decide-${entry.key}`, sourceKey: entry.key, action: "KEEP_FOR_CATCHUP", reason: "Initial synthetic overlap explicitly reviewed" }, creator) as Manifest;
      manifest = await manual.reconcile(manifest.id, { expectedVersion: manifest.version, idempotencyKey: `reconcile-${nonce}-${tag}` }, creator) as Manifest;
      if (google) {
        const priorReads = source.reads;
        await assert.rejects(() => worker.qualify(manifest.id, { expectedVersion: manifest.version, idempotencyKey: `qualify-google-${nonce}`, identityEvidenceSha256: "a".repeat(64), qualified: true }, authorizer),
          (error: unknown) => code(error) === "cutover_upstream_not_qualified");
        assert.equal(source.reads, priorReads); assert.equal((await worker.get(manifest.id, authorizer) as Runtime).state, "UNQUALIFIED");
        return { manifest, source, worker, manual, connectorId: connector.id, configuration };
      }
      let runtime = await worker.qualify(manifest.id, { expectedVersion: manifest.version, idempotencyKey: `qualify-${nonce}-${tag}` }, authorizer) as Runtime;
      runtime = await worker.arm(manifest.id, { expectedVersion: runtime.version, confirmed: true, idempotencyKey: `arm-${nonce}-${tag}` }, authorizer) as Runtime;
      assert.equal(runtime.delegation.creatorId, creator.userId); assert.equal(runtime.delegation.authorizedBy, authorizer.userId);
      return { manifest, source, worker, manual, connectorId: connector.id, configuration };
    };
    process.env.CRM_BACKGROUND_WORKERS = "external"; process.env.SHEETS_ENABLED = "false"; process.env.SHEET_CUTOVER_ENABLED = "false";
    const fixture = await prepare("primary"), id = fixture.manifest.id;
    await prepare("google", true);
    const counts = async (): Promise<unknown> => ({ leads: await client.lead.count(), activities: await client.leadActivity.count(), provenance: await client.leadProvenance.count(),
      batches: await client.ingestionBatch.count(), reports: await client.importReport.count(), audits: await client.auditEvent.count(),
      effects: await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_effects`, receipts: await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_runtime_receipts` });
    const beforeOff = await counts(), reads = fixture.source.reads;
    assert.deepEqual(await fixture.worker.tick(), { skipped: "cutover_flags_off", runs: [] }); assert.equal(fixture.source.reads, reads); assert.deepEqual(await counts(), beforeOff);
    process.env.SHEETS_ENABLED = "true"; process.env.SHEET_CUTOVER_ENABLED = "true";
    fixture.source.values.rows.push(sourceRow("equal-t0"), sourceRow("late-post", "2026-09-05T12:00:01Z"), sourceRow("late-pre", "2026-09-05T11:59:59Z"));
    const simultaneous = await Promise.all([fixture.worker.tick({ manifestId: id, limit: 1, chunks: 4 }), fixture.worker.tick({ manifestId: id, limit: 1, chunks: 4 })]) as Array<{ runs: Array<{ status: string; processed?: number; code?: string }> }>;
    const concurrentRuns = simultaneous.flatMap((result) => result.runs);
    assert.ok(concurrentRuns.some((run) => run.status === "COMPLETED"));
    assert.ok(concurrentRuns.every((run) => run.status === "COMPLETED" || run.status === "FAILED" && run.code === "permission_version_conflict"), JSON.stringify(concurrentRuns));
    assert.equal(concurrentRuns.filter((run) => run.status === "COMPLETED").reduce((sum, run) => sum + (run.processed ?? 0), 0), 3);
    const persisted = await counts(); await new CutoverRuntimeService(permissions, bootstrap, app.get(PersistentIngestionService), app.get(ImportMappingService), fixture.source).tick({ manifestId: id });
    const stable = await counts() as { leads: number; activities: number; provenance: number }; const expected = persisted as typeof stable;
    assert.equal(stable.leads, expected.leads); assert.equal(stable.activities, expected.activities); assert.equal(stable.provenance, expected.provenance);
    const view = await fixture.manual.get(id, creator) as Manifest;
    assert.equal(view.submissions.find((entry) => entry.externalId === "late-pre")?.classification, "EXCLUDED_PRE_T0");
    assert.equal(view.submissions.find((entry) => entry.externalId === "equal-t0")?.decision, "KEEP_FOR_CATCHUP");
    const audits = await client.auditEvent.findMany({ where: { resourceId: id, eventType: "CUTOVER_RUNTIME_AUTOMATIC_POST_T0_POLICY" } }); assert.equal(audits.length, 1);
    assert.equal(audits[0]!.actorId, `SYSTEM:CUTOVER:${id}`); assert.deepEqual(audits[0]!.actorRoles, ["SYSTEM"]);
    assert.ok(JSON.stringify(audits[0]!.after).includes(authorizer.userId)); assert.ok(JSON.stringify(audits[0]!.after).includes(creator.userId));
    const ingestionAudit = await client.auditEvent.findFirstOrThrow({ where: { actorId: `SYSTEM:CUTOVER:${id}`, eventType: "CUTOVER_NEW_INGESTION" } }); assert.ok(JSON.stringify(ingestionAudit.after).includes("runtimeVersion"));
    // Both persisted authorities are revalidated, not just connector.updatedBy.
    for (const identity of [creator, authorizer]) {
      await client.collaborator.update({ where: { id: identity.userId }, data: { active: false } });
      const result = await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ code: string }> }; assert.equal(result.runs[0]?.code, "cutover_runtime_authority_revoked");
      await client.collaborator.update({ where: { id: identity.userId }, data: { active: true } });
    }
    const target = { kind: "ROLE" as const, role: "ADMIN" as const, campus: campus.id }, defaults = defaultConfiguration(target);
    await permissions.transaction((tx) => permissions.append(tx, { ...target, expectedVersion: 0, grants: { ...defaults, "import.confirm": "NONE" }, reason: "ACCESS_REVIEW", confirmed: true }, defaults, authorizer));
    assert.equal((await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_runtime_authority_revoked");
    await permissions.transaction((tx) => permissions.append(tx, { ...target, expectedVersion: 1, grants: defaults, reason: "RESTORE_VERSION", confirmed: true }, { ...defaults, "import.confirm": "NONE" }, authorizer));
    const authorizerTarget = { kind: "ROLE" as const, role: "SUPER_ADMIN" as const, campus: campus.id }, authorizerDefaults = defaultConfiguration(authorizerTarget);
    await permissions.transaction((tx) => permissions.append(tx, { ...authorizerTarget, expectedVersion: 0, grants: { ...authorizerDefaults, "lead.create": "NONE" }, reason: "ACCESS_REVIEW", confirmed: true }, authorizerDefaults, authorizer));
    assert.equal((await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_runtime_authority_revoked");
    await permissions.transaction((tx) => permissions.append(tx, { ...authorizerTarget, expectedVersion: 1, grants: authorizerDefaults, reason: "RESTORE_VERSION", confirmed: true }, { ...authorizerDefaults, "lead.create": "NONE" }, authorizer));
    await client.collaborator.update({ where: { id: creator.userId }, data: { campusId: null } });
    assert.equal((await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_runtime_authority_revoked");
    await client.collaborator.update({ where: { id: creator.userId }, data: { campusId: campus.id } });
    const versionAccount = await account("ADMIN"), versionUser = await client.collaborator.findUniqueOrThrow({ where: { id: versionAccount.userId } });
    const versionDelegation = { creatorId: versionUser.id, authorizedBy: versionUser.id, creatorAuthenticationVersion: versionUser.authenticationVersion, authorizerAuthenticationVersion: versionUser.authenticationVersion };
    await permissions.readTransaction((tx) => assertCutoverRuntimeAuthority(tx, permissions, versionDelegation, campus.id, id, false));
    await client.collaborator.update({ where: { id: versionUser.id }, data: { authenticationVersion: { increment: 1 } } });
    await assert.rejects(() => permissions.readTransaction((tx) => assertCutoverRuntimeAuthority(tx, permissions, versionDelegation, campus.id, id, false)), (error: unknown) => code(error) === "cutover_runtime_authority_revoked");
    // Fixture attestation cannot arm a real/shared DB or a Google source.
    const savedNonce = process.env.CRMY63_DATABASE_NONCE; process.env.CRMY63_DATABASE_NONCE = "wrong-nonce";
    assert.equal((await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_fixture_database_required"); process.env.CRMY63_DATABASE_NONCE = savedNonce;
    await assert.rejects(() => permissions.readTransaction((tx) => assertCutoverRuntimeAuthority(tx, permissions, { creatorId: creator.userId, authorizedBy: creator.userId, creatorAuthenticationVersion: 1, authorizerAuthenticationVersion: 2 }, campus.id, id, false)), (error: unknown) => code(error) === "cutover_runtime_authority_revoked");
    // Permission revoked after remote I/O rolls back inventory and effects.
    const revoked = await prepare("revoked"), revokedBefore = await counts(); revoked.source.values.rows.push(sourceRow("must-not-commit"));
    revoked.source.afterRead = async (): Promise<void> => { await client.collaborator.update({ where: { id: authorizer.userId }, data: { active: false } }); };
    assert.equal((await revoked.worker.tick({ manifestId: revoked.manifest.id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_runtime_authority_revoked");
    await client.collaborator.update({ where: { id: authorizer.userId }, data: { active: true } });
    assert.equal((await counts() as { leads: number }).leads, (revokedBefore as { leads: number }).leads);
    assert.equal((await revoked.manual.get(revoked.manifest.id, creator) as Manifest).submissions.length, 1);
    // Out-of-band legacy activation is refused by both consumers.
    const legacy = await prepare("legacy"), legacyBefore = await counts();
    legacy.source.afterRead = async (): Promise<void> => { await client.sheetImportConnector.update({ where: { id: legacy.connectorId }, data: { enabled: true, manualRequested: true } }); };
    assert.equal((await legacy.worker.tick({ manifestId: legacy.manifest.id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_producer_must_be_stopped");
    assert.equal(await new SheetImportCoordinator(prisma).claim(legacy.connectorId, "MANUAL"), undefined);
    await client.sheetImportConnector.update({ where: { id: legacy.connectorId }, data: { enabled: false, manualRequested: false } });
    assert.equal((await counts() as { leads: number }).leads, (legacyBefore as { leads: number }).leads);
    // Flags flipped while reading prevent inventory/effect commit.
    const flags = await prepare("flags"), flagBefore = await counts(); flags.source.afterRead = (): Promise<void> => { process.env.SHEET_CUTOVER_ENABLED = "false"; return Promise.resolve(); };
    assert.equal((await flags.worker.tick({ manifestId: flags.manifest.id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_flags_off");
    process.env.SHEET_CUTOVER_ENABLED = "true"; assert.equal((await counts() as { leads: number }).leads, (flagBefore as { leads: number }).leads);
    // Lost response/interruption after one committed chunk: a new process uses
    // the same ledger and completes only pending source identities.
    const resumed = await prepare("resume"), resumeBefore = await counts() as { leads: number };
    resumed.source.values.rows.push(sourceRow("resume-next"), sourceRow("resume-last"));
    await resumed.worker.tick({ manifestId: resumed.manifest.id, limit: 1, chunks: 1 }); // response intentionally not used as a cursor
    assert.equal((await counts() as { leads: number }).leads, resumeBefore.leads + 1);
    const restarted = new CutoverRuntimeService(permissions, bootstrap, app.get(PersistentIngestionService), app.get(ImportMappingService), resumed.source);
    await restarted.tick({ manifestId: resumed.manifest.id, limit: 1, chunks: 4 });
    assert.equal((await counts() as { leads: number }).leads, resumeBefore.leads + 3);
    const resumeStable = await counts() as { leads: number; activities: number; provenance: number };
    await restarted.tick({ manifestId: resumed.manifest.id });
    assert.equal((await counts() as { leads: number }).leads, resumeStable.leads);
    assert.equal((await counts() as { activities: number }).activities, resumeStable.activities);
    assert.equal((await counts() as { provenance: number }).provenance, resumeStable.provenance);
    // Expired owner after I/O cannot commit over a replacement epoch.
    const takeover = await prepare("takeover"), takeoverBefore = await counts() as { leads: number };
    takeover.source.afterRead = async (): Promise<void> => {
      takeover.source.afterRead = undefined;
      await client.$executeRaw`UPDATE import_cutover_runtimes SET lease_until=clock_timestamp()-interval '1 second' WHERE manifest_id=${takeover.manifest.id}::uuid`;
      await takeover.worker.tick({ manifestId: takeover.manifest.id });
    };
    const obsolete = await takeover.worker.tick({ manifestId: takeover.manifest.id }) as { runs: Array<{ code: string }> };
    assert.equal(obsolete.runs[0]?.code, "cutover_runtime_lease_lost");
    assert.equal((await counts() as { leads: number }).leads, takeoverBefore.leads + 1);
    const takeRuns = await client.$queryRaw<Array<{ status: string }>>`SELECT status FROM import_cutover_runtime_runs WHERE manifest_id=${takeover.manifest.id}::uuid ORDER BY epoch`;
    assert.deepEqual(takeRuns.map((run) => run.status), ["ABANDONED", "COMPLETED"]);
    // Expiry inside the fenced effect tx is not silently renewed. The attempted
    // Lead, activity, provenance, receipt and inventory are all rolled back.
    const expiry = await prepare("expiry"), expiryBefore = await counts(), ingestion = app.get(PersistentIngestionService);
    const originalPersist = ingestion.persistScheduledCutoverRecord.bind(ingestion);
    ingestion.persistScheduledCutoverRecord = async (...args: Parameters<typeof originalPersist>): ReturnType<typeof originalPersist> => {
      const result = await originalPersist(...args);
      await args[0].$executeRaw`UPDATE import_cutover_runtimes SET lease_until=clock_timestamp()-interval '1 second' WHERE manifest_id=${expiry.manifest.id}::uuid`;
      return result;
    };
    try { assert.equal((await expiry.worker.tick({ manifestId: expiry.manifest.id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_runtime_lease_lost"); }
    finally { ingestion.persistScheduledCutoverRecord = originalPersist; }
    assert.deepEqual(await counts(), expiryBefore);
    assert.equal((await expiry.manual.get(expiry.manifest.id, creator) as Manifest).submissions.length, 1);
    // A GLOBAL Super Admin cannot use a cell-mapped campus to cross this
    // manifest's immutable campus. The entire mixed chunk remains atomic.
    const crossing = await prepare("campus", false, true);
    crossing.source.values.rows.push({ ...sourceRow("cross-campus"), Campus: otherCampus.code });
    const crossingBefore = await counts();
    assert.equal((await crossing.worker.tick({ manifestId: crossing.manifest.id }) as { runs: Array<{ code: string }> }).runs[0]?.code, "cutover_record_campus_mismatch");
    assert.deepEqual(await counts(), crossingBefore);
    let crossingView = await crossing.manual.observe(crossing.manifest.id, { expectedVersion: crossing.manifest.version, idempotencyKey: `cross-observe-${nonce}` }, authorizer) as Manifest;
    const crossEntry = crossingView.submissions.find((entry) => entry.externalId === "cross-campus")!;
    crossingView = await crossing.manual.decide(crossingView.id, { expectedVersion: crossingView.version, idempotencyKey: `cross-decision-${nonce}`, sourceKey: crossEntry.key, action: "KEEP_FOR_CATCHUP", reason: "Synthetic mismatch test only, no authorization widening" }, authorizer) as Manifest;
    crossingView = await crossing.manual.reconcile(crossingView.id, { expectedVersion: crossingView.version, idempotencyKey: `cross-reconcile-${nonce}` }, authorizer) as Manifest;
    const crossBefore = await counts(), crossReceipts = await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_receipts WHERE manifest_id=${crossingView.id}::uuid`;
    await assert.rejects(() => crossing.manual.consume(crossingView.id, { expectedVersion: crossingView.version, idempotencyKey: `cross-consume-${nonce}`, limit: 25, confirmed: true }, authorizer),
      (error: unknown) => code(error) === "cutover_record_campus_mismatch");
    assert.deepEqual(await counts(), crossBefore); assert.deepEqual(await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_receipts WHERE manifest_id=${crossingView.id}::uuid`, crossReceipts);
    // Source divergence is journaled and pauses; old content/effects never change.
    fixture.source.values.rows[0]!.First = "Changed"; const changedBefore = await counts();
    assert.equal((await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ status: string }> }).runs[0]?.status, "BLOCKED");
    const changed = await fixture.manual.get(id, creator) as Manifest; assert.equal(changed.submissions.find((entry) => entry.externalId === "initial-primary")?.issue, "SOURCE_CHANGED");
    assert.equal((await fixture.worker.get(id, authorizer) as Runtime).state, "PAUSED"); assert.equal((await counts() as { leads: number }).leads, (changedBefore as { leads: number }).leads);
  } finally {
    process.env.SHEETS_ENABLED = original.sheets; process.env.SHEET_CUTOVER_ENABLED = original.cutover; process.env.CRM_BACKGROUND_WORKERS = original.background; process.env.CRMY63_DATABASE_NONCE = original.nonce;
    await app.close();
  }
});
