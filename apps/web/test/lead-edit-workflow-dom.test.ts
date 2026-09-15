import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("Lead correction shares the governed form, blocks double submit and preserves values on collision", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, FormData: dom.window.FormData, DOMException: dom.window.DOMException, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LeadEditWorkflowForm } = await import("../app/leads/[leadId]/lead-edit-workflow");
  const host = dom.window.document.getElementById("root"); assert.ok(host); const root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let release: ((response: Response) => void) | undefined; let patchCalls = 0;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/crm/references")) {
      const kind = new URL(url, "http://localhost").searchParams.get("kind");
      const value = kind === "CAMPUS" ? { id: "campus-id", kind, code: "CAMPUS-A", label: "Campus A", scope: "GLOBAL", campusId: null, state: "ACTIVE", version: 1 } : kind === "PROGRAM" ? { id: "program-id", kind, code: "PROGRAM-A", label: "Programme A", scope: "CAMPUS", campusId: "campus-id", state: "ACTIVE", version: 1 } : { id: "campaign-id", kind, code: "CAMPAIGN-A", label: "Campagne A", scope: "CAMPUS", campusId: "campus-id", state: "ACTIVE", version: 1 };
      return Promise.resolve(Response.json({ items: [value] }));
    }
    assert.equal(init?.method, "PATCH"); patchCalls += 1;
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  const lead = { id: "synthetic", leadCode: "LD-SYNTHETIC", firstName: "Alex", lastName: "Test", email: "alex@example.invalid", phone: "+212600000001", campus: "CAMPUS-A", campaign: "CAMPAIGN-A", educationLevel: "BAC", program: "PROGRAM-A", source: "MANUAL_ENTRY", status: "PROSPECT", collaboratorIds: [], temperature: "UNEVALUATED" as const, temperatureLabel: "Non évalué", qualificationVersion: 0, version: 4 };
  await act(async () => { root.render(createElement(LeadEditWorkflowForm, { lead })); await new Promise<void>((resolve) => setImmediate(resolve)); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const form = host.querySelector<HTMLFormElement>("form"); const email = host.querySelector<HTMLInputElement>('input[name="email"]'); assert.ok(form && email);
  email.value = "collision@example.invalid";
  await act(async () => { email.dispatchEvent(new dom.window.Event("change", { bubbles: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(patchCalls, 1); assert.equal(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent, "Enregistrement…");
  await act(async () => { assert.ok(release); release(Response.json({ code: "lead_contact_collision" }, { status: 409 })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(email.value, "collision@example.invalid"); assert.match(host.textContent ?? "", /déjà utilisées par un autre Lead/u); assert.doesNotMatch(host.textContent ?? "", /lead_contact_collision/u);
  assert.match(host.textContent ?? "", /Laisser vide efface explicitement/u); assert.match(host.textContent ?? "", /sans inventer de chiffre/u);
});
