import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

async function mount(t: TestContext): Promise<{ host: HTMLElement; root: import("react-dom/client").Root; act: typeof import("react").act; createElement: typeof import("react").createElement; dom: JSDOM }> {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement,
    FormData: dom.window.FormData, DOMException: dom.window.DOMException, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async () => {
    await act<void>(() => root.unmount()); dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { host, root, act, createElement, dom };
}

const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
const requestUrl = (input: string | URL | Request): string => typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
const props = { endpoint: "/api/crm/leads?page=1&pageSize=25", ariaLabel: "Leads", emptyMessage: "Aucun lead filtré." };

test("list handles 401, 403, 503 and network failures distinctly without exposing a fabricated empty result", async (t) => {
  const cases = [
    { status: 401, expected: "Session expirée" }, { status: 403, expected: "Accès refusé" },
    { status: 503, expected: "Service CRM indisponible" }, { status: 0, expected: "Connexion réseau impossible" },
  ];
  for (const row of cases) await t.test(row.expected, async (child) => {
    const { host, root, act, createElement } = await mount(child);
    const { LeadDirectory } = await import("../app/leads/lead-directory.js");
    child.mock.method(globalThis, "fetch", () => row.status ? Promise.resolve(Response.json({}, { status: row.status })) : Promise.reject(new TypeError("Failed to fetch")));
    await act(async () => { root.render(createElement(LeadDirectory, props)); await flush(); });
    assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", new RegExp(row.expected));
    assert.equal(host.querySelector("table"), null);
    assert.notEqual(host.querySelector("h2")?.textContent, "Aucun résultat");
    assert.equal(host.querySelector('.lead-list-pagination'), null);
    if (row.status === 401) assert.equal(host.querySelector("a")?.getAttribute("href"), "/");
  });
});

test("retry only rereads the list and displays the confirmed server count", async (t) => {
  const { host, root, act, createElement } = await mount(t);
  const { LeadDirectory } = await import("../app/leads/lead-directory.js");
  let calls = 0;
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method ?? "GET", "GET"); calls++;
    return Promise.resolve(calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ items: [{ id: "synthetic", leadCode: "LD-SYN" }], page: 1, pageSize: 25, total: 64 }));
  });
  await act(async () => { root.render(createElement(LeadDirectory, props)); await flush(); });
  const retry = host.querySelector<HTMLButtonElement>("button"); assert.ok(retry);
  await act(async () => { retry.click(); await flush(); });
  assert.equal(calls, 2);
  assert.ok(host.querySelector("table"));
  assert.match(host.textContent ?? "", /1–1 sur 64 résultats · Page 1 sur 3/u);
});

test("relative list requests and pagination retain encoded query context without navigating to the parsing base", async (t) => {
  const { host, root, act, createElement } = await mount(t);
  const { LeadDirectory } = await import("../app/leads/lead-directory.js");
  const query = new URLSearchParams({
    page: "2", pageSize: "50", view: "MINE", savedView: "LEGACY_RELAUNCH", sharedViewId: "shared-synthetic",
    collaboratorId: "collaborator-synthetic", sortBy: "lastName", sortDirection: "desc", search: "A+B & Noor#? é",
    createdFrom: "2026-09-01T10:15:00.000Z", createdTo: "2026-09-30T18:45:00.000Z", createdBefore: "2026-10-01T00:00:00.000Z",
    returnTo: "/manager/reports/dashboard?period=30d&source=YNOV_COM#cohorte",
  });
  const endpoint = `/api/crm/leads?${query.toString()}`;
  let calls = 0;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(requestUrl(input), endpoint);
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return Promise.resolve(Response.json({ items: [{ id: "synthetic-lead", leadCode: "LD-SYN" }], page: 2, pageSize: 50, total: 151 }));
  });
  await act(async () => { root.render(createElement(LeadDirectory, { ...props, endpoint })); await flush(); });
  assert.equal(calls, 1);
  for (const [relation, page] of [["prev", "1"], ["next", "3"]]) {
    const href = host.querySelector(`a[rel="${relation}"]`)?.getAttribute("href"); assert.ok(href);
    assert.match(href, /^\/leads\?/u);
    const actual = new URL(href, "https://example.invalid");
    const expected = new URLSearchParams(query); expected.set("page", page);
    assert.deepEqual([...actual.searchParams], [...expected]);
    assert.equal(actual.origin, "https://example.invalid");
    assert.equal(actual.hash, "");
  }
});

test("missing pagination metadata is reported as an invalid server response, not an empty directory", async (t) => {
  const { host, root, act, createElement } = await mount(t);
  const { LeadDirectory } = await import("../app/leads/lead-directory.js");
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ items: [] })));
  await act(async () => { root.render(createElement(LeadDirectory, props)); await flush(); });
  assert.match(host.textContent ?? "", /Le serveur n’a pas fourni une liste valide/u);
  assert.notEqual(host.querySelector("h2")?.textContent, "Aucun résultat");
  assert.equal(host.querySelector('.lead-list-pagination'), null);
});

