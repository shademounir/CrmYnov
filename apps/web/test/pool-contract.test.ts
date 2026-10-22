import assert from "node:assert/strict";
import test from "node:test";
import { poolAdministration, poolConfiguration } from "../app/admin/assignment/pools/pool-contract.js";
const configuration = { campusId: "synthetic-campus", version: 0, automaticEnabled: false, rules: [] };
const projection = { campusId: "synthetic-campus", version: 0, fairnessScope: "CAMPUS_CONFIGURATION_VERSION_RULE_NEW_ENTRANTS", candidates: [], counters: [] };
test("pool contracts keep version zero and absence of candidates distinct from errors", () => {
  assert.deepEqual(poolConfiguration(configuration), configuration); assert.deepEqual(poolAdministration(projection), projection);
  for (const value of [null, [], {}, { ...configuration, version: -1 }, { ...configuration, version: 1.1 }, { ...configuration, automaticEnabled: "true" }]) assert.throws(() => poolConfiguration(value));
  for (const value of [null, {}, { ...projection, fairnessScope: "HISTORICAL_PORTFOLIO" }, { ...projection, candidates: [{ id: "a", label: "A", activeLeadCount: -1 }] }, { ...projection, counters: [{ ruleId: "r", userId: "a", label: "A", assignedCount: NaN }] }]) assert.throws(() => poolAdministration(value));
});
test("pool contracts reject malformed members and balance flags instead of inventing counts", () => {
  const rule = { id: "rule", scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", balanceNewEntrants: true, enabled: true, candidates: [{ userId: "a", capacity: 20, active: true }] };
  assert.equal(poolConfiguration({ ...configuration, rules: [rule] }).rules[0]?.balanceNewEntrants, true);
  for (const capacity of [0, -1, 0.5]) assert.throws(() => poolConfiguration({ ...configuration, rules: [{ ...rule, candidates: [{ userId: "a", capacity, active: true }] }] }));
  assert.throws(() => poolConfiguration({ ...configuration, rules: [{ ...rule, balanceNewEntrants: "true" }] }));
});
