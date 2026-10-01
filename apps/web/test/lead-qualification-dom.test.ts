import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("qualification drawer blocks repeated submissions and preserves input on a version conflict", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement,
    FormData: dom.window.FormData,
    DOMException: dom.window.DOMException,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", { configurable: true, value(): void { this.setAttribute("open", ""); } });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", { configurable: true, value(): void { this.removeAttribute("open"); } });
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LeadQualificationDrawer } = await import("../app/leads/[leadId]/lead-qualification-drawer");
  const host = dom.window.document.getElementById("root");
  assert.ok(host);
  const root = createRoot(host);
  t.after(async (): Promise<void> => {
    await act<void>(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  let releaseSave: ((response: Response) => void) | undefined;
  let patchCalls = 0;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method !== "PATCH") return Promise.resolve(Response.json({ current: { temperature: "UNEVALUATED", temperatureLabel: "Non évalué", version: 0 }, history: [] }));
    patchCalls += 1;
    if (patchCalls === 1) return new Promise<Response>((resolve) => { releaseSave = resolve; });
    return Promise.resolve(Response.json({ code: "lead_qualification_version_conflict" }, { status: 409 }));
  });

  act(() => {
    root.render(createElement(LeadQualificationDrawer, { leadId: "synthetic-lead", leadCode: "LD-SYNTHETIC", temperatureLabel: "Non évalué" }));
  });
  const trigger = host.querySelector<HTMLButtonElement>("button.secondary-button");
  assert.ok(trigger);
  await act(async () => {
    trigger.click();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const form = host.querySelector<HTMLFormElement>("form");
  const warm = host.querySelector<HTMLInputElement>('input[value="WARM"]');
  const reason = host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]');
  assert.ok(form && warm && reason);
  warm.checked = true;
  reason.value = "Projet et échéance à préciser";
  await act(async () => {
    warm.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    reason.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(patchCalls, 1);
  assert.equal(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent, "Enregistrement…");

  await act(async () => {
    assert.ok(releaseSave);
    releaseSave(Response.json({ temperature: "WARM", temperatureLabel: "Tiède", reason: reason.value, version: 1, createdAt: "2026-09-10T10:00:00.000Z" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.match(host.textContent ?? "", /Température enregistrée : Tiède/u);

  const refreshedForm = host.querySelector<HTMLFormElement>("form");
  const cold = host.querySelector<HTMLInputElement>('input[value="COLD"]');
  const refreshedReason = host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]');
  assert.ok(refreshedForm && cold && refreshedReason);
  cold.checked = true;
  refreshedReason.value = "Projet sans échéance exploitable";
  await act(async () => {
    cold.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    refreshedReason.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    refreshedForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(patchCalls, 2);
  assert.equal(refreshedReason.value, "Projet sans échéance exploitable");
  assert.match(host.textContent ?? "", /La qualification a changé depuis l’ouverture/u);
});
