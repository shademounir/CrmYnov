import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { deriveSecret, digestRecoveryValue } from "../../src/access-recovery/access-recovery.store.js";
import { referenceKey } from "../../src/references/reference.contract.js";
import { DynamicPermissionRepository } from "../../src/permissions/dynamic-repository.js";
import { defaultConfiguration } from "../../src/permissions/dynamic-evaluator.js";
import type { Grants } from "../../src/permissions/dynamic-contract.js";
import { BootstrapImportService } from "../../src/bootstrap-import/bootstrap-import.service.js";
import { CutoverService } from "../../src/cutover/cutover.service.js";
import { SheetImportAdminService } from "../../src/sheet-import/sheet-import-admin.service.js";
import { SheetImportCoordinator } from "../../src/sheet-import/sheet-import-coordinator.js";
import { PersistentIngestionService } from "../../src/ingestion/persistent-ingestion.service.js";
import { ImportMappingService } from "../../src/import-mapping/import-mapping.service.js";
import { SheetSource } from "../../src/sheet-import/synthetic-sheet-source.js";
import { bytesHash, CHUNK_BYTES, HISTORICAL_SHEETS, type HistoricalMappingInput } from "../../src/bootstrap-import/bootstrap-import.contract.js";
import { syntheticHistoricalParts, syntheticZip } from "../fixtures/import/historical-workbook.synthetic.js";
import type { SheetConfiguration } from "../../src/sheet-import/sheet-import-configuration.js";
import type { SheetValues } from "../../src/sheet-import/google-sheets-adapter.js";
import type { Principal } from "../../src/auth/auth.types.js";

interface Manifest {
  id: string; version: number; state: string; counts: Record<string, number>; automaticActivationAvailable: boolean; effectsApplied: boolean;
  submissions: Array<{ key: string; externalId: string; classification: string; issue: string | null; decision: string | null }>;
}
class ControlledCutoverSource extends SheetSource {
  constructor(public values: SheetValues, private readonly afterRead?: () => Promise<void>) { super(); }
  async read(): Promise<SheetValues> { const values = structuredClone(this.values); await this.afterRead?.(); return values; }
}
const enabled = process.env.CRMY63_EPHEMERAL_TEST === "true";

