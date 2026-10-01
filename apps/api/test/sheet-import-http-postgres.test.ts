import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { referenceKey } from "../src/references/reference.contract.js";
import { imageRuntime, webImageProof } from "./helpers/sheet-image-runtime.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}
async function startApi(t: TestContext, database: string): Promise<string> {
  if (process.env.CRMY171_API_IMAGE) {
    assert.equal(process.env.NODE_V8_COVERAGE, undefined, "image execution is a separate proof, never added to local source coverage");
    const url = new URL(database); assert.equal(url.hostname, "127.0.0.1"); url.hostname = "host.docker.internal";
    return imageRuntime(t, "api", url.toString());
  }
  const port = await freePort();
  const coverageDirectory = process.env.NODE_V8_COVERAGE;
  const instrumented = Boolean(coverageDirectory);
  const instrumentation = instrumented
    ? ["--import", pathToFileURL(resolve("../../scripts/ci/tests/coverage-shutdown.mjs")).href]
    : [];
  const child = spawn(process.execPath, [...instrumentation, resolve("dist/main.js")], { windowsHide: true,
    stdio: instrumented ? ["ignore", "ignore", "ignore", "ipc"] : "ignore", env: {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
    NODE_V8_COVERAGE: coverageDirectory,
    DATABASE_URL: database, API_PORT: String(port), LOG_LEVEL: "error",
  } });
  t.after(async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>((done) => child.once("exit", () => done()));
    if (instrumented && child.connected) child.send({ type: "crmy-coverage-shutdown" });
    else child.kill();
    await closed;
    if (coverageDirectory) {
      const reports = await readdir(coverageDirectory);
      assert.ok(reports.some((file) => file.startsWith(`coverage-${String(child.pid)}-`)), "each compiled API must flush its own native V8 counters");
    }
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("synthetic_compiled_api_exited");
    try { if ((await fetch(`${base}/health/ready`)).ok) return base; } catch { /* bounded local startup */ }
    await new Promise<void>((done) => setTimeout(done, 250));
  }
  throw new Error("synthetic_compiled_api_not_ready");
}
function object(value: unknown): Record<string, unknown> { assert.ok(value && typeof value === "object" && !Array.isArray(value)); return Object.fromEntries(Object.entries(value)); }

function testDatabase(t: TestContext): string {
  const precreated = process.env.CRMY171_HTTP_PRECREATED_URL;
  if (precreated) {
    const url = new URL(precreated);
    assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.username, "postgres"); assert.equal(url.password, "");
    assert.equal(url.pathname, "/crmy171_http_synthetic");
    assert.equal(url.search, ""); assert.equal(url.hash, "");
    assert.match(url.port, /^\d+$/u);
    assert.match(process.env.CRMY171_DATABASE_NONCE ?? "", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    return precreated;
  }
  const container = `crmy171-http-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", container, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_DB=crmy171_http_synthetic", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 60_000 });
  t.after(() => { execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }); });
  const port = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" }).trim().split(":").at(-1);
  assert.ok(port && /^\d+$/u.test(port));
  return `postgresql://postgres@127.0.0.1:${port}/crmy171_http_synthetic`;
}

