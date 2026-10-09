import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { ConflictException, HttpException } from "@nestjs/common";
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
import { loadCutover, updateCutover } from "../../src/cutover/cutover.store.js";
import { cutoverEffects } from "../../src/cutover/cutover.effects.js";

interface Manifest { id: string; version: number; state: string; counts: Record<string, number>; submissions: Array<{ key: string; externalId: string; classification: string; issue: string | null; decision: string | null }> }
interface Runtime { version: number; state: string; delegation: { creatorId: string; authorizedBy: string }; }
interface Exceptions {
  id: string; version: number; state: string; bindingValid: boolean; observation: null | { sourceEvidenceSha256: string };
  cases: Array<{ id: string; sourceKey: string; kind: string; generation: number; evidenceSha256: string; present: boolean; observedFingerprint: string | null;
    disposition: null | { action: string }; requiresReobservation: boolean }>;
  summary: { coverageValid: boolean; currentCases: number; unresolvedCases: number; quarantinedCases: number; allDispositionsReconciled: boolean; requiresReobservation: boolean };
  capabilities: { canQuarantine: boolean; canObserve: boolean }; replayed?: boolean; receipt?: { caseId: string };
}
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
    const tokens = new Map<string, string>();
    const account = async (role: "SUPER_ADMIN" | "ADMIN"): Promise<Principal> => {
      const password = `Synthetic!${randomBytes(12).toString("hex")}`, email = `worker-${randomUUID()}@example.invalid`, salt = randomBytes(16).toString("hex");
      const user = await client.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: "Synthetic worker authority", roles: [role], campusId: campus.id, active: true, firstLoginRequired: false } });
      await client.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
      const response = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 201); const session = await response.json() as { sessionId: string; token: string }; tokens.set(user.id, session.token);
      return { userId: user.id, roles: [role], scopes: role === "SUPER_ADMIN" ? [{ kind: "GLOBAL" }] : [{ kind: "CAMPUS", id: campus.id }], sessionId: session.sessionId };
    };
    const creator = await account("ADMIN"), authorizer = await account("SUPER_ADMIN");
    const request = async (id: string, suffix: string, actor: Principal | null, body?: unknown): Promise<Response> => fetch(`${origin}/lead-import/cutover/manifests/${id}${suffix}`,
      { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${tokens.get(actor.userId)!}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
    // Minimal durable exception resolution never edits an imported Lead,
    // historical payload, ingestion REVIEW or its stable submission key.
    const business = async (): Promise<unknown> => ({ leads: await client.lead.findMany({ orderBy: { id: "asc" } }), activities: await client.leadActivity.findMany({ orderBy: { id: "asc" } }),
      provenance: await client.leadProvenance.findMany({ orderBy: { id: "asc" } }), batches: await client.ingestionBatch.findMany({ orderBy: { id: "asc" } }), reports: await client.importReport.findMany({ orderBy: { id: "asc" } }),
      review: await client.ingestionReviewItem.findMany({ orderBy: { id: "asc" } }), effects: await client.$queryRaw`SELECT * FROM import_cutover_effects ORDER BY id` });
    const durable = async (manifestId: string): Promise<unknown> => ({ manifests: await client.$queryRaw`SELECT * FROM import_cutover_manifests WHERE id=${manifestId}::uuid`,
      cases: await client.$queryRaw`SELECT * FROM import_cutover_exception_cases WHERE manifest_id=${manifestId}::uuid ORDER BY id`,
      dispositions: await client.$queryRaw`SELECT d.* FROM import_cutover_exception_dispositions d JOIN import_cutover_exception_cases c ON c.id=d.case_id WHERE c.manifest_id=${manifestId}::uuid ORDER BY d.id`,
      receipts: await client.$queryRaw`SELECT * FROM import_cutover_receipts WHERE manifest_id=${manifestId}::uuid ORDER BY id`,
      runtime: await client.$queryRaw`SELECT * FROM import_cutover_runtimes WHERE manifest_id=${manifestId}::uuid`,
      audits: await client.auditEvent.findMany({ where: { resourceId: manifestId }, orderBy: { id: "asc" } }) });
    const exceptionGet = async (item = fixture): Promise<Exceptions> => item.manual.exceptions(item.manifest.id, creator) as Promise<Exceptions>;
    const refresh = async (item = fixture): Promise<Manifest> => {
      const current = await item.manual.get(item.manifest.id, creator) as Manifest;
      return item.manual.observe(current.id, { expectedVersion: current.version, idempotencyKey: `exception-observe-${randomUUID()}` }, creator) as Promise<Manifest>;
    };
    const quarantineBody = (view: Exceptions, index = 0): Record<string, unknown> => ({ expectedVersion: view.version, evidenceSha256: view.cases[index]!.evidenceSha256,
      action: "QUARANTINE_PRESERVE", reason: "Synthetic exception preserved for explicit later investigation", confirmed: true, idempotencyKey: `quarantine-${randomUUID()}` });
    let exceptions = await exceptionGet(); assert.equal(exceptions.cases.length, 1); assert.equal(exceptions.cases[0]!.kind, "SOURCE_CHANGED");
    const detailResponse = await request(id, "/exceptions", creator); assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as Exceptions; assert.deepEqual(detail, exceptions);
    assert.equal((await request(id, "/exceptions", null)).status, 401);
    assert.ok(!JSON.stringify(detail).includes("@example.invalid")); assert.ok(!JSON.stringify(detail).includes('"payload"'));
    const other = await account("ADMIN"); await client.collaborator.update({ where: { id: other.userId }, data: { campusId: otherCampus.id } });
    assert.equal((await request(id, "/exceptions", other)).status, 403);
    const firstCase = exceptions.cases[0]!, decision = quarantineBody(exceptions), beforeInvalid = await durable(id), businessBefore = await business();
    for (const invalid of [{ ...decision, evidenceSha256: "0".repeat(64) }, { ...decision, confirmed: false }, { ...decision, reason: "short" }, { ...decision, action: "INGEST" }]) {
      assert.ok([400, 409].includes((await request(id, `/exceptions/${firstCase.id}/disposition`, creator, invalid)).status));
      assert.deepEqual(await durable(id), beforeInvalid);
    }
    // Aborting the outer transaction also rolls back the decision, audit,
    // receipt, runtime epoch/disarm and manifest suspension together.
    await assert.rejects(() => permissions.transaction(async () => { await fixture.manual.quarantine(id, firstCase.id, decision, creator); throw new ConflictException({ code: "synthetic_abort_quarantine" }); }), (error: unknown) => code(error) === "synthetic_abort_quarantine");
    assert.deepEqual(await durable(id), beforeInvalid);
    const epochBefore = (await fixture.worker.get(id, authorizer) as { epoch: number }).epoch;
    const concurrent = await Promise.allSettled([fixture.manual.quarantine(id, firstCase.id, decision, creator), fixture.manual.quarantine(id, firstCase.id, decision, creator)]);
    const outcomes: Exceptions[] = [];
    for (const result of concurrent) {
      if (result.status === "fulfilled") outcomes.push(result.value as Exceptions);
      else { assert.equal(code(result.reason), "permission_version_conflict"); outcomes.push(await fixture.manual.quarantine(id, firstCase.id, decision, creator) as Exceptions); }
    }
    assert.deepEqual(outcomes.map((item) => item.replayed).sort(), [false, true]);
    assert.equal((await fixture.worker.get(id, authorizer) as { epoch: number }).epoch, epochBefore + 1);
    exceptions = await exceptionGet(); assert.equal(exceptions.state, "SUSPENDED"); assert.equal(exceptions.summary.requiresReobservation, true);
    assert.equal(exceptions.summary.allDispositionsReconciled, false); assert.equal(exceptions.capabilities.canObserve, true);
    await assert.rejects(() => fixture.manual.reconcile(id, { expectedVersion: exceptions.version, idempotencyKey: `no-observe-${nonce}` }, creator), (error: unknown) => code(error) === "cutover_suspended");
    const armReplay = await fixture.worker.arm(id, { expectedVersion: 1, confirmed: true, idempotencyKey: `arm-${nonce}-primary` }, authorizer) as { state: string; epoch: number };
    assert.equal(armReplay.state, "PAUSED"); assert.equal(armReplay.epoch, epochBefore + 1);
    let renewed = await refresh();
    renewed = await fixture.manual.reconcile(id, { expectedVersion: renewed.version, idempotencyKey: `quarantine-reconcile-${nonce}` }, creator) as Manifest;
    exceptions = await exceptionGet(); assert.equal(exceptions.summary.allDispositionsReconciled, true);
    assert.equal((await fixture.manual.get(id, creator) as { catchup: { complete: boolean; quarantined: number } }).catchup.complete, false);
    assert.equal((await fixture.manual.get(id, creator) as { catchup: { quarantined: number } }).catchup.quarantined, 1);
    assert.deepEqual(await business(), businessBefore);
    const paused = await fixture.worker.get(id, authorizer) as Runtime;
    await assert.rejects(() => fixture.worker.arm(id, { expectedVersion: paused.version, confirmed: true, idempotencyKey: `no-requalification-${nonce}` }, authorizer),
      (error: unknown) => code(error) === "cutover_runtime_requalification_required");
    const requalified = await fixture.worker.qualify(id, { expectedVersion: renewed.version, idempotencyKey: `exception-requalify-${nonce}` }, authorizer) as Runtime;
    await fixture.worker.arm(id, { expectedVersion: requalified.version, confirmed: true, idempotencyKey: `exception-rearm-${nonce}` }, authorizer);
    const quarantineTick = await fixture.worker.tick({ manifestId: id }) as { runs: Array<{ status: string; processed: number }> };
    assert.equal(quarantineTick.runs[0]!.status, "COMPLETED"); assert.equal(quarantineTick.runs[0]!.processed, 0);
    const testedRuntime = await fixture.worker.get(id, authorizer) as Runtime;
    await fixture.worker.arm(id, { expectedVersion: testedRuntime.version, confirmed: true, idempotencyKey: `exception-disarm-after-proof-${nonce}` }, authorizer, true);
    renewed = await fixture.manual.get(id, creator) as Manifest; assert.deepEqual(await business(), businessBefore);
    // Replay is immutable but never acts as a grant or a new arm operation.
    const settled = await durable(id); const replay = await fixture.manual.quarantine(id, firstCase.id, decision, creator) as Exceptions;
    assert.equal(replay.replayed, true); assert.deepEqual(await durable(id), settled);
    const replayResponse = await request(id, `/exceptions/${firstCase.id}/disposition`, creator, decision); assert.equal(replayResponse.status, 201);
    assert.equal((await replayResponse.json() as Exceptions).replayed, true); assert.deepEqual(await durable(id), settled);
    const affectedLeadId = (await permissions.readTransaction((tx) => cutoverEffects(tx, id))).find((effect) => effect.sourceKey === firstCase.sourceKey)!.leadId!;
    const currentDefaults = defaultConfiguration(target);
    await permissions.transaction((tx) => permissions.append(tx, { ...target, expectedVersion: 2, grants: { ...currentDefaults, "lead.view": "OWN" }, reason: "ACCESS_REVIEW", confirmed: true }, currentDefaults, authorizer));
    const restricted = await fixture.manual.get(id, creator) as { capabilities: { canConsume: boolean }; catchup: { allDispositionsReconciled: boolean } };
    assert.equal(restricted.capabilities.canConsume, false); assert.equal(restricted.catchup.allDispositionsReconciled, false);
    for (const operation of [(): Promise<unknown> => fixture.manual.exceptions(id, creator), (): Promise<unknown> => fixture.manual.quarantine(id, firstCase.id, decision, creator),
      (): Promise<unknown> => fixture.manual.reconcile(id, { expectedVersion: renewed.version, idempotencyKey: `restricted-reconcile-${nonce}` }, creator),
      (): Promise<unknown> => fixture.manual.consume(id, { expectedVersion: renewed.version, idempotencyKey: `restricted-consume-${nonce}`, limit: 1, confirmed: true }, creator),
      (): Promise<unknown> => fixture.worker.qualify(id, { expectedVersion: renewed.version, idempotencyKey: `restricted-qualify-${nonce}` }, authorizer)]) {
      await assert.rejects(operation, (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
    }
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: affectedLeadId } })).assignedToId, null);
    await permissions.transaction((tx) => permissions.append(tx, { ...target, expectedVersion: 3, grants: currentDefaults, reason: "RESTORE_VERSION", confirmed: true }, { ...currentDefaults, "lead.view": "OWN" }, authorizer));
    assert.deepEqual(await durable(id), settled);
    // Nullable historical rows are unqualified, never silently backfilled.
    await assert.rejects(() => permissions.transaction(async (tx) => {
      const before = await durable(id); await tx.$executeRaw`UPDATE import_cutover_manifests SET exception_observation=NULL WHERE id=${id}::uuid`;
      const old = await fixture.manual.exceptions(id, creator) as Exceptions;
      assert.equal(old.observation, null); assert.deepEqual(old.cases, []); assert.equal(old.summary.coverageValid, false); assert.equal(old.summary.allDispositionsReconciled, false);
      await assert.rejects(() => fixture.manual.consume(id, { expectedVersion: renewed.version, idempotencyKey: `old-unqualified-${nonce}`, confirmed: true, limit: 1 }, creator), (error: unknown) => code(error) === "cutover_exception_observation_required");
      const after = await durable(id) as Record<string, unknown>, prior = before as Record<string, unknown>;
      for (const key of ["cases", "dispositions", "receipts", "runtime", "audits"]) assert.deepEqual(after[key], prior[key]);
      throw new ConflictException({ code: "synthetic_abort_nullable_historical" });
    }), (error: unknown) => code(error) === "synthetic_abort_nullable_historical"); assert.deepEqual(await durable(id), settled);
    // Coverage cannot be certified through an empty/filtered list of refs.
    await assert.rejects(() => permissions.transaction(async (tx) => {
      await tx.$executeRaw`UPDATE import_cutover_manifests SET exception_observation=jsonb_set(exception_observation,'{cases}','[]'::jsonb) WHERE id=${id}::uuid`;
      const empty = await fixture.manual.exceptions(id, creator) as Exceptions;
      assert.equal(empty.summary.currentCases, 1); assert.equal(empty.summary.coverageValid, false); assert.equal(empty.summary.allDispositionsReconciled, false);
      throw new ConflictException({ code: "synthetic_abort_empty_coverage" });
    }), (error: unknown) => code(error) === "synthetic_abort_empty_coverage"); assert.deepEqual(await durable(id), settled);
    // A→B→A retains immutable generations. Returning to an older payload does
    // not revive its former quarantine disposition or change the Lead.
    fixture.source.values.rows[0]!.First = "Changed twice"; await refresh();
    const twice = await exceptionGet(); assert.equal(twice.cases[0]!.generation, 2); assert.equal(twice.cases[0]!.disposition, null); assert.notEqual(twice.cases[0]!.evidenceSha256, firstCase.evidenceSha256);
    fixture.source.values.rows[0]!.First = "Changed"; await refresh();
    const returned = await exceptionGet(); assert.equal(returned.cases[0]!.generation, 3); assert.equal(returned.cases[0]!.disposition, null);
    assert.equal(returned.cases[0]!.evidenceSha256, firstCase.evidenceSha256); assert.notEqual(returned.cases[0]!.id, firstCase.id);
    assert.deepEqual(await business(), businessBefore);
    // Quarantine during source I/O fences that actual RUNNING lease, not only
    // a previously finished/paused worker. The stale worker cannot ingest.
    const inFlight = await prepare("quarantine-fence"), inFlightBefore = await business(), inFlightEpoch = (await inFlight.worker.get(inFlight.manifest.id, authorizer) as { epoch: number }).epoch;
    inFlight.source.afterRead = async (): Promise<void> => {
      inFlight.source.afterRead = undefined; inFlight.source.values.rows[0]!.First = "Synthetic changed during worker read";
      await refresh(inFlight);
      const current = await exceptionGet(inFlight); await inFlight.manual.quarantine(current.id, current.cases[0]!.id, quarantineBody(current), creator);
    };
    const fenced = await inFlight.worker.tick({ manifestId: inFlight.manifest.id }) as { runs: Array<{ code: string }> };
    assert.equal(fenced.runs[0]!.code, "cutover_runtime_lease_lost");
    assert.equal((await inFlight.worker.get(inFlight.manifest.id, authorizer) as { epoch: number }).epoch, inFlightEpoch + 2);
    assert.deepEqual(await client.$queryRaw`SELECT status,error_code AS code FROM import_cutover_runtime_runs WHERE manifest_id=${inFlight.manifest.id}::uuid`, [{ status: "ABANDONED", code: "cutover_quarantined" }]);
    assert.deepEqual(await business(), inFlightBefore);
    // Removal and reappearance are equally durable, never new ingestion.
    resumed.source.values.rows.shift();
    await restarted.tick({ manifestId: resumed.manifest.id });
    const removed = await exceptionGet(resumed); assert.equal(removed.cases[0]!.kind, "SOURCE_REMOVED"); assert.equal(removed.cases[0]!.present, false);
    await resumed.manual.quarantine(resumed.manifest.id, removed.cases[0]!.id, quarantineBody(removed), creator);
    const removedObserved = await refresh(resumed); await resumed.manual.reconcile(removedObserved.id, { expectedVersion: removedObserved.version, idempotencyKey: `removed-reconcile-${nonce}` }, creator);
    resumed.source.values.rows.unshift(sourceRow("initial-resume")); await refresh(resumed);
    const reappeared = await exceptionGet(resumed); assert.equal(reappeared.cases[0]!.generation, 2); assert.equal(reappeared.cases[0]!.present, true); assert.equal(reappeared.cases[0]!.disposition, null);
    // A contact collision remains REVIEW with its batch/report/Lead preserved.
    const review = await prepare("review");
    // A genuinely new post-T0 identity collides; existing inventory is intact.
    review.source.values.rows.push({ ...sourceRow("review-collision"), Email: fixture.source.values.rows[0]!.Email! });
    const reviewRun = await review.worker.tick({ manifestId: review.manifest.id }) as { runs: Array<{ status: string }> }; assert.equal(reviewRun.runs[0]!.status, "BLOCKED");
    const reviewExceptions = await exceptionGet(review), reviewCase = reviewExceptions.cases.find((item) => item.kind === "EFFECT_REVIEW")!; assert.ok(reviewCase);
    const reviewPreserved = await business();
    await review.manual.quarantine(review.manifest.id, reviewCase.id, quarantineBody(reviewExceptions, reviewExceptions.cases.indexOf(reviewCase)), creator);
    const reviewObserved = await refresh(review); await review.manual.reconcile(reviewObserved.id, { expectedVersion: reviewObserved.version, idempotencyKey: `review-reconcile-${nonce}` }, creator);
    assert.equal((await exceptionGet(review)).summary.allDispositionsReconciled, true);
    assert.equal((await review.manual.get(review.manifest.id, creator) as { catchup: { review: number; complete: boolean } }).catchup.review, 1);
    assert.equal((await review.manual.get(review.manifest.id, creator) as { catchup: { complete: boolean } }).catchup.complete, false);
    const reviewCurrent = await review.manual.get(review.manifest.id, creator) as Manifest;
    await review.manual.consume(reviewCurrent.id, { expectedVersion: reviewCurrent.version, idempotencyKey: `review-no-reingest-${nonce}`, confirmed: true, limit: 25 }, creator);
    assert.deepEqual(await business(), reviewPreserved);
    // Global durable capacity includes inventory + actual payload cases, not
    // separate 4 MiB allowances. The refused observation leaves all cursors,
    // receipts, audits and epoch unchanged after the transaction aborts.
    const large = await prepare("capacity"), largeBefore = await durable(large.manifest.id);
    const largeColumns = ["ID", "Original UTC", ...Array.from({ length: 98 }, (_, index) => `Synthetic ${index}`)];
    const largeRows = Array.from({ length: 10 }, (_, index) => Object.fromEntries(largeColumns.map((column) => [column, column === "ID" ? `large-${index}` : column === "Original UTC" ? "2026-09-05T12:00:00Z" : "x".repeat(4000)])));
    large.source.values = { columns: largeColumns, rows: largeRows };
    await assert.rejects(() => permissions.transaction(async (tx) => {
      const old = await loadCutover(tx, large.manifest.id, true);
      await tx.$executeRaw`UPDATE import_cutover_manifests SET exception_observation=NULL WHERE id=${old.id}::uuid`;
      const reset = await updateCutover(tx, old, { ...old, inventory: [], headerSha256: null, snapshotSha256: null, observedAt: null, reportSha256: null, state: "DRAFT" });
      // This setup is nonce-only and itself rolled back; no historical/real row
      // or contract is rewritten, and all payloads satisfy the source limits.
      const initial = await large.manual.observe(reset.id, { expectedVersion: reset.version, idempotencyKey: `large-initial-${nonce}` }, creator) as Manifest;
      assert.ok(JSON.stringify(largeRows).length < 4 * 1024 * 1024);
      large.source.values.rows[0]!["Synthetic 0"] = "y".repeat(4000);
      await large.manual.observe(initial.id, { expectedVersion: initial.version, idempotencyKey: `large-refused-${nonce}` }, creator);
    }), (error: unknown) => code(error) === "cutover_exception_journal_bound_exceeded");
    assert.deepEqual(await durable(large.manifest.id), largeBefore);
  } finally {
    process.env.SHEETS_ENABLED = original.sheets; process.env.SHEET_CUTOVER_ENABLED = original.cutover; process.env.CRM_BACKGROUND_WORKERS = original.background; process.env.CRMY63_DATABASE_NONCE = original.nonce;
    await app.close();
  }
});
