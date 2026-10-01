import assert from "node:assert/strict";
import test from "node:test";
import { observeSheetPositions, reconcileSheetObservation, sheetPositionKey, type SheetLocalScope } from "../src/sheet-import/sheet-local-observation.js";

const scope: SheetLocalScope = { workbookId: "synthetic_local_sheet", sheetId: 42, headerRow: 1, lastRow: 6, firstColumn: 1, lastColumn: 2 };
const header = ["first_name", "email"];
const first: [string, string] = ["Synthetic A", "a@example.invalid"];
const second: [string, string] = ["Synthetic B", "b@example.invalid"];

test("Local position key is independent of contents and mapping, but scoped to workbook, sheet and absolute row", () => {
  assert.equal(sheetPositionKey(scope, 2), sheetPositionKey({ ...scope }, 2));
  for (const key of [sheetPositionKey(scope, 3), sheetPositionKey({ ...scope, sheetId: 43 }, 2), sheetPositionKey({ ...scope, workbookId: "synthetic_other_sheet" }, 2)]) {
    assert.notEqual(key, sheetPositionKey(scope, 2));
  }
});

test("Re-reading unchanged rows has no new positions", () => {
  const snapshot = observeSheetPositions(scope, [header, first]);
  assert.deepEqual(reconcileSheetObservation(snapshot, observeSheetPositions(scope, [header, first])), { kind: "CONSISTENT", newPositions: [] });
});

test("Append within approved range keeps old fingerprints and exposes only new absolute positions", () => {
  const previous = observeSheetPositions(scope, [header, first]);
  const next = observeSheetPositions(scope, [header, first, second]);
  assert.deepEqual(reconcileSheetObservation(previous, next), { kind: "CONSISTENT", newPositions: [next.positions[1]] });
  assert.equal(next.positions[1]?.row, 3);
});

test("Modified, deleted or reordered observed rows require reconciliation", () => {
  const previous = observeSheetPositions(scope, [header, first, second]);
  for (const values of [[header, second, first], [header, first], [header, ["Changed", first[1]], second], [header, second]]) {
    assert.equal(reconcileSheetObservation(previous, observeSheetPositions(scope, values)).kind, "RECONCILIATION");
  }
});

test("Headers and range changes never silently reuse a baseline", () => {
  const previous = observeSheetPositions(scope, [header, first]);
  assert.deepEqual(reconcileSheetObservation(previous, observeSheetPositions(scope, [["name", "email"], first])), { kind: "RECONCILIATION", reason: "headers_changed" });
  assert.deepEqual(reconcileSheetObservation(previous, observeSheetPositions({ ...scope, lastRow: 7 }, [header, first])), { kind: "RECONCILIATION", reason: "scope_changed" });
});

test("Interior empty and incomplete rows remain in tracking", () => {
  const result = observeSheetPositions(scope, [header, [], ["Incomplete"], second]);
  assert.deepEqual(result.positions.map(({ row, empty }) => ({ row, empty })), [{ row: 2, empty: true }, { row: 3, empty: false }, { row: 4, empty: false }]);
  const changed = observeSheetPositions(scope, [header, first, ["Incomplete"], second]);
  assert.deepEqual(reconcileSheetObservation(result, changed), { kind: "RECONCILIATION", reason: "observed_row_changed", row: 2 });
});

test("Identical rows have distinct positions; swapping indistinguishable rows is an explicit detection limit", () => {
  const result = observeSheetPositions(scope, [header, first, [...first]]);
  assert.equal(result.positions.length, 2);
  assert.equal(result.positions[0]?.fingerprint, result.positions[1]?.fingerprint);
  assert.notEqual(sheetPositionKey(scope, 2), sheetPositionKey(scope, 3));
  assert.equal(reconcileSheetObservation(result, observeSheetPositions(scope, [header, [...first], first])).kind, "CONSISTENT");
});

test("Fingerprints preserve original content differences without exposing raw cells", () => {
  const result = observeSheetPositions(scope, [header, first]);
  assert.equal(JSON.stringify(result).includes(first[1]), false);
  assert.notEqual(result.positions[0]?.fingerprint, observeSheetPositions(scope, [header, [first[0] + " ", first[1]]]).positions[0]?.fingerprint);
});

test("Invalid scopes, out-of-range responses and unusable headers fail closed", () => {
  for (const invalid of [{ ...scope, sheetId: -1 }, { ...scope, lastRow: 1 }, { ...scope, firstColumn: 0 }, { ...scope, workbookId: "invalid" }]) {
    assert.throws(() => observeSheetPositions(invalid, [header]), /sheet_local_scope_invalid/u);
  }
  assert.throws(() => observeSheetPositions(scope, [header, ...Array.from({ length: 6 }, () => first)]), /sheet_local_range_exceeded/u);
  assert.throws(() => observeSheetPositions(scope, [header, ["a", "b", "c"]]), /sheet_local_range_exceeded/u);
  for (const values of [[], [["", "email"]], [["email", "email"]], [["email"]]]) assert.throws(() => observeSheetPositions(scope, values), /sheet_local_headers_invalid/u);
  assert.throws(() => sheetPositionKey(scope, 1), /sheet_local_position_invalid/u);
});
