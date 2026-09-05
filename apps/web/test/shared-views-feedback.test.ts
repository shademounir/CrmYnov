import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import type { SharedView } from "../app/leads/shared-view-client.js";

const own: SharedView = { id: "00000000-0000-4000-8000-000000000170", name: "Vue synthétique", version: 1, filters: {},
  ownerDisplayName: "Responsable synthétique", isOwner: true, visibleAudiences: [], canEdit: true, canRevoke: true, canDuplicate: true };
const campus = "00000000-0000-4000-8000-000000000171";
type Override = (path: string, init: RequestInit) => Response | Promise<Response> | undefined;

function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void; reject: (reason: Error) => void } {
  let resolve: (value: Response) => void = () => { throw new Error("deferred_missing"); };
  let reject: (reason: Error) => void = () => { throw new Error("deferred_missing"); };
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function browser(t: TestContext, override: Override): Promise<{
  dom: JSDOM; doc: Document; act: typeof import("react").act;
  button: (label: string) => HTMLButtonElement; click: (label: string) => Promise<void>;
  choose: () => Promise<void>; share: () => Promise<void>;
}> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/leads" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { SharedViewControls } = await import("../app/leads/shared-views.js");
  const doc = dom.window.document, host = doc.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async () => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  t.mock.method(globalThis, "fetch", (path: string, init: RequestInit): Promise<Response> => {
    assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store");
    const custom = override(path, init); if (custom !== undefined) return Promise.resolve(custom);
    if (init.method === "POST") return Promise.resolve(Response.json(own, { status: 201 }));
    const body = path === "/api/crm/lead-views" ? [own]
      : path.includes("/view-sharing/views/") ? own
        : path.endsWith("/audiences") ? [{ id: campus, campusId: campus, label: "Campus synthétique", kind: "CAMPUS" }] : [];
    return Promise.resolve(Response.json(body));
  });
  const button = (label: string): HTMLButtonElement => { const node = [...doc.querySelectorAll("button")].find((b) => b.textContent === label); assert.ok(node, label); return node; };
  const click = async (label: string): Promise<void> => { assert.equal(button(label).disabled, false); await act<void>(() => { button(label).click(); }); };
  const choose = async (): Promise<void> => {
    for (const [index, value] of [own.id, campus].entries()) {
      const select = doc.querySelectorAll("select")[index]; assert.ok(select);
      await act<void>(() => { select.value = value; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    }
  };
  const share = async (): Promise<void> => { await choose(); await click("Partager la vue"); await click("Confirmer l’action"); };
  await act<void>(() => root.render(createElement(SharedViewControls, { current: {} })));
  return { dom, doc, act, button, click, choose, share };
}

function terminal(doc: Document, expected: "idle" | "success" | "error"): void {
  const success = [...doc.querySelectorAll('[role="status"]')].filter((node) => node.textContent?.includes("Action enregistrée"));
  assert.equal(success.length, expected === "success" ? 1 : 0);
  assert.equal(doc.querySelectorAll('[role="alert"]').length, expected === "error" ? 1 : 0);
}

test("CRMY-170 success then refresh/error, error then success, new action clears feedback", async (t) => {
  let response: Response | undefined;
  const ui = await browser(t, (path) => path.endsWith("/received") ? response?.clone() : undefined);
  await ui.share(); terminal(ui.doc, "success");
  await ui.click("Actualiser les partages"); terminal(ui.doc, "idle");
  await ui.share(); terminal(ui.doc, "success");
  response = Response.json({ diagnostic: "do-not-display" }, { status: 403 });
  await ui.click("Actualiser les partages"); terminal(ui.doc, "error");
  assert.ok(ui.doc.querySelector('[role="alert"]')?.textContent?.includes("Accès refusé"));
  assert.equal(ui.doc.body.textContent.includes("do-not-display"), false);
  response = undefined; await ui.click("Actualiser les partages"); terminal(ui.doc, "idle");
  await ui.share(); terminal(ui.doc, "success");
  await ui.click("Partager la vue"); terminal(ui.doc, "idle");
  await ui.click("Annuler l’action"); terminal(ui.doc, "idle");
});

test("CRMY-170 refused writes and failed rereads never retain success (403/409/429/5xx/network)", async (t) => {
  let failure: number | "network" | undefined;
  let phase: "write" | "read" = "write";
  const ui = await browser(t, (path, init) => {
    if (failure === undefined || (phase === "write" ? init.method !== "POST" : !path.endsWith("/received"))) return undefined;
    return failure === "network" ? Promise.reject(new Error("Connexion synthétique interrompue")) : Response.json({}, { status: failure });
  });
  for (const status of [403, 409, 429, 500, 503, "network"] as const) {
    failure = undefined; await ui.click("Actualiser les partages"); await ui.share(); terminal(ui.doc, "success");
    failure = status; await ui.share(); terminal(ui.doc, "error");
    failure = undefined; await ui.click("Actualiser les partages"); await ui.share(); terminal(ui.doc, "success");
    failure = status; phase = "read"; await ui.click("Actualiser les partages"); terminal(ui.doc, "error"); phase = "write";
  }
});

test("CRMY-170 server write success is not announced when its authorized reread fails", async (t) => {
  let written = false;
  const ui = await browser(t, (path, init) => {
    if (init.method === "POST") written = true;
    if (written && path.endsWith("/received")) return Response.json({}, { status: 503 });
    return undefined;
  });
  await ui.share(); terminal(ui.doc, "error");
  assert.ok(ui.doc.querySelector('[role="alert"]')?.textContent?.includes("Service indisponible"));
});

test("CRMY-170 refresh starts neutral and aborts/ignores older success and failure responses", async (t) => {
  let pending: ReturnType<typeof deferred> | undefined, signal: AbortSignal | null | undefined;
  const ui = await browser(t, (path, init) => {
    if (path.endsWith("/received") && pending) { signal = init.signal; return pending.promise; }
    return undefined;
  });
  for (const status of [200, 403]) {
    await ui.share(); terminal(ui.doc, "success");
    pending = deferred(); const old = pending;
    await ui.click("Actualiser les partages"); terminal(ui.doc, "idle");
    assert.ok(ui.doc.body.textContent.includes("Chargement des vues"));
    const oldSignal = signal;
    pending = undefined; await ui.click("Actualiser les partages");
    assert.equal(oldSignal?.aborted, true); await ui.share(); terminal(ui.doc, "success");
    await ui.act<void>(() => old.resolve(Response.json([], { status })));
    terminal(ui.doc, "success");
  }
});

test("CRMY-170 older mutation completion cannot overwrite a newer refresh result", async (t) => {
  let write: ReturnType<typeof deferred> | undefined;
  const ui = await browser(t, (_path, init) => init.method === "POST" ? write?.promise : undefined);
  for (const fail of [false, true]) {
    write = deferred(); const old = write;
    await ui.share(); terminal(ui.doc, "idle");
    assert.equal(ui.button("Actualiser les partages").disabled, true);
    await ui.act<void>(() => { ui.dom.window.dispatchEvent(new ui.dom.window.Event("saved-views-changed")); });
    write = undefined; await ui.share(); terminal(ui.doc, "success");
    await ui.act<void>(() => { if (fail) old.reject(new Error("Late synthetic failure")); else old.resolve(Response.json(own, { status: 201 })); });
    terminal(ui.doc, "success");
  }
});
