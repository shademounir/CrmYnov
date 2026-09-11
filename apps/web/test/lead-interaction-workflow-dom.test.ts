import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test("interaction chronology fails before transport and same-tick submits produce one write", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    FormData: dom.window.FormData,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { InteractionWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms");
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

  const transport = deferred<Response>();
  let writes = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { writes += 1; return transport.promise; });
  act(() => root.render(createElement(InteractionWorkflowForm, { leadId: "synthetic-lead" })));
  const form = host.querySelector("form");
  const nextAction = host.querySelector<HTMLInputElement>('input[name="nextActionAt"]');
  assert.ok(form); assert.ok(nextAction);

  nextAction.value = "2020-01-01T00:00";
  act(() => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(writes, 0);
  assert.match(host.textContent ?? "", /postérieure à l’interaction/u);

  nextAction.value = "2099-01-01T00:00";
  act(() => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  assert.equal(writes, 1);
  assert.equal([...host.querySelectorAll("button")].find((button) => button.type === "submit")?.disabled, true);
  await act(async () => { transport.resolve(Response.json({ id: "activity-synthetic" }, { status: 201 })); await Promise.resolve(); });
  assert.match(host.textContent ?? "", /Interaction enregistrée/u);
});
