import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../app/admin/scheduled-sheets/page";
import { sheetApiObject, sheetApiValue, sheetError, sheetRequest, sheetSimulation, sheetSourceConfiguration, sheetAppendState } from "../app/admin/scheduled-sheets/sheets-client";
import { SheetAppendMonitor } from "../app/admin/scheduled-sheets/sheet-append-monitor";

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

test("append-only source mode is preserved without client boundary or producer assertions", () => {
  const form = new FormData();
  form.set("sourceMode", "GOOGLE"); form.set("identityMode", "LOCAL_ROW_APPEND_ONLY");
  form.set("sheetId", "0"); form.set("range", " A1:K100 ");
  form.set("boundaryRow", "999"); form.set("producerAttested", "true");
  assert.deepEqual(sheetSourceConfiguration(form), { mode: "GOOGLE", identityMode: "LOCAL_ROW_APPEND_ONLY", sheetId: 0, range: "A1:K100" });
});

test("append monitor distinguishes unregistered, durable and confirmed coverage without PII", () => {
  const props = { busy: false, sourceUnavailable: false, connectorEnabled: false, action: (): Promise<void> => Promise.resolve() };
  const empty = renderToStaticMarkup(createElement(SheetAppendMonitor, { ...props, state: null }));
  assert.match(empty, /État non lu/u); assert.doesNotMatch(empty, /N0<\/dt><dd>0/u);
  const html = renderToStaticMarkup(createElement(SheetAppendMonitor, { ...props, state: { boundaryRegistered: true, boundaryRow: 4,
    capturedAt: "2026-10-10T07:00:00.000Z", generation: "synthetic-generation", lastObservedRow: 8, lastDurableRow: 8,
    lastConfirmedRow: 7, qualificationRegistered: false, suspended: true, counts: { pending: 1, incomplete: 1, review: 1, confirmed: 1 } } }));
  for (const text of ["Frontière historique N0", "Dernière position observée", "Dernière position durable", "Dernière position confirmée", "non confirmée", "Réception suspendue", "première observation conservée séparément"]) assert.ok(html.includes(text));
  assert.match(html, /ne prouve pas que toutes les positions précédentes/u);
  assert.doesNotMatch(html, /type="password"|producerAttested.*true|@example/u);
});

test("append state rejects missing counters, boundaries and inconsistent positions rather than reporting success", () => {
  const valid = { boundaryRegistered: true, boundaryRow: 4, generation: "00000000-0000-4000-8000-000000000063", capturedAt: "2026-10-10T07:00:00.000Z",
    lastObservedRow: 6, lastDurableRow: 6, lastConfirmedRow: null, suspended: false, qualificationRegistered: false, producerConditionConfirmed: false,
    counts: { observed: 2, pending: 1, incomplete: 1, review: 0, confirmed: 0 } };
  assert.deepEqual(sheetAppendState(valid), valid);
  assert.deepEqual(sheetAppendState({ boundaryRegistered: false }), { boundaryRegistered: false });
  for (const invalid of [null, {}, { ...valid, boundaryRow: -1 }, { ...valid, lastDurableRow: 7 }, { ...valid, generation: "" },
    { ...valid, capturedAt: "invalid" }, { ...valid, counts: {} }, { ...valid, lastConfirmedRow: 3 },
    { ...valid, counts: { ...valid.counts, observed: 3 } }, { ...valid, qualificationRegistered: "true" }]) {
    assert.throws(() => sheetAppendState(invalid), /incomplet ou incohérent/u);
  }
});
