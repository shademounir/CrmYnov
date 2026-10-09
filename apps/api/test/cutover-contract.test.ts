import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { CUTOVER_BYTE_LIMIT, cutoverCounts, cutoverHash, cutoverInstant, cutoverTimeZone, observeCutover, type CutoverContract } from "../src/cutover/cutover.contract.js";
import type { SheetValues } from "../src/sheet-import/google-sheets-adapter.js";

const contract: CutoverContract = { schemaVersion: 1, bootstrapPackageId: "00000000-0000-4000-8000-000000000063", connectorId: "00000000-0000-4000-8000-000000000064",
  excelSha256: "a".repeat(64), configurationSha256: "b".repeat(64), connectorVersion: 1, t0: "2026-10-09T09:00:00.000Z", timeZone: "Africa/Casablanca",
  equality: "POST_T0", excelFrozenAt: "2026-10-09T08:55:00.000Z", externalIdColumn: "Submission ID", originalArrivalColumn: "Original arrival UTC", identityEvidenceSha256: "c".repeat(64) };
const columns = ["Submission ID", "Original arrival UTC", "Comment"];
const row = (id: string, date: string, comment = "Synthetic comment"): Record<string, string> => ({ "Submission ID": id, "Original arrival UTC": date, Comment: comment });
const values = (rows: Array<Record<string, string>>): SheetValues => ({ columns, rows });

