import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { createElement, StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecoveryCompletionPage from "../app/access-recovery/complete/page";
import { RecoveryCompletionForm } from "../app/access-recovery/complete/recovery-completion-form";
import config from "../next.config";
import { AppShellClient } from "../app/_components/app-shell";

const TOKEN = "A".repeat(43);
const SECRET = "Synthetic-Password-2026!";

async function browser(t: TestContext, suffix = `#token=${TOKEN}`, strict = false): Promise<{
  dom: JSDOM; settle(): Promise<void>; interact(callback: () => void): void; submit(secret?: string, confirmation?: string): void;
}> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: `https://dev.example.invalid/access-recovery/complete${suffix}` });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, location: dom.window.location, history: dom.window.history, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => {
    act(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await act(async () => {
    const component = createElement(AppShellClient, { pathname: "/access-recovery/complete", children: createElement(RecoveryCompletionForm) });
    root.render(strict ? createElement(StrictMode, null, component) : component);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  const interact = (callback: () => void): void => { act(callback); };
  const submit = (secret = SECRET, confirmation = secret): void => {
    const form = dom.window.document.querySelector("form");
    assert.ok(form);
    form.querySelector<HTMLInputElement>('[name="nextSecret"]')!.value = secret;
    form.querySelector<HTMLInputElement>('[name="confirmation"]')!.value = confirmation;
    interact(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  };
  return { dom, settle, interact, submit };
}

test("completion server markup exposes neither secret fields nor token and uses the auth card", async () => {
  const markup = renderToStaticMarkup(createElement(RecoveryCompletionPage));
  assert.match(markup, /login-card/u);
  assert.match(markup, /Définir un nouveau mot de passe/u);
  assert.doesNotMatch(markup, /<form|name="nextSecret"|name="token"|token=|AAAAAAAA/u);
  assert.match(markup, /Vérification du lien/u);
  const shell = renderToStaticMarkup(createElement(AppShellClient, { pathname: "/access-recovery/complete", children: createElement(RecoveryCompletionPage) }));
  assert.doesNotMatch(shell, /Navigation CRM|Recherche globale|Session locale/u);
  const headers = await config.headers?.();
  for (const path of ["/access-recovery", "/access-recovery/complete", "/first-login", "/invitation"]) {
    const route = headers?.find((entry) => entry.source === path);
    assert.ok(route);
    assert.deepEqual(route.headers, [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }]);
  }
});

test("a fragment is removed before parsing and explicit POST confirmation is required", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { requests++; return Promise.resolve(new Response(null, { status: 204 })); });
  const b = await browser(t, `?untrusted=ignored#token=${TOKEN}`);
  assert.equal(b.dom.window.location.href, "https://dev.example.invalid/access-recovery/complete");
  assert.equal(requests, 0);
  const form = b.dom.window.document.querySelector("form");
  assert.ok(form);
  assert.equal(form.method, "post");
  assert.equal(form.querySelector('[name="token"]'), null);
  for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
    assert.equal(input.type, "password"); assert.equal(input.autocomplete, "new-password");
    assert.equal(input.minLength, 14); assert.equal(input.maxLength, 128);
  }
  assert.doesNotMatch(b.dom.window.document.body.innerHTML, new RegExp(TOKEN));
  assert.equal(b.dom.window.localStorage.length, 0);
  assert.equal(b.dom.window.sessionStorage.length, 0);
});

for (const suffix of [`?token=${TOKEN}`, "", "#token=invalid", `#token=${TOKEN}&token=${TOKEN}`]) {
  test(`completion rejects an absent, query-only or malformed fragment (${suffix.startsWith("?") ? "query" : suffix ? "fragment" : "absent"}) without a request`, async (t) => {
    let requests = 0;
    t.mock.method(globalThis, "fetch", (): Promise<Response> => { requests++; return Promise.resolve(new Response(null, { status: 204 })); });
    const b = await browser(t, suffix);
    assert.equal(b.dom.window.location.search, "");
    assert.equal(b.dom.window.location.hash, "");
    assert.equal(b.dom.window.document.querySelector("form"), null);
    assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’est plus utilisable/u);
    assert.equal(requests, 0);
  });
}

test("StrictMode initialization preserves a valid fragment after history cleanup", async (t) => {
  const b = await browser(t, `#token=${TOKEN}`, true);
  assert.equal(b.dom.window.location.hash, "");
  assert.ok(b.dom.window.document.querySelector("form"));
});

