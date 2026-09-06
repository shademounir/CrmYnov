import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../app/admin/scheduled-sheets/page";
import { sheetApiObject, sheetApiValue, sheetError, sheetRequest } from "../app/admin/scheduled-sheets/sheets-client";

test("scheduled Sheets advertises synthetic-only mode, disabled defaults and existing manual imports", () => {
  const html = renderToStaticMarkup(createElement(Page));
  assert.match(html, /Mode synthétique uniquement/u);
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
