import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../app/admin/scheduled-sheets/page";
import { sheetApiObject, sheetApiValue, sheetError, sheetRequest, sheetSimulation } from "../app/admin/scheduled-sheets/sheets-client";

test("simulation counters preserve real, simulated, empty and review results without inventing import outcomes", () => {
  for (const simulated of [true, false]) {
    for (const { rows, mapped, review } of [{ rows: 0, mapped: 0, review: 0 }, { rows: 5, mapped: 3, review: 2 }, { rows: 4, mapped: 0, review: 4 }]) {
      const expected = { rows, mapped, review, simulated, reconciliationRequired: mapped === 0 && rows !== 0 };
      assert.deepEqual(sheetSimulation({ ...expected, mutated: false }), expected);
    }
  }
});

test("missing, malformed or inconsistent simulation results fail closed, never default to zero", () => {
  const valid = { rows: 5, mapped: 3, review: 2, mutated: false, simulated: true, reconciliationRequired: false };
  for (const invalid of [null, {}, { ...valid, rows: null }, { ...valid, mapped: "3" }, { ...valid, review: -1 },
    { ...valid, mapped: 1.5 }, { ...valid, rows: 7 }, { ...valid, mutated: true }, { ...valid, simulated: null },
    { ...valid, reconciliationRequired: null }]) {
    assert.throws(() => sheetSimulation(invalid), /incomplet ou incohérent/u);
  }
});

test("scheduled Sheets defaults to clearly identified simulation, disabled imports and no browser credentials", () => {
  const html = renderToStaticMarkup(createElement(Page));
  assert.match(html, /Source simulée — aucun accès Google/u);
  assert.match(html, /Mode simulé/u);
  assert.match(html, /désactivé par défaut/u);
  assert.match(html, /\/imports\/wizard/u);
  assert.match(html, /Campus à consulter/u);
  assert.doesNotMatch(html, /type="password"/u);
});
test("Sheets client validates JSON and preserves explicit bounded errors", () => {
  assert.deepEqual(sheetApiValue({ value: [null, true, "synthetic", 1] }), { value: [null, true, "synthetic", 1] });
  assert.throws(() => sheetApiValue(undefined), /invalide/u);
  assert.throws(() => sheetApiValue(Number.NaN), /invalide/u);
  assert.deepEqual(sheetApiObject([]), {});
  assert.deepEqual(sheetApiObject(undefined), {});
  assert.deepEqual(sheetApiObject({ value: "synthetic" }), { value: "synthetic" });
  for (const status of [401, 403, 404, 409, 400, 422, 429, 500, 503]) assert.ok(sheetError(status).length > 20);
  assert.equal(sheetError(403), sheetError(404));
  assert.match(sheetError(409), /Actualisez/u);
});
test("Sheets requests remain same-origin, uncached and never reveal rejected response contents", async (t) => {
  let status = 200;
  t.mock.method(globalThis, "fetch", (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "/api/crm/scheduled-sheets/synthetic/runs");
    assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.method, "POST");
    assert.equal(typeof init.body, "string");
    assert.ok(typeof init.body === "string");
    assert.deepEqual(JSON.parse(init.body), { expectedVersion: 2 });
    return Promise.resolve(Response.json({ synthetic: true }, { status }));
  });
  assert.deepEqual(await sheetRequest("/synthetic/runs", "POST", { expectedVersion: 2 }), { synthetic: true });
  for (status of [401, 403, 409, 429, 503]) await assert.rejects(sheetRequest("/synthetic/runs", "POST", { expectedVersion: 2 }), (error: unknown): boolean => {
    assert.ok(error instanceof Error); assert.equal(error.message, sheetError(status)); return true;
  });
});
