import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import AccessRecoveryPage from "../app/access-recovery/page";
import { GENERIC_MESSAGE } from "../app/access-recovery/recovery-form";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("exposes a recovery page with a non-enumerating message", () => {
  const page = AccessRecoveryPage();
  assert.equal(page.type, "main");
  assert.match(GENERIC_MESSAGE, /compte est éligible/);
  assert.doesNotMatch(GENERIC_MESSAGE, /existe|inconnu|introuvable/i);
});

test("recovery has a native POST method before hydration", () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(AccessRecoveryPage)));
  assert.equal(dom.window.document.querySelector("form")?.method, "post");
  dom.window.close();
});

test("recovery keeps the existing auth layout and provides a login return", () => {
  const markup = renderToStaticMarkup(createElement(AccessRecoveryPage));
  assert.match(markup, /login-card/u);
  assert.match(markup, /href="\/"/u);
});

async function browser(t: TestContext): Promise<{
  dom: JSDOM;
  form: HTMLFormElement;
  interact(callback: () => void): void;
  submit(): void;
  settle(): Promise<void>;
}> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://dev.example.invalid/access-recovery" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => {
    act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  act(() => root.render(createElement(AccessRecoveryPage)));
  const form = dom.window.document.querySelector("form");
  assert.ok(form);
  const interact = (callback: () => void): void => { act(callback); };
  const submit = (): void => {
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = "synthetic@example.invalid";
    interact(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  };
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  return { dom, form, interact, submit, settle };
}

function assertUnconfirmedResult(b: Awaited<ReturnType<typeof browser>>): void {
  assert.match(b.form.querySelector('[role="alert"]')?.textContent ?? "", /demande n’a pas pu être confirmée/u);
  assert.equal(b.form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, false);
  assert.doesNotMatch(b.dom.window.document.body.textContent ?? "", /synthetic@example\.invalid|internal transport detail|account existence detail/u);
}

test("a rejected recovery fetch is handled without escaping and permits deliberate retry", async (t) => {
  const b = await browser(t);
  const requests: Array<{ target: string; init?: RequestInit }> = [];
  const logs: unknown[][] = [];
  for (const method of ["error", "warn", "log"] as const) {
    t.mock.method(console, method, (...values: unknown[]): void => { logs.push(values); });
  }
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ target, ...(init ? { init } : {}) });
    return requests.length === 1 ? Promise.reject(new Error("internal transport detail")) : Promise.resolve(new Response("account existence detail", { status: 503 }));
  });
  b.submit();
  await b.settle();
  assertUnconfirmedResult(b);
  b.submit();
  await b.settle();
  assertUnconfirmedResult(b);
  assert.equal(requests.length, 2);
  assert.equal(logs.length, 0, "transport and account details must not be logged");
  for (const request of requests) {
    assert.equal(request.target, "/api/crm/access-recovery/requests");
    assert.equal(request.init?.method, "POST");
    assert.equal(typeof request.init?.body, "string");
    assert.deepEqual(JSON.parse(request.init?.body as string), { email: "synthetic@example.invalid", returnPath: "/access-recovery/complete" });
  }
});

test("recovery returns the same non-enumerating feedback for uniformly accepted requests", async (t) => {
  const b = await browser(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => {
    requests += 1;
    return Promise.resolve(new Response("account existence detail", { status: 202 }));
  });
  b.submit();
  await b.settle();
  assert.equal(b.form.querySelector('[role="status"]')?.textContent, GENERIC_MESSAGE);
  b.submit();
  await b.settle();
  assert.equal(b.form.querySelector('[role="status"]')?.textContent, GENERIC_MESSAGE);
  assert.equal(requests, 2);
});

test("concurrent recovery submissions issue one request and release pending state after refusal", async (t) => {
  const b = await browser(t);
  let resolveRequest!: (response: Response) => void;
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => {
    requests += 1;
    return new Promise<Response>((resolve) => { resolveRequest = resolve; });
  });
  b.submit();
  b.submit();
  await b.settle();
  assert.equal(requests, 1);
  assert.equal(b.form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
  b.interact(() => resolveRequest(new Response(null, { status: 503 })));
  await b.settle();
  assertUnconfirmedResult(b);
});

test("recovery throttling is non-enumerating and never claims a mail was sent", async (t) => {
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ detail: "private account detail" }, { status: 429 })));
  const b = await browser(t); b.submit(); await b.settle();
  assert.match(b.form.querySelector('[role="alert"]')?.textContent ?? "", /Trop de demandes/u);
  assert.equal(b.form.querySelector('[role="status"]'), null);
  assert.doesNotMatch(b.dom.window.document.body.textContent ?? "", /private account detail|mail envoyé/u);
});

test("recovery timeout aborts and releases the form without automatic resend", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0; let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests++; signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => { signal?.addEventListener("abort", () => reject(new DOMException("synthetic timeout", "AbortError")), { once: true }); });
  });
  const b = await browser(t); b.submit(); await b.settle();
  b.interact(() => t.mock.timers.tick(30_000)); await b.settle();
  assert.equal(signal?.aborted, true); assert.equal(requests, 1); assertUnconfirmedResult(b);
});
