import assert from "node:assert/strict";
import test from "node:test";
import { classifySheetRow, sheetImportDefaults, sheetInterval, sheetRetry, sheetRowFingerprint } from "../src/sheet-import/sheet-import-policy.js";

const row = { "Submission ID": "synthetic-001", "Programme": "Programme synthétique" };

test("Sheets defaults are disabled and the schedule is bounded to 5–15 integer minutes", () => {
  assert.deepEqual(sheetImportDefaults, { enabled: false, intervalMinutes: 15 });
  for (const interval of [5, 10, 15]) assert.equal(sheetInterval(interval), interval);
  for (const interval of [0, 4, 16, 5.5, Number.NaN]) assert.throws(() => sheetInterval(interval), /sheet_interval_invalid/u);
});

test("Missing stable identity is reviewed, never synthesized from row contents", () => {
  for (const id of [undefined, "", "  "]) assert.deepEqual(classifySheetRow(id, row, undefined), { kind: "REVIEW", reason: "submission_id_missing" });
});

test("Malformed identities are reviewed without exposing the value", () => {
  for (const id of ["x".repeat(129), "synthetic\n001"]) assert.deepEqual(classifySheetRow(id, row, undefined), { kind: "REVIEW", reason: "submission_id_invalid" });
});

test("First import uses the common Forminator source, not the Sheets transport", () => {
  assert.deepEqual(classifySheetRow(" synthetic-001 ", row, undefined), {
    kind: "IMPORT", source: "FORMINATOR_ZAPIER", externalId: "synthetic-001", fingerprint: sheetRowFingerprint(row),
  });
});

test("Column property order does not change the fingerprint or create a second import", () => {
  const reversed = { "Programme": "Programme synthétique", "Submission ID": "synthetic-001" };
  const previous = { externalId: "synthetic-001", fingerprint: sheetRowFingerprint(row) };
  assert.equal(sheetRowFingerprint(reversed), previous.fingerprint);
  assert.equal(classifySheetRow("synthetic-001", reversed, previous).kind, "REPLAY");
});

test("Changed submission is reviewed without overwriting canonical data", () => {
  assert.deepEqual(classifySheetRow("synthetic-001", { ...row, Programme: "Autre programme synthétique" }, {
    externalId: "synthetic-001", fingerprint: sheetRowFingerprint(row),
  }), { kind: "REVIEW", reason: "submission_changed" });
});

test("Tracking another submission fails closed instead of reporting a replay", () => {
  assert.throws(() => classifySheetRow("synthetic-001", row, { externalId: "synthetic-002", fingerprint: sheetRowFingerprint(row) }), /sheet_submission_tracking_mismatch/u);
});

test("Tracking metadata contains only an identity and an opaque fingerprint", () => {
  const result = classifySheetRow("synthetic-001", row, undefined);
  assert.equal(JSON.stringify(result).includes("Programme synthétique"), false);
  assert.match(sheetRowFingerprint(row), /^[a-f0-9]{64}$/u);
});

test("Authentication and ordinary client failures are terminal", () => {
  for (const status of [401, 403]) assert.deepEqual(sheetRetry(status, 1, undefined, 0), { kind: "STOP", reason: "access_denied" });
  for (const status of [400, 404, 409]) assert.deepEqual(sheetRetry(status, 1, undefined, 0), { kind: "STOP", reason: "source_rejected" });
});

test("Network and service retries use bounded exponential delay and stop on the third attempt", () => {
  for (const status of ["NETWORK", 500, 503] as const) {
    assert.deepEqual(sheetRetry(status, 1, undefined, 0), { kind: "RETRY", delayMs: 1_000 });
    assert.deepEqual(sheetRetry(status, 2, undefined, 0), { kind: "RETRY", delayMs: 2_000 });
    assert.deepEqual(sheetRetry(status, 3, undefined, 0), { kind: "STOP", reason: "attempts_exhausted" });
  }
});

test("Rate limits honor Retry-After seconds or date, without shortening a long backoff", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.deepEqual(sheetRetry(429, 1, "60", now), { kind: "RETRY", delayMs: 60_000 });
  assert.deepEqual(sheetRetry(429, 1, "Thu, 01 Jan 2026 00:01:00 GMT", now), { kind: "RETRY", delayMs: 60_000 });
  assert.deepEqual(sheetRetry(429, 1, "901", now), { kind: "STOP", reason: "retry_after_exceeds_budget" });
  assert.deepEqual(sheetRetry(429, 1, "invalid", now), { kind: "RETRY", delayMs: 1_000 });
  assert.deepEqual(sheetRetry(429, 1, "", now), { kind: "RETRY", delayMs: 1_000 });
});

test("Invalid retry context is rejected", () => {
  for (const attempt of [0, -1, 1.5]) assert.throws(() => sheetRetry(503, attempt, undefined, 0), /sheet_retry_context_invalid/u);
  assert.throws(() => sheetRetry(503, 1, undefined, Number.NaN), /sheet_retry_context_invalid/u);
});
