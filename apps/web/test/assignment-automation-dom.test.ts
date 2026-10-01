import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { sheetApiObject, sheetApiValue } from "../app/admin/scheduled-sheets/sheets-client";

test("campus automation control loads, persists disabled state, preserves rules and refuses conflicts", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/admin/assignment" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client");
  const { AutomationControl } = await import("../app/admin/assignment/automation-control");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async (): Promise<void> => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  } });
  const rules = [{ id: "synthetic-rule", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [] }];
  let saved = { version: 2, automaticEnabled: true, rules }; let failure = false; let writes = 0;
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes("/references?")) return Promise.resolve(Response.json({ items: [{ id: "synthetic-id", code: "SYNTHETIC-CAMPUS", label: "Campus synthétique" }] }));
    if (failure) return Promise.resolve(Response.json({ code: "assignment_version_conflict" }, { status: 409 }));
    if (init?.method === "PUT") {
      assert.equal(url, "/api/crm/assignment/config"); assert.ok(typeof init.body === "string");
      const body = sheetApiObject(sheetApiValue(JSON.parse(init.body)));
      assert.equal(body.campusId, "SYNTHETIC-CAMPUS"); assert.equal(body.expectedVersion, saved.version); assert.deepEqual(body.rules, rules);
      assert.equal(body.automaticEnabled, false); saved = { ...saved, version: saved.version + 1, automaticEnabled: false }; writes++;
    } else assert.equal(url, "/api/crm/assignment/config?campusId=SYNTHETIC-CAMPUS");
    return Promise.resolve(Response.json(saved));
  });
  await act<void>(() => { root.render(createElement(AutomationControl)); });
  const campus = host.querySelector("select"); assert.ok(campus);
  await act<void>(() => { campus.value = "SYNTHETIC-CAMPUS"; campus.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  const toggle = host.querySelector<HTMLInputElement>('input[type="checkbox"]'); assert.ok(toggle); assert.equal(toggle.checked, true);
  await act<void>(() => toggle.click()); assert.equal(toggle.checked, false);
  const form = host.querySelector("form"); assert.ok(form);
  await act<void>(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  assert.equal(writes, 1); assert.match(host.querySelector('[role="status"]')?.textContent ?? "", /enregistrée/);
  const refresh = [...host.querySelectorAll("button")].find((button) => button.textContent === "Actualiser"); assert.ok(refresh);
  await act<void>(() => { refresh.click(); });
  assert.equal(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked, false);
  failure = true;
  await act<void>(() => { host.querySelector("form")?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Conflit/); assert.equal(host.querySelector('[role="status"]'), null);
  assert.equal(writes, 1); assert.equal(host.querySelector('[aria-busy="true"]'), null);
});