async function verifyPrecreatedDatabase(client: PrismaClient): Promise<void> {
  if (!process.env.CRMY171_HTTP_PRECREATED_URL) return;
  const identity = await client.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy171_test_identity.marker`;
  assert.deepEqual(identity, [{ nonce: process.env.CRMY171_DATABASE_NONCE }], "dedicated test database ownership must match before migration");
  const tables = await client.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
  assert.equal(tables[0]?.count, 0, "precreated test database must have an empty public schema");
}

test("CRMY-171 real HTTP administration and two compiled schedulers / synthetic PostgreSQL", {
  skip: process.env.CRMY171_HTTP_TEST !== "true" && process.env.CI !== "true", timeout: 180_000,
}, async (t) => {
  execFileSync(process.execPath, ["../../node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "pipe", timeout: 90_000 });
  const database = testDatabase(t);
  const client = new PrismaClient({ datasourceUrl: database });
  t.after(() => client.$disconnect());
  for (let attempt = 0; ; attempt++) {
    try { await client.$queryRaw`SELECT 1`; break; } catch { if (attempt > 30) throw new Error("synthetic_database_not_ready"); }
    await new Promise<void>((done) => setTimeout(done, 100));
  }
  await verifyPrecreatedDatabase(client);
  execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy"], {
    stdio: "pipe", timeout: 60_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: database },
  });
  const refs = await Promise.all((["CAMPUS", "PROGRAM", "CAMPAIGN"] as const).map((kind) => {
    const code = `SYNTHETIC-HTTP-${kind}`;
    return client.crmReference.create({ data: { kind, code, label: code, scope: "GLOBAL", scopeKey: "GLOBAL", keys: { create: { kind, scopeKey: "GLOBAL", key: referenceKey(code) } } } });
  }));
  const [campus, program, campaign] = refs;
  assert.ok(campus); assert.ok(program); assert.ok(campaign);
  await client.crmProgramAvailability.create({ data: { programId: program.id, campusId: campus.id } });
  const email = "synthetic-admin@example.invalid", password = `Synthetic!${randomBytes(24).toString("hex")}`;
  const user = await client.collaborator.create({ data: { professionalEmail: email, roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const salt = randomBytes(16).toString("hex");
  await client.localPasswordHash.create({ data: { collaboratorId: user.id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt,
    passwordDigest: scryptSync(password, salt, 32).toString("hex"), mustChange: false } });
  const first = await startApi(t, database), second = await startApi(t, database);
  const login = await fetch(`${first}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 201);
  const session = object(await login.json()); assert.equal(typeof session.token, "string");
  const headers = { "content-type": "application/json", authorization: `Bearer ${String(session.token)}` };
  const adviser = await client.collaborator.create({ data: { professionalEmail: "synthetic-assignee@example.invalid", roles: ["ADMISSIONS"], campusId: campus.id, firstLoginRequired: false } });
  const assignmentConfiguration = { campusId: campus.id, expectedVersion: 0, rules: [
    { id: "synthetic-fallback", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [{ userId: adviser.id, active: true, capacity: 100, activeLeadCount: 0 }] },
  ] };
  const assignedConfig = await fetch(`${first}/assignment/config`, { method: "PUT", headers, body: JSON.stringify(assignmentConfiguration) });
  assert.equal(assignedConfig.status, 200, JSON.stringify(await assignedConfig.clone().json()));
  const readAssignment = await fetch(`${second}/assignment/config?campusId=${campus.id}`, { headers });
  assert.equal(readAssignment.status, 200);
  assert.equal(object(await readAssignment.json()).version, 1, "second API reads the same persistent assignment configuration");
  assert.equal((await fetch(`${first}/scheduled-sheets?campus=${campus.id}`)).status, 401);
  const input = { expectedVersion: 0, enabled: false, intervalMinutes: 15, workbookLink: "https://docs.google.com/spreadsheets/d/synthetic_http_171/edit", tab: "Synthétique", campusId: campus.id,
    mapping: { mappingKey: "synthetic-http", name: "Mapping synthétique", profile: "FORMINATOR_ZAPIER", columns: [
      { sourceColumn: "Submission", targetField: "externalId", action: "TRIM", required: true }, { sourceColumn: "First", targetField: "firstName", action: "TRIM" },
      { sourceColumn: "Last", targetField: "lastName", action: "TRIM" }] }, assignment: { strategy: "ROUND_ROBIN" },
    context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", campus: campus.code, campaign: campaign.code, program: program.code, educationLevel: "BAC" } };
  const saved = await fetch(`${first}/scheduled-sheets`, { method: "POST", headers, body: JSON.stringify(input) });
  assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
  const configuration = object(await saved.json()); assert.equal(typeof configuration.id, "string");
  const id = String(configuration.id);
  assert.equal(configuration.enabled, false);
  const listed = await fetch(`${second}/scheduled-sheets?campus=${campus.code}`, { headers });
  assert.equal(listed.status, 200);
  const inventory = object(await listed.json());
  assert.equal(inventory.simulated, true);
  assert.ok(Array.isArray(inventory.connectors));
  assert.deepEqual(inventory.connectors.map((row: unknown) => object(row).id), [id], "administration lists the same persisted campus configuration on another API");
  const malformedIdentifier = await fetch(`${second}/scheduled-sheets/not-a-uuid/runs`, { headers });
  assert.equal(malformedIdentifier.status, 400);
  assert.equal(object(await malformedIdentifier.json()).code, "sheet_identifier_invalid");
  assert.equal(await client.sheetImportConfigurationVersion.count({ where: { connectorId: id } }), 1);
  for (const invalid of [{ intervalMinutes: 4 }, { intervalMinutes: 16 }, { workbookLink: "https://example.invalid/arbitrary" }, { workbookLink: "https://docs.google.com/spreadsheets/d/real_source_refused/edit" }]) {
    const denied = await fetch(`${first}/scheduled-sheets`, { method: "POST", headers, body: JSON.stringify({ ...input, ...invalid }) });
    assert.equal(denied.status, 400);
  }
  const conflict = await fetch(`${second}/scheduled-sheets/${id}`, { method: "PUT", headers, body: JSON.stringify({ ...input, expectedVersion: 0 }) });
  assert.equal(conflict.status, 409);
  assert.equal(await client.sheetImportConfigurationVersion.count({ where: { connectorId: id } }), 1, "invalid and stale changes never append a revision");
  const simulated = await fetch(`${second}/scheduled-sheets/${id}/simulations`, { method: "POST", headers });
  assert.equal(simulated.status, 201, JSON.stringify(await simulated.clone().json()));
  assert.deepEqual(await simulated.json(), { rows: 1, mapped: 1, review: 0, mutated: false, simulated: true, reconciliationRequired: false, reason: null });
  assert.equal(await client.lead.count(), 0);
  const enabled = await fetch(`${second}/scheduled-sheets/${id}`, { method: "PUT", headers, body: JSON.stringify({ ...input, expectedVersion: 1, enabled: true }) });
  assert.equal(enabled.status, 200, JSON.stringify(await enabled.clone().json()));
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && await client.sheetImportRun.count({ where: { connectorId: id, status: "COMPLETED" } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
  assert.equal(await client.lead.count(), 1);
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: id, status: "COMPLETED", createdCount: 1 } }), 1);
  assert.equal(await client.sheetImportSubmission.count(), 1);
  const queued = await fetch(`${first}/scheduled-sheets/${id}/runs`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 2 }) });
  assert.equal(queued.status, 201);
  const replayDeadline = Date.now() + 8_000;
  while (Date.now() < replayDeadline && await client.sheetImportRun.count({ where: { connectorId: id, trigger: "MANUAL", status: "COMPLETED" } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: id, trigger: "MANUAL", duplicateCount: 1, status: "COMPLETED" } }), 1);
  assert.equal(await client.lead.count(), 1);
  assert.equal(await client.auditEvent.count({ where: { eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 1);
  const canonicalLead = await client.lead.findFirstOrThrow();
  assert.equal(canonicalLead.assignedToId, adviser.id, "worker applies the configuration saved through authenticated HTTP");
  const selectionAudit = await client.auditEvent.findFirstOrThrow({ where: { resourceId: id, eventType: "SHEET_IMPORT_ROW_PROCESSED" } });
  const evidence = object(object(selectionAudit.after).assignment);
  assert.equal(evidence.version, 1); assert.equal(evidence.ruleId, "synthetic-fallback");
  assert.equal(await client.campusAssignmentCursor.count({ where: { campusId: campus.id, version: 1, cursor: 1 } }), 1, "replay does not advance the assignment cursor");
  const importedMapping = object(object(configuration.configuration).mapping);
  const record = { lineNumber: 1, firstName: "Lead", lastName: "Synthétique", externalId: "submission-synthetic_http_171", campus: campus.code, program: program.code,
    campaign: campaign.code, educationLevel: "BAC", source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", recentSource: "ZAPIER_SYNTHETIC" };
  for (const divergent of [false, true]) {
    const records = [{ ...record, ...(divergent ? { lastName: "Synthétique divergent" } : {}) }];
    const result = await fetch(`${first}/lead-ingestion/persistent-batches`, { method: "POST", headers, body: JSON.stringify({ records, confirmed: true,
      profile: "FORMINATOR_ZAPIER", mappingId: importedMapping.id, mappingVersion: importedMapping.version, assignment: { strategy: "UNASSIGNED" },
      idempotencyKey: `synthetic-cross-channel-${String(divergent)}`, sourceFileSha256: createHash("sha256").update(JSON.stringify(records)).digest("hex") }) });
    assert.equal(result.status, 201, JSON.stringify(await result.clone().json()));
    const report = object(await result.json());
    assert.equal(report.created, 0); assert.equal(report.manualReview, divergent ? 1 : 0); assert.equal(report.attached, divergent ? 0 : 1);
    assert.deepEqual(await client.lead.findUniqueOrThrow({ where: { id: canonicalLead.id } }), canonicalLead, "cross-channel replay or divergence cannot overwrite canonical values");
  }
  assert.equal((await fetch(`${first}/scheduled-sheets/${id}/runs`, { headers })).status, 200);
  const eventsBeforeRefusal = await client.auditEvent.count();
  const outside = await client.crmReference.create({ data: { kind: "CAMPUS", code: "SYNTHETIC-OTHER-CAMPUS", label: "Campus synthétique extérieur", scope: "GLOBAL", scopeKey: "GLOBAL",
    keys: { create: ["SYNTHETIC-OTHER-CAMPUS", "Campus synthétique extérieur"].map((value) => ({ kind: "CAMPUS", scopeKey: "GLOBAL", key: referenceKey(value) })) } } });
  // Persisted identity changes are seen by both APIs, never by broadening a test principal.
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: outside.id } });
  const denied = await fetch(`${second}/scheduled-sheets/${id}/runs`, { headers });
  const missing = await fetch(`${first}/scheduled-sheets/${randomUUID()}/runs`, { headers });
  assert.equal(denied.status, 404); assert.equal(missing.status, 404);
  assert.deepEqual(await denied.json(), await missing.json(), "no cross-campus existence disclosure");
  assert.equal(await client.auditEvent.count(), eventsBeforeRefusal, "refused consultation emits no success audit");
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: campus.id } });
  const disabled = await fetch(`${first}/scheduled-sheets/${id}`, { method: "PUT", headers, body: JSON.stringify({ ...input, expectedVersion: 2, enabled: false }) });
  assert.equal(disabled.status, 200);
  assert.equal((await fetch(`${second}/scheduled-sheets/${id}/runs`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 3 }) })).status, 409, "legacy EXTERNAL_ID manual import remains refused while disabled");
  assert.equal(await client.sheetImportConfigurationVersion.count({ where: { connectorId: id } }), 3);
  assert.equal(await client.lead.count(), 1, "disable retains business data and receipts");
  await webImageProof(t, first, String(session.token), campus.id, id);
  // Keep first/last names while replacing the stable submission column with email.
  const noIdMapping = { ...input.mapping, columns: [...input.mapping.columns.filter((column) => column.targetField !== "externalId"), { sourceColumn: "Email", targetField: "email", action: "LOWERCASE" }] };
  const missingId = await fetch(`${second}/scheduled-sheets/${id}`, { method: "PUT", headers, body: JSON.stringify({ ...input, mapping: noIdMapping, expectedVersion: 3, enabled: true }) });
  assert.equal(missingId.status, 200, JSON.stringify(await missingId.clone().json()));
  const reviewDeadline = Date.now() + 8_000;
  while (Date.now() < reviewDeadline && await client.sheetImportRun.count({ where: { connectorId: id, configurationVersion: 4, status: "COMPLETED" } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: id, configurationVersion: 4, reviewCount: 1, createdCount: 0 } }), 1);
  assert.equal(await client.lead.count(), 1, "missing stable identifier never creates or merges");
  assert.equal(await client.auditEvent.count({ where: { eventType: "SHEET_IMPORT_ROW_REVIEWED" } }), 1);
  const manualLead = await client.lead.create({ data: { leadCode: "LD-SYNTHETIC-MANUAL-171", firstName: "Lead", lastName: "Synthétique manuel",
    campus: campus.code, program: program.code, campaign: campaign.code, educationLevel: "BAC", source: "WEB_FORM", status: "PROSPECT" } });
  const batch = { idempotencyKey: "synthetic-persistent-assignment-171", strategy: "ROUND_ROBIN", confirmed: true,
    items: [{ leadId: manualLead.id, source: "UNTRUSTED_CLIENT_SOURCE", campaign: "UNTRUSTED_CLIENT_CAMPAIGN" }] };
  const cursorBeforeSimulation = await client.campusAssignmentCursor.findMany();
  const auditBeforeSimulation = await client.auditEvent.count();
  const automaticPreview = await fetch(`${second}/assignment/simulate`, { method: "POST", headers, body: JSON.stringify({
    leadId: manualLead.id, eventKey: "synthetic-auto-preview-171", source: "UNTRUSTED_CLIENT_SOURCE", campaign: "UNTRUSTED_CLIENT_CAMPAIGN",
  }) });
  assert.equal(automaticPreview.status, 201, JSON.stringify(await automaticPreview.clone().json()));
  const automaticPreviewResult = object(await automaticPreview.json());
  assert.equal(automaticPreviewResult.mutated, false);
  assert.equal(automaticPreviewResult.targetUserId, adviser.id);
  assert.equal(automaticPreviewResult.configurationVersion, 1);
  assert.deepEqual(await client.campusAssignmentCursor.findMany(), cursorBeforeSimulation);
  assert.equal(await client.auditEvent.count(), auditBeforeSimulation);
  assert.deepEqual(await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } }), manualLead);
  const preview = await fetch(`${first}/lead-assignments/preview`, { method: "POST", headers, body: JSON.stringify(batch) });
  assert.equal(preview.status, 201, JSON.stringify(await preview.clone().json()));
  const previewResult = object(await preview.json());
  assert.equal(previewResult.mutated, false);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } })).assignedToId, null);
  const assigned = await fetch(`${first}/lead-assignments`, { method: "POST", headers, body: JSON.stringify(batch) });
  assert.equal(assigned.status, 201, JSON.stringify(await assigned.clone().json()));
  const assignedResult = object(await assigned.json());
  assert.deepEqual(assignedResult.refused, []);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } })).assignedToId, adviser.id);
  const auditCount = await client.auditEvent.count({ where: { resourceId: manualLead.id } });
  const replay = await fetch(`${second}/lead-assignments`, { method: "POST", headers, body: JSON.stringify(batch) });
  assert.equal(replay.status, 201, JSON.stringify(await replay.clone().json()));
  assert.deepEqual(await replay.json(), assignedResult, "another API returns the same assignment result without memory receipts");
  assert.equal(await client.auditEvent.count({ where: { resourceId: manualLead.id } }), auditCount, "assignment replay writes no duplicate audit");
  assert.equal(await client.campusAssignmentCursor.count({ where: { campusId: campus.id, version: 1, cursor: 2 } }), 1);
  const manualRecords = [{ ...record, externalId: "synthetic-manual-import-171" }];
  const manualImport = await fetch(`${second}/lead-ingestion/persistent-batches`, { method: "POST", headers, body: JSON.stringify({
    records: manualRecords, confirmed: true, profile: "FORMINATOR_ZAPIER", mappingId: importedMapping.id, mappingVersion: importedMapping.version,
    assignment: { strategy: "ROUND_ROBIN" }, resolvedAssignments: { "1": randomUUID() },
    idempotencyKey: "synthetic-manual-campus-rules-171", sourceFileSha256: createHash("sha256").update(JSON.stringify(manualRecords)).digest("hex"),
  }) });
  assert.equal(manualImport.status, 201, JSON.stringify(await manualImport.clone().json()));
  const manualReport = object(await manualImport.json());
  assert.equal(manualReport.created, 1);
  const manuallyImported = await client.lead.findFirstOrThrow({ where: { importBatchId: String(manualReport.batchId) } });
  assert.equal(manuallyImported.assignedToId, adviser.id, "manual imports use the same persisted campus rule, never client-selected recipients");
  const manualEvidence = await client.auditEvent.findFirstOrThrow({ where: { eventType: "LEAD_ASSIGNED", resourceId: manuallyImported.id } });
  assert.equal(object(manualEvidence.after).configurationVersion, 1);
  assert.equal(object(manualEvidence.after).ruleId, "synthetic-fallback");
  assert.equal(await client.campusAssignmentCursor.count({ where: { campusId: campus.id, version: 1, cursor: 3 } }), 1);
  const decisionInput = { leadId: manualLead.id, eventKey: "synthetic-decision-only-171", source: "UNTRUSTED", campaign: "UNTRUSTED" };
  const leadBeforeDecision = await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } });
  const activitiesBeforeDecision = await client.leadActivity.count({ where: { leadId: manualLead.id } });
  const assignmentAuditsBeforeDecision = await client.auditEvent.count({ where: { eventType: "LEAD_ASSIGNED" } });
  const decide = (base: string, body = decisionInput, correlation = "synthetic-decision"): Promise<Response> => fetch(`${base}/assignment/auto`, {
    method: "POST", headers: { ...headers, "x-correlation-id": correlation }, body: JSON.stringify(body),
  });
  const decisionResponse = await decide(first);
  assert.equal(decisionResponse.status, 201, JSON.stringify(await decisionResponse.clone().json()));
  const decision = object(await decisionResponse.json());
  assert.equal(decision.configurationVersion, 1); assert.equal(decision.selectedUserId, adviser.id);
  const decisionReplay = await decide(second);
  assert.equal(decisionReplay.status, 201);
  assert.deepEqual(await decisionReplay.json(), decision);
  assert.equal(await client.campusAssignmentCursor.count({ where: { campusId: campus.id, version: 1, cursor: 4 } }), 1);
  assert.equal(await client.auditEvent.count({ where: { eventType: "ASSIGNMENT_DECISION_CREATED" } }), 1);
  assert.equal(await client.auditEvent.count({ where: { eventType: "LEAD_ASSIGNED" } }), assignmentAuditsBeforeDecision);
  assert.deepEqual(await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } }), leadBeforeDecision);
  assert.equal(await client.leadActivity.count({ where: { leadId: manualLead.id } }), activitiesBeforeDecision);
  // A deliberately overlong correlation fails the actual audit write (varchar(64)) in this ephemeral database.
  const failedDecision = await decide(first, { ...decisionInput, eventKey: "synthetic-decision-rollback-171" }, "x".repeat(65));
  assert.equal(failedDecision.status, 503);
  assert.equal(await client.auditEvent.count({ where: { eventType: "ASSIGNMENT_DECISION_CREATED" } }), 1);
  assert.equal(await client.campusAssignmentCursor.count({ where: { campusId: campus.id, version: 1, cursor: 4 } }), 1);
  const concurrentInputs = ["first", "second"].map((suffix) => ({ ...decisionInput, eventKey: `synthetic-concurrent-decision-${suffix}` }));
  const concurrentDecisions = await Promise.all(concurrentInputs.map((body, index) => decide(index === 0 ? first : second, body)));
  for (const [index, response] of concurrentDecisions.entries()) {
    assert.ok(response.status === 201 || response.status === 409, JSON.stringify(await response.clone().json()));
    if (response.status === 409) {
      const retryInput = concurrentInputs[index]; assert.ok(retryInput);
      assert.equal((await decide(second, retryInput)).status, 201);
    }
  }
  assert.equal(await client.auditEvent.count({ where: { eventType: "ASSIGNMENT_DECISION_CREATED" } }), 3);
  assert.equal(await client.campusAssignmentCursor.count({ where: { campusId: campus.id, version: 1, cursor: 6 } }), 1);
  assert.deepEqual(await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } }), leadBeforeDecision);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: outside.id } });
  const outsideDecision = await decide(second, { ...decisionInput, eventKey: "synthetic-outside-decision-171" });
  const absentDecision = await decide(first, { ...decisionInput, leadId: randomUUID(), eventKey: "synthetic-absent-decision-171" });
  assert.equal(outsideDecision.status, 404); assert.equal(absentDecision.status, 404);
  assert.deepEqual(await outsideDecision.json(), await absentDecision.json());
  assert.equal(await client.auditEvent.count({ where: { eventType: "ASSIGNMENT_DECISION_CREATED" } }), 3);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: campus.id } });
  const historyResponse = await fetch(`${first}/assignment/history?campusId=${campus.id}`, { headers });
  assert.equal(historyResponse.status, 200, JSON.stringify(await historyResponse.clone().json()));
  const history = object(await historyResponse.json());
  assert.ok(Array.isArray(history.decisions));
  const recorded = history.decisions.map(object).find((event) => event.resourceId === manuallyImported.id);
  assert.ok(recorded);
  assert.equal(object(recorded.context).configurationVersion, 1);
  assert.equal(object(recorded.context).ruleId, "synthetic-fallback");
  const changedRules = await fetch(`${second}/assignment/config`, { method: "PUT", headers, body: JSON.stringify({ ...assignmentConfiguration, expectedVersion: 1, rules: [] }) });
  assert.equal(changedRules.status, 200);
  const historyAfterChange = await fetch(`${second}/assignment/history?campusId=${campus.id}`, { headers });
  assert.equal(historyAfterChange.status, 200);
  assert.deepEqual(object(await historyAfterChange.json()).decisions, history.decisions, "recorded decisions are not recomputed after configuration changes");
  const replayAfterRulesChanged = await decide(second);
  assert.equal(replayAfterRulesChanged.status, 201);
  assert.deepEqual(await replayAfterRulesChanged.json(), decision, "replay retains the original rule version even after configuration changes");
  const newAdviser = await client.collaborator.create({ data: { professionalEmail: "synthetic-reassignment-target@example.invalid", roles: ["ADMISSIONS"], campusId: campus.id, firstLoginRequired: false } });
  const reassignmentRules = await fetch(`${first}/assignment/config`, { method: "PUT", headers, body: JSON.stringify({ ...assignmentConfiguration, expectedVersion: 2,
    rules: [{ ...assignmentConfiguration.rules[0], candidates: [adviser, newAdviser].map((candidate) => ({ userId: candidate.id, active: true, capacity: 100, activeLeadCount: 0 })) }],
  }) });
  assert.equal(reassignmentRules.status, 200, JSON.stringify(await reassignmentRules.clone().json()));
  const requestResponse = await fetch(`${first}/leads/${manualLead.id}/reassignment-requests`, { method: "POST", headers, body: JSON.stringify({
    targetUserId: newAdviser.id, reason: "Répartition synthétique contrôlée", moveOpenTasks: false, idempotencyKey: "synthetic-reassignment-171",
  }) });
  assert.equal(requestResponse.status, 201, JSON.stringify(await requestResponse.clone().json()));
  const reassignmentRequest = object(await requestResponse.json());
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } })).assignedToId, adviser.id);
  const approvalBody = { approved: true, reason: "Validation synthétique distincte" };
  const selfApproval = await fetch(`${second}/reassignment-requests/${String(reassignmentRequest.id)}/decision`, { method: "PATCH", headers, body: JSON.stringify(approvalBody) });
  assert.equal(selfApproval.status, 403);
  const approverEmail = "synthetic-approver@example.invalid";
  const approver = await client.collaborator.create({ data: { professionalEmail: approverEmail, roles: ["ADMIN"], campusId: campus.id, firstLoginRequired: false } });
  const approverSalt = randomBytes(16).toString("hex");
  await client.localPasswordHash.create({ data: { collaboratorId: approver.id, identityDigest: createHash("sha256").update(approverEmail).digest("hex"), passwordSalt: approverSalt,
    passwordDigest: scryptSync(password, approverSalt, 32).toString("hex"), mustChange: false } });
  const approverLogin = await fetch(`${second}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: approverEmail, password }) });
  assert.equal(approverLogin.status, 201);
  const approverSession = object(await approverLogin.json()); assert.equal(typeof approverSession.token, "string");
  const approval = await fetch(`${second}/reassignment-requests/${String(reassignmentRequest.id)}/decision`, { method: "PATCH",
    headers: { ...headers, authorization: `Bearer ${String(approverSession.token)}` }, body: JSON.stringify(approvalBody) });
  assert.equal(approval.status, 200, JSON.stringify(await approval.clone().json()));
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: manualLead.id } })).assignedToId, newAdviser.id);
  const mappingResponse = await fetch(`${first}/lead-import/mappings`, { method: "POST", headers, body: JSON.stringify({
    mappingKey: "synthetic-campus-preview", name: "Mapping synthétique manuel", profile: "FORMINATOR_ZAPIER", expectedVersion: 0, columns: input.mapping.columns,
  }) });
  assert.equal(mappingResponse.status, 201, JSON.stringify(await mappingResponse.clone().json()));
  const previewMapping = object(await mappingResponse.json());
  const beforeManualPreview = { leads: await client.lead.count(), cursors: await client.campusAssignmentCursor.findMany(), decisions: await client.auditEvent.count({ where: { eventType: "ASSIGNMENT_DECISION_CREATED" } }) };
  const manualPreviewResponse = await fetch(`${first}/lead-import/dry-runs`, { method: "POST", headers, body: JSON.stringify({
    idempotencyKey: "synthetic-persisted-rule-preview", mappingKey: previewMapping.mappingKey, mappingVersion: previewMapping.version,
    sourceColumns: ["Submission", "First", "Last"], rows: [{ Submission: "synthetic-preview-one", First: "Lead", Last: "Synthétique premier" }, { Submission: "synthetic-preview-two", First: "Lead", Last: "Synthétique second" }],
    context: { ...input.context, originalSource: "FORMINATOR" }, assignment: { strategy: "ROUND_ROBIN" },
  }) });
  assert.equal(manualPreviewResponse.status, 201, JSON.stringify(await manualPreviewResponse.clone().json()));
  const manualPreview = object(await manualPreviewResponse.json());
  assert.equal(manualPreview.mutated, false); assert.equal(manualPreview.assigned, 2);
  assert.ok(Array.isArray(manualPreview.assignmentDistribution));
  assert.deepEqual(manualPreview.assignmentDistribution.map(object).map((entry) => entry.userId).sort(), [adviser.id, newAdviser.id].sort());
  assert.equal(await client.lead.count(), beforeManualPreview.leads);
  assert.deepEqual(await client.campusAssignmentCursor.findMany(), beforeManualPreview.cursors);
  assert.equal(await client.auditEvent.count({ where: { eventType: "ASSIGNMENT_DECISION_CREATED" } }), beforeManualPreview.decisions);
  const dashboards = await Promise.all([first, second].map(async (api) => {
    const response = await fetch(`${api}/assignment/dashboard`, { headers });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return object(await response.json());
  }));
  assert.deepEqual(dashboards[0], dashboards[1], "both instances read the same persisted rules and recorded decisions");
  const dashboard = dashboards[0]; assert.ok(dashboard);
  assert.equal(object(dashboard.configuration).activeRules, 1);
  assert.deepEqual(object(dashboard.configuration).versions, [3]);
  assert.equal(object(dashboard.activity).automaticDecisions, 3);
  assert.equal(object(dashboard.activity).completedBatches, null, "historical batch totals are not invented from volatile state");
  const riskResponse = await fetch(`${second}/reports/operational-risks`, { headers });
  assert.equal(riskResponse.status, 200, JSON.stringify(await riskResponse.clone().json()));
  const risks = object(await riskResponse.json()); assert.ok(Array.isArray(risks.capacity));
  const targetCapacity = risks.capacity.map(object).find((entry) => entry.adviserId === newAdviser.id);
  assert.ok(targetCapacity); assert.equal(targetCapacity.capacity, 100); assert.equal(targetCapacity.activeLeads, 1);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: outside.id } });
  const outsideDashboard = await fetch(`${second}/assignment/dashboard`, { headers });
  assert.equal(outsideDashboard.status, 200);
  const outsideData = object(await outsideDashboard.json());
  assert.equal(object(outsideData.configuration).activeRules, 0);
  assert.equal(object(outsideData.activity).automaticDecisions, 0);
  assert.equal(JSON.stringify(outsideData).includes(newAdviser.id), false);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: campus.id } });
  const historyConnectorResponse = await fetch(`${first}/scheduled-sheets`, { method: "POST", headers, body: JSON.stringify({ ...input, tab: "Synthétique historique" }) });
  assert.equal(historyConnectorResponse.status, 201, JSON.stringify(await historyConnectorResponse.clone().json()));
  const historyConnector = String(object(await historyConnectorResponse.json()).id);
  await client.sheetImportRun.createMany({ data: Array.from({ length: 51 }, (_, index) => ({ connectorId: historyConnector,
    status: "COMPLETED", trigger: "MANUAL", startedAt: new Date(Date.UTC(2026, 8, 6, 0, index)), createdCount: index })) });
  const storedHistory = await client.sheetImportRun.findMany({ where: { connectorId: historyConnector }, orderBy: [{ startedAt: "desc" }, { id: "asc" }] });
  const historyAuditCount = await client.auditEvent.count();
  const paged: string[] = [];
  for (const page of [1, 2]) {
    const result = await fetch(`${second}/scheduled-sheets/${historyConnector}/runs?page=${page}`, { headers });
    assert.equal(result.status, 200);
    const rows: unknown = await result.json(); assert.ok(Array.isArray(rows));
    assert.equal(rows.length, page === 1 ? 50 : 1);
    paged.push(...rows.map((row: unknown) => String(object(row).id)));
  }
  assert.deepEqual(paged, storedHistory.map((row) => row.id), "pagination reads every recorded event exactly once in stable order");
  for (const invalidPage of ["0", "-1", "1.5", "10001", "invalid"]) {
    assert.equal((await fetch(`${first}/scheduled-sheets/${historyConnector}/runs?page=${invalidPage}`, { headers })).status, 400);
  }
  assert.equal(await client.auditEvent.count(), historyAuditCount, "paging and invalid pages do not append business audit events");
  assert.deepEqual(await client.sheetImportRun.findMany({ where: { connectorId: historyConnector }, orderBy: [{ startedAt: "desc" }, { id: "asc" }] }), storedHistory);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: outside.id } });
  assert.equal((await fetch(`${second}/scheduled-sheets/${historyConnector}/runs?page=2`, { headers })).status, 404);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: campus.id } });
  await client.collaborator.update({ where: { id: user.id }, data: { roles: ["MANAGER"] } });
  assert.equal((await fetch(`${second}/scheduled-sheets?campus=${campus.id}`, { headers })).status, 403, "current role invariant is checked across instances");
  await client.collaborator.update({ where: { id: user.id }, data: { roles: ["ADMIN"] } });
  const closeReviewConnector = await fetch(`${first}/scheduled-sheets/${id}`, { method: "PUT", headers, body: JSON.stringify({ ...input, mapping: noIdMapping, expectedVersion: 4, enabled: false }) });
  assert.equal(closeReviewConnector.status, 200);
  for (const scenario of [{ enabled: false, fixed: false }, { enabled: true, fixed: false }, { enabled: false, fixed: true }, { enabled: true, fixed: true }]) {
    const automaticEnabled = scenario.enabled;
    const storedResponse: Response = await fetch(`${first}/assignment/config?campusId=${campus.id}`, { headers }); assert.equal(storedResponse.status, 200);
    const stored = object(await storedResponse.json());
    const toggle: Response = await fetch(`${second}/assignment/config`, { method: "PUT", headers, body: JSON.stringify({ campusId: campus.id, expectedVersion: stored.version, rules: stored.rules, automaticEnabled }) });
    assert.equal(toggle.status, 200);
    const toggleVersion = Number(object(await toggle.json()).version);
    const reread: Response = await fetch(`${first}/assignment/config?campusId=${campus.code}`, { headers }); assert.equal(reread.status, 200);
    assert.equal(object(await reread.json()).automaticEnabled, automaticEnabled, "Admin toggle is persisted and seen by the other API");
    const workbook = `synthetic_toggle_${automaticEnabled ? "on" : "off"}_${scenario.fixed ? "fixed" : "round"}`;
    const connectorInput = { ...input, enabled: true, workbookLink: `https://docs.google.com/spreadsheets/d/${workbook}/edit`, tab: "Toggle synthétique",
      assignment: scenario.fixed ? { strategy: "FIXED", targetUserId: newAdviser.id } : input.assignment };
    const createdConnector = await fetch(`${first}/scheduled-sheets`, { method: "POST", headers, body: JSON.stringify(connectorInput) });
    assert.equal(createdConnector.status, 201, JSON.stringify(await createdConnector.clone().json()));
    const connectorId = String(object(await createdConnector.json()).id);
    const until = Date.now() + 8000;
    while (Date.now() < until && await client.sheetImportRun.count({ where: { connectorId, status: "COMPLETED" } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
    assert.equal(await client.sheetImportRun.count({ where: { connectorId, status: "COMPLETED" } }), 1);
    const provenance = await client.leadProvenance.findUniqueOrThrow({ where: { technicalSystem_externalId: { technicalSystem: "FORMINATOR_ZAPIER", externalId: `submission-${workbook}` } } });
    const imported = await client.lead.findUniqueOrThrow({ where: { id: provenance.leadId } });
    assert.equal(Boolean(imported.assignedToId), automaticEnabled, "connector activation never overrides disabled assignment automation");
    const assignments = await client.auditEvent.findMany({ where: { resourceId: imported.id, eventType: "LEAD_ASSIGNED" } });
    assert.equal(assignments.length, automaticEnabled ? 1 : 0);
    assert.equal(await client.auditEvent.count({ where: { eventType: "LEAD_AUTO_ASSIGNED" } }), 0, "no second assignment event emitted");
    if (automaticEnabled) {
      assert.equal(object(assignments[0]?.after).origin, "AUTOMATIC"); assert.equal(object(assignments[0]?.after).configurationVersion, toggleVersion);
      assert.ok(typeof object(assignments[0]?.after).decisionRef === "string");
    } else {
      const receipt = await client.sheetImportRunReceipt.findFirstOrThrow({ where: { run: { connectorId } } });
      assert.equal(receipt.errorCode, "assignment_automation_disabled");
      const before = await client.lead.findUniqueOrThrow({ where: { id: imported.id } });
      const body = { confirmed: true, targetUserId: newAdviser.id, idempotencyKey: `toggle-manual-${scenario.fixed ? "fixed" : "round"}` };
      await client.$executeRawUnsafe("CREATE FUNCTION crmy171_assignment_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'LEAD_ASSIGNED' THEN RAISE EXCEPTION 'synthetic_assignment_audit_failure'; END IF; RETURN NEW; END $$");
      await client.$executeRawUnsafe("CREATE TRIGGER crmy171_assignment_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION crmy171_assignment_fault()");
      try {
        const failed = await fetch(`${first}/leads/${imported.id}/assignment`, { method: "POST", headers, body: JSON.stringify(body) });
        assert.equal(failed.status, 409, JSON.stringify(await failed.clone().json()));
        assert.equal(object(await failed.json()).code, "assignment_failed", "existing single-assignment contract expurgates transaction errors");
        assert.deepEqual(await client.lead.findUniqueOrThrow({ where: { id: imported.id } }), before);
        assert.equal(await client.auditEvent.count({ where: { resourceId: imported.id, eventType: "LEAD_ASSIGNED" } }), 0);
      } finally {
        await client.$executeRawUnsafe("DROP TRIGGER crmy171_assignment_fault ON audit_events");
        await client.$executeRawUnsafe("DROP FUNCTION crmy171_assignment_fault()");
      }
      for (const api of [first, second]) assert.equal((await fetch(`${api}/leads/${imported.id}/assignment`, { method: "POST", headers, body: JSON.stringify(body) })).status, 201);
      assert.equal((await client.lead.findUniqueOrThrow({ where: { id: imported.id } })).assignedToId, newAdviser.id);
      const audit = await client.auditEvent.findMany({ where: { resourceId: imported.id, eventType: "LEAD_ASSIGNED" } });
      assert.equal(audit.length, 1); assert.equal(object(audit[0]?.after).origin, "MANUAL");
      assert.equal(object(audit[0]?.after).configurationVersion, toggleVersion);
    }
    const stop = await fetch(`${second}/scheduled-sheets/${connectorId}`, { method: "PUT", headers, body: JSON.stringify({ ...connectorInput, expectedVersion: 1, enabled: false }) }); assert.equal(stop.status, 200);
  }
  // A dedicated campus avoids a same-name-only collision with the earlier legacy
  // fixture (the simulated source deliberately uses the same synthetic names).
  const localCampusCode = "SYNTHETIC-HTTP-LOCAL-CAMPUS";
  const localCampus = await client.crmReference.create({ data: { kind: "CAMPUS", code: localCampusCode, label: localCampusCode, scope: "GLOBAL", scopeKey: "GLOBAL",
    keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: referenceKey(localCampusCode) } } } });
  await client.crmProgramAvailability.create({ data: { campusId: localCampus.id, programId: program.id } });
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: localCampus.id } });
  const localInput = { ...input, campusId: localCampus.id, workbookLink: "https://docs.google.com/spreadsheets/d/synthetic_http_local_171/edit", enabled: false, expectedVersion: 0,
    source: { mode: "SIMULATED", identityMode: "LOCAL_ROW", sheetId: 0, range: "A1:G6" }, assignment: { strategy: "UNASSIGNED" },
    mapping: { mappingKey: "synthetic-http-local", name: "Mapping local synthétique", profile: "CUSTOM", columns: [
      { sourceColumn: "First", targetField: "firstName", action: "TRIM", required: true }, { sourceColumn: "Last", targetField: "lastName", action: "TRIM", required: true },
      { sourceColumn: "Email", targetField: "email", action: "LOWERCASE" }, { sourceColumn: "Campus", targetField: "campus", action: "TRIM", required: true },
      { sourceColumn: "Program", targetField: "program", action: "TRIM", required: true }, { sourceColumn: "Education", targetField: "educationLevel", action: "TRIM", required: true },
      { sourceColumn: "Campaign", targetField: "campaign", action: "TRIM", required: true },
    ] }, context: { ...input.context, campus: localCampus.code, source: "OTHER_CONTROLLED", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic controlled origin" } };
  // Demonstrate the refusal observed during the first HTTP run instead of
  // weakening name-only collision detection to make this test create a Lead.
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: campus.id } });
  const collisionInput = { ...localInput, campusId: campus.id, workbookLink: "https://docs.google.com/spreadsheets/d/synthetic_http_local_collision/edit",
    mapping: { ...localInput.mapping, mappingKey: "synthetic-http-local-collision" }, context: { ...localInput.context, campus: campus.code } };
  const collisionSaved = await fetch(`${first}/scheduled-sheets`, { method: "POST", headers, body: JSON.stringify(collisionInput) });
  assert.equal(collisionSaved.status, 201, JSON.stringify(await collisionSaved.clone().json()));
  const collisionId = String(object(await collisionSaved.json()).id);
  const leadsBeforeCollision = await client.lead.findMany({ orderBy: { id: "asc" } });
  assert.equal((await fetch(`${second}/scheduled-sheets/${collisionId}/runs`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1 }) })).status, 201);
  const collisionDeadline = Date.now() + 8_000;
  while (Date.now() < collisionDeadline && await client.sheetImportRun.count({ where: { connectorId: collisionId, status: "COMPLETED" } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: collisionId, status: "COMPLETED", createdCount: 0, reviewCount: 1 } }), 1);
  assert.equal(await client.ingestionReviewItem.count({ where: { batch: { actorId: `SYSTEM:SHEETS:${collisionId}` }, reasonCode: "NAME_ONLY_MATCH" } }), 1);
  assert.deepEqual(await client.lead.findMany({ orderBy: { id: "asc" } }), leadsBeforeCollision, "name-only candidate is reviewed without modifying any existing Lead");
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: localCampus.id } });
  const localSaved = await fetch(`${first}/scheduled-sheets`, { method: "POST", headers, body: JSON.stringify(localInput) });
  assert.equal(localSaved.status, 201, JSON.stringify(await localSaved.clone().json()));
  const localConfiguration = object(await localSaved.json()); assert.equal(typeof localConfiguration.id, "string");
  const localId = String(localConfiguration.id);
  assert.equal(localConfiguration.enabled, false);
  assert.equal(object(object(localConfiguration.configuration).source).identityMode, "LOCAL_ROW");
  const leadsBeforeLocal = await client.lead.count();
  const rowsBeforeLocal = await client.sheetLocalRow.count();
  const localSimulation = await fetch(`${second}/scheduled-sheets/${localId}/simulations`, { method: "POST", headers });
  assert.equal(localSimulation.status, 201, JSON.stringify(await localSimulation.clone().json()));
  const localSimulationResult = object(await localSimulation.json());
  assert.equal(localSimulationResult.mutated, false); assert.equal(localSimulationResult.simulated, true);
  assert.equal(localSimulationResult.rows, 1); assert.equal(localSimulationResult.mapped, 1); assert.equal(localSimulationResult.review, 0);
  assert.equal(await client.lead.count(), leadsBeforeLocal);
  assert.equal(await client.sheetLocalRow.count(), rowsBeforeLocal, "simulation does not create local identities");
  const emptyReconciliation = await fetch(`${first}/scheduled-sheets/${localId}/reconciliation`, { headers });
  assert.equal(emptyReconciliation.status, 200, JSON.stringify(await emptyReconciliation.clone().json()));
  assert.deepEqual(await emptyReconciliation.json(), { suspended: false, reason: null, page: 1, rows: [] });
  const queuedLocal = await fetch(`${second}/scheduled-sheets/${localId}/runs`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1 }) });
  assert.equal(queuedLocal.status, 201, JSON.stringify(await queuedLocal.clone().json()));
  const localDeadline = Date.now() + 8_000;
  while (Date.now() < localDeadline && await client.sheetImportRun.count({ where: { connectorId: localId, status: "COMPLETED" } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
  const localRunEvidence = await client.sheetImportRun.findMany({ where: { connectorId: localId }, select: { trigger: true, status: true, createdCount: true, duplicateCount: true, reviewCount: true, errorCode: true } });
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: localId, trigger: "MANUAL", status: "COMPLETED", createdCount: 1 } }), 1, JSON.stringify(localRunEvidence));
  assert.equal((await client.sheetImportConnector.findUniqueOrThrow({ where: { id: localId } })).enabled, false);
  assert.equal(await client.lead.count(), leadsBeforeLocal + 1);
  const localLead = await client.lead.findFirstOrThrow({ where: { email: "synthetic_http_local_171@example.invalid" } });
  assert.equal(localLead.assignedToId, null);
  const localAudit = await client.auditEvent.findMany({ where: { resourceId: localId, eventType: "SHEET_IMPORT_ROW_PROCESSED" } });
  assert.equal(localAudit.length, 1); assert.equal(localAudit[0]?.actorId, `SYSTEM:SHEETS:${localId}`);
  assert.equal(JSON.stringify(localAudit).includes(localLead.email ?? "not-present"), false);
  const historyCount = await client.auditEvent.count();
  const state = await fetch(`${second}/scheduled-sheets/${localId}/reconciliation`, { headers });
  assert.equal(state.status, 200);
  const reconciliation = object(await state.json()); assert.equal(reconciliation.suspended, false); assert.ok(Array.isArray(reconciliation.rows));
  assert.equal(reconciliation.rows.length, 1); const safeRow = object(reconciliation.rows[0]);
  assert.equal(safeRow.rowNumber, 2); assert.equal(safeRow.status, "CREATED");
  assert.deepEqual(Object.keys(safeRow).sort(), ["rowNumber", "status", "errorCode", "firstObservedAt", "lastObservedAt"].sort());
  assert.equal(await client.auditEvent.count(), historyCount, "reconciliation inspection does not emit a business mutation audit");
  assert.equal((await fetch(`${first}/scheduled-sheets/${localId}/reconciliation?page=0`, { headers })).status, 400);
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: outside.id } });
  const hiddenLocal = await fetch(`${second}/scheduled-sheets/${localId}/reconciliation`, { headers });
  const missingLocal = await fetch(`${second}/scheduled-sheets/${randomUUID()}/reconciliation`, { headers });
  assert.equal(hiddenLocal.status, 404); assert.equal(missingLocal.status, 404); assert.deepEqual(await hiddenLocal.json(), await missingLocal.json());
  await client.collaborator.update({ where: { id: user.id }, data: { campusId: localCampus.id } });
  assert.equal((await fetch(`${first}/scheduled-sheets/${localId}/runs`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1 }) })).status, 201);
  const localReplayDeadline = Date.now() + 8_000;
  while (Date.now() < localReplayDeadline && await client.sheetImportRun.count({ where: { connectorId: localId, status: "COMPLETED", duplicateCount: 1 } }) === 0) await new Promise<void>((done) => setTimeout(done, 100));
  assert.equal(await client.sheetImportRun.count({ where: { connectorId: localId, status: "COMPLETED", duplicateCount: 1 } }), 1);
  assert.equal(await client.lead.count(), leadsBeforeLocal + 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: localId, eventType: "SHEET_IMPORT_ROW_PROCESSED" } }), 1);
  assert.equal((await client.sheetImportConnector.findUniqueOrThrow({ where: { id: localId } })).enabled, false);
  t.diagnostic("LOCAL_ROW authenticated HTTP: save, non-mutating simulation, manual queue while disabled, persisted ingestion, redacted read-only reconciliation, cross-campus refusal and replay on two APIs.");
  t.diagnostic("Admin assignment toggle persisted across APIs: active connector imports with/without effective assignment, unique LEAD_ASSIGNED, manual assignment while disabled, audit rollback and cross-instance replay.");
  t.diagnostic("Real authenticated HTTP: disabled creation, immutable versions, simulation without Lead writes, two autonomous API instances, scheduled import, manual replay and one business audit.");
});
