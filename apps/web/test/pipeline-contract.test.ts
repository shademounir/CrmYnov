import assert from "node:assert/strict";
import test from "node:test";
import { parseSnapshot } from "../app/manager/reports/commercial-funnel/funnel-contract.js";

const snapshot = { generatedAt: "2026-09-06T12:00:00.000Z", cohort: { totalUniqueLeads: 10 }, currentState: { PROSPECT: 4, CONTACTED: 3, QUALIFIED: 1, ENROLLED: 1, CLOSED_LOST: 1 }, temperatureDistribution: { UNEVALUATED: 6, COLD: 1, WARM: 2, HOT: 1 } };
test("pipeline preserves each current-state volume without inventing transitions", () => {
  assert.deepEqual(parseSnapshot(snapshot), { generatedAt: snapshot.generatedAt, total: 10, counts: snapshot.currentState, temperatureDistribution: snapshot.temperatureDistribution });
});
test("pipeline accepts a genuine zero cohort without manufacturing rates", () => {
  assert.equal(parseSnapshot({ ...snapshot, cohort: { totalUniqueLeads: 0 }, currentState: { PROSPECT: 0, CONTACTED: 0, QUALIFIED: 0, ENROLLED: 0, CLOSED_LOST: 0 }, temperatureDistribution: { UNEVALUATED: 0, COLD: 0, WARM: 0, HOT: 0 } }).total, 0);
});
test("pipeline refuses incomplete or inconsistent payloads instead of displaying zeros", () => {
  for (const payload of [null, {}, { ...snapshot, generatedAt: "invalid" }, { ...snapshot, cohort: { totalUniqueLeads: 20 } }, { ...snapshot, currentState: { ...snapshot.currentState, PROSPECT: -1 } }, { ...snapshot, currentState: { ...snapshot.currentState, QUALIFIED: "1" } }, { ...snapshot, temperatureDistribution: { ...snapshot.temperatureDistribution, HOT: 4 } }, { ...snapshot, temperatureDistribution: { ...snapshot.temperatureDistribution, COLD: -1 } }]) {
    assert.throws(() => parseSnapshot(payload));
  }
});
