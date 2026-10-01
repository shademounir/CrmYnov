import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

const lead = {
  id: "00000000-0000-4000-8000-000000000193",
  leadCode: "LD-READBACK",
  firstName: "Recette",
  lastName: "Synthétique",
  campus: "SYNTHETIC",
  campaign: "SYNTHETIC",
  educationLevel: "BAC",
  program: "SYNTHETIC",
  source: "TEST",
  status: "CONTACTED",
  collaboratorIds: [],
  temperature: "UNEVALUATED",
  temperatureLabel: "Non évalué",
  qualificationVersion: 0,
  version: 1,
};

async function mountProfile(t: TestContext, rereadFails: boolean): Promise<{ host: HTMLElement; timelineReads: () => number }> {
  const dom = new JSDOM("<div id='root'></div>", { url: `http://localhost/leads/${lead.id}` });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement,
    FormData: dom.window.FormData,
    Event: dom.window.Event,
    DOMException: dom.window.DOMException,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function showModal(): void { this.setAttribute("open", ""); };
  dom.window.HTMLDialogElement.prototype.close = function close(): void { this.removeAttribute("open"); };
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LeadProfile } = await import("../app/leads/[leadId]/lead-profile");
  const host = dom.window.document.getElementById("root");
  assert.ok(host);
  const root = createRoot(host);
  let written = false;
  let reads = 0;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === "POST" && url.endsWith("/timeline")) {
      written = true;
      return Promise.resolve(Response.json({ id: "interaction-readback" }, { status: 201 }));
    }
    if (url.endsWith("/timeline")) {
      reads += 1;
      if (written && rereadFails) return Promise.resolve(Response.json({ code: "temporary" }, { status: 503 }));
      return Promise.resolve(Response.json({ events: written ? [{ id: "interaction-readback", type: "CRM_CALL", result: "CONNECTED", occurredAt: "2026-09-11T14:00:00.000Z" }] : [] }));
    }
    return Promise.resolve(Response.json(lead));
  });
  await act(async () => {
    root.render(createElement(LeadProfile, { leadId: lead.id }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const trigger = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Ajouter une interaction"));
  assert.ok(trigger);
  act(() => trigger.click());
  const form = host.querySelector<HTMLFormElement>(".lead-interaction-dialog form");
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  t.after(async (): Promise<void> => {
    await act<void>(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { host, timelineReads: () => reads };
}

test("profile announces success only after the interaction is reread and displayed", async (t) => {
  const mounted = await mountProfile(t, false);
  assert.ok(mounted.timelineReads() >= 2);
  assert.match(mounted.host.textContent ?? "", /Appel depuis le CRM/u);
  assert.match(mounted.host.textContent ?? "", /fiche et l’historique ont été relus depuis le serveur/u);
});

test("profile preserves context and distinguishes a confirmed write from a failed reread", async (t) => {
  const mounted = await mountProfile(t, true);
  assert.ok(mounted.timelineReads() >= 2);
  assert.match(mounted.host.textContent ?? "", /Action confirmée par le serveur, mais la relecture de la fiche a échoué/u);
  assert.match(mounted.host.textContent ?? "", /Recette Synthétique/u);
  assert.doesNotMatch(mounted.host.textContent ?? "", /fiche et l’historique ont été relus depuis le serveur/u);
});
