import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

async function browser(t: TestContext): Promise<{
  dom: JSDOM;
  form: HTMLFormElement;
  submit(): void;
  settle(): Promise<void>;
  interact(callback: () => void): void;
  uncaught: unknown[];
  navigation: string[];
}> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://dev.example.invalid/" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  const navigation: string[] = [];
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, location: { assign: (path: string): void => { navigation.push(path); } }, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LoginForm } = await import("../app/_components/login-form.js");
  const uncaught: unknown[] = [];
  const root = createRoot(dom.window.document.getElementById("root")!, { onUncaughtError: (error: unknown): void => { uncaught.push(error); } });
  t.after(() => {
    act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  act(() => root.render(createElement(LoginForm)));
  const form = dom.window.document.querySelector("form");
  assert.ok(form);
  const submit = (): void => {
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = "synthetic@example.invalid";
    form.querySelector<HTMLInputElement>('input[name="password"]')!.value = "Synthetic-Only-Password!9";
    act(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  };
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  return { dom, form, submit, settle, interact: (callback: () => void): void => { act(callback); }, uncaught, navigation };
}

function assertRetryAvailable(b: Awaited<ReturnType<typeof browser>>): void {
  const alert = b.dom.window.document.querySelector('[role="alert"]');
  assert.ok(alert, "a generic error must remain visible after a failed login request");
  assert.match(alert.textContent ?? "", /Identifiants refusés ou service indisponible/u);
  assert.doesNotMatch(b.dom.window.document.body.textContent ?? "", /Synthetic-Only-Password|internal transport detail|backend stack detail/u);
  const button = b.dom.window.document.querySelector<HTMLButtonElement>('button[type="submit"]');
  assert.ok(button);
  assert.equal(button.disabled, false, "the submit button must be usable again");
  assert.equal(button.textContent, "Se connecter");
  assert.equal(b.uncaught.length, 0, "request failures must not escape the form");
}

test("a rejected login fetch shows a generic error and permits a deliberate retry", async (t) => {
  const b = await browser(t);
  const requests: Array<{ target: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ target: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ...(init ? { init } : {}) });
    return requests.length === 1 ? Promise.reject(new Error("internal transport detail")) : Promise.resolve(new Response(null, { status: 401 }));
  });
  b.submit();
  await b.settle();
  assertRetryAvailable(b);
  b.submit();
  await b.settle();
  assertRetryAvailable(b);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.target, "/api/crm/sessions");
    assert.equal(request.init?.method, "POST");
    assert.equal(request.init?.credentials, "same-origin");
    assert.deepEqual(request.init?.headers, { "content-type": "application/json" });
    assert.equal(typeof request.init?.body, "string");
    assert.deepEqual(JSON.parse(request.init?.body as string), { email: "synthetic@example.invalid", password: "Synthetic-Only-Password!9" });
  }
});

test("an invalid session JSON response is generic and never locks submission", async (t) => {
  const b = await browser(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { requests += 1; return Promise.resolve(new Response("backend stack detail", { status: 200, headers: { "content-type": "application/json" } })); });
  b.submit();
  await b.settle();
  assertRetryAvailable(b);
  b.submit();
  await b.settle();
  assert.equal(requests, 2);
  assertRetryAvailable(b);
});

test("concurrent submissions send one request, then allow retry after an explicit refusal", async (t) => {
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
  assert.equal(requests, 1, "a second submit while the first request is pending must not issue another session request");
  assert.equal(b.form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
  b.interact(() => resolveRequest(new Response(null, { status: 403 })));
  await b.settle();
  assertRetryAvailable(b);
  b.submit();
  await b.settle();
  assert.equal(requests, 2);
  b.interact(() => resolveRequest(new Response(null, { status: 401 })));
  await b.settle();
  assertRetryAvailable(b);
});

test("persistent labels, password visibility, Caps Lock and keyboard-focusable controls remain available", async (t) => {
  const b = await browser(t);
  const email = b.form.querySelector<HTMLInputElement>('input[name="email"]')!;
  assert.equal(b.form.method, "post", "a native submission without hydration must never put credentials in the URL");
  const password = b.form.querySelector<HTMLInputElement>('input[name="password"]')!;
  assert.equal(email.closest("label")?.textContent, "Email professionnel");
  assert.match(password.closest("label")?.textContent ?? "", /Mot de passe/u);
  assert.equal(email.required, true);
  assert.equal(password.required, true);
  assert.equal(password.autocomplete, "current-password");
  assert.equal(password.type, "password");
  const toggle = b.form.querySelector<HTMLButtonElement>('[aria-label="Afficher le mot de passe"]')!;
  toggle.focus();
  assert.equal(b.dom.window.document.activeElement, toggle);
  b.interact(() => toggle.click());
  await b.settle();
  assert.equal(password.type, "text");
  assert.ok(b.form.querySelector('[aria-label="Masquer le mot de passe"]'));
  const caps = new b.dom.window.KeyboardEvent("keydown", { key: "A", bubbles: true });
  Object.defineProperty(caps, "getModifierState", { value: (key: string): boolean => key === "CapsLock" });
  b.interact(() => { password.dispatchEvent(caps); });
  await b.settle();
  assert.match(b.form.querySelector('[role="status"]')?.textContent ?? "", /Verr\. Maj\. est activé/u);
});

for (const [mustChangeSecret, path] of [[true, "/first-login"], [false, "/leads"]] as const) {
  test(`a successful server session preserves the ${path} redirect`, async (t) => {
    const b = await browser(t);
    t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ mustChangeSecret })));
    b.submit();
    await b.settle();
    assert.deepEqual(b.navigation, [path]);
    assert.equal(b.dom.window.document.querySelector('[role="alert"]'), null);
    assert.equal(b.uncaught.length, 0);
  });
}
