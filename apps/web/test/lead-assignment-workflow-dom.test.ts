import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("disables assignment actions when no eligible adviser is available", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic/collaborators" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AssignmentWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms");
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
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ candidates: [] })));

  await act(async () => {
    root.render(createElement(AssignmentWorkflowForm, { leadId: "synthetic-lead", assigned: false }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  const select = host.querySelector<HTMLSelectElement>('select[name="targetUserId"]');
  assert.ok(select);
  assert.equal(select.disabled, true);
  assert.match(select.textContent, /Aucun conseiller disponible/u);
  const preview = [...host.querySelectorAll("button")].find((button) => button.textContent === "Prévisualiser");
  const confirm = [...host.querySelectorAll("button")].find((button) => button.textContent === "Confirmer l’affectation");
  assert.ok(preview);
  assert.ok(confirm);
  assert.equal(preview.disabled, true);
  assert.equal(confirm.disabled, true);
});
