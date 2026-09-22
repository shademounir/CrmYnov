import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
import { failureMessage, parseClosureRequests } from "../app/leads/[leadId]/lead-workflow-forms.js";
test("renders the separated closure approval in the shared Lead workflow", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "closure" }));
  for (const expected of ["Clôture du Lead", "Inscrit", "Sans suite", "Non intéressé", "Preuves métier", "Soumettre au Manager", "statut reste inchangé", "Chargement des demandes de clôture"]) assert.match(html, new RegExp(expected));
  assert.doesNotMatch(html, /Admission confirmée/u, "a CLOSED_LOST request must not offer an ENROLLED-only reason");
});

test("filters authorized closure requests to the current Lead", () => {
  const leadId = "00000000-0000-4000-8000-000000000171";
  const base = { requesterId: "requester", state: "PENDING", version: 1, target: "ENROLLED", reason: "ADMISSION_CONFIRMED", comment: "Qualification vérifiée", evidence: ["DOSSIER-171"], createdAt: "2026-09-21T10:00:00.000Z" };
  const items = parseClosureRequests({ items: [{ ...base, id: "request-current", leadId }, { ...base, id: "request-other", leadId: "00000000-0000-4000-8000-000000000172" }] }, leadId);
  assert.deepEqual(items.map((item) => item.id), ["request-current"]);
});

test("submits one versioned closure decision and reloads the Lead history", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic/closure" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"); const { createRoot } = await import("react-dom/client");
  const { ClosureHistory } = await import("../app/leads/[leadId]/lead-workflow-forms");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const pending = { id: "closure-1", leadId: "synthetic-lead", requesterId: "requester", state: "PENDING", version: 1, target: "ENROLLED", reason: "ADMISSION_CONFIRMED", comment: "Qualification vérifiée", evidence: ["DOSSIER-171"], createdAt: "2026-09-21T10:00:00.000Z" };
  const requests: Array<{ init?: RequestInit }> = []; let completions = 0;
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ ...(init ? { init } : {}) });
    if (init?.method === "PATCH") return Promise.resolve(Response.json({ ...pending, state: "APPROVED", version: 2 }));
    return Promise.resolve(Response.json({ items: requests.some((request) => request.init?.method === "PATCH") ? [{ ...pending, state: "APPROVED", version: 2, decisionReason: "Validation Manager" }] : [pending] }));
  });
  await act(async () => { root.render(createElement(ClosureHistory, { leadId: "synthetic-lead", onCompleted: () => { completions++; } })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const form = host.querySelector<HTMLFormElement>("form"); const reason = host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]'); assert.ok(form && reason); reason.value = "Validation Manager";
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const patches = requests.filter((request) => request.init?.method === "PATCH"); assert.equal(patches.length, 1);
  const body = patches[0]?.init?.body; if (typeof body !== "string") assert.fail("expected_string_request_body");
  assert.deepEqual(JSON.parse(body), { decision: "APPROVE", reason: "Validation Manager", expectedVersion: 1 });
  assert.equal(completions, 1); assert.match(host.textContent ?? "", /Approuvée/u); assert.doesNotMatch(host.textContent ?? "", /Confirmer la décision/u);
});

test("explains the requester and approver separation without suggesting a retry", () => {
  assert.match(failureMessage("closure-decision", 403, "closure_self_approval_forbidden"), /ne peut pas valider sa propre demande/u);
});
