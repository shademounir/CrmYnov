import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { LeadWorkflowPage } from "../app/leads/[leadId]/lead-workflow-page.js";
test("renders the controlled persistent follow-up journey", () => {
  const html = renderToStaticMarkup(createElement(LeadWorkflowPage, { leadId: "00000000-0000-4000-8000-000000000171", surface: "follow-up" }));
  for (const expected of ["Relances du Lead", "Éléments enregistrés", "Chargement des relances", "Retour à la fiche"]) assert.match(html, new RegExp(expected));
});

test("blocks repeated follow-up submissions and sends a stable idempotency key", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"); const { createRoot } = await import("react-dom/client");
  const { FollowUpWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let release: ((response: Response) => void) | undefined; const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push(init ?? {}); return new Promise<Response>((resolve) => { release = resolve; });
  });
  await act(async () => { root.render(createElement(FollowUpWorkflowForm, { leadId: "synthetic-lead" })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const form = host.querySelector<HTMLFormElement>("form"); const dueAt = host.querySelector<HTMLInputElement>('input[name="dueAt"]'); const reason = host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]'); assert.ok(form && dueAt && reason);
  dueAt.value = "2099-09-10T10:30"; reason.value = "Rappeler après réception du dossier";
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(requests.length, 1); const requestBody = requests[0]?.body; if (typeof requestBody !== "string") assert.fail("expected_string_request_body"); const submitted = JSON.parse(requestBody) as Record<string, unknown>;
  assert.match(String(submitted.idempotencyKey), /^[a-f\d-]{36}$/u); assert.equal(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent, "Enregistrement…");
  await act(async () => { assert.ok(release); release(Response.json({ id: "follow-up-1" })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.match(host.textContent ?? "", /Relance planifiée/u);
});

test("loads a persisted follow-up and blocks repeated completion submissions", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic/follow-ups" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"); const { createRoot } = await import("react-dom/client");
  const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const scheduled = { id: "follow-up-1", leadId: "synthetic-lead", ownerId: "synthetic-owner", dueAt: "2099-09-10T10:30:00.000Z", state: "SCHEDULED", reason: "Rappel synthétique", version: 1, createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z" };
  const requests: Array<{ init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ ...(init ? { init } : {}) });
    if (init?.method === "PATCH") return Promise.resolve(Response.json({ ...scheduled, state: "COMPLETED", version: 2 }));
    return Promise.resolve(Response.json({ items: requests.some((request) => request.init?.method === "PATCH") ? [{ ...scheduled, state: "COMPLETED", version: 2 }] : [scheduled] }));
  });
  await act(async () => { root.render(createElement(FollowUpHistory, { leadId: "synthetic-lead" })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const form = host.querySelector<HTMLFormElement>("form"); const action = host.querySelector<HTMLSelectElement>('select[name="action"]'); assert.ok(form && action); action.value = "COMPLETE";
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const patches = requests.filter((request) => request.init?.method === "PATCH"); assert.equal(patches.length, 1);
  const body = patches[0]?.init?.body; if (typeof body !== "string") assert.fail("expected_string_request_body"); const parsed = JSON.parse(body) as Record<string, unknown>;
  assert.equal(parsed.action, "COMPLETE"); assert.equal(parsed.expectedVersion, 1); assert.match(String(parsed.idempotencyKey), /^[a-f\d-]{36}$/u);
  assert.match(host.textContent ?? "", /Relance clôturée/u); assert.match(host.textContent ?? "", /Clôturée/u); assert.doesNotMatch(host.textContent ?? "", /Enregistrer l.action/u);
});