test("late results from a previous filter cannot overwrite a new forbidden response", async (t) => {
  const { host, root, act, createElement } = await mount(t);
  const { LeadDirectory } = await import("../app/leads/lead-directory.js");
  let releaseOld: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request) => requestUrl(input).includes("old")
    ? new Promise<Response>((resolve) => { releaseOld = resolve; }) : Promise.resolve(Response.json({}, { status: 403 })));
  await act(async () => { root.render(createElement(LeadDirectory, { ...props, endpoint: `${props.endpoint}&search=old` })); await flush(); });
  await act(async () => { root.render(createElement(LeadDirectory, { ...props, endpoint: `${props.endpoint}&search=new` })); await flush(); });
  assert.ok(releaseOld);
  await act(async () => { releaseOld?.(Response.json({ items: [{ id: "old", firstName: "Old prospect" }], page: 1, pageSize: 25, total: 1 })); await flush(); });
  assert.match(host.textContent ?? "", /Accès refusé/u);
  assert.doesNotMatch(host.textContent ?? "", /Old prospect/u);
  assert.equal(host.querySelector("table"), null);
});

test("an out-of-range page retains the server total and offers the first page", async (t) => {
  const { host, root, act, createElement } = await mount(t);
  const { LeadDirectory } = await import("../app/leads/lead-directory.js");
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ items: [], page: 7, pageSize: 25, total: 1 })));
  await act(async () => { root.render(createElement(LeadDirectory, { ...props, endpoint: "/api/crm/leads?page=7&pageSize=25&collaboratorId=synthetic&savedView=YNOV_COM" })); await flush(); });
  assert.match(host.textContent ?? "", /Aucun résultat sur cette page/u);
  assert.match(host.textContent ?? "", /0–0 sur 1 résultat/u);
  const first = new URL([...host.querySelectorAll("a")].find((link) => link.textContent === "Première page")?.getAttribute("href") ?? "", "http://crm.test").searchParams;
  assert.equal(first.get("page"), "1");
  assert.equal(first.get("collaboratorId"), "synthetic");
  assert.equal(first.get("savedView"), "YNOV_COM");
});

test("saving a private view retains pageSize while omitting the current page and shared token", async (t) => {
  const { host, root, act, createElement, dom } = await mount(t);
  const { SavedViews } = await import("../app/leads/saved-views.js");
  let saved: { name: string; filters: Record<string, string> } | undefined;
  t.mock.method(globalThis, "fetch", (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      assert.equal(typeof init.body, "string");
      saved = JSON.parse(init.body as string) as { name: string; filters: Record<string, string> };
      return Promise.resolve(Response.json({ id: "view-synthetic", ...saved, version: 1 }));
    }
    return Promise.resolve(Response.json([]));
  });
  await act(async () => { root.render(createElement(SavedViews, { current: { status: "CONTACTED", pageSize: "50", page: "7", sharedViewId: "shared-synthetic", sortDirection: "asc" } })); await flush(); });
  const name = host.querySelector<HTMLInputElement>("#saved-view-name"); assert.ok(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(name, "Vue synthétique");
    name.dispatchEvent(new dom.window.Event("input", { bubbles: true })); await flush();
  });
  const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Enregistrer la vue"); assert.ok(save);
  assert.equal(save.disabled, false);
  await act(async () => { save.click(); await flush(); });
  assert.deepEqual(saved, { name: "Vue synthétique", filters: { status: "CONTACTED", pageSize: "50", sortDirection: "asc" } });
});

test("creation is hidden until the authenticated server explicitly grants canCreateLead", async (t) => {
  const cases = [
    { value: { canCreateLead: true }, status: 200, shown: true },
    { value: { canCreateLead: false }, status: 200, shown: false },
    { value: { canCreateLead: "true" }, status: 200, shown: false },
    { value: {}, status: 200, shown: false }, { value: {}, status: 401, shown: false },
    { value: {}, status: 403, shown: false }, { value: {}, status: 503, shown: false },
    { value: {}, status: 0, shown: false },
  ];
  for (const [index, row] of cases.entries()) await t.test(`capability response ${index + 1}`, async (child) => {
    const { host, root, act, createElement } = await mount(child);
    const { LeadCreateAccess } = await import("../app/leads/lead-create-access.js");
    let release: ((response: Response) => void) | undefined;
    child.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(requestUrl(input), "/api/crm/reports/dashboard/capabilities");
      assert.equal(init?.method ?? "GET", "GET");
      return row.status ? new Promise<Response>((resolve) => { release = resolve; }) : Promise.reject(new TypeError("offline"));
    });
    await act(async () => { root.render(createElement(LeadCreateAccess)); await flush(); });
    assert.equal(host.querySelector("button"), null);
    if (release) await act(async () => { release?.(Response.json(row.value, { status: row.status })); await flush(); });
    assert.equal(Boolean(host.querySelector("button")), row.shown);
    if (row.shown) assert.match(host.textContent ?? "", /Nouveau Lead/u);
  });
});