test("CRMY-63 real PostgreSQL/HTTP: durable T0, bounded delta, lost response replay, revoked session and no Lead effects", { skip: !enabled, timeout: 120000 }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname)); assert.equal(database.pathname, "/crmy63_cutover_synthetic");
  const prisma = new PrismaService(), client = prisma.client!;
  const marker = await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy63_test_identity.marker WHERE purpose='cutover-synthetic-qualification'`;
  assert.ok(process.env.CRMY63_DATABASE_NONCE && marker.some((row) => row.nonce === process.env.CRMY63_DATABASE_NONCE));
  const nonce = randomUUID().slice(0, 8);
  const reference = async (kind: string, code: string): Promise<{ id: string; code: string }> => {
    const row = await client.crmReference.create({ data: { kind, code, label: `Synthetic ${code}`, scope: "GLOBAL", scopeKey: "GLOBAL" } });
    await client.crmReferenceKey.create({ data: { referenceId: row.id, kind, scopeKey: "GLOBAL", key: referenceKey(code) } }); return row;
  };
  const campus = await reference("CAMPUS", `SYNTHETIC63-${nonce}`), other = await reference("CAMPUS", `OTHER63-${nonce}`), campaign = await reference("CAMPAIGN", `CAMPAIGN63-${nonce}`);
  const account = async (role: "SUPER_ADMIN" | "ADMIN" | "ADMISSIONS" | "MANAGER", campusId: string): Promise<{ id: string; email: string; password: string }> => {
    const password = `Synthetic63!${randomBytes(12).toString("hex")}`, email = `${role.toLowerCase()}-${randomUUID()}@example.invalid`, salt = randomBytes(16).toString("hex");
    const user = await client.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Synthetic ${role}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    await client.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    return { id: user.id, email, password };
  };
  const admin = await account("SUPER_ADMIN", campus.id), outsider = await account("ADMIN", other.id), commercial = await account("ADMISSIONS", campus.id);
  const manager = await account("MANAGER", campus.id), outsideManager = await account("MANAGER", other.id);
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  try {
    const origin = await app.getUrl();
    const login = async (user: { email: string; password: string }): Promise<{ token: string; sessionId: string }> => {
      const response = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(user) });
      assert.equal(response.status, 201); return response.json() as Promise<{ token: string; sessionId: string }>;
    };
    const auth = await login(admin), outsideAuth = await login(outsider), commercialAuth = await login(commercial);
    const actor: Principal = { userId: admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: auth.sessionId };
    const repository = new DynamicPermissionRepository(prisma), bootstrap = app.get(BootstrapImportService);
    const grantTarget = { kind: "ROLE" as const, role: "MANAGER" as const, campus: "GLOBAL" };
    const originalManagerGrants = defaultConfiguration(grantTarget);
    const managerGrants: Grants = { ...originalManagerGrants, "settings.campus.manage": "CAMPUS", "import.execute": "CAMPUS", "import.confirm": "CAMPUS" };
    const appendManagerGrants = async (grants: Grants, previous: Grants, expectedVersion: number): Promise<void> => {
      await repository.transaction(async (tx) => { await repository.append(tx, { ...grantTarget, expectedVersion, grants, reason: "ACCESS_REVIEW", confirmed: true }, previous, actor); });
    };
    await appendManagerGrants(managerGrants, originalManagerGrants, 0);
    const managerAuth = await login(manager), outsideManagerAuth = await login(outsideManager);
    const managerActor: Principal = { userId: manager.id, roles: ["MANAGER"], scopes: [{ kind: "CAMPUS", id: campus.id }], sessionId: managerAuth.sessionId };
    const request = async (path: string, method = "GET", body?: unknown, token = auth.token): Promise<Response> => fetch(`${origin}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const success = async <T>(response: Response, status = 201): Promise<T> => { assert.equal(response.status, status, `Unexpected HTTP status ${response.status}: ${response.status === status ? "" : await response.text()}`); return response.json() as Promise<T>; };
    const parts = syntheticHistoricalParts(); parts[0]![1] = parts[0]![1].replace("<workbook>", `<workbook data-synthetic="${nonce}">`);
    const bytes = syntheticZip(parts), sha256 = bytesHash(bytes), bootstrapPath = "/lead-import/bootstrap/packages";
    let pack = await success<{ id: string; version: number }>(await request(bootstrapPath, "POST", { fileName: "cutover-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `create-${nonce}` }));
    for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
      pack = await success(await request(`${bootstrapPath}/${pack.id}/chunks`, "POST", { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) }));
    }
    pack = await success(await request(`${bootstrapPath}/${pack.id}/seal`, "POST", { sha256 }));
    const mapping: HistoricalMappingInput = { expectedVersion: pack.version, mappingVersion: "R8-v1", sheets: HISTORICAL_SHEETS.map((name) => ({ name, campaign: campaign.code,
      fields: { lastName: "A", firstName: "B", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" }, commentColumns: ["I"], ownerAliases: {} })) };
    pack = await success(await request(`${bootstrapPath}/${pack.id}/mappings`, "POST", mapping));
    const rows = await success<{ items: Array<{ id: string; version: number }> }>(await request(`${bootstrapPath}/${pack.id}/rows`), 200);
    for (const row of rows.items) await success(await request(`${bootstrapPath}/${pack.id}/rows/${row.id}/decision`, "POST", { expectedVersion: row.version, idempotencyKey: `ignore-${row.id}`,
      action: "IGNORE", reason: "Synthetic source excluded explicitly for preparation-only cutover qualification" }));
    pack = await success(await request(`${bootstrapPath}/${pack.id}/confirm`, "POST", { expectedVersion: pack.version, idempotencyKey: `confirm-${nonce}`, confirmed: true, limit: 25 }));
    const report = await success<{ cutoverBlocked: boolean }>(await request(`${bootstrapPath}/${pack.id}/report`), 200); assert.equal(report.cutoverBlocked, false);
    const configuration: SheetConfiguration = { source: { mode: "SIMULATED", identityMode: "EXTERNAL_ID" }, mapping: { id: `mapping-${nonce}`, mappingKey: `cutover-${nonce}`, name: "Synthetic cutover",
      profile: "FORMINATOR_ZAPIER", version: 1, builtIn: false, createdAt: new Date().toISOString(), createdBy: admin.id,
      columns: [{ sourceColumn: "Submission ID", targetField: "externalId", action: "DIRECT" }, { sourceColumn: "Original arrival UTC", targetField: "occurredAt", action: "DIRECT" },
        { sourceColumn: "Comment", targetField: "firstName", action: "DIRECT" }] },
      context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", recentSource: "GOOGLE_SHEETS", campus: campus.code, campaign: campaign.code }, assignment: { strategy: "UNASSIGNED" } };
    const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_cutover_${nonce}`, tab: "SYNTHETIC", configuration: JSON.parse(JSON.stringify(configuration)) as Prisma.InputJsonValue, updatedBy: admin.id } });
    const create = { bootstrapPackageId: pack.id, connectorId: connector.id, sourceSheetId: 0, t0: "2026-09-05T12:00:00Z", timeZone: "Africa/Casablanca", excelFrozenAt: "2026-09-05T12:00:00Z",
      originalArrivalColumn: "Original arrival UTC", identityEvidenceSha256: "a".repeat(64), idempotencyKey: `cutover-create-${nonce}` };
    const path = "/lead-import/cutover/manifests";
    let manifest = await success<Manifest>(await request(path, "POST", create)); const id = manifest.id;
    assert.deepEqual(await success(await request(path, "POST", create)), manifest);
    assert.equal((await request(path, "POST", { ...create, t0: "2026-09-05T12:01:00Z", excelFrozenAt: "2026-09-05T12:01:00Z" })).status, 409);
    assert.equal((await request(`${path}/${id}`, "GET", undefined, outsideAuth.token)).status, 403);
    assert.equal((await request(`${path}/${id}`, "GET", undefined, commercialAuth.token)).status, 403);
    assert.equal((await request(`${path}/${id}`, "GET", undefined, managerAuth.token)).status, 200);
    assert.equal((await request(`${path}/${id}`, "GET", undefined, outsideManagerAuth.token)).status, 403);
    assert.equal((await success<{ state: string }>(await request(`${path}/${id}/runtime`), 200)).state, "UNQUALIFIED");
    assert.equal((await fetch(`${origin}${path}/${id}/runtime`)).status, 401, "Runtime HTTP inspection requires a real authenticated session");
    assert.equal((await request(`${path}/${id}/runtime`, "GET", undefined, managerAuth.token)).status, 403, "A valid Manager preparation grant is not a scheduled runtime authority");
    assert.equal((await request(`${path}/${id}/activate`, "POST", {})).status, 404);
    const sheetAdmin = app.get(SheetImportAdminService);
    await assert.rejects(() => sheetAdmin.save(actor, { expectedVersion: connector.version, campusId: campus.id, workbookLink: `https://docs.google.com/spreadsheets/d/${connector.workbookId}/edit`, enabled: true }, connector.id),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409 && JSON.stringify(error.getResponse()).includes("sheet_cutover_preparation_only"));
    await assert.rejects(() => sheetAdmin.requestRun(actor, connector.id, connector.version),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409 && JSON.stringify(error.getResponse()).includes("sheet_cutover_preparation_only"));
    // Even an out-of-band flag change cannot send this bound connector to the legacy consumer.
    await client.sheetImportConnector.update({ where: { id: connector.id }, data: { enabled: true, manualRequested: true } });
    try {
      assert.equal(await new SheetImportCoordinator(prisma).claim(connector.id, "MANUAL"), undefined);
      assert.equal(await client.sheetImportRun.count({ where: { connectorId: connector.id } }), 0);
    } finally { await client.sheetImportConnector.update({ where: { id: connector.id }, data: { enabled: false, manualRequested: false } }); }
    const effects = async (): Promise<unknown> => ({ leads: await client.lead.count(), notes: await client.importedHistoricalNote.count(), activities: await client.leadActivity.count(), notifications: await client.internalNotification.count() });
    const beforeEffects = await effects();
    const observation = { expectedVersion: manifest.version, idempotencyKey: `baseline-${nonce}` };
    manifest = await success<Manifest>(await request(`${path}/${id}/observe`, "POST", observation));
    assert.equal(manifest.counts.backlog, 1); assert.equal(manifest.counts.overlapReview, 1); assert.equal(manifest.automaticActivationAvailable, false); assert.equal(manifest.effectsApplied, false);
    const counts = async (): Promise<unknown> => ({ effects: await effects(), receipts: await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_receipts WHERE manifest_id=${id}::uuid`,
      audits: await client.auditEvent.count({ where: { resourceId: id } }) });
    const committed = await counts(); const receiptReplay = await success<Manifest>(await request(`${path}/${id}/observe`, "POST", observation)); assert.deepEqual(receiptReplay, manifest); assert.deepEqual(await counts(), committed);
    assert.equal((await request(`${path}/${id}/observe`, "POST", { ...observation, expectedVersion: 99 })).status, 409);
    assert.equal((await request(`${path}/${id}/reconcile`, "POST", { expectedVersion: manifest.version, idempotencyKey: `early-reconcile-${nonce}` })).status, 409);
    const decision = { expectedVersion: manifest.version, idempotencyKey: `overlap-${nonce}`, sourceKey: manifest.submissions[0]!.key, action: "KEEP_FOR_CATCHUP", reason: "Synthetic source explicitly reviewed against the excluded baseline" };
    manifest = await success(await request(`${path}/${id}/decisions`, "POST", decision));
    manifest = await success(await request(`${path}/${id}/reconcile`, "POST", { expectedVersion: manifest.version, idempotencyKey: `reconcile-${nonce}` })); assert.equal(manifest.state, "READY_FOR_CATCHUP");
    const initialValues = await app.get(SheetSource).read(connector.workbookId, connector.tab, configuration);
    const source = new ControlledCutoverSource({ ...initialValues, rows: [...initialValues.rows,
      { "Submission ID": "during-bootstrap", "Original arrival UTC": "2026-09-05T12:01:00Z" },
      { "Submission ID": "historic", "Original arrival UTC": "2026-09-05T11:59:59Z" }] });
    const service = new CutoverService(repository, bootstrap, source);
    // A real aborted transaction must not leave inventory, receipt, audit or cursor effects.
    const beforeAbort = await counts(), beforeState = await service.get(id, actor);
    const delta = { expectedVersion: manifest.version, idempotencyKey: `delta-${nonce}` };
    await assert.rejects(() => repository.transaction(async () => { await service.observe(id, delta, actor); throw new Error("synthetic_abort_before_commit"); }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 503 && JSON.stringify(error.getResponse()).includes("permission_store_unavailable"));
    assert.deepEqual(await counts(), beforeAbort); assert.deepEqual(await service.get(id, actor), beforeState);
    manifest = await service.observe(id, delta, actor) as Manifest;
    assert.equal(manifest.state, "BASELINED"); assert.equal(manifest.counts.backlog, 2); assert.equal(manifest.counts.excludedPreT0, 1); assert.equal(manifest.counts.overlapReview, 1);
    const afterDelta = await counts();
    const restarted = new CutoverService(new DynamicPermissionRepository(prisma), bootstrap, source);
    assert.deepEqual(await restarted.observe(id, delta, actor), manifest); assert.deepEqual(await counts(), afterDelta);
    // Identical concurrent requests converge to the same persisted receipt; no new source identity is minted.
    const simultaneous = { expectedVersion: manifest.version, idempotencyKey: `concurrent-${nonce}` };
    const results = await Promise.all([restarted.observe(id, simultaneous, actor), service.observe(id, simultaneous, actor)]);
    assert.deepEqual(results[0], results[1]); manifest = results[0] as Manifest;
    const historic = source.values.rows.find((row) => row["Submission ID"] === "historic")!; historic["Original arrival UTC"] = "2026-09-05T13:00:00Z";
    manifest = await restarted.observe(id, { expectedVersion: manifest.version, idempotencyKey: `old-edit-${nonce}` }, actor) as Manifest;
    assert.equal(manifest.submissions.find((row) => row.externalId === "historic")!.classification, "EXCLUDED_PRE_T0");
    assert.equal(manifest.submissions.find((row) => row.externalId === "historic")!.issue, "SOURCE_CHANGED");
    manifest = await restarted.suspend(id, { expectedVersion: manifest.version, idempotencyKey: `pause-${nonce}`, reason: "Synthetic preparation pause; preserve every source and receipt" }, actor) as Manifest;
    assert.equal(manifest.state, "SUSPENDED");
    await assert.rejects(() => restarted.observe(id, { expectedVersion: manifest.version, idempotencyKey: `denied-paused-${nonce}` }, actor), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
    manifest = await restarted.suspend(id, { expectedVersion: manifest.version, idempotencyKey: `resume-${nonce}`, reason: "Synthetic explicit resume requires observation and reconciliation" }, actor, true) as Manifest;
    assert.equal(manifest.state, "DRAFT");
    await assert.rejects(() => restarted.reconcile(id, { expectedVersion: manifest.version, idempotencyKey: `resume-needs-observation-${nonce}` }, actor),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
    assert.deepEqual(await effects(), beforeEffects); assert.equal((await client.sheetImportConnector.findUniqueOrThrow({ where: { id: connector.id } })).enabled, false);
    // Current grants and bindings, not only session validity, are rechecked after external I/O.
    const beforeGrant = await counts();
    const grantSource = new ControlledCutoverSource(source.values, async () => { await appendManagerGrants({ ...managerGrants, "import.execute": "NONE" }, managerGrants, 1); });
    await assert.rejects(() => new CutoverService(new DynamicPermissionRepository(prisma), bootstrap, grantSource).observe(id,
      { expectedVersion: manifest.version, idempotencyKey: `grant-revoked-${nonce}` }, managerActor), (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
    assert.deepEqual(await counts(), beforeGrant);
    await appendManagerGrants(managerGrants, { ...managerGrants, "import.execute": "NONE" }, 2);
    const beforeBinding = await counts();
    const bindingSource = new ControlledCutoverSource(source.values, async () => { await client.sheetImportConnector.update({ where: { id: connector.id }, data: { version: { increment: 1 } } }); });
    await assert.rejects(() => new CutoverService(new DynamicPermissionRepository(prisma), bootstrap, bindingSource).observe(id,
      { expectedVersion: manifest.version, idempotencyKey: `binding-changed-${nonce}` }, actor), (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
    assert.deepEqual(await counts(), beforeBinding);
    assert.equal((await request(`${path}/${id}/observe`, "POST", observation)).status, 409, "Even a previously successful receipt must recheck the current binding");
    await client.sheetImportConnector.update({ where: { id: connector.id }, data: { version: connector.version } });
    const admissionsTarget = { kind: "ROLE" as const, role: "ADMISSIONS" as const, campus: "GLOBAL" };
    const admissionsOriginal = defaultConfiguration(admissionsTarget);
    await repository.transaction(async (tx) => { await repository.append(tx, { ...admissionsTarget, expectedVersion: 0,
      grants: { ...admissionsOriginal, "settings.campus.manage": "CAMPUS", "import.view": "CAMPUS", "import.execute": "CAMPUS" }, reason: "ACCESS_REVIEW", confirmed: true }, admissionsOriginal, actor); });
    const beforeRole = await counts();
    const roleSource = new ControlledCutoverSource(source.values, async () => { await client.collaborator.update({ where: { id: manager.id }, data: { roles: ["ADMISSIONS"] } }); });
    await assert.rejects(() => new CutoverService(new DynamicPermissionRepository(prisma), bootstrap, roleSource).observe(id,
      { expectedVersion: manifest.version, idempotencyKey: `role-downgrade-${nonce}` }, managerActor), (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
    assert.deepEqual(await counts(), beforeRole);
    await client.collaborator.update({ where: { id: manager.id }, data: { roles: ["MANAGER"] } });
    const boundedValues = (prefix: string): SheetValues => ({ columns: initialValues.columns, rows: Array.from({ length: 500 }, (_, index) => ({
      "Submission ID": `${prefix}-${index}`, "Original arrival UTC": "2026-09-05T12:02:00Z", Comment: "x".repeat(4000) })) });
    const bounded = new ControlledCutoverSource(boundedValues("first"));
    const boundedService = new CutoverService(new DynamicPermissionRepository(prisma), bootstrap, bounded);
    manifest = await boundedService.observe(id, { expectedVersion: manifest.version, idempotencyKey: `capacity-first-${nonce}` }, actor) as Manifest;
    const beforeCapacity = await counts(), preservedCapacity = await boundedService.get(id, actor);
    bounded.values = boundedValues("second");
    await assert.rejects(() => boundedService.observe(id, { expectedVersion: manifest.version, idempotencyKey: `capacity-refused-${nonce}` }, actor),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 400 && JSON.stringify(error.getResponse()).includes("cutover_ledger_bound_exceeded"));
    assert.deepEqual(await counts(), beforeCapacity); assert.deepEqual(await boundedService.get(id, actor), preservedCapacity);
    // Revocation during external I/O is rechecked before committing the observation.
    const revokeSource = new ControlledCutoverSource(source.values, async () => { await client.localSession.update({ where: { id: actor.sessionId }, data: { active: false } }); });
    const revokeService = new CutoverService(new DynamicPermissionRepository(prisma), bootstrap, revokeSource), beforeRevocation = await counts();
    await assert.rejects(() => revokeService.observe(id, { expectedVersion: manifest.version, idempotencyKey: `revoked-${nonce}` }, actor), (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
    assert.deepEqual(await counts(), beforeRevocation);
    await assert.rejects(() => revokeService.observe(id, delta, actor), (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
    assert.equal((await request(`${path}/${id}`, "GET")).status, 401);
    const swagger = await success<{ paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } }>(await fetch(`${origin}/docs-json`), 200);
    assert.equal(Object.keys(swagger.paths).filter((route) => route.startsWith("/lead-import/cutover/")).length, 14); assert.ok(swagger.components.schemas.CutoverCreate);
    for (const suffix of ["", "/qualify", "/arm", "/disarm"]) assert.ok(swagger.paths[`/lead-import/cutover/manifests/{id}/runtime${suffix}`]);
    assert.ok(swagger.components.schemas.CutoverRuntimeQualification); assert.ok(swagger.components.schemas.CutoverRuntimeArm);
  } finally { await app.close(); await prisma.onModuleDestroy(); }
});

test("CRMY-63 manual NEW catch-up: stable stream, atomic replay, explicit baseline link and conservative compensation", { skip: !enabled, timeout: 120000 }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? ""); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.pathname, "/crmy63_cutover_synthetic");
  const prisma = new PrismaService(), client = prisma.client!;
  const marker = await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy63_test_identity.marker WHERE purpose='cutover-synthetic-qualification'`;
  assert.ok(marker.some((row) => row.nonce === process.env.CRMY63_DATABASE_NONCE));
  const nonce = randomUUID().slice(0, 8);
  const reference = async (kind: string, code: string): Promise<{ id: string; code: string }> => {
    const row = await client.crmReference.create({ data: { kind, code, label: `Synthetic ${code}`, scope: "GLOBAL", scopeKey: "GLOBAL" } });
    await client.crmReferenceKey.create({ data: { referenceId: row.id, kind, scopeKey: "GLOBAL", key: referenceKey(code) } }); return row;
  };
  const campus = await reference("CAMPUS", `CONSUMER63-${nonce}`), program = await reference("PROGRAM", `PROGRAM63-${nonce}`), campaign = await reference("CAMPAIGN", `CATCHUP63-${nonce}`);
  await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id } });
  const password = `Synthetic63!${randomBytes(12).toString("hex")}`, email = `consumer-${nonce}@example.invalid`, salt = randomBytes(16).toString("hex");
  const admin = await client.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: "Synthetic cutover consumer", roles: ["SUPER_ADMIN"], campusId: campus.id, active: true, firstLoginRequired: false } });
  await client.localPasswordHash.create({ data: { collaboratorId: admin.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  try {
    const origin = await app.getUrl(), logged = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(logged.status, 201); const auth = await logged.json() as { token: string; sessionId: string };
    const actor: Principal = { userId: admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: auth.sessionId };
    const request = async (path: string, body?: unknown): Promise<Response> => fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const success = async <T>(response: Response, status = 201): Promise<T> => { assert.equal(response.status, status, `Unexpected HTTP status ${response.status}: ${response.status === status ? "" : await response.text()}`); return response.json() as Promise<T>; };
    const bootstrapPath = "/lead-import/bootstrap/packages";
    const upload = async (tag: string): Promise<{ id: string; version: number }> => {
      const parts = syntheticHistoricalParts({ workbookExtra: `<definedNames data-synthetic="${nonce}-${tag}"/>` });
      for (const part of parts) part[1] = part[1].replaceAll("PROGRAM_SYNTHETIC", program.code).replaceAll("synthetic@example.invalid", `baseline-${nonce}-${tag}@example.invalid`);
      const bytes = syntheticZip(parts), sha256 = bytesHash(bytes);
      let pack = await success<{ id: string; version: number }>(await request(bootstrapPath, { fileName: "cutover-consumer-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `create-${nonce}-${tag}` }));
      for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CHUNK_BYTES); pack = await success(await request(`${bootstrapPath}/${pack.id}/chunks`, { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) }));
      }
      return success(await request(`${bootstrapPath}/${pack.id}/seal`, { sha256 }));
    };
    let pack = await upload("main");
    pack = await success(await request(`${bootstrapPath}/${pack.id}/mappings`, { expectedVersion: pack.version, mappingVersion: "R8-v1", sheets: HISTORICAL_SHEETS.map((name) => ({ name, campaign: campaign.code,
      fields: { lastName: "A", firstName: "B", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" }, commentColumns: ["I"], ownerAliases: {} })) }));
    const rows = await success<{ items: Array<{ id: string; version: number }> }>(await request(`${bootstrapPath}/${pack.id}/rows`), 200), baselineRow = rows.items[0]!;
    for (const row of rows.items.slice(1)) await success(await request(`${bootstrapPath}/${pack.id}/rows/${row.id}/decision`, { expectedVersion: row.version, idempotencyKey: `ignore-${row.id}`, action: "IGNORE", reason: "Synthetic excluded source retained explicitly" }));
    await success(await request(`${bootstrapPath}/${pack.id}/rows/${baselineRow.id}/decision`, { expectedVersion: baselineRow.version, idempotencyKey: `baseline-${nonce}`, action: "CREATE_DOSSIER", reason: "Synthetic baseline created unassigned explicitly", overrides: { ownerId: "" } }));
    pack = await success(await request(`${bootstrapPath}/${pack.id}/confirm`, { expectedVersion: pack.version, idempotencyKey: `confirm-${nonce}`, confirmed: true, limit: 25 }));
    assert.equal((await success<{ cutoverBlocked: boolean }>(await request(`${bootstrapPath}/${pack.id}/report`), 200)).cutoverBlocked, false);
    const baselineLeadId = (await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: baselineRow.id } })).leadId!;
    const mappings = app.get(ImportMappingService);
    const mapping = mappings.snapshot({ mappingKey: `consumer-${nonce}`, name: "Synthetic catch-up mapping", profile: "FORMINATOR_ZAPIER", expectedVersion: 0,
      columns: [{ sourceColumn: "ID", targetField: "externalId", action: "DIRECT" }, { sourceColumn: "Arrived", targetField: "occurredAt", action: "DIRECT" },
        { sourceColumn: "First", targetField: "firstName", action: "DIRECT" }, { sourceColumn: "Last", targetField: "lastName", action: "DIRECT" }, { sourceColumn: "Email", targetField: "email", action: "DIRECT" }] }, actor.userId, new Date().toISOString());
    const configuration: SheetConfiguration = { source: { mode: "SIMULATED", identityMode: "EXTERNAL_ID" }, mapping,
      context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", recentSource: "GOOGLE_SHEETS", campus: campus.code, campaign: campaign.code, program: program.code, educationLevel: "BAC" }, assignment: { strategy: "ROUND_ROBIN" } };
    const connector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: `synthetic_consumer_${nonce}`, tab: "Synthetic", configuration: JSON.parse(JSON.stringify(configuration)) as Prisma.InputJsonValue, updatedBy: actor.userId } });
    const path = "/lead-import/cutover/manifests", creation = { bootstrapPackageId: pack.id, connectorId: connector.id, sourceSheetId: 0, t0: "2026-09-05T12:00:00Z", timeZone: "Africa/Casablanca", excelFrozenAt: "2026-09-05T12:00:00Z", originalArrivalColumn: "Arrived", identityEvidenceSha256: "b".repeat(64), idempotencyKey: `manifest-${nonce}` };
    assert.equal((await request(path, { ...creation, excelFrozenAt: "2026-09-05T11:55:00Z" })).status, 400, "The unqualified gap cannot silently exclude an arrival at 11:59:59 absent from Excel");
    let manifest = await success<Manifest>(await request(path, creation)); const id = manifest.id;
    const secondPack = await upload("recreated"), secondConnector = await client.sheetImportConnector.create({ data: { campusId: campus.id, workbookId: connector.workbookId, tab: "Synthetic renamed", configuration: connector.configuration as Prisma.InputJsonValue, updatedBy: actor.userId } });
    assert.equal((await request(path, { ...creation, bootstrapPackageId: secondPack.id, connectorId: secondConnector.id, idempotencyKey: `recreated-${nonce}` })).status, 409, "A recreated connector is not a new source stream");
    await client.sheetImportConnector.update({ where: { id: secondConnector.id }, data: { enabled: true, configuration: { ...configuration, source: { mode: "GOOGLE", identityMode: "EXTERNAL_ID", sheetId: 0, range: "A1:E100" } } as unknown as Prisma.InputJsonValue } });
    assert.equal(await new SheetImportCoordinator(prisma).claim(secondConnector.id, "MANUAL"), undefined, "Legacy execution also recognizes the same stream on a recreated connector");
    await client.sheetImportConnector.update({ where: { id: secondConnector.id }, data: { enabled: false } });
    const values: SheetValues = { columns: ["ID", "Arrived", "First", "Last", "Email"], rows: [
      { ID: "old", Arrived: "2026-09-05T11:59:59Z", First: "Old", Last: "Synthetic", Email: `old-${nonce}@example.invalid` },
      ...["one", "two", "linked"].map((name) => ({ ID: name, Arrived: "2026-09-05T12:01:00Z", First: name, Last: "Synthetic", Email: `${name}-${nonce}@example.invalid` }))] };
    // Keep all nested services on the application's transaction/permission fence.
    // A second PrismaService would legitimately contend with the outer write lock.
    const source = new ControlledCutoverSource(values), repository = app.get(DynamicPermissionRepository), bootstrap = app.get(BootstrapImportService), ingestion = app.get(PersistentIngestionService);
    const service = (): CutoverService => new CutoverService(repository, bootstrap, source, ingestion, mappings);
    const otherCampus = await reference("CAMPUS", `MOVED63-${nonce}`);
    const scopedAdmin = await client.collaborator.create({ data: { professionalEmail: `scoped-${nonce}@example.invalid`, professionalDisplayName: "Synthetic runtime target reader", roles: ["ADMIN"], campusId: campus.id, active: true, firstLoginRequired: false } });
    const counts = async (): Promise<unknown> => ({ leads: await client.lead.count(), provenance: await client.leadProvenance.count(), activities: await client.leadActivity.count(), notifications: await client.internalNotification.count(),
      batches: await client.ingestionBatch.count(), reports: await client.importReport.count(), allAudits: await client.auditEvent.count(),
      effects: await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_effects WHERE manifest_id=${id}::uuid`, receipts: await client.$queryRaw`SELECT count(*)::int AS count FROM import_cutover_receipts WHERE manifest_id=${id}::uuid`, audits: await client.auditEvent.count({ where: { resourceId: id } }) });
    const observeBody = { expectedVersion: manifest.version, idempotencyKey: `observe-${nonce}` };
    manifest = await service().observe(id, observeBody, actor) as Manifest;
    const decisionBodies = new Map<string, Record<string, unknown>>();
    for (const entry of manifest.submissions.filter((item) => item.classification === "BACKLOG")) {
      const body = { expectedVersion: manifest.version, idempotencyKey: `decide-${entry.externalId}-${nonce}`, sourceKey: entry.key,
        action: entry.externalId === "linked" ? "LINK_BASELINE" : "KEEP_FOR_CATCHUP", ...(entry.externalId === "linked" ? { targetBootstrapRowId: baselineRow.id } : {}), reason: "Synthetic explicit overlap reconciliation" };
      if (entry.externalId === "linked") {
        const beforeMovedDecision = await counts();
        await assert.rejects(() => repository.transaction(async (tx) => {
          await tx.lead.update({ where: { id: baselineLeadId }, data: { campus: otherCampus.code } });
          await service().decide(id, body, actor);
        }), (error: unknown) => error instanceof HttpException && error.getStatus() === 409 && JSON.stringify(error.getResponse()).includes("cutover_baseline_campus_mismatch"));
        assert.deepEqual(await counts(), beforeMovedDecision);
        assert.equal((await client.lead.findUniqueOrThrow({ where: { id: baselineLeadId } })).campus, campus.code);
      }
      decisionBodies.set(entry.externalId, body); manifest = await success(await request(`${path}/${id}/decisions`, body));
    }
    manifest = await success(await request(`${path}/${id}/reconcile`, { expectedVersion: manifest.version, idempotencyKey: `reconcile-${nonce}` }));
    const before = await counts(), consume = { expectedVersion: manifest.version, idempotencyKey: `consume-${nonce}`, limit: 1, confirmed: true };
    // Even GLOBAL visibility cannot bind a historical target that moved out of
    // this immutable campus; an attempted mixed NEW+LINK chunk rolls back whole.
    for (const operation of ["reconcile", "consume"] as const) {
      await assert.rejects(() => repository.transaction(async (tx) => {
        await tx.lead.update({ where: { id: baselineLeadId }, data: { campus: otherCampus.code } });
        await service()[operation](id, { ...consume, limit: 25, idempotencyKey: `moved-${operation}-${nonce}` }, actor);
      }), (error: unknown) => error instanceof HttpException && error.getStatus() === 409 && JSON.stringify(error.getResponse()).includes("cutover_baseline_campus_mismatch"));
      assert.deepEqual(await counts(), before);
    }
    // Structural completeness is not permission to hide current target axes.
    // Either persisted authority being unable to see a BASELINE target denies
    // the runtime report, while the ordinary GLOBAL HTTP projection is intact.
    for (const [creator, authorizer] of [[admin, scopedAdmin], [scopedAdmin, admin]]) {
      const delegation = { creatorId: creator!.id, authorizedBy: authorizer!.id,
        creatorAuthenticationVersion: creator!.authenticationVersion, authorizerAuthenticationVersion: authorizer!.authenticationVersion };
      const visibleReport = await repository.readTransaction((tx) => bootstrap.reportCutoverRuntime(tx, pack.id, delegation, id, false)) as { reconciliation: { currentDossierAxes: { withheld: number } } };
      assert.equal(visibleReport.reconciliation.currentDossierAxes.withheld, 0, "Both authority arrangements are valid before the actual Lead moves");
      await assert.rejects(() => repository.transaction(async (tx) => {
        await tx.lead.update({ where: { id: baselineLeadId }, data: { campus: otherCampus.code } });
        assert.equal((await bootstrap.report(pack.id, actor) as { cutoverBlocked: boolean }).cutoverBlocked, false);
        await bootstrap.reportCutoverRuntime(tx, pack.id, delegation, id, false);
      }), (error: unknown) => error instanceof HttpException && error.getStatus() === 403 && JSON.stringify(error.getResponse()).includes("cutover_runtime_authority_revoked"));
      assert.deepEqual(await counts(), before);
    }
    for (const operation of ["reconcile", "consume"] as const) {
      await assert.rejects(() => repository.transaction(async (tx) => {
        // Emulate a previously persisted preparatory contract only inside the
        // aborting synthetic transaction; never rewrite real contract/history.
        await tx.$executeRaw`UPDATE import_cutover_manifests SET contract=jsonb_set(contract,'{excelFrozenAt}',${JSON.stringify("2026-09-05T11:55:00.000Z")}::jsonb) WHERE id=${id}::uuid`;
        await service()[operation](id, consume, actor);
      }), (error: unknown) => error instanceof HttpException && error.getStatus() === 400 && JSON.stringify(error.getResponse()).includes("cutover_freeze_delta_unqualified"));
      assert.deepEqual(await counts(), before);
    }
    let reachedAbort = false;
    await assert.rejects(() => repository.transaction(async () => { await new CutoverService(repository, bootstrap, source, ingestion, mappings).consume(id, consume, actor); reachedAbort = true; throw new Error("synthetic_consume_abort"); }), (error: unknown) => error instanceof HttpException && error.getStatus() === 503);
    assert.equal(reachedAbort, true, "The explicit transaction abort occurs only after a complete consumer write, not an accidental earlier store error");
    assert.deepEqual(await counts(), before);
    const first = await success<Record<string, unknown>>(await request(`${path}/${id}/consume`, consume)); const afterFirst = await counts();
    assert.deepEqual(await service().consume(id, consume, actor), first); assert.deepEqual(await counts(), afterFirst);
    manifest = first as unknown as Manifest;
    const remaining = { expectedVersion: manifest.version, idempotencyKey: `consume-rest-${nonce}`, limit: 25, confirmed: true };
    const concurrent = await Promise.all([service().consume(id, remaining, actor), service().consume(id, remaining, actor)]); assert.deepEqual(concurrent[0], concurrent[1]);
    const completed = concurrent[0] as Manifest & { effects: Array<{ sourceKey: string; outcome: string; leadId?: string }>; catchup: { created: number; linkedBaseline: number; pending: number; complete: boolean } };
    assert.equal(completed.catchup.created, 2); assert.equal(completed.catchup.linkedBaseline, 1); assert.equal(completed.catchup.pending, 0); assert.equal(completed.catchup.complete, true);
    const createdEffects = completed.effects.filter((effect) => effect.outcome === "CREATED");
    for (const effect of createdEffects) { const lead = await client.lead.findUniqueOrThrow({ where: { id: effect.leadId! } }); assert.equal(lead.acquisitionKind, "NEW"); assert.equal(lead.assignedToId, null);
      assert.equal(await client.leadActivity.count({ where: { leadId: lead.id, type: "LEAD_CREATED" } }), 1); assert.equal(await client.leadProvenance.count({ where: { leadId: lead.id } }), 1); }
    assert.ok((await client.leadActivity.findMany({ where: { leadId: { in: createdEffects.map((effect) => effect.leadId!) } } })).every((activity) => activity.correlationId.length <= 64 && activity.correlationId.startsWith("c63:")));
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: baselineLeadId } })).acquisitionKind, "BASELINE");
    assert.equal(await client.leadProvenance.count({ where: { leadId: baselineLeadId } }), 1, "LINK_BASELINE must not fabricate a NEW reception");
    assert.equal(await client.lead.count({ where: { email: `old-${nonce}@example.invalid` } }), 0);
    // Persisted receipts never retain the initial actor's visibility after current grants change.
    const target = { kind: "ROLE" as const, role: "SUPER_ADMIN" as const, campus: "GLOBAL" }, original = defaultConfiguration(target);
    const grant = async (grants: Grants, previous: Grants, expectedVersion: number): Promise<void> => repository.transaction(async (tx) => {
      await repository.append(tx, { ...target, expectedVersion, grants, reason: "ACCESS_REVIEW", confirmed: true }, previous, actor);
    });
    const noView: Grants = { ...original, "lead.view": "NONE" }; await grant(noView, original, 0);
    const beforeRestrictedReplay = await counts();
    const restricted = await success<{ effects: Array<{ leadId?: string; leadVisible: boolean }>; submissions: Array<{ targetBootstrapRowId: string | null }> }>(await request(`${path}/${id}`), 200);
    assert.ok(restricted.effects.every((effect) => !effect.leadVisible && effect.leadId === undefined));
    assert.ok(restricted.submissions.every((submission) => submission.targetBootstrapRowId === null));
    assert.equal((await request(`${path}/${id}/decisions`, decisionBodies.get("linked"))).status, 403, "A replayed receipt must not disclose a previously readable BASELINE target");
    assert.equal((await request(`${path}/${id}/consume`, remaining)).status, 403);
    assert.deepEqual(await counts(), beforeRestrictedReplay);
    await grant(original, noView, 1);
    const noConfirm: Grants = { ...original, "import.confirm": "NONE" }; await grant(noConfirm, original, 2);
    const beforeCapabilityReplay = await counts();
    const observedReplay = await success<{ capabilities: { canConsume: boolean } }>(await request(`${path}/${id}/observe`, observeBody));
    assert.equal(observedReplay.capabilities.canConsume, false, "An OBSERVE replay cannot advertise a removed confirmation capability");
    assert.deepEqual(await counts(), beforeCapabilityReplay); await grant(original, noConfirm, 3);
    const noMore = await service().consume(id, { expectedVersion: completed.version, idempotencyKey: `no-more-${nonce}`, limit: 25, confirmed: true }, actor) as Manifest;
    assert.equal((await client.sheetImportConnector.findUniqueOrThrow({ where: { id: connector.id } })).enabled, false);
    // An untouched creation can request compensation, but no retirement is falsely claimed.
    const untouched = createdEffects[0]!, touched = createdEffects[1]!;
    const requestBody = { expectedVersion: noMore.version, idempotencyKey: `compensate-request-${nonce}`, sourceKey: untouched.sourceKey, reason: "Synthetic reversible forward-action request", confirmed: true };
    const ownEdit: Grants = { ...original, "lead.edit": "OWN" }; await grant(ownEdit, original, 4);
    const beforeEditRefusal = await counts();
    const replayAfterEditRestriction = await success<{ capabilities: { canCompensate: boolean } }>(await request(`${path}/${id}/decisions`, decisionBodies.get("linked")));
    assert.equal(replayAfterEditRestriction.capabilities.canCompensate, false, "Receipt capabilities are recalculated rather than copied from their original actor");
    assert.equal((await request(`${path}/${id}/compensate`, requestBody)).status, 403, "Compensation checks lead.edit on the actual unassigned Lead, not only import campus rights");
    assert.equal((await success<{ capabilities: { canCompensate: boolean } }>(await request(`${path}/${id}`), 200)).capabilities.canCompensate, false);
    assert.deepEqual(await counts(), beforeEditRefusal); await grant(original, ownEdit, 5);
    const requested = await success<Manifest & { compensation: { status: string; applied: boolean } }>(await request(`${path}/${id}/compensate`, requestBody));
    assert.equal(requested.compensation.status, "REQUESTED"); assert.equal(requested.compensation.applied, false); assert.equal(requested.state, "SUSPENDED");
    const afterRequest = await counts(); assert.deepEqual(await service().compensate(id, requestBody, actor), requested); assert.deepEqual(await counts(), afterRequest);
    await client.leadActivity.create({ data: { leadId: touched.leadId!, type: "MEETING", result: "Synthetic later business activity", authorId: actor.userId, correlationId: `downstream-${nonce}` } });
    const blocked = await success<Manifest & { compensation: { status: string; applied: boolean } }>(await request(`${path}/${id}/compensate`, { expectedVersion: requested.version, idempotencyKey: `compensate-blocked-${nonce}`, sourceKey: touched.sourceKey, reason: "Synthetic downstream write must not be erased", confirmed: true }));
    assert.equal(blocked.compensation.status, "BLOCKED_DOWNSTREAM"); assert.equal(blocked.compensation.applied, false);
    assert.equal(await client.lead.count({ where: { id: { in: createdEffects.map((effect) => effect.leadId!) } } }), 2, "Requests/refusals never delete or reclassify data");
  } finally { await app.close(); await prisma.onModuleDestroy(); }
});