test("password policy and confirmation reject invalid values locally without consuming the token", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { requests++; return Promise.resolve(new Response(null, { status: 204 })); });
  const b = await browser(t);
  for (const [secret, confirmation] of [["Short-1!", "Short-1!"], [SECRET, "Different-Password-2026!"], ["a".repeat(14), "a".repeat(14)], ["Missing-Digits-Here!", "Missing-Digits-Here!"], ["Synthetic Password-2026!", "Synthetic Password-2026!"], ["Aa1!" + "a".repeat(125), "Aa1!" + "a".repeat(125)]]) {
    b.submit(secret, confirmation); await b.settle();
    assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /conformité/u);
    assert.equal(requests, 0);
  }
});

test("one explicit completion consumes the token, clears fields and offers login without automatic navigation", async (t) => {
  const requests: Array<{ path: string; init: RequestInit | undefined }> = [];
  let resolveRequest!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ path: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init });
    return new Promise<Response>((resolve) => { resolveRequest = resolve; });
  });
  const b = await browser(t);
  b.submit(); b.submit(); await b.settle();
  assert.equal(requests.length, 1);
  const form = b.dom.window.document.querySelector("form")!;
  assert.equal(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
  assert.equal(requests[0]?.path, "/api/crm/access-recovery/completions");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.deepEqual(JSON.parse(requests[0]?.init?.body as string), { token: TOKEN, returnPath: "/access-recovery/complete", nextSecret: SECRET });
  b.interact(() => resolveRequest(new Response(null, { status: 204 }))); await b.settle();
  assert.equal(b.dom.window.document.querySelector("form"), null);
  assert.equal(form.querySelector<HTMLInputElement>('[name="nextSecret"]')?.value, "");
  assert.match(b.dom.window.document.querySelector('[role="status"]')?.textContent ?? "", /anciennes sessions ont été révoquées/u);
  assert.equal(b.dom.window.document.querySelector('[role="status"] a')?.getAttribute("href"), "/");
  assert.equal(b.dom.window.location.pathname, "/access-recovery/complete");
  assert.equal(requests.length, 1);
});

test("expired, used or revoked challenges use the same generic response without reflecting server details", async (t) => {
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ code: "recovery_challenge_invalid", detail: "private account or expiration detail" }, { status: 400 })));
  const b = await browser(t);
  b.submit(); await b.settle();
  assert.equal(b.dom.window.document.querySelector("form"), null);
  assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’est plus utilisable/u);
  assert.doesNotMatch(b.dom.window.document.body.textContent ?? "", /private account|expiration detail|AAAAAAAA/u);
});

test("transport failure permits only a deliberate retry with the same fragment and never logs secrets", async (t) => {
  const requests: string[] = [];
  const logs: unknown[][] = [];
  for (const method of ["error", "warn", "log"] as const) t.mock.method(console, method, (...values: unknown[]) => { logs.push(values); });
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(typeof init?.body, "string");
    requests.push(init?.body as string);
    return requests.length === 1 ? Promise.reject(new Error(`private transport ${TOKEN} ${SECRET}`)) : Promise.resolve(new Response(null, { status: 204 }));
  });
  const b = await browser(t);
  b.submit(); await b.settle();
  assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’a pas pu être confirmé/u);
  assert.equal(requests.length, 1);
  assert.equal(b.dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
  assert.doesNotMatch(b.dom.window.document.body.innerHTML, /private transport|AAAAAAAA/u);
  b.submit(); await b.settle();
  assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]); assert.equal(logs.length, 0);
});

test("a 200 payload cannot falsely confirm completion and a server policy refusal retains the form", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => {
    requests++;
    return Promise.resolve(requests === 1 ? Response.json({ completed: true }) : Response.json({ code: "recovery_completion_invalid" }, { status: 400 }));
  });
  const b = await browser(t);
  b.submit(); await b.settle();
  assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’a pas pu être confirmé/u);
  b.submit(); await b.settle();
  assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /conformité/u);
  assert.ok(b.dom.window.document.querySelector("form"));
});

test("a timed out completion releases the pending state without another request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests++; signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => { signal?.addEventListener("abort", () => reject(new DOMException("synthetic timeout", "AbortError")), { once: true }); });
  });
  const b = await browser(t);
  b.submit(); await b.settle();
  b.interact(() => t.mock.timers.tick(30_000)); await b.settle();
  assert.equal(signal?.aborted, true);
  assert.match(b.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’a pas pu être confirmé/u);
  assert.equal(b.dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
  assert.equal(requests, 1);
});
