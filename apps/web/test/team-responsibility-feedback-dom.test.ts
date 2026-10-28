import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("team responsibility read distinguishes pending, empty and failed states and blocks stale edits without writes", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TeamResponsibilities } = await import("../app/admin/roles/team-responsibilities");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close(); for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let response: ((value: Response) => void) | undefined; let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    calls++; assert.equal(url, "/api/crm/admin/role-permissions/team-responsibilities"); assert.notEqual(init?.method, "POST");
    return new Promise<Response>((resolve) => { response = resolve; });
  });
  const doc = dom.window.document;
  const section = (): HTMLElement => { const item = doc.querySelector<HTMLElement>("section"); assert(item); return item; };
  const readButton = (): HTMLButtonElement => { const item = section().querySelector<HTMLButtonElement>("button"); assert(item); return item; };
  const saveButton = (): HTMLButtonElement => { const item = section().querySelector<HTMLButtonElement>(".primary-button"); assert(item); return item; };
  const relationButton = (): HTMLButtonElement => { const item = section().querySelector<HTMLButtonElement>("li button"); assert(item); return item; };
  const confirmBox = (): HTMLInputElement => { const items = section().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'); const item = items[1]; assert(item); return item; };
  const click = async (item: HTMLElement): Promise<void> => { await act(async () => { item.click(); await Promise.resolve(); }); };
  const startRead = async (): Promise<void> => { response = undefined; await click(readButton()); assert(response); };
  const finishRead = async (value: Response): Promise<void> => { assert(response); await act(async () => { response!(value); await Promise.resolve(); }); };
  await act(async () => { root.render(createElement(TeamResponsibilities, { campuses: [{ id: "synthetic-campus", code: "SYNTHETIC" }] })); await Promise.resolve(); });
  assert.equal(calls, 0); assert.equal(doc.querySelector('[role="status"]'), null); assert.doesNotMatch(doc.body.textContent, /Aucune responsabilité enregistrée/); assert.equal(saveButton().disabled, true);
  await startRead(); assert.equal(section().getAttribute("aria-busy"), "true"); assert.equal(readButton().disabled, true); assert.match(readButton().textContent, /Chargement des responsabilités/); assert.doesNotMatch(doc.body.textContent, /0 responsabilités chargées/);
  await finishRead(Response.json({ responsibilities: [] })); assert.equal(section().getAttribute("aria-busy"), "false"); assert.equal(readButton().disabled, false);
  assert.match(doc.body.textContent, /0 responsabilités chargées/); assert.match(doc.body.textContent, /Aucune responsabilité enregistrée dans ce périmètre/); assert.equal(doc.querySelector('[role="status"]')?.getAttribute("aria-live"), "polite");
  await startRead(); assert.doesNotMatch(doc.body.textContent, /0 responsabilités chargées/); assert.doesNotMatch(doc.body.textContent, /Aucune responsabilité enregistrée/);
  await finishRead(Response.json({ responsibilities: [{ id: "synthetic-relation", teamId: "synthetic-team", managerId: "synthetic-manager", campusId: "synthetic-campus", active: true, version: 1 }] }));
  assert.match(doc.body.textContent, /1 responsabilité chargée/); assert.doesNotMatch(doc.body.textContent, /Aucune responsabilité enregistrée/);
  await click(relationButton()); await click(confirmBox()); assert.equal(confirmBox().checked, true); assert.equal(saveButton().disabled, false);
  await startRead(); assert.equal(saveButton().disabled, true); await finishRead(Response.json({ code: "permission_store_unavailable" }, { status: 503 }));
  assert(doc.querySelector('[role="alert"]')); assert.match(doc.body.textContent, /Aucune nouvelle lecture n’est confirmée/); assert.equal(doc.querySelector('[role="status"]'), null); assert.match(doc.body.textContent, /synthetic-team/);
  assert.equal(confirmBox().checked, false); assert.equal(relationButton().disabled, true); await click(confirmBox()); assert.equal(confirmBox().checked, true); assert.equal(saveButton().disabled, true);
  await click(saveButton()); assert.equal(calls, 3, "no mutative request after failed read even with a stale selection and renewed confirmation");
  await startRead(); await finishRead(Response.json({ responsibilities: null })); assert.match(doc.body.textContent, /réponse des responsabilités est invalide/); assert.doesNotMatch(doc.body.textContent, /0 responsabilités chargées/); assert.equal(saveButton().disabled, true);
  await startRead(); await finishRead(Response.json({ code: "session_expired" }, { status: 401 })); assert(doc.querySelector('[role="alert"]')); assert.equal(doc.querySelector('[role="status"]'), null);
  assert.equal(calls, 5); assert.equal(saveButton().disabled, true);
});
