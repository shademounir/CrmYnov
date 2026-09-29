import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvitationPage from "../app/invitation/page";
import { InvitationForm } from "../app/admin/users/invitation-form";

test("invitation pages distinguish Gmail acceptance from activation and never expose a raw code in server markup", () => {
  const page = renderToStaticMarkup(createElement(InvitationPage));
  assert.match(page, /Définir mon mot de passe/);
  assert.doesNotMatch(page, /code=/);
  const admin = renderToStaticMarkup(createElement(InvitationForm, { collaboratorId: "synthetic-id", email: "synthetic@example.invalid", eligible: true }));
  assert.match(admin, /Confirmer l’envoi ou la réémission/);
  assert.match(admin, /réception et l’activation restent à vérifier|Le lien est personnel/u);
});

test("opening an invitation does not submit it; explicit password confirmation consumes it once", async (t) => {
  const code = "A".repeat(43);
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: `https://dev.example.invalid/invitation#code=${code}` });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, location: dom.window.location, history: dom.window.history, IS_REACT_ACT_ENVIRONMENT: true })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { act } = await import("react"); const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
    requests.push({ path, body });
    return Promise.resolve(Response.json({ completed: true }, { status: 201 }));
  });
  await act(async () => { root.render(createElement(InvitationPage)); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(dom.window.location.hash, "");
  assert.equal(requests.length, 0);
  const form = dom.window.document.querySelector("form")!;
  form.querySelector<HTMLInputElement>('input[name="nextSecret"]')!.value = "Synthetic-Password-2026!";
  form.querySelector<HTMLInputElement>('input[name="confirmation"]')!.value = "Synthetic-Password-2026!";
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.deepEqual(requests, [{ path: "/api/crm/invitations/completions", body: { code, nextSecret: "Synthetic-Password-2026!" } }]);
  assert.match(dom.window.document.body.textContent ?? "", /Mot de passe enregistré/u);
});
