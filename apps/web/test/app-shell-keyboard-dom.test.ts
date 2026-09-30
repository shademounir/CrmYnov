import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("mobile navigation keeps keyboard focus inside and restores it on Escape", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/leads" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, self: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AppShellClient } = await import("../app/_components/app-shell.js");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => {
    act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  });
  t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (path === "/api/crm/sessions/current") return Promise.resolve(Response.json({ roles: ["SUPER_ADMIN"], professionalEmail: "synthetic@example.invalid", scopes: [{ kind: "TEAM" }] }));
    if (path.startsWith("/api/crm/notifications")) return Promise.resolve(Response.json({ unread: 0 }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  await act(async () => { root.render(createElement(AppShellClient, { pathname: "/leads", children: createElement("main", null, "Contenu") })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const find = (label: string): HTMLButtonElement => {
    const element = dom.window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(element, label);
    return element;
  };
  const opener = find("Ouvrir la navigation");
  await act(async () => opener.click());
  const closer = find("Fermer la navigation");
  assert.equal(dom.window.document.activeElement, closer);
  assert.equal(opener.getAttribute("aria-expanded"), "true");
  assert.match(dom.window.document.body.textContent ?? "", /Équipe attribuée/u);

  const sidebar = dom.window.document.querySelector<HTMLElement>("#crm-sidebar")!;
  const last = sidebar.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
  const lastFocusable = last[last.length - 1]!;
  const backward = new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => sidebar.dispatchEvent(backward));
  assert.equal(backward.defaultPrevented, true);
  assert.equal(dom.window.document.activeElement, lastFocusable);

  const forward = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => sidebar.dispatchEvent(forward));
  assert.equal(forward.defaultPrevented, true);
  assert.equal(dom.window.document.activeElement, closer);

  const escape = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => sidebar.dispatchEvent(escape));
  assert.equal(escape.defaultPrevented, true);
  assert.equal(dom.window.document.activeElement, opener);
  assert.equal(opener.getAttribute("aria-expanded"), "false");
});
