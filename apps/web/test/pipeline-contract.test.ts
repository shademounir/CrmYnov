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
  assert.equal(buildLeadListHref({ from: "2026-09-01", to: "2026-10-01", campus: "CAMPUS-A", campaign: "", program: "PROGRAM-A", source: "WEB_FORM", ignored: "no" }, { status: "CONTACTED" }), "/leads?createdFrom=2026-09-01&campus=CAMPUS-A&program=PROGRAM-A&source=WEB_FORM&createdBefore=2026-10-01&status=CONTACTED&returnTo=%2Fmanager%2Freports%2Fcommercial-funnel%3Ffrom%3D2026-09-01%26campus%3DCAMPUS-A%26program%3DPROGRAM-A%26source%3DWEB_FORM%26to%3D2026-10-01");
  assert.equal(buildLeadListHref({}, { temperature: "UNEVALUATED" }), "/leads?temperature=UNEVALUATED&returnTo=%2Fmanager%2Freports%2Fcommercial-funnel");
});

test("pipeline drill-down preserves the Dashboard cohort, exact instants and explicit status exploration", () => {
  const filters = { from: "2026-10-01T08:14:27.000Z", to: "2026-10-05T09:42:18.000Z", campus: "CAMPUS-SYNTHETIC", source: "SYNTHETIC", channel: "DIGITAL", adviserId: "adviser-synthetic", status: "QUALIFIED" };
  const url = new URL(buildLeadListHref(filters), "https://dev.example.invalid");
  for (const key of ["campus", "source", "channel", "adviserId", "status"] as const) assert.equal(url.searchParams.get(key), filters[key]);
  assert.equal(url.searchParams.get("createdFrom"), filters.from);
  assert.equal(url.searchParams.get("createdBefore"), filters.to);
  assert.equal(url.searchParams.has("createdTo"), false, "keep the exclusive server bound without subtracting a millisecond");
  const returnUrl = new URL(url.searchParams.get("returnTo")!, url.origin);
  for (const [key, value] of Object.entries(filters)) assert.equal(returnUrl.searchParams.get(key), value);
  const stage = new URL(buildLeadListHref(filters, { status: "ENROLLED" }), url.origin);
  assert.equal(stage.searchParams.get("status"), "ENROLLED", "a chosen stage deliberately replaces the current status filter");
  assert.equal(new URL(stage.searchParams.get("returnTo")!, url.origin).searchParams.get("status"), "QUALIFIED");
  const temperature = new URL(buildLeadListHref(filters, { temperature: "HOT" }), url.origin);
  assert.equal(temperature.searchParams.get("status"), "QUALIFIED");
  assert.equal(temperature.searchParams.get("temperature"), "HOT");
});
