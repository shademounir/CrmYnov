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

function assertUncertain(b: Awaited<ReturnType<typeof browser>>): void {
  assert.match(b.form.textContent ?? "", /Vérifiez votre session avant de renvoyer vos identifiants/u);
  assert.equal(b.form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
  assert.doesNotMatch(b.form.textContent ?? "", /Synthetic-Only-Password|internal transport detail|backend stack detail/u);
  assert.equal(b.uncaught.length, 0);
}

function checkSession(b: Awaited<ReturnType<typeof browser>>): void {
  const button = Array.from(b.form.querySelectorAll("button")).find((item) => item.textContent === "Vérifier ma session");
  assert.ok(button);
  b.interact(() => button.click());
}

test("a rejected login fetch checks the current session before a deliberate credential retry", async (t) => {
  const b = await browser(t);
  const requests: Array<{ target: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ target: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ...(init ? { init } : {}) });
    return requests.length === 1 ? Promise.reject(new Error("internal transport detail")) : Promise.resolve(new Response(null, { status: 401 }));
  });
  b.submit();
  await b.settle();
  assertUncertain(b);
  b.submit();
  await b.settle();
  assert.equal(requests.length, 1, "uncertain login must never be automatically or manually replayed before checking");
  checkSession(b);
  await b.settle();
  assertRetryAvailable(b);
  assert.equal(requests[1]?.target, "/api/crm/sessions/current");
  assert.equal(requests[1]?.init?.body, undefined);
  assert.equal(requests[1]?.init?.cache, "no-store");
  b.submit();
  await b.settle();
  assertRetryAvailable(b);
  assert.equal(requests.length, 3);
  for (const request of [requests[0]!, requests[2]!]) {
    assert.equal(request.target, "/api/crm/sessions");
    assert.equal(request.init?.method, "POST");
    assert.equal(request.init?.credentials, "same-origin");
    assert.deepEqual(request.init?.headers, { "content-type": "application/json" });
    assert.equal(typeof request.init?.body, "string");
    assert.deepEqual(JSON.parse(request.init?.body as string), { email: "synthetic@example.invalid", password: "Synthetic-Only-Password!9" });
  }
});

test("invalid session JSON requires a read-only session check without leaking the response", async (t) => {
  const b = await browser(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => { requests += 1; return Promise.resolve(input === "/api/crm/sessions/current" ? new Response(null, { status: 401 }) : new Response("backend stack detail", { status: 200, headers: { "content-type": "application/json" } })); });
  b.submit();
  await b.settle();
  assertUncertain(b);
  b.submit();
  await b.settle();
  assert.equal(requests, 1);
  checkSession(b);
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

test("a stalled login is bounded, ignores a late success and resumes only through a read-only session check", async (t) => {
  const b = await browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveLogin!: (value: Response) => void;
  let posts = 0;
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (input === "/api/crm/sessions/current") {
      assert.equal(init?.body, undefined);
      assert.equal(init?.cache, "no-store");
      return Promise.resolve(Response.json({ mustChangeSecret: false }));
    }
    posts += 1;
    signal = init?.signal;
    return new Promise<Response>((resolve) => { resolveLogin = resolve; });
  });
  b.submit();
  await b.settle();
  t.mock.timers.tick(20_000);
  await b.settle();
  assertUncertain(b);
  assert.equal(signal?.aborted, true);
  b.interact(() => resolveLogin(Response.json({ mustChangeSecret: true })));
  await b.settle();
  assert.deepEqual(b.navigation, [], "late login responses cannot redirect or override a newer result");
  checkSession(b);
  await b.settle();
  assert.equal(posts, 1);
  assert.deepEqual(b.navigation, ["/leads"]);
  assert.equal(b.form.querySelector("a[href='/leads']")?.textContent, "Ouvrir mon espace CRM");
  b.submit();
  assert.equal(posts, 1, "confirmed session never replays credentials even if browser navigation is delayed");
});

test("the session deadline also covers a stalled successful JSON body", async (t) => {
  const b = await browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = Response.json({ mustChangeSecret: false });
  t.mock.method(response, "json", (): Promise<never> => new Promise<never>(() => undefined));
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(response));
  b.submit();
  await b.settle();
  t.mock.timers.tick(20_000);
  await b.settle();
  assertUncertain(b);
  assert.deepEqual(b.navigation, []);
});

test("a session check that stalls or is forbidden never unlocks another credential submission", async (t) => {
  const b = await browser(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let posts = 0;
  let reads = 0;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request): Promise<Response> => {
    if (input === "/api/crm/sessions/current") {
      reads += 1;
      return reads === 1 ? new Promise<never>(() => undefined) : Promise.resolve(new Response(null, { status: 403 }));
    }
    posts += 1;
    return Promise.reject(new Error("internal transport detail"));
  });
  b.submit();
  await b.settle();
  checkSession(b);
  await b.settle();
  b.submit();
  t.mock.timers.tick(20_000);
  await b.settle();
  assertUncertain(b);
  checkSession(b);
  await b.settle();
  assertUncertain(b);
  b.submit();
  assert.equal(posts, 1);
  assert.equal(reads, 2);
  assert.deepEqual(b.navigation, []);
});

test("confirmed login renders a safe resume link instead of an endless navigation spinner", async (t) => {
  const b = await browser(t);
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ mustChangeSecret: false })));
  b.submit();
  await b.settle();
  assert.match(b.form.textContent ?? "", /Connexion confirmée/u);
  assert.doesNotMatch(b.form.textContent ?? "", /Connexion…/u);
  assert.equal(b.form.querySelector("a[href='/leads']")?.textContent, "Ouvrir mon espace CRM");
});

test("a successful reconnection resumes a safe internal URL and rejects unsafe return targets", async () => {
  const { loginRedirectPath } = await import("../app/_components/login-form.js");
  assert.equal(loginRedirectPath("?returnTo=%2Fleads%3Fview%3DMINE%26page%3D4%23results"), "/leads?view=MINE&page=4#results");
  for (const unsafe of ["https://attacker.invalid/leads", "//attacker.invalid/leads", "/api/private", "/first-login", "/\\attacker.invalid"]) {
    assert.equal(loginRedirectPath(`?returnTo=${encodeURIComponent(unsafe)}`), "/leads");
  }
});
