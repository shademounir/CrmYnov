import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

async function environment(t: test.TestContext): Promise<{ dom: JSDOM; host: HTMLElement; act: typeof import("react").act; render: (leadId?: string, assigned?: boolean) => Promise<void> }> {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/synthetic/collaborators" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, DOMException: dom.window.DOMException, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AssignmentWorkflowForm } = await import("../app/leads/[leadId]/lead-workflow-forms.js");
  const host = dom.window.document.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async (): Promise<void> => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  async function render(leadId = "lead-synthetic", assigned = false): Promise<void> {
    await act(async () => {
      root.render(createElement(AssignmentWorkflowForm, { leadId, assigned }));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
  return { dom, host, act, render };
}

for (const assigned of [false, true]) {
  test(`server403 is permission refusal, not unavailable advisers; assigned=${assigned}`, async (t) => {
    const { host, render } = await environment(t); let writes = 0;
    t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST") writes++;
      return Promise.resolve(url.endsWith("assignment-candidates") ? Response.json({ code: "permission_denied" }, { status: 403 }) : Response.json({ requests: [] }));
    });
    await render("lead-synthetic", assigned);
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", assigned ? /pas autorisé.*réaffectation.*reste inchangé/u : /pas autorisé.*affectation initiale.*reste à affecter/u);
    assert.match(host.textContent ?? "", /Responsable ou Administrateur autorisé.*campus/u);
    assert.doesNotMatch(host.textContent ?? "", /conseillers éligibles sont indisponibles/u);
    assert.equal(host.querySelector("form"), null); assert.equal(host.querySelector("select"), null); assert.equal(writes, 0);
  });
}

test("401 candidates offer reconnection without proposing a mutation", async (t) => {
  const { host, render } = await environment(t);
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 401 })));
  await render(); assert.match(host.textContent ?? "", /session a expiré/u);
  assert.equal(host.querySelector('a[href="/"]')?.textContent, "Se reconnecter"); assert.equal(host.querySelector("form"), null);
});

for (const status of [401, 403]) {
  test(`assigned Lead with both reads${status} retains the precise access verdict`, async (t) => {
    const { host, render } = await environment(t);
    t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status })));
    await render("lead-synthetic", true);
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", status === 401 ? /session a expiré/u : /pas autorisé.*réaffectation/u);
    assert.doesNotMatch(host.textContent ?? "", /demandes enregistrées sont indisponibles/u);
    assert.equal(host.querySelector("form"), null);
    if (status === 401) assert.equal(host.querySelector('a[href="/"]')?.textContent, "Se reconnecter");
  });
}

test("503 remains service unavailability with disabled actions, not a permission verdict", async (t) => {
  const { host, render } = await environment(t);
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 503 })));
  await render(); assert.match(host.textContent ?? "", /conseillers éligibles sont indisponibles/u);
  assert.doesNotMatch(host.textContent ?? "", /pas autorisé/u);
  for (const button of host.querySelectorAll<HTMLButtonElement>('button[type="submit"], button.secondary-button')) assert.equal(button.disabled, true);
});

test("empty200 is no eligible advisers, not permission or transport failure", async (t) => {
  const { host, render } = await environment(t);
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ candidates: [] })));
  await render(); assert.equal(host.querySelector('[role="alert"]'), null);
  assert.match(host.querySelector("select")?.textContent ?? "", /Aucun conseiller disponible/u);
});

test("late candidates from an old Lead cannot override the new Lead's403", async (t) => {
  const { host, render, act } = await environment(t);
  let resolveOld: (response: Response) => void = (): void => { throw Error("old request not captured"); };
  t.mock.method(globalThis, "fetch", (url: string): Promise<Response> => url.includes("lead-old")
    ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(new Response(null, { status: 403 })));
  await render("lead-old"); await render("lead-new");
  await act(async () => { resolveOld(Response.json({ candidates: [{ id: "target-old", label: "Ancien conseiller", activeLeadCount: 0, capacity: 4 }] })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.match(host.textContent ?? "", /pas autorisé/u); assert.equal(host.querySelector("select"), null); assert.doesNotMatch(host.textContent ?? "", /Ancien conseiller/u);
});

test("ownership change rereads resource permission rather than reusing initial403", async (t) => {
  const { host, render } = await environment(t); let candidateReads = 0;
  t.mock.method(globalThis, "fetch", (url: string): Promise<Response> => {
    if (!url.endsWith("assignment-candidates")) return Promise.resolve(Response.json({ requests: [] }));
    candidateReads++; return Promise.resolve(candidateReads === 1 ? new Response(null, { status: 403 }) : Response.json({ candidates: [{ id: "target-synthetic", label: "Conseiller autorisé", activeLeadCount: 0, capacity: 4 }] }));
  });
  await render("lead-synthetic", false); assert.equal(host.querySelector("form"), null);
  await render("lead-synthetic", true); assert.equal(candidateReads, 2);
  assert.match(host.textContent ?? "", /Conseiller autorisé/u); assert.ok(host.querySelector("form"));
});
