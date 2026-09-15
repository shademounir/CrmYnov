import assert from "node:assert/strict";
import test from "node:test";
import { buildLeadListHref, parseSnapshot } from "../app/manager/reports/commercial-funnel/funnel-contract.js";

const snapshot = { definitionVersion: "commercial-funnel-v1", timezone: "Africa/Casablanca", generatedAt: "2026-09-06T12:00:00.000Z", cohort: { totalUniqueLeads: 10 }, currentState: { PROSPECT: 4, CONTACTED: 3, QUALIFIED: 1, ENROLLED: 1, CLOSED_LOST: 1 }, temperatureDistribution: { UNEVALUATED: 6, COLD: 1, WARM: 2, HOT: 1 } };
test("pipeline preserves each current-state volume without inventing transitions", () => {
  assert.deepEqual(parseSnapshot(snapshot), { definitionVersion: snapshot.definitionVersion, timezone: snapshot.timezone, generatedAt: snapshot.generatedAt, total: 10, counts: snapshot.currentState, temperatureDistribution: snapshot.temperatureDistribution });
});
test("pipeline accepts a genuine zero cohort without manufacturing rates", () => {
  assert.equal(parseSnapshot({ ...snapshot, cohort: { totalUniqueLeads: 0 }, currentState: { PROSPECT: 0, CONTACTED: 0, QUALIFIED: 0, ENROLLED: 0, CLOSED_LOST: 0 }, temperatureDistribution: { UNEVALUATED: 0, COLD: 0, WARM: 0, HOT: 0 } }).total, 0);
});
test("pipeline refuses incomplete or inconsistent payloads instead of displaying zeros", () => {
  for (const payload of [null, {}, { ...snapshot, definitionVersion: "legacy" }, { ...snapshot, timezone: "UTC" }, { ...snapshot, generatedAt: "invalid" }, { ...snapshot, cohort: { totalUniqueLeads: 20 } }, { ...snapshot, currentState: { ...snapshot.currentState, PROSPECT: -1 } }, { ...snapshot, currentState: { ...snapshot.currentState, QUALIFIED: "1" } }, { ...snapshot, temperatureDistribution: { ...snapshot.temperatureDistribution, HOT: 4 } }, { ...snapshot, temperatureDistribution: { ...snapshot.temperatureDistribution, COLD: -1 } }]) {
    assert.throws(() => parseSnapshot(payload));
  }
});
test("pipeline drill-down links preserve the compatible lead-list context", () => {
  assert.equal(buildLeadListHref({ from: "2026-09-01", to: "2026-10-01", campus: "CAMPUS-A", campaign: "", program: "PROGRAM-A", source: "WEB_FORM", ignored: "no" }, { status: "CONTACTED" }), "/leads?createdFrom=2026-09-01&campus=CAMPUS-A&program=PROGRAM-A&source=WEB_FORM&createdTo=2026-09-30T23%3A59%3A59.999Z&status=CONTACTED&returnTo=%2Fmanager%2Freports%2Fcommercial-funnel%3Ffrom%3D2026-09-01%26campus%3DCAMPUS-A%26program%3DPROGRAM-A%26source%3DWEB_FORM%26to%3D2026-10-01");
  assert.equal(buildLeadListHref({}, { temperature: "UNEVALUATED" }), "/leads?temperature=UNEVALUATED&returnTo=%2Fmanager%2Freports%2Fcommercial-funnel");
});
