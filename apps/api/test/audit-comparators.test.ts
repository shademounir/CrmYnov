import assert from "node:assert/strict";
import test from "node:test";
import { compareAuditKeys, compareNumericResults } from "./helpers/audit-lead-cycle.test.js";

test("CRMY-54 audit metadata comparator has deterministic lower, greater and equal results", () => {
  assert.ok(compareAuditKeys("scope", "version") < 0);
  assert.ok(compareAuditKeys("version", "scope") > 0);
  assert.equal(compareAuditKeys("scope", "scope"), 0);
  assert.deepEqual(["version", "scope", "scope"].sort(compareAuditKeys), ["scope", "scope", "version"]);
});
test("CRMY-54 numeric comparator preserves equal items, including identical timestamps", () => {
  assert.ok(compareNumericResults(200, 409) < 0);
  assert.ok(compareNumericResults(409, 200) > 0);
  assert.equal(compareNumericResults(200, 200), 0);
  assert.deepEqual([409, 20, 200, 200].sort(compareNumericResults), [20, 200, 200, 409]);
  const sameDate = new Date("2026-09-03T12:00:00Z").getTime();
  const events = [{ id: "first", at: sameDate }, { id: "second", at: sameDate }, { id: "before", at: sameDate - 1 }];
  const sortEvents = (): string[] => [...events].sort((a, b) => compareNumericResults(a.at, b.at)).map((event) => event.id);
  assert.deepEqual(sortEvents(), ["before", "first", "second"]);
  assert.deepEqual(sortEvents(), sortEvents());
});
