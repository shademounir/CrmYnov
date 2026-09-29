import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

async function browser(t: TestContext): Promise<{ dom: JSDOM; act: typeof import("react").act; createElement: typeof import("react").createElement; root: import("react-dom/client").Root; settle(): Promise<void> }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/users" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react"); const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  return { dom, act, createElement, root, settle };
}

test("issues and displays one temporary secret from the authenticated same-origin route", async (t) => {
  const b = await browser(t); const { TemporarySecretForm } = await import("../app/admin/users/temporary-secret-form.js");
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => { const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; requests.push({ input: target, ...(init ? { init } : {}) }); return Promise.resolve(Response.json({ temporarySecret: "Synthetic-Temporary-Only!9" })); });
  b.act(() => b.root.render(b.createElement(TemporarySecretForm))); const form = b.dom.window.document.querySelector("form"); const id = b.dom.window.document.querySelector<HTMLInputElement>('input[name="collaboratorId"]'); assert.ok(form && id); id.value = "user synthetic/id";
  b.act(() => form.dispatchEvent(new b.dom.window.Event("submit", { bubbles: true, cancelable: true }))); await b.settle();
  assert.equal(requests.length, 1); assert.equal(requests[0]?.input, "/api/crm/users/user%20synthetic%2Fid/temporary-secret"); assert.equal(requests[0]?.init?.credentials, "same-origin");
  const requestBody = requests[0]?.init?.body; if (typeof requestBody !== "string") assert.fail("expected_string_request_body");
  assert.deepEqual(JSON.parse(requestBody), { confirmed: true, reason: "INITIAL_ACCESS" });
  assert.match(b.dom.window.document.body.textContent ?? "", /Synthetic-Temporary-Only!9/u); assert.match(b.dom.window.document.body.textContent ?? "", /ne sera pas réaffiché/u);
});

test("fails closed when the API refuses or omits the one-time secret", async (t) => {
  const b = await browser(t); const { TemporarySecretForm } = await import("../app/admin/users/temporary-secret-form.js"); let response = new Response(null, { status: 403 });
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(response));
  const submit = async (): Promise<void> => { const form = b.dom.window.document.querySelector("form"); const id = b.dom.window.document.querySelector<HTMLInputElement>('input[name="collaboratorId"]'); assert.ok(form && id); id.value = "user-id"; b.act(() => form.dispatchEvent(new b.dom.window.Event("submit", { bubbles: true, cancelable: true }))); await b.settle(); };
  b.act(() => b.root.render(b.createElement(TemporarySecretForm))); await submit(); assert.match(b.dom.window.document.body.textContent ?? "", /génération a été refusée/u);
  response = Response.json({}); await submit(); assert.match(b.dom.window.document.body.textContent ?? "", /génération a été refusée/u); assert.equal(b.dom.window.document.querySelector("code"), null);
});