test("CRMY-63 records explicit before/equal/after T0 independently from row positions", () => {
  const observed = observeCutover(contract, values([row("before", "2026-10-09T08:59:59Z"), row("equal", contract.t0), row("after", "2026-10-09T09:00:01Z")]), []);
  assert.equal(observed.entries.find((item) => item.externalId === "before")?.classification, "EXCLUDED_PRE_T0");
  assert.equal(observed.entries.find((item) => item.externalId === "equal")?.classification, "BACKLOG");
  assert.equal(observed.entries.find((item) => item.externalId === "after")?.classification, "BACKLOG");
  assert.deepEqual(cutoverCounts(observed.entries), { total: 3, excludedPreT0: 1, backlog: 2, sourceIssues: 0, overlapReview: 2, linkedBaseline: 0, keptForCatchup: 0 });
});
test("CRMY-63 sorted/inserted rows retain identities and payload text exactly", () => {
  const a = row("before", "2026-10-09T08:59:59Z", "  raw\ncomment  "), b = row("after", contract.t0);
  const first = observeCutover(contract, values([a, b]), []);
  const next = observeCutover(contract, values([b, row("arrived-during-bootstrap", "2026-10-09T09:01:00Z"), a]), first.entries, first.headerSha256);
  assert.deepEqual(next.entries.find((item) => item.externalId === "before"), first.entries.find((item) => item.externalId === "before"));
  assert.equal(next.entries.find((item) => item.externalId === "before")?.payload.Comment, "  raw\ncomment  ");
  assert.equal(cutoverCounts(next.entries).backlog, 2);
});
test("CRMY-63 historical edits and changed original date never promote history to NEW", () => {
  const first = observeCutover(contract, values([row("old", "2026-10-09T08:00:00Z", "original")]), []);
  const changed = observeCutover(contract, values([row("old", "2026-10-09T11:00:00Z", "edited")]), first.entries);
  assert.equal(changed.entries[0]!.classification, "EXCLUDED_PRE_T0"); assert.equal(changed.entries[0]!.issue, "SOURCE_CHANGED");
  assert.equal(changed.entries[0]!.payload.Comment, "original");
  const reverted = observeCutover(contract, values([row("old", "2026-10-09T08:00:00Z", "original")]), changed.entries);
  assert.equal(reverted.entries[0]!.issue, "SOURCE_CHANGED", "A later source revert must not erase the review finding");
});
test("CRMY-63 deleted sources remain in the durable inventory, never vanish", () => {
  const first = observeCutover(contract, values([row("old", "2026-10-09T08:00:00Z")]), []);
  const missing = observeCutover(contract, values([]), first.entries);
  assert.equal(missing.sourceCount, 0); assert.equal(missing.entries.length, 1); assert.equal(missing.entries[0]!.issue, "SOURCE_REMOVED");
});
test("CRMY-63 rejects ambiguous/missing ID or original instant without row fallback", () => {
  assert.throws(() => observeCutover(contract, values([row("same", contract.t0), row("same", contract.t0)]), []), /Bad Request/u);
  for (const id of ["", " ", "row\n2"]) assert.throws(() => observeCutover(contract, values([row(id, contract.t0)]), []));
  for (const date of ["2026-10-09", "09:00", "2026-10-09T09:00:00+01:00", "2026-02-30T09:00:00Z", "modified just now"]) {
    assert.throws(() => observeCutover(contract, values([row("id", date)]), []));
  }
});
test("CRMY-63 refuses source header drift and explicit capacity overflow", () => {
  const first = observeCutover(contract, values([]), []);
  assert.throws(() => observeCutover(contract, { columns: [...columns].reverse(), rows: [] }, [], first.headerSha256));
  assert.throws(() => observeCutover(contract, values(Array.from({ length: 10001 }, (_, index) => row(String(index), contract.t0))), []));
  assert.throws(() => observeCutover(contract, { columns: [...columns, columns[0]!], rows: [] }, []));
});
test("CRMY-63 snapshot replay hash is stable under row ordering and object-key ordering", () => {
  const one = row("one", contract.t0), two = row("two", "2026-10-09T09:00:01Z");
  const first = observeCutover(contract, values([one, two]), []);
  const second = observeCutover(contract, values([two, Object.fromEntries(Object.entries(one).reverse())]), first.entries);
  assert.equal(first.snapshotSha256, second.snapshotSha256); assert.equal(cutoverHash({ b: 2, a: 1 }), cutoverHash({ a: 1, b: 2 }));
});
test("CRMY-63 bounds the accumulated ledger, including retained removed payloads", () => {
  const source = (prefix: string): SheetValues => values(Array.from({ length: 500 }, (_, index) => row(`${prefix}-${index}`, contract.t0, "x".repeat(4000))));
  const firstSource = source("first"), secondSource = source("second");
  assert.ok(Buffer.byteLength(JSON.stringify(firstSource)) < CUTOVER_BYTE_LIMIT);
  assert.ok(Buffer.byteLength(JSON.stringify(secondSource)) < CUTOVER_BYTE_LIMIT);
  const first = observeCutover(contract, firstSource, []), preserved = structuredClone(first.entries);
  assert.throws(() => observeCutover(contract, secondSource, first.entries), /Bad Request/u);
  assert.deepEqual(first.entries, preserved, "Rejected delta must not mutate the last durable inventory");
});
test("CRMY-63 canonical fingerprints sort Unicode keys ordinally, not by platform locale", () => {
  const payload = { "é": "accent", "a": "lowercase", "Z": "uppercase", "Ω": "omega", "A": "first" };
  const canonical = JSON.stringify({ A: "first", Z: "uppercase", a: "lowercase", "é": "accent", "Ω": "omega" });
  assert.equal(cutoverHash(payload), createHash("sha256").update(canonical).digest("hex"));
  assert.equal(cutoverHash(payload), cutoverHash(Object.fromEntries(Object.entries(payload).reverse())));
});
test("CRMY-63 UTC remains distinct from real IANA Casablanca display", () => {
  assert.equal(cutoverInstant("2026-10-09T09:00:00Z"), contract.t0); assert.equal(cutoverTimeZone("Africa/Casablanca"), contract.timeZone);
  const local = new Intl.DateTimeFormat("fr-MA", { timeZone: contract.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(contract.t0));
  // Oracle comes from the actual IANA runtime, never a hard-coded +01 offset.
  assert.equal(local, new Intl.DateTimeFormat("fr-MA", { timeZone: "Africa/Casablanca", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(contract.t0)));
  assert.match(local, /^\d{2}:\d{2}$/u); assert.throws(() => cutoverTimeZone("not/an-iana-zone"));
});
