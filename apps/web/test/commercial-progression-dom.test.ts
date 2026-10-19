import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("commercial qualification submits directly with explicit criteria and reuses the same intent after a lost response", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/fixture" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { StatusWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms");
  const host = dom.window.document.getElementById("root"); assert(host);
  const root = createRoot(host);
  t.after(async () => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  let resolveSave: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(init?.method, "PATCH");
    assert.equal(typeof input, "string"); assert.equal(typeof init?.body, "string");
    sent.push({ url: input as string, body: JSON.parse(init?.body as string) as Record<string, unknown> });
    if (sent.length === 1) return Promise.reject(new Error("synthetic_response_lost"));
    return new Promise<Response>(resolve => { resolveSave = resolve; });
  });
  await act(async () => { root.render(createElement(StatusWorkflowForm, { leadId: "fixture", currentStatus: "CONTACTED" })); await new Promise<void>(resolve => setImmediate(resolve)); });
  const form = host.querySelector("form"); assert(form);
  const reason = host.querySelector<HTMLTextAreaElement>('[name="reason"]'); assert(reason); reason.value = "Intérêt explicite et prérequis vérifiés";
  for (const name of ["interestConfirmed", "eligibilityConfirmed"]) { const input = host.querySelector<HTMLInputElement>(`[name="${name}"]`); assert(input); assert(input.required); input.checked = true; }
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>(resolve => setImmediate(resolve)); });
  assert.equal(sent.length, 1); assert.equal(sent[0]?.url, "/api/crm/leads/fixture/status");
  assert.deepEqual(sent[0]?.body.qualification, { interestConfirmed: true, eligibilityConfirmed: true });
  assert.equal(sent[0]?.body.status, "QUALIFIED"); assert.equal(typeof sent[0]?.body.idempotencyKey, "string");
  await act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>(resolve => setImmediate(resolve));
  });
  assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]);
  await act(async () => { assert(resolveSave); resolveSave(Response.json({ status: "QUALIFIED" })); await new Promise<void>(resolve => setImmediate(resolve)); });
  assert.match(host.textContent ?? "", /enregistrée/u);
  assert.doesNotMatch(host.textContent ?? "", /envoyée au Manager/u);
});
