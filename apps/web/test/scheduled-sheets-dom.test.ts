import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { sheetApiObject, sheetApiValue } from "../app/admin/scheduled-sheets/sheets-client";

const campus = { id: "00000000-0000-4000-8000-000000000171", code: "SYNTHETIC-CAMPUS", label: "Campus synthétique", kind: "CAMPUS", state: "ACTIVE" };
const template = { mappingKey: "synthetic-map", name: "Mapping synthétique", profile: "FORMINATOR_ZAPIER", columns: [
  { sourceColumn: "First", targetField: "firstName", action: "TRIM" }, { sourceColumn: "Last", targetField: "lastName", action: "TRIM" },
  { sourceColumn: "ID", targetField: "externalId", action: "TRIM", required: true }] };

async function browser(t: TestContext, paginated = false): Promise<{ doc: Document; change(name: string, value: string): Promise<void>; toggle(name: string): Promise<void>; click(name: string): Promise<void>; submit(): Promise<void>; fail(status: number): void; calls: string[] }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/scheduled-sheets" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Page } = await import("../app/admin/scheduled-sheets/page");
  const host = dom.window.document.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async (): Promise<void> => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  } });
  const calls: string[] = [];
  let failure = 0;
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, "http://localhost"); assert.equal(url.origin, "http://localhost"); calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/references")) {
      const kind = url.searchParams.get("kind");
      return Promise.resolve(Response.json({ items: kind === "CAMPUS" ? [campus] : [{ ...campus, id: `${kind}-synthetic`, kind, code: `SYNTHETIC-${kind}`, label: `${kind} synthétique` }] }));
    }
    if (failure) return Promise.resolve(Response.json({ code: "synthetic_refusal" }, { status: failure }));
    if (init?.method === "POST" || init?.method === "PUT") {
      if (url.pathname.endsWith("/simulations")) return Promise.resolve(Response.json({ rows: 1, mapped: 1, review: 0, mutated: false, simulated: true }));
      if (url.pathname.endsWith("/runs")) return Promise.resolve(Response.json({ queued: true, version: 1 }));
      assert.ok(typeof init.body === "string");
      const body = sheetApiObject(sheetApiValue(JSON.parse(init.body)));
      assert.equal(body.campusId, campus.code);
      return Promise.resolve(Response.json({ id: "synthetic-connector", version: Number(body.expectedVersion) + 1, tab: body.tab, workbookId: "synthetic_crmy171",
        enabled: body.enabled, intervalMinutes: body.intervalMinutes, configuration: { mapping: body.mapping, context: body.context, assignment: body.assignment } }));
    }
    if (url.pathname.endsWith("/runs")) return Promise.resolve(Response.json(Array.from({ length: paginated && url.searchParams.get("page") === "1" ? 50 : 1 }, (_, index) => ({ id: `synthetic-run-${index}`, status: "COMPLETED", trigger: "SCHEDULED", configurationVersion: 1, createdCount: 1, duplicateCount: 0, reviewCount: 0, ignoredCount: 0 }))));
    return Promise.resolve(Response.json({ connectors: [], mappings: [template], simulated: true }));
  });
  await act<void>(() => root.render(createElement(Page)));
  const doc = dom.window.document;
  return { doc, calls, fail: (status): void => { failure = status; },
    toggle: async (name): Promise<void> => { const field = doc.querySelector(`[name="${name}"]`); assert.ok(field instanceof dom.window.HTMLInputElement); await act<void>(() => field.click()); },
    change: async (name, value): Promise<void> => {
      const field = doc.querySelector(`[name="${name}"]`); assert.ok(field instanceof dom.window.HTMLSelectElement || field instanceof dom.window.HTMLInputElement);
      await act<void>(() => { field.value = value; field.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    },
    click: async (name): Promise<void> => { const button = [...doc.querySelectorAll("button")].find((item) => item.textContent === name); assert.ok(button, name); await act<void>(() => button.click()); },
    submit: async (): Promise<void> => { const form = doc.querySelector("form"); assert.ok(form); await act<void>(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); },
  };
}

test("CRMY-171 Admin UI configures, simulates, queues and reads server results without retaining stale success", async (t) => {
  const ui = await browser(t);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  assert.match(ui.doc.body.textContent, /Aucune configuration/u);
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  await ui.submit();
  assert.match(ui.doc.body.textContent, /Version enregistrée par l’API/u);
  assert.ok(ui.calls.includes("POST /api/crm/scheduled-sheets"));
  await ui.toggle("enabled"); await ui.submit();
  assert.ok(ui.calls.includes("PUT /api/crm/scheduled-sheets/synthetic-connector"));
  await ui.click("Lancer manuellement");
  assert.ok(ui.calls.includes("POST /api/crm/scheduled-sheets/synthetic-connector/runs"));
  assert.match(ui.doc.body.textContent, /Demande enregistrée/u);
  await ui.click("Simuler"); assert.match(ui.doc.body.textContent, /Simulation terminée sans écriture Lead/u);
  await ui.click("Actualiser l’historique"); assert.match(ui.doc.body.textContent, /COMPLETED/u);
  for (const status of [403, 409, 429, 503]) {
    ui.fail(status); await ui.click("Actualiser l’historique");
    assert.equal(ui.doc.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(ui.doc.querySelectorAll('[role="status"]').length, 0);
    assert.doesNotMatch(ui.doc.body.textContent, /Historique actualisé\./u);
  }
  ui.fail(0); await ui.click("Actualiser l’historique");
  assert.equal(ui.doc.querySelectorAll('[role="alert"]').length, 0);
  assert.match(ui.doc.body.textContent, /Historique actualisé/u);
  await ui.click("Nouvelle configuration");
  assert.match(ui.doc.body.textContent, /Nouvelle configuration/u);
});

test("recorded history is paged through the API and refresh resets the first page", async (t) => {
  const ui = await browser(t, true);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN"); await ui.submit();
  await ui.click("Actualiser l’historique");
  assert.equal(ui.doc.querySelectorAll(".sheets-runs article").length, 50);
  await ui.click("Exécutions suivantes");
  assert.match(ui.doc.body.textContent, /Page 2/u);
  assert.equal(ui.doc.querySelectorAll(".sheets-runs article").length, 1);
  assert.ok(ui.calls.includes("GET /api/crm/scheduled-sheets/synthetic-connector/runs?page=2"));
  await ui.click("Exécutions précédentes"); assert.match(ui.doc.body.textContent, /Page 1/u);
  await ui.click("Exécutions suivantes"); await ui.click("Actualiser l’historique");
  assert.match(ui.doc.body.textContent, /Page 1/u);
  await ui.click("Simuler"); assert.equal(ui.doc.querySelector('[aria-label="Pagination de l’historique"]'), null);
});
