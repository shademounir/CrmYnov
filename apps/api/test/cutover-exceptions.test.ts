import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { CUTOVER_BYTE_LIMIT, cutoverHash, cutoverStreamKey, observeCutover, type CutoverContract } from "../src/cutover/cutover.contract.js";
import { cutoverExceptionEvidenceHash, cutoverTrueObservation, cutoverTrueObservationHash, type CutoverExceptionEvidence } from "../src/cutover/cutover-exceptions.contract.js";
import { assertCutoverJournalBounds } from "../src/cutover/cutover-exceptions.js";
import type { PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import type { SheetValues } from "../src/sheet-import/google-sheets-adapter.js";
import { cutoverPaths, cutoverSchemas } from "../src/cutover/cutover.openapi.js";

const contract: CutoverContract = { schemaVersion: 2, streamKey: cutoverStreamKey("synthetic_exceptions", 0), sourceSheetId: 0,
  bootstrapPackageId: "00000000-0000-4000-8000-000000000063", connectorId: "00000000-0000-4000-8000-000000000064", excelSha256: "a".repeat(64),
  configurationSha256: "b".repeat(64), connectorVersion: 1, t0: "2026-10-09T09:00:00.000Z", timeZone: "Africa/Casablanca", equality: "POST_T0",
  excelFrozenAt: "2026-10-09T09:00:00.000Z", externalIdColumn: "ID", originalArrivalColumn: "UTC", identityEvidenceSha256: "c".repeat(64) };
const values = (text: string, utc = contract.t0): SheetValues => ({ columns: ["ID", "UTC", "Comment"], rows: [{ ID: "synthetic-one", UTC: utc, Comment: text }] });

test("CRMY-63 exception evidence follows actual repeated edits, not the sticky historical snapshot", () => {
  const first = observeCutover(contract, values("original"), []), second = observeCutover(contract, values("changed"), first.entries), third = observeCutover(contract, values("changed again"), second.entries);
  assert.equal(second.snapshotSha256, third.snapshotSha256, "Historical inventory intentionally keeps the old fingerprint");
  assert.equal(third.entries[0]!.payload.Comment, "original");
  const secondRead = cutoverTrueObservation(contract, values("changed"), second.entries), thirdRead = cutoverTrueObservation(contract, values("changed again"), third.entries);
  assert.notEqual(cutoverTrueObservationHash("b".repeat(64), second.headerSha256, secondRead.sources), cutoverTrueObservationHash("b".repeat(64), third.headerSha256, thirdRead.sources));
  assert.equal(secondRead.payloads.get(second.entries[0]!.key)?.Comment, "changed");
});
test("CRMY-63 true evidence includes absence, original arrival, binding and columns", () => {
  const initial = observeCutover(contract, values("original"), []), present = cutoverTrueObservation(contract, values("original"), initial.entries);
  const absent = cutoverTrueObservation(contract, { columns: values("").columns, rows: [] }, initial.entries);
  const later = cutoverTrueObservation(contract, values("original", "2026-10-09T09:01:00Z"), initial.entries);
  assert.deepEqual(absent.sources[0], { sourceKey: initial.entries[0]!.key, present: false, fingerprint: null, originalArrivedAt: null });
  const hashes = [cutoverTrueObservationHash("binding", "columns", present.sources), cutoverTrueObservationHash("binding", "columns", absent.sources),
    cutoverTrueObservationHash("binding", "columns", later.sources), cutoverTrueObservationHash("changed binding", "columns", present.sources), cutoverTrueObservationHash("binding", "changed columns", present.sources)];
  assert.equal(new Set(hashes).size, hashes.length);
});
test("CRMY-63 true observation is ordinal stable and refuses duplicate identities/unknown coverage", () => {
  const input = values("unchanged"); input.rows.push({ ID: "synthetic-two", UTC: contract.t0, Comment: "Other" });
  const inventory = observeCutover(contract, input, []).entries, before = cutoverTrueObservation(contract, input, inventory);
  const reversed = cutoverTrueObservation(contract, { ...input, rows: [...input.rows].reverse() }, inventory);
  assert.deepEqual(before.sources, reversed.sources);
  assert.throws(() => cutoverTrueObservation(contract, { ...input, rows: [...input.rows, input.rows[0]!] }, inventory));
  assert.throws(() => cutoverTrueObservation(contract, input, inventory.slice(1)));
});
test("CRMY-63 case hash covers source and REVIEW fingerprints without depending on client declarations", () => {
  const source = cutoverTrueObservation(contract, values("original"), observeCutover(contract, values("original"), []).entries).sources[0]!;
  const evidence: CutoverExceptionEvidence = { schemaVersion: 1, bindingSha256: "b".repeat(64), headerSha256: "c".repeat(64), sourceKey: source.sourceKey, kind: "EFFECT_REVIEW",
    originalFingerprint: cutoverHash(values("original").rows[0]), originalArrivedAt: contract.t0, source,
    review: { effectId: contract.connectorId, batchId: contract.bootstrapPackageId, fingerprint: "d".repeat(64), reason: "cutover_identity_review_required" } };
  assert.notEqual(cutoverExceptionEvidenceHash(evidence), cutoverExceptionEvidenceHash({ ...evidence, review: { ...evidence.review!, fingerprint: "e".repeat(64) } }));
  assert.notEqual(cutoverExceptionEvidenceHash(evidence), cutoverExceptionEvidenceHash({ ...evidence, source: { ...source, fingerprint: "f".repeat(64) } }));
});
test("CRMY-63 global journal bound includes inventory, observation, cases and dispositions before commit", async () => {
  let query = "";
  const tx = (bytes: bigint, count = 1): PermissionTransaction => ({ $queryRaw: (parts: TemplateStringsArray) => { query = parts.join("?"); return Promise.resolve([{ count, bytes }]); } }) as unknown as PermissionTransaction;
  await assertCutoverJournalBounds(tx(BigInt(CUTOVER_BYTE_LIMIT)), contract.connectorId);
  await assert.rejects(() => assertCutoverJournalBounds(tx(BigInt(CUTOVER_BYTE_LIMIT + 1)), contract.connectorId), (error: unknown) => error instanceof HttpException && JSON.stringify(error.getResponse()).includes("cutover_exception_journal_bound_exceeded"));
  await assert.rejects(() => assertCutoverJournalBounds(tx(1n, 10001), contract.connectorId));
  assert.match(query, /import_cutover_exception_dispositions/u); assert.match(query, /to_jsonb\(c\)/u);
  assert.match(query, /to_jsonb\(m\)/u); assert.match(query, /jsonb_array_length\(m.inventory\)/u);
});
test("CRMY-63 OpenAPI exposes motivated quarantine, never ingestion or automatic rearm", () => {
  assert.ok(cutoverPaths["/lead-import/cutover/manifests/{id}/exceptions"].get);
  assert.ok(cutoverPaths["/lead-import/cutover/manifests/{id}/exceptions/{caseId}/disposition"].post);
  assert.deepEqual(cutoverSchemas.CutoverQuarantine.properties.action.enum, ["QUARANTINE_PRESERVE"]);
  assert.equal(cutoverSchemas.CutoverQuarantine.properties.reason.minLength, 8);
  assert.match(cutoverSchemas.CutoverQuarantine.description, /fresh observe/u);
});
