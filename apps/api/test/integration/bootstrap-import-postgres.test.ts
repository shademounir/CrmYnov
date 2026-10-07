import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "../../src/application.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { deriveSecret, digestRecoveryValue } from "../../src/access-recovery/access-recovery.store.js";
import { BootstrapImportService } from "../../src/bootstrap-import/bootstrap-import.service.js";
import { DynamicPermissionRepository } from "../../src/permissions/dynamic-repository.js";
import { DynamicPermissionService } from "../../src/permissions/dynamic-service.js";
import { bytesHash, CHUNK_BYTES, HISTORICAL_SHEETS, type HistoricalMappingInput } from "../../src/bootstrap-import/bootstrap-import.contract.js";
import { referenceKey } from "../../src/references/reference.contract.js";
import { syntheticHistoricalParts, syntheticZip } from "../fixtures/import/historical-workbook.synthetic.js";
import type { Principal } from "../../src/auth/auth.types.js";
import { crashChildEntrypoint } from "../fixtures/import/bootstrap-crash-child.js";
void crashChildEntrypoint; // Compile the owned child fixture into the same qualified artifact tree.

type Package = { id: string; version: number; state: string; batchId: string; counts: { accepted: number; review: number; ignored: number; pending: number } };
type Row = { id: string; version: number; state: string; leadId?: string; sheet: string };
const enabled = process.env.CRMY61_EPHEMERAL_TEST === "true";

