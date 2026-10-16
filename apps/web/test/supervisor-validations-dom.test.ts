import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ValidationsPage from "../app/manager/validations/page.js";

test("supervisor inbox is scoped, read-only for the requester and reconciles only explicitly", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/manager/validations" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const pending = { id: "proposal-synthetic", leadId: "lead-synthetic", requesterId: "requester", state: "PENDING", version: 1, target: "QUALIFIED", reason: "COMMERCIAL_STAGE_REVIEW", comment: "Commentaire synthétique à examiner", evidence: [], createdAt: "2026-10-16T10:00:00.000Z" };
  let canManage = false; let canDecide = false; let readStatus = 200; let invalid = false; let empty = false; let reconcileStatus = 200; let writes = 0;
  t.mock.method(globalThis, "fetch", (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(init?.credentials, "same-origin");
    if (init?.method === "POST") {
      assert.equal(url, "/api/crm/closure-requests/reconcile-notifications"); assert.equal(init.body, "{}"); writes++;
      return Promise.resolve(Response.json({}, { status: reconcileStatus }));
    }
    assert.equal(url, "/api/crm/closure-requests"); assert.equal(init?.cache, "no-store");
    return Promise.resolve(Response.json(invalid ? {} : { canManage, items: empty ? [] : [{ ...pending, canDecide }, { ...pending, id: "decided", state: "APPROVED" }] }, { status: readStatus }));
  });
  async function mount(key: string): Promise<void> { await act(async () => { root.render(createElement(ValidationsPage, { key })); await new Promise<void>((resolve) => setImmediate(resolve)); }); }
  async function click(text: string): Promise<void> {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text); assert.ok(button);
    await act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  }
  await mount("requester");
  assert.match(host.textContent ?? "", /1 demande.*Commentaire synthétique/u);
  assert.match(host.textContent ?? "", /En attente d’un autre superviseur/u);
  assert.equal(host.querySelector("a"), null); assert.equal(host.querySelector("button"), null); assert.equal(writes, 0);
  canManage = true; canDecide = true; await mount("manager");
  assert.equal(host.querySelector("a")?.getAttribute("href"), "/leads/lead-synthetic/closure");
  await click("Vérifier la transmission aux responsables"); assert.equal(writes, 1);
  assert.match(host.textContent ?? "", /responsables autorisés disposent des notifications/u);
  reconcileStatus = 503; await click("Vérifier la transmission aux responsables"); assert.equal(writes, 2);
  assert.match(host.textContent ?? "", /transmission n’a pas pu être confirmée/u);
  readStatus = 401; await mount("expired"); assert.ok(host.querySelector('[role="alert"]')); assert.equal(host.querySelector("a"), null);
  readStatus = 200; empty = true; await click("Réessayer"); assert.match(host.textContent ?? "", /Aucune demande en attente/u);
  invalid = true; await mount("invalid"); assert.ok(host.querySelector('[role="alert"]'));
});
