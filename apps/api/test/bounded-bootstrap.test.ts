import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hash, type HistoricalDecisionInput } from "../src/bootstrap-import/bootstrap-import.contract.js";
import { boundedBootstrapReconciliation, deferralBinding, deferralReceiptResponse, isDeferralInput, validDeferral, BOUNDED_BOOTSTRAP_POLICY } from "../src/bootstrap-import/bounded-bootstrap.js";
import { historicalReconciliation } from "../src/bootstrap-import/historical-reconciliation.js";
import { deferredHistoricalCollision, historicalContactSignals } from "../src/bootstrap-import/bootstrap-create-guards.js";
import { APPEND_MODE, APPEND_POLICY } from "../src/sheet-import/sheet-append-contract.js";
import { appendBootstrapProofHash, appendBootstrapQualified, readAppendQualification, DEFERRED_RESERVATION_POLICY, type SheetAppendQualificationArtifact } from "../src/sheet-import/sheet-append-qualification.js";
import type { PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import type { Prisma } from "@prisma/client";
import { SheetImportExecutor } from "../src/sheet-import/sheet-import-executor.js";

const sha256 = "a".repeat(64), actorId = "11111111-1111-4111-8111-111111111111", planId = "22222222-2222-4222-8222-222222222222";
function fixture(): Parameters<typeof boundedBootstrapReconciliation>[0] {
  const payload = { rowNumber: 7, cells: { C: { value: " deferred@example.invalid ", type: "inlineStr", raw: null }, I: { value: "  Note différée exacte\n ", type: "inlineStr", raw: null } }, annotations: [{ text: "Orpheline conservée", author: null }] };
  const mapped = { values: { email: null, phone: null, firstName: "Synthetic", lastName: "Deferred" }, comments: [{ column: "I", text: payload.cells.I.value }] };
  const row = { id: "33333333-3333-4333-8333-333333333333", sheet: "VISITES ET APPELS", relationId: "rId1", rowNumber: 7,
    sourceKey: hash([sha256, "rId1", 7]), fingerprint: hash(payload), payload, mapped, reasons: ["OWNER_UNKNOWN", "NATIVE_ANNOTATION_QUARANTINE"],
    planId, version: 1, state: "REVIEW", leadId: null, decision: null as unknown, decisionKey: "defer-synthetic", decisionFingerprint: null as string | null };
  const binding = deferralBinding(sha256, row);
  const decision = { action: "DEFER", confirmed: true, expectedVersion: 1, idempotencyKey: row.decisionKey, reason: "Identité et propriétaire à vérifier explicitement", actorId, deferral: binding };
  row.decision = decision; row.decisionFingerprint = hash({ ...decision, expectedVersion: undefined }); row.state = "DEFERRED"; row.version = 2;
  return { sha256, rows: [row], notes: [], receipts: [], provenance: [], leads: [], truncated: false, coverageQualified: true,
    deferralReceipts: [{ key: row.decisionKey, fingerprint: row.decisionFingerprint, actorId, response: deferralReceiptResponse(row.id, row.decisionFingerprint, binding) }] };
}
function qualification(report: Record<string, unknown>): SheetAppendQualificationArtifact {
  const bounded = report.boundedReconciliation as ReturnType<typeof boundedBootstrapReconciliation>;
  return { schemaVersion: 2, mode: APPEND_MODE, policy: APPEND_POLICY, boundaryArtifactSha256: "b".repeat(64),
    bootstrapPackageId: "44444444-4444-4444-8444-444444444444", excelSha256: sha256, reportSha256: appendBootstrapProofHash(report, 2), bindingSha256: "c".repeat(64), evidenceSha256: "d".repeat(64),
    qualifiedAt: "2026-01-01T00:00:01.000Z", producerCondition: { confirmedAt: "2026-01-01T00:00:00.000Z", evidenceSha256: "e".repeat(64) },
    boundedBootstrap: { policy: BOUNDED_BOOTSTRAP_POLICY, inventorySha256: bounded.inventorySha256, deferredOccurrences: bounded.deferredOccurrences,
      deferredWithoutUsableContact: bounded.deferredWithoutUsableContact, reservationPolicy: DEFERRED_RESERVATION_POLICY } };
}
test("DEFER requires explicit confirmation and forbids invented identity/status/annotation decisions", () => {
  const base: HistoricalDecisionInput = { action: "DEFER", confirmed: true, expectedVersion: 1, idempotencyKey: "defer-synthetic", reason: "Revue différée explicite" };
  assert.equal(isDeferralInput(base), true);
  for (const change of [{ confirmed: undefined }, { overrides: {} }, { cycle: {} }, { annotations: [] }, { targetLeadId: actorId }]) assert.equal(isDeferralInput({ ...base, ...change } as HistoricalDecisionInput), false);
  for (const key of [undefined, null, 123, true]) assert.equal(isDeferralInput({ ...base, idempotencyKey: key } as unknown as HistoricalDecisionInput), false);
});
test("a deferred source stays globally unresolved, exact comments and annotations retained but NOT persisted", () => {
  const input = fixture(), report = boundedBootstrapReconciliation(input);
  assert.equal(validDeferral(sha256, input.rows[0]!, input.deferralReceipts), true);
  assert.equal(historicalReconciliation(input).complete, false);
  assert.equal(historicalReconciliation(input).unresolvedOccurrences, 1);
  assert.deepEqual(historicalReconciliation(input).axes.resolvedOwner, {}, "unknown deferred ownership is not UNASSIGNED");
  assert.equal(report.qualified, true); assert.equal(report.deferredOccurrences, 1);
  assert.equal(report.deferredComments, 1); assert.equal(report.deferredNativeAnnotations, 1);
  assert.equal(report.deferredWithoutUsableContact, 0, "literal raw contact reserves even an unmapped contact");
  assert.equal(input.notes.length, 0); assert.equal(input.receipts.length, 0); assert.equal(input.leads.length, 0);
});
test("bounded reconciliation refuses omitted disposition, corruption, false receipt and truncation", () => {
  const cases: Array<(input: ReturnType<typeof fixture>) => void> = [
    input => { input.rows[0]!.state = "READY"; }, input => { input.rows[0]!.version++; }, input => { input.coverageQualified = false; }, input => { input.truncated = true; },
    input => { input.rows[0]!.mapped = { values: { email: "changed@example.invalid" } }; }, input => { input.rows[0]!.fingerprint = "f".repeat(64); },
    input => { input.rows[0]!.reasons = []; }, input => { input.deferralReceipts = []; }, input => { input.deferralReceipts[0]!.actorId = planId; },
    input => { input.deferralReceipts[0]!.response = { rowId: "other" }; }, input => { input.rows.push(input.rows[0]!); },
  ];
  for (const mutate of cases) { const input = fixture(); mutate(input); assert.equal(boundedBootstrapReconciliation(input).qualified, false); }
});
test("even a valid deferral cannot conceal a Lead, commit receipt, provenance or note effect", () => {
  const input = fixture(); input.receipts.push({ key: input.rows[0]!.id, actorId, fingerprint: "f".repeat(64), response: {} });
  assert.equal(boundedBootstrapReconciliation(input).qualified, false);
  const lead = fixture(); lead.rows[0]!.leadId = actorId; assert.equal(boundedBootstrapReconciliation(lead).qualified, false);
  const note = fixture(); note.notes.push({ rowId: note.rows[0]!.id, leadId: actorId, cellKey: "f".repeat(64), fingerprint: "f".repeat(64), sourceSheet: "VISITES ET APPELS", sourceRow: 7, sourceColumn: "I", text: "x", sourceValue: {}, author: null, occurredAt: null });
  assert.equal(boundedBootstrapReconciliation(note).qualified, false);
});
test("V1 projection and strict guard remain unchanged; V2 is explicit and reopening invalidates it", () => {
  const input = fixture(), strict = historicalReconciliation(input), bounded = boundedBootstrapReconciliation(input);
  const oldReport = { cutoverBlocked: true, reconciliation: strict };
  const report = { ...oldReport, boundedReconciliation: bounded };
  assert.equal(appendBootstrapProofHash(report), appendBootstrapProofHash(oldReport));
  const q = qualification(report); assert.deepEqual(readAppendQualification(q), q);
  assert.equal(appendBootstrapQualified(report, q), true);
  const v1 = { ...q, schemaVersion: 1 as const, reportSha256: appendBootstrapProofHash(report) }; delete v1.boundedBootstrap;
  assert.equal(appendBootstrapQualified(report, v1), false);
  assert.throws(() => readAppendQualification({ ...q, schemaVersion: 1 }));
  input.rows[0]!.state = "REVIEW"; input.rows[0]!.version++; input.rows[0]!.decision = null; input.rows[0]!.decisionKey = null; input.rows[0]!.decisionFingerprint = null;
  const reopened = { ...report, boundedReconciliation: boundedBootstrapReconciliation(input) };
  assert.equal(reopened.boundedReconciliation.qualified, false); assert.equal(appendBootstrapQualified(reopened, q), false);
});
test("literal reservation signals exclude formulas, invalid multi-contacts and inferred phone countries", () => {
  const signals = historicalContactSignals({ values: {} }, { cells: { A: { value: " RAW@EXAMPLE.INVALID " }, B: { value: "+212 (6) 12 34 56 78" }, C: { value: "0612345678 / 1234" }, D: { value: "formula@example.invalid", formula: { text: "untrusted" } } } });
  assert.deepEqual(signals.emails, ["raw@example.invalid"]); assert.deepEqual(signals.phones, ["+212612345678"]);
  const input = fixture(); input.rows[0]!.payload = { cells: {} }; // changing source is not permitted; report nevertheless exposes unmatched risk, not global silent exclusion.
  assert.equal(boundedBootstrapReconciliation(input).deferredWithoutUsableContact, 1);
});
test("Sheet reservation query is scoped, bounded, raw+mapped, and returns only a conservative review reason", async () => {
  let query: Prisma.Sql | undefined;
  for (const [result, expected] of [
    [{ overflow: false, contact: false, name: false }, null], [{ overflow: false, contact: true, name: true }, "sheet_append_deferred_contact_review"],
    [{ overflow: false, contact: false, name: true }, "sheet_append_deferred_name_review"], [{ overflow: true, contact: false, name: false }, "sheet_append_deferred_scope_review"],
    [undefined, "sheet_append_deferred_scope_review"], [{ overflow: false, contact: undefined, name: false }, "sheet_append_deferred_scope_review"],
  ] as const) {
    const tx = { $queryRaw: (sql: Prisma.Sql): Promise<unknown[]> => { query = sql; return Promise.resolve(result ? [result] : []); } } as unknown as PermissionTransaction;
    assert.equal(await deferredHistoricalCollision(tx, { campusId: actorId, email: "match@example.invalid", phone: null, firstName: "Synthetic", lastName: "Different" }), expected);
  }
  assert.ok(query); assert.ok(query.text.includes("r.state='DEFERRED'")); assert.ok(query.text.includes("jsonb_each")); assert.ok(query.text.includes("NOT (cell ? 'formula')"));
  assert.ok(query.text.includes("r.state IN ('REVIEW','READY')")); assert.ok(query.text.includes("deferred_receipt.operation='DEFER_ROW'"));
  assert.ok(query.values.includes(10001)); assert.ok(query.values.includes(actorId)); assert.ok(!query.text.includes("SELECT id"));
});
test("deferred SQL reservation trims exactly ECMAScript edge whitespace without joining internal contacts", async () => {
  const trimCharacters = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  assert.equal([...new Set(trimCharacters)].length, 25);
  for (const character of trimCharacters) {
    const signals = historicalContactSignals({ values: { email: `${character}EDGE@EXAMPLE.INVALID${character}`, phone: `${character}+212600000001${character}` } },
      { cells: { A: { value: `${character}RAW@EXAMPLE.INVALID${character}` }, B: { value: `${character}+212600000002${character}` } } });
    assert.deepEqual(signals, { emails: ["edge@example.invalid", "raw@example.invalid"], phones: ["+212600000001", "+212600000002"] });
  }
  assert.deepEqual(historicalContactSignals({ values: {} }, { cells: {
    A: { value: "not@exa\tmple.invalid" }, B: { value: "+21260\u00a0000001" },
  } }), { emails: [], phones: [] }, "internal whitespace is not stripped or joined into a contact");
  let query: Prisma.Sql | undefined;
  const tx = { $queryRaw: (sql: Prisma.Sql): Promise<unknown[]> => { query = sql; return Promise.resolve([{ overflow: false, contact: false, name: false }]); } } as unknown as PermissionTransaction;
  await deferredHistoricalCollision(tx, { campusId: actorId, email: "edge@example.invalid", phone: "+212600000001", firstName: "\tSynthetic\u00a0", lastName: "\r\nDifferent\ufeff" });
  assert.ok(query);
  assert.equal(query.values.filter(value => value === trimCharacters).length, 11, "all mapped/decided/raw contact and name btrim calls use the same bound character set");
  assert.doesNotMatch(query.text, /btrim\([^,)]+\)/u, "no ASCII-only btrim remains in this new reservation query");
  assert.ok(query.values.includes("Synthetic")); assert.ok(query.values.includes("Different"));
  for (const character of ["\u0085", "\u180e", "\u200b"]) assert.equal(trimCharacters.includes(character), false, "non-ECMAScript characters are not added to trimming");
});
test("external-ID deferred REVIEW is durable across runs, not an implicit future CREATE or an unrelated legacy review", async () => {
  type Submission = { externalId: string; fingerprint: string; outcome: string; batchId: string | null };
  const state = { previous: null as Submission | null };
  let guardCalls = 0, persistenceCalls = 0;
  const receipts: Array<{ outcome: string; errorCode?: string }> = [];
  const tx = {
    sheetImportRunReceipt: { findUnique: (): Promise<null> => Promise.resolve(null), create: ({ data }: { data: { outcome: string; errorCode?: string } }): Promise<void> => { receipts.push(data); return Promise.resolve(); } },
    sheetImportSubmission: { findUnique: (): Promise<Submission | null> => Promise.resolve(state.previous), create: ({ data }: { data: Submission }): Promise<void> => { state.previous = data; return Promise.resolve(); } },
    sheetImportRun: { update: (): Promise<void> => Promise.resolve() },
    auditEvent: { create: (): Promise<void> => Promise.resolve() },
    $queryRaw: (): Promise<unknown[]> => { guardCalls++; return Promise.resolve([{ overflow: false, contact: true, name: false }]); },
  };
  const executor = Object.assign(Object.create(SheetImportExecutor.prototype) as object, {
    mappings: { recordsFromSnapshot: (): unknown[] => [{ firstName: "Synthetic", lastName: "Different", email: "deferred@example.invalid" }] },
    ingestion: { persistSheetRecord: (): never => { persistenceCalls++; throw new Error("unexpected_creation"); } },
  }) as unknown as { processRow(tx: unknown, context: unknown, row: Record<string, string>, columns: string[]): Promise<void> };
  const context = { lease: { connectorId: planId, runId: actorId }, campusId: actorId, configuration: { mapping: { columns: [{ sourceColumn: "ID", targetField: "externalId" }] } } };
  const row = { ID: "synthetic-durable-id", Email: "deferred@example.invalid" };
  await executor.processRow(tx, context, row, Object.keys(row));
  assert.equal(state.previous?.outcome, "REVIEW"); assert.equal(state.previous?.batchId, null);
  assert.equal(receipts[0]?.errorCode, "sheet_append_deferred_contact_review");
  await executor.processRow(tx, context, row, Object.keys(row));
  assert.equal(receipts[1]?.outcome, "REVIEW"); assert.equal(receipts[1]?.errorCode, "sheet_append_deferred_review_pending");
  assert.equal(guardCalls, 1, "replay cannot later create even after the historical reservation is resolved");
  assert.equal(persistenceCalls, 0);
  state.previous = { ...state.previous!, batchId: planId };
  await executor.processRow(tx, context, row, Object.keys(row));
  assert.equal(receipts[2]?.outcome, "DUPLICATE"); assert.equal(receipts[2]?.errorCode, undefined, "legacy business review is not attributed falsely to a deferral");
});

test("DEFERRED uses existing unconstrained VARCHAR/JSON receipt primitives, no new migration required", () => {
  const migration = readFileSync(resolve(__dirname, "../prisma/migrations/20261007153000_bootstrap_historical_excel/migration.sql"), "utf8");
  assert.match(migration, /"state" VARCHAR\(24\) NOT NULL DEFAULT 'REVIEW'/);
  assert.match(migration, /"decision" JSONB/); assert.match(migration, /"operation" VARCHAR\(24\)/);
  const rowTable = migration.match(/CREATE TABLE "bootstrap_import_rows" \([\s\S]+?\n\);/)?.[0];
  assert.ok(rowTable); assert.ok(!/CHECK\s*\(/i.test(rowTable), "row state must not rely on a forbidden enum/check change");
});