test("CRMY-61 real HTTP/Prisma: immutable upload, decisions, atomic notes/receipt, replay and revoked/campus grants", { skip: !enabled, timeout: 120000 }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname)); assert.equal(database.pathname, "/crmy61_bootstrap_synthetic");
  const prisma = new PrismaService(); const client = prisma.client!; const marker = randomUUID().slice(0, 8).toUpperCase();
  const identity = await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy61_test_identity.marker WHERE purpose='historical-bootstrap-synthetic-qualification'`;
  assert.ok(process.env.CRMY61_DATABASE_NONCE && identity.some((row) => row.nonce === process.env.CRMY61_DATABASE_NONCE), "synthetic_database_identity_required");
  const reference = async (kind: string, code: string): Promise<{ id: string; code: string }> => {
    const row = await client.crmReference.create({ data: { kind, code, label: `Synthétique ${code}`, scope: "GLOBAL", scopeKey: "GLOBAL" } });
    await client.crmReferenceKey.create({ data: { referenceId: row.id, kind, scopeKey: "GLOBAL", key: referenceKey(code) } }); return row;
  };
  const campus = await reference("CAMPUS", `SYNTHETIC61-${marker}`); const otherCampus = await reference("CAMPUS", `OTHER61-${marker}`);
  const program = await reference("PROGRAM", `PROGRAM61-${marker}`); const campaign = await reference("CAMPAIGN", `CAMPAIGN61-${marker}`);
  await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id } });
  const account = async (role: string, campusId: string): Promise<{ id: string; email: string; password: string }> => {
    const password = `Synthetic61!${randomBytes(12).toString("hex")}`; const email = `${role.toLowerCase()}-${marker.toLowerCase()}-${randomUUID().slice(0, 6)}@example.invalid`; const salt = randomBytes(16).toString("hex");
    const user = await client.collaborator.create({ data: { professionalEmail: email, professionalDisplayName: `Recette ${role}`, roles: [role], campusId, active: true, firstLoginRequired: false } });
    await client.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: digestRecoveryValue(email), passwordSalt: salt, passwordDigest: deriveSecret(password, salt), mustChange: false } });
    return { id: user.id, email, password };
  };
  const admin = await account("SUPER_ADMIN", campus.id); const adviser = await account("ADMISSIONS", campus.id); const outsider = await account("ADMIN", otherCampus.id); const secondAdmin = await account("ADMIN", campus.id);
  const app = await createApplication(); await app.listen(0, "127.0.0.1");
  try {
    const origin = await app.getUrl();
    const login = async (user: { email: string; password: string }): Promise<{ token: string; sessionId: string }> => {
      const response = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(user) });
      assert.equal(response.status, 201); const data = await response.json() as { token: string; sessionId: string; mustChangeSecret: boolean }; assert.equal(data.mustChangeSecret, false); return data;
    };
    const auth = await login(admin); const adviserAuth = await login(adviser); const outsiderAuth = await login(outsider); const secondAuth = await login(secondAdmin);
    const request = async (path: string, method = "GET", body?: unknown, token = auth.token): Promise<Response> => fetch(`${origin}/lead-import/bootstrap${path}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const success = async <T>(response: Response, expected = 201): Promise<T> => { assert.equal(response.status, expected, `unexpected HTTP status ${response.status}`); return response.json() as Promise<T>; };
    const context = await success<{ campuses: Array<{ id: string }>; owners: Array<{ id: string }> }>(await request("/context"), 200);
    assert.ok(context.campuses.some((row) => row.id === campus.id)); assert.ok(context.owners.some((row) => row.id === adviser.id));
    const swagger = await fetch(`${origin}/docs-json`); assert.equal(swagger.status, 200); const documented = await swagger.json() as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    assert.equal(Object.keys(documented.paths).filter((path) => path.startsWith("/lead-import/bootstrap/")).length, 11); assert.ok(documented.components.schemas.BootstrapDecision);
    const parts = syntheticHistoricalParts(); for (const part of parts) part[1] = part[1].replaceAll("PROGRAM_SYNTHETIC", program.code);
    const bytes = syntheticZip(parts); const sha256 = bytesHash(bytes);
    let pack = await success<Package>(await request("/packages", "POST", { fileName: "bootstrap-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `create-${marker}` }));
    assert.equal((await request(`/packages/${pack.id}`, "GET", undefined, outsiderAuth.token)).status, 403);
    assert.equal((await request("/context", "GET", undefined, adviserAuth.token)).status, 403);
    const duplicate = await success<Package & { replayed: boolean }>(await request("/packages", "POST", { fileName: "renamed-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `different-${marker}` }));
    assert.equal(duplicate.id, pack.id); assert.equal(duplicate.replayed, true);
    const secondActorSnapshot = await success<Package>(await request("/packages", "POST", { fileName: "second-actor-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: campus.id, idempotencyKey: `second-${marker}` }, secondAuth.token)); assert.equal(secondActorSnapshot.id, pack.id);
    assert.equal((await request("/packages", "POST", { fileName: "other-campus-synthetic.xlsx", sizeBytes: bytes.length, sha256, campusId: otherCampus.id, idempotencyKey: `outside-${marker}` }, outsiderAuth.token)).status, 409);
    for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK_BYTES, index++) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES); pack = await success<Package>(await request(`/packages/${pack.id}/chunks`, "POST", { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) }));
    }
    pack = await success<Package>(await request(`/packages/${pack.id}/seal`, "POST", { sha256 })); assert.equal(pack.state, "SEALED");
    const mapping: HistoricalMappingInput = { expectedVersion: pack.version, mappingVersion: "R8-v1", sheets: HISTORICAL_SHEETS.map((name) => ({ name, campaign: campaign.code,
      fields: { lastName: "A", firstName: "B", email: "C", educationLevel: "D", program: "E", source: "F", status: "G", owner: "H", temperature: "J" }, commentColumns: ["I"], ownerAliases: { "Conseiller synthétique": adviser.id } })) };
    pack = await success<Package>(await request(`/packages/${pack.id}/mappings`, "POST", mapping)); assert.equal(pack.counts.review, 4);
    const rows = await success<{ items: Row[] }>(await request(`/packages/${pack.id}/rows`), 200); assert.equal(rows.items.length, 4);
    const first = rows.items[0]!; const second = rows.items[1]!; const third = rows.items[2]!; const fourth = rows.items[3]!;
    const decide = async (row: Row, action: string, targetLeadId?: string): Promise<Row> => success<Row>(await request(`/packages/${pack.id}/rows/${row.id}/decision`, "POST", {
      expectedVersion: row.version, idempotencyKey: `decision-${marker}-${row.id}`, action, reason: "Résolution explicite du dossier synthétique", ...(targetLeadId ? { targetLeadId } : {}) }));
    await decide(first, "CREATE_DOSSIER");
    const confirm = { expectedVersion: pack.version, idempotencyKey: `confirm-first-${marker}`, confirmed: true as const, limit: 1 };
    const principal: Principal = { userId: admin.id, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: auth.sessionId };
    const effectCounts = async (): Promise<unknown> => ({ leads: await client.lead.count(), notes: await client.importedHistoricalNote.count(), provenance: await client.leadProvenance.count(), receipts: await client.bootstrapImportReceipt.count(), audit: await client.auditEvent.count() });
    const interrupt = async (stage: "before_commit" | "after_commit"): Promise<void> => {
      const compiledChild = resolve(process.cwd(), "compiled/test/fixtures/import/bootstrap-crash-child.js");
      const child = spawn(process.execPath, existsSync(compiledChild) ? [compiledChild] : ["--import", "tsx", "test/fixtures/import/bootstrap-crash-child.ts"], { cwd: process.cwd(), env: { ...process.env, CRMY61_CRASH_CHILD: "true", CRMY61_CRASH_INSTRUCTION: JSON.stringify({ stage, packageId: pack.id, input: confirm, actor: principal }) }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let failure = ""; child.stderr!.on("data", (data: Buffer) => { failure += data.toString(); });
      const exited = new Promise<void>((resolveExit) => { child.once("exit", () => resolveExit()); });
      await new Promise<void>((resolveStage, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(new Error(`synthetic_child_stage_timeout:${stage}`)); }, 15000);
        child.once("message", (message) => { clearTimeout(timeout); assert.equal((message as { stage: string }).stage, stage); resolveStage(); });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", (code) => { clearTimeout(timeout); if (code !== null) reject(new Error(`synthetic_child_failed:${code}:${failure}`)); });
      });
      assert.equal(child.kill(), true); await exited;
    };
    const beforeInterruption = await effectCounts(); await interrupt("before_commit");
    assert.deepEqual(await effectCounts(), beforeInterruption); assert.equal((await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: first.id } })).state, "READY");
    await interrupt("after_commit"); const afterLostAcknowledgement = await effectCounts();
    const concurrent = await Promise.all([request(`/packages/${pack.id}/confirm`, "POST", confirm), request(`/packages/${pack.id}/confirm`, "POST", confirm)]);
    for (const response of concurrent) assert.equal(response.status, 201);
    assert.deepEqual(await effectCounts(), afterLostAcknowledgement);
    assert.equal((await request(`/packages/${pack.id}/confirm`, "POST", { ...confirm, limit: 2 })).status, 409);
    pack = await success<Package>(await request(`/packages/${pack.id}`), 200); assert.equal(pack.counts.accepted, 1);
    const committed = await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: first.id } }); assert.ok(committed.leadId);
    const leadId = committed.leadId; const lead = await client.lead.findUniqueOrThrow({ where: { id: leadId } });
    assert.equal(lead.acquisitionKind, "BASELINE"); assert.equal(lead.baselineTemperature, "COLD"); assert.equal(lead.assignedToId, adviser.id);
    assert.equal(await client.leadActivity.count({ where: { leadId } }), 0); assert.equal(await client.leadCommercialQualification.count({ where: { leadId } }), 0);
    assert.equal(await client.importedHistoricalNote.count({ where: { leadId } }), 1);
    const note = await client.importedHistoricalNote.findFirstOrThrow({ where: { leadId } }); assert.equal(note.text, "Note exacte\navec accents é & espaces  "); assert.equal(note.author, null); assert.equal(note.occurredAt, null);
    assert.equal(await client.bootstrapImportReceipt.count({ where: { packageId: pack.id, operation: "COMMIT_ROW", key: first.id } }), 1);
    assert.equal(await client.auditEvent.count({ where: { resourceId: pack.id, eventType: "BOOTSTRAP_ROW_COMMITTED", after: { path: ["rowId"], equals: first.id } } }), 1);
    const counts = { leads: await client.lead.count(), notes: await client.importedHistoricalNote.count(), receipts: await client.bootstrapImportReceipt.count(), audit: await client.auditEvent.count() };
    const restart = new BootstrapImportService(new DynamicPermissionRepository(prisma));
    const replay = await restart.confirm(pack.id, confirm, principal) as { replayed: boolean }; assert.equal(replay.replayed, true);
    assert.deepEqual({ leads: await client.lead.count(), notes: await client.importedHistoricalNote.count(), receipts: await client.bootstrapImportReceipt.count(), audit: await client.auditEvent.count() }, counts);
    const notes = await success<{ items: unknown[]; provenance: Array<{ cycleLabel: string }> }>(await request(`/leads/${leadId}/notes`, "GET", undefined, adviserAuth.token), 200);
    assert.equal(notes.items.length, 1); assert.equal(notes.provenance[0]!.cycleLabel, "Cycle à préciser");
    assert.equal((await request(`/leads/${leadId}/notes`, "GET", undefined, outsiderAuth.token)).status, 403);
    await decide(second, "LINK_EXISTING", leadId); await decide(third, "IGNORE");
    pack = await success<Package>(await request(`/packages/${pack.id}/confirm`, "POST", { expectedVersion: pack.version, idempotencyKey: `confirm-next-${marker}`, confirmed: true, limit: 25 }));
    assert.equal(pack.counts.accepted, 2); assert.equal(pack.counts.ignored, 1); assert.equal(pack.counts.review, 1);
    assert.equal(await client.lead.count({ where: { id: leadId } }), 1); assert.equal(await client.importedHistoricalNote.count({ where: { leadId } }), 2); // Distinct source cells with identical text are both retained.
    assert.equal((await client.lead.findUniqueOrThrow({ where: { id: leadId } })).assignedToId, adviser.id);
    const report = await success<{ bySheet: Array<{ total: number; accepted: number; review: number; invalid: number; ignored: number }>; cutoverBlocked: boolean }>(await request(`/packages/${pack.id}/report`), 200);
    assert.equal(report.bySheet.reduce((sum, row) => sum + row.total, 0), 4); assert.equal(report.cutoverBlocked, true);
    assert.ok(await client.importReport.findUnique({ where: { batchId: pack.batchId } }));
    const before = await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: fourth.id } });
    assert.equal((await request(`/packages/${pack.id}/rows/${fourth.id}/decision`, "POST", { expectedVersion: fourth.version, idempotencyKey: `bad-${marker}`, action: "CREATE_DOSSIER", reason: "Unknown program cannot be invented", overrides: { program: "UNKNOWN" } })).status, 422);
    assert.equal((await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: fourth.id } })).version, before.version);
    // Actual persisted permission version changes, not a stale in-memory role mock.
    const permissions = new DynamicPermissionService(new DynamicPermissionRepository(prisma));
    const target = { kind: "ROLE" as const, role: "SUPER_ADMIN" as const, campus: "GLOBAL" };
    let configuration = await permissions.read(principal, target);
    for (const key of ["import.view", "import.execute", "import.review.resolve", "import.confirm", "lead.create", "lead.assign"]) {
      const savedGrants = configuration.grants;
      await permissions.save(principal, { ...target, expectedVersion: configuration.version, reason: "ACCESS_REVIEW", confirmed: true, grants: { ...savedGrants, [key]: "NONE" } });
      assert.equal((await request(`/packages/${pack.id}/confirm`, "POST", confirm)).status, 403, `revoked ${key} must deny receipt replay`);
      configuration = await permissions.read(principal, target);
      await permissions.save(principal, { ...target, expectedVersion: configuration.version, reason: "RESTORE_VERSION", confirmed: true, grants: savedGrants });
      configuration = await permissions.read(principal, target);
    }
    // Native mirrors and replies remain distinct source occurrences until an explicit decision.
    const nativeParts = syntheticHistoricalParts({ workbookExtra: '<workbookPr date1904="1"/>', extra: [
      ["xl/worksheets/_rels/sheet1.xml.rels", '<Relationships><Relationship Id="legacy" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/><Relationship Id="thread" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>'],
      ["xl/comments/comment1.xml", '<comments><authors><author>Auteur source</author></authors><commentList><comment ref="I9" authorId="0"><text><t>Intention synthétique 2027-2028</t></text></comment></commentList></comments>'],
      ["xl/threadedComments/threadedComment1.xml", '<ThreadedComments><threadedComment ref="I9" id="thread-1" personId="person-1" dT="2025-07-02T09:30:00Z"><text>Intention synthétique 2027-2028</text></threadedComment><threadedComment ref="I9" id="thread-2" parentId="thread-1" personId="person-1"><text>Réponse distincte</text></threadedComment></ThreadedComments>'],
      ["xl/persons/person.xml", '<personList><person id="person-1" displayName="Auteur source" providerId="SOURCE" userId="source@example.invalid"/></personList>'],
    ] });
    for (const part of nativeParts) if (part[0].startsWith("xl/worksheets/sheet")) part[1] = part[1].replaceAll("PROGRAM_SYNTHETIC", program.code).replace('<c r="I9" t="inlineStr"><is><t>Note exacte\navec accents é &amp; espaces  </t></is></c>', '<c r="I9" t="inlineStr"><is><t>Intention synthétique 2027-2028</t></is></c>').replace('<row r="9">', '<row r="9"><c r="K9" s="1"><v>45123</v></c>');
    const nativeBytes = syntheticZip(nativeParts); const nativeSha = bytesHash(nativeBytes);
    let nativePack = await success<Package>(await request("/packages", "POST", { fileName: "native-synthetic.xlsx", sizeBytes: nativeBytes.length, sha256: nativeSha, campusId: campus.id, idempotencyKey: `native-${marker}` }));
    for (let offset = 0, index = 0; offset < nativeBytes.length; offset += CHUNK_BYTES, index++) { const chunk = nativeBytes.subarray(offset, offset + CHUNK_BYTES); await success(await request(`/packages/${nativePack.id}/chunks`, "POST", { index, contentBase64: chunk.toString("base64"), sha256: bytesHash(chunk) })); }
    nativePack = await success<Package>(await request(`/packages/${nativePack.id}/seal`, "POST", { sha256: nativeSha }));
    nativePack = await success<Package>(await request(`/packages/${nativePack.id}/mappings`, "POST", { ...mapping, expectedVersion: nativePack.version, sheets: mapping.sheets.map((sheet) => ({ ...sheet, fields: { ...sheet.fields, receivedDate: "K" } })) }));
    type NativeRow = Row & { annotations: Array<{ annotationId: string; reference: string; relationshipId: string; format: string }>; sourceEvidence: Array<{ reference: string; text: string }>; decision?: { resolvedValues: Record<string, string | null>; cycle: { label: string }; annotations: unknown[] } };
    const nativeRows = await success<{ items: NativeRow[] }>(await request(`/packages/${nativePack.id}/rows`), 200);
    const nativeRow = nativeRows.items.find((row) => row.sheet === HISTORICAL_SHEETS[0])!; assert.equal(nativeRow.annotations.length, 3); assert.ok(nativeRow.sourceEvidence.some((cell) => cell.reference === "K9" && cell.text === "45123"));
    const nativeDecision = { expectedVersion: nativeRow.version, idempotencyKey: `native-decision-${marker}`, action: "CREATE_DOSSIER", reason: "Conserver les threads source et exclure explicitement leur miroir legacy", cycle: { state: "CONFIRMED_TARGET", label: "2027-2028", sourceColumns: ["I"], reason: "Intention explicitement déclarée dans la cellule source synthétique" },
      annotations: nativeRow.annotations.map((item) => ({ annotationId: item.annotationId, reference: item.reference, relationshipId: item.relationshipId, action: item.format === "LEGACY" ? "EXCLUDE" : "PRESERVE_NOTE", reason: item.format === "LEGACY" ? "Miroir legacy exclu explicitement, source exacte conservée" : "Annotation native distincte conservée explicitement" })) };
    assert.equal((await request(`/packages/${nativePack.id}/rows/${nativeRow.id}/decision`, "POST", { ...nativeDecision, annotations: [] })).status, 422);
    assert.equal((await request(`/packages/${nativePack.id}/rows/${nativeRow.id}/decision`, "POST", { ...nativeDecision, overrides: { phone: "06 12 34 56 78 / 1234" } })).status, 422);
    assert.equal((await request(`/packages/${nativePack.id}/rows/${nativeRow.id}/decision`, "POST", { ...nativeDecision, overrides: { status: "ENROLLED" } })).status, 422);
    const resolvedNative = await success<NativeRow>(await request(`/packages/${nativePack.id}/rows/${nativeRow.id}/decision`, "POST", nativeDecision));
    assert.equal(resolvedNative.decision!.cycle.label, "2027-2028"); assert.equal(resolvedNative.decision!.annotations.length, 3); assert.equal(resolvedNative.decision!.resolvedValues.program, program.code);
    for (const row of nativeRows.items.filter((item) => item.id !== nativeRow.id)) await success(await request(`/packages/${nativePack.id}/rows/${row.id}/decision`, "POST", { expectedVersion: row.version, idempotencyKey: `native-ignore-${row.id}`, action: "IGNORE", reason: "Occurrence synthétique explicitement ignorée pour le scénario natif" }));
    const nativeConfirm = { expectedVersion: nativePack.version, idempotencyKey: `native-confirm-${marker}`, confirmed: true, limit: 25 };
    nativePack = await success<Package>(await request(`/packages/${nativePack.id}/confirm`, "POST", nativeConfirm)); assert.equal(nativePack.state, "COMPLETED");
    const savedNative = await client.bootstrapImportRow.findUniqueOrThrow({ where: { id: nativeRow.id } }); const nativeNotes = await client.importedHistoricalNote.findMany({ where: { leadId: savedNative.leadId! } });
    assert.equal(nativeNotes.length, 3); assert.equal(new Set(nativeNotes.map((item) => item.cellKey)).size, 3); assert.equal(nativeNotes.filter((item) => item.author === "Auteur source").length, 2); assert.ok(nativeNotes.every((item) => item.occurredAt === null));
    const nativeBeforeReplay = await effectCounts(); await success(await request(`/packages/${nativePack.id}/confirm`, "POST", nativeConfirm)); assert.deepEqual(await effectCounts(), nativeBeforeReplay);
    const nativeReport = await success<{ cutoverBlocked: boolean; sourceCoverage: { complete: boolean } }>(await request(`/packages/${nativePack.id}/report`), 200); assert.equal(nativeReport.cutoverBlocked, false); assert.equal(nativeReport.sourceCoverage.complete, true);
    const nativeProvenance = await success<{ provenance: Array<{ cycleLabel: string; receivedDateEvidence: { date1904: boolean; cell: { raw: string; style: string } } }>; items: Array<{ sourceDate: string | null }> }>(await request(`/leads/${savedNative.leadId!}/notes`), 200);
    assert.equal(nativeProvenance.provenance[0]!.cycleLabel, "Candidature 2027-2028"); assert.equal(nativeProvenance.provenance[0]!.receivedDateEvidence.date1904, true); assert.equal(nativeProvenance.provenance[0]!.receivedDateEvidence.cell.raw, "45123"); assert.ok(nativeProvenance.items.some((item) => item.sourceDate === "2025-07-02T09:30:00Z"));
    if (process.env.CRMY61_UI_FIXTURE_DIR) {
      const directory = resolve(process.env.CRMY61_UI_FIXTURE_DIR); await mkdir(directory, { recursive: true }); const fixturePath = resolve(directory, "bootstrap-ui-synthetic.xlsx");
      const uiParts = syntheticHistoricalParts(); for (const part of uiParts) part[1] = part[1].replaceAll("PROGRAM_SYNTHETIC", program.code).replaceAll("synthetic@example.invalid", `ui-${marker.toLowerCase()}@example.invalid`);
      await writeFile(fixturePath, syntheticZip(uiParts));
      await writeFile(resolve(directory, "private-ui.json"), JSON.stringify({ account: { email: secondAdmin.email, password: secondAdmin.password }, adviser: { id: adviser.id }, campus, program, campaign, fixturePath, mapping }, null, 2));
    }
    await client.localSession.update({ where: { id: auth.sessionId }, data: { active: false, revokedAt: new Date() } });
    assert.equal((await request(`/packages/${pack.id}`)).status, 401);
    await assert.rejects(() => restart.confirm(pack.id, confirm, principal));
  } finally { await app.close(); await prisma.onModuleDestroy(); }
});
