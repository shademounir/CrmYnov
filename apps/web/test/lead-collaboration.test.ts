import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
test("waits for the actual assignment before rendering an actionable adviser selection", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "assignment" }));
  for (const expected of ["Affectation et réaffectation", "Propriétaire actuel", "Chargement de l’affectation actuelle", "Chargement des demandes autorisées"]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /<form\b/u);
  assert.doesNotMatch(html, /<input[^>]+name="targetUserId"/u);
});

test("loads bounded advisers only after the Lead context is confirmed without a technical identifier input", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/lead-synthetic/collaborators" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"), { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async (): Promise<void> => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  let releaseLead: (response: Response) => void = () => { throw new Error("lead_context_not_requested"); };
  const leadResponse = new Promise<Response>((resolve) => { releaseLead = resolve; });
  let candidateReads = 0;
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
    assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    if (url === "/api/crm/leads/lead-synthetic") return leadResponse;
    if (url === "/api/crm/leads/lead-synthetic/reassignment-requests") return Promise.resolve(Response.json({ requests: [] }));
    assert.equal(url, "/api/crm/leads/lead-synthetic/assignment-candidates"); candidateReads++;
    return Promise.resolve(Response.json({ candidates: [{ id: "eligible-synthetic", label: "Commercial autorisé", activeLeadCount: 2, capacity: 5 }] }));
  });
  await act(async () => { root.render(createElement(LeadWorkflowPage, { leadId: "lead-synthetic", surface: "assignment" })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(candidateReads, 0); assert.equal(host.querySelector('select[name="targetUserId"]'), null);
  assert.match(host.textContent ?? "", /Chargement de l’affectation actuelle/u);
  await act(async () => { releaseLead(Response.json({ id: "lead-synthetic", leadCode: "LD-SYNTHETIC", firstName: "Lead", lastName: "Synthétique", status: "PROSPECT" })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(candidateReads, 1);
  const select = host.querySelector<HTMLSelectElement>('select[name="targetUserId"]'); assert.ok(select); assert.equal(select.disabled, false);
  assert.deepEqual([...select.options].filter((option) => !option.disabled).map((option) => ({ value: option.value, text: option.textContent })), [{ value: "eligible-synthetic", text: "Commercial autorisé · 2/5 Leads actifs" }]);
  assert.equal(host.querySelector('input[name="targetUserId"]'), null);
  assert.match(host.textContent ?? "", /campus et la règle applicables.*revérifiée/u);
});
