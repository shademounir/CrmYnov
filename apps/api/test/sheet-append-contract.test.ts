import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { APPEND_MODE, APPEND_POLICY, appendBinding, appendCompletion, appendOccurrenceKey, appendPositions, readAppendBoundary } from "../src/sheet-import/sheet-append-contract.js";
import { appendRowMayComplete, appendWorkerEnabled } from "../src/sheet-import/sheet-append-ledger.js";
import { appendBootstrapProofHash, readAppendQualification } from "../src/sheet-import/sheet-append-qualification.js";
import { readSheetConfiguration } from "../src/sheet-import/sheet-import-configuration.js";

const boundary = (): ReturnType<typeof readAppendBoundary> => readAppendBoundary({ schemaVersion: 1, mode: APPEND_MODE, workbookId: "synthetic_append_contract", sheetId: 0,
  tab: "SYNTHETIC", generation: randomUUID(), range: "A1:CV10001", capturedAt: "2026-01-01T00:00:00.000Z", boundaryRow: 3,
  values: [["First", "Last", "Email"], ["Synthetic", "Historical", "history@example.invalid"], [" "]] });

test("append boundary: ceiling columns are not invented data headers; whitespace still occupies N0", () => {
  const saved = boundary(); assert.equal(saved.boundaryRow, 3);
  const observed = appendPositions(saved.range, saved.values); assert.equal(observed.header.length, 3); assert.equal(observed.positions[0]?.cells.length, 100);
  assert.equal(observed.positions[1]?.empty, false);
});
test("append boundary: no retrospective timestamp, invented N0 or invalid calendar", () => {
  const saved = boundary();
  for (const change of [{ boundaryRow: 4 }, { boundaryRow: 2 }, { capturedAt: "2026-02-30T00:00:00.000Z" }, { capturedAt: "2999-01-01T00:00:00.000Z" }, { capturedAt: "2026-01-01T00:00:00+01:00" }, { mode: "EXTERNAL_ID" }]) {
    assert.throws(() => readAppendBoundary({ ...saved, ...change }), /sheet_append_/u);
  }
});
test("append observation: no silent truncation, unheaded values or duplicate headers", () => {
  for (const [range, values] of [["A1:C4", [["A", "B", "C"], [], [], ["last"]]], ["A1:CV10001", [["A", "B"], ["x", "y", "unheaded"]]],
    ["A1:C5", [["A", "A"]]], ["A1:C5", [["A", "", "C"]]], ["A1:C5", [["A"], [5]]]] as const) {
    assert.throws(() => appendPositions(range, values), /sheet_append_/u);
  }
});
test("append observation: blank tail does not advance cursor; interior gaps are retained", () => {
  const observed = appendPositions("A1:C20", [["A"], ["old"], [], ["new"], [], []]);
  assert.equal(observed.lastOccupiedRow, 4); assert.deepEqual(observed.positions.map(({ row, empty }) => ({ row, empty })), [{ row: 2, empty: false }, { row: 3, empty: true }, { row: 4, empty: false }]);
});
test("append identity: source, immutable tab, generation and position; never contact or payload", () => {
  const saved = boundary(), first = appendOccurrenceKey(saved, 4);
  assert.match(first, /^[a-f0-9]{64}$/u); assert.equal(appendOccurrenceKey({ ...saved }, 4), first);
  for (const alternate of [{ ...saved, generation: randomUUID() }, { ...saved, sheetId: 1 }, { ...saved, workbookId: "synthetic_other_contract" }]) assert.notEqual(appendOccurrenceKey(alternate, 4), first);
  assert.notEqual(appendOccurrenceKey(saved, 5), first); assert.throws(() => appendOccurrenceKey(saved, 3), /position_invalid/u);
});
test("append completion: only missing cells can be filled, not overwritten or reordered", () => {
  assert.equal(appendCompletion(["Synthetic", "", ""], ["Synthetic", "New", "new@example.invalid"]), true);
  assert.equal(appendCompletion(["Synthetic", "Old"], ["Synthetic", "New"]), false);
  assert.equal(appendCompletion(["Old", "Synthetic"], ["Synthetic", "Old"]), false);
  assert.equal(appendCompletion(["Old", " "], ["Old", "New"]), false);
  assert.equal(appendRowMayComplete({ status: "PENDING", payload: ["Old", ""] }, ["Old", "Completed"]), true);
  assert.equal(appendRowMayComplete({ status: "INCOMPLETE", payload: ["Old", ""] }, ["Old", "Completed"]), true);
  for (const status of ["CREATED", "REVIEW", "DUPLICATE", "IGNORED"]) assert.equal(appendRowMayComplete({ status, payload: ["Old", ""] }, ["Old", "Completed"]), false);
});
test("append OFF job: exits before database/Google initialization, even with unusable private configuration", async () => {
  const output = await promisify(execFile)(process.execPath, ["--require", "tsx/cjs", "--eval", "require('./src/jobs/sheet-append.ts').runSheetAppendJob().catch(()=>process.exitCode=1)"],
    { cwd: process.cwd(), timeout: 30000, windowsHide: true, env: { ...process.env, SHEETS_ENABLED: "false", SHEET_ROW_APPEND_ENABLED: "false",
      DATABASE_URL: "postgresql://unavailable.invalid/never", CRM_SHEET_APPEND_BOUNDARY_FILE: "nonexistent-private-boundary", CRM_SHEET_APPEND_POLICY_QUALIFIED: "true" } });
  assert.equal(output.stderr, ""); assert.deepEqual(JSON.parse(output.stdout.trim()), { job: "sheet-append", skipped: "append_flags_off" });
});
test("append flags: strict OFF means not executable; strings are not approvals", () => {
  assert.equal(appendWorkerEnabled({}), false); assert.equal(appendWorkerEnabled({ SHEETS_ENABLED: "true" }), false);
  assert.equal(appendWorkerEnabled({ SHEETS_ENABLED: "true", SHEET_ROW_APPEND_ENABLED: "1" }), false);
  assert.equal(appendWorkerEnabled({ SHEETS_ENABLED: "true", SHEET_ROW_APPEND_ENABLED: "true" }), true);
});
test("append qualification artifact: explicit policy, private evidence and real package required", () => {
  const valid = { schemaVersion: 1, mode: APPEND_MODE, policy: APPEND_POLICY, boundaryArtifactSha256: "a".repeat(64), bootstrapPackageId: randomUUID(),
    excelSha256: "b".repeat(64), reportSha256: "c".repeat(64), bindingSha256: "d".repeat(64), evidenceSha256: "e".repeat(64), qualifiedAt: "2026-01-01T00:00:00.000Z",
    producerCondition: { confirmedAt: "2026-01-01T00:00:00.000Z", evidenceSha256: "f".repeat(64) } };
  assert.deepEqual(readAppendQualification(valid), valid);
  for (const change of [{ mode: "EXTERNAL_ID" }, { policy: "SKIP_RECONCILIATION" }, { reportSha256: "" }, { bootstrapPackageId: "fake" }, { qualifiedAt: "2999-01-01T00:00:00.000Z" },
    { producerCondition: undefined }, { producerCondition: { ...valid.producerCondition, confirmedAt: "2026-01-02T00:00:00.000Z" } }]) assert.throws(() => readAppendQualification({ ...valid, ...change }));
});
test("append bootstrap proof: live dossier axes may evolve, exact historical effects cannot", () => {
  const report = { cutoverBlocked: false, sourceCoverage: { complete: true }, reconciliation: { complete: true, effects: { exactNotes: 2, exactRowReceipts: 1 },
    axes: { sourceStatus: { PROSPECT: 1 }, currentDossierStatus: { PROSPECT: 1 }, currentDossierOwner: { OLD: 1 } }, currentDossierAxes: { visible: 1, withheld: 0 } } };
  const later = { ...report, reconciliation: { ...report.reconciliation, axes: { ...report.reconciliation.axes, currentDossierStatus: { ENROLLED: 1 }, currentDossierOwner: { NEW: 1 } } } };
  assert.equal(appendBootstrapProofHash(later), appendBootstrapProofHash(report));
  assert.notEqual(appendBootstrapProofHash({ ...report, reconciliation: { ...report.reconciliation, effects: { exactNotes: 1, exactRowReceipts: 1 } } }), appendBootstrapProofHash(report));
  assert.notEqual(appendBootstrapProofHash({ ...report, cutoverBlocked: true }), appendBootstrapProofHash(report));
});
test("append mapping: source explicit, CUSTOM and local provenance; stable revision metadata is not source identity", () => {
  const value = { source: { mode: "SIMULATED", identityMode: APPEND_MODE, sheetId: 0, range: "A1:CV10001" },
    mapping: { id: "mapping-000000000000000000000000", name: "Synthetic", mappingKey: "synthetic-map", profile: "CUSTOM", version: 1, createdAt: "2026-01-01T00:00:00.000Z", createdBy: randomUUID(), columns: [{ sourceColumn: "First", targetField: "firstName", action: "TRIM" }] },
    context: { source: "WEB_FORM", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic declared origin", campus: "SYNTHETIC", campaign: "SYNTHETIC" }, assignment: { strategy: "UNASSIGNED" } };
  const parsed = readSheetConfiguration(value); assert.equal(parsed.source?.identityMode, APPEND_MODE);
  const hash = appendBinding("synthetic_workbook", "SYNTHETIC", "synthetic-campus", parsed);
  const revised = { ...parsed, mapping: { ...parsed.mapping, version: 2 } };
  assert.equal(appendBinding("synthetic_workbook", "SYNTHETIC", "synthetic-campus", revised), hash);
  assert.notEqual(appendBinding("synthetic_workbook", "SYNTHETIC", "other-campus", parsed), hash);
  assert.throws(() => readSheetConfiguration({ ...value, mapping: { ...value.mapping, profile: "FORMINATOR_ZAPIER" } }));
});
