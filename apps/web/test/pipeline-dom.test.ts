import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const snapshot = {
  definitionVersion: "commercial-funnel-v1", timezone: "Africa/Casablanca", generatedAt: "2026-09-15T08:00:00.000Z",
  cohort: { totalUniqueLeads: 10 },
  currentState: { PROSPECT: 7, CONTACTED: 1, QUALIFIED: 2, ENROLLED: 0, CLOSED_LOST: 0 },
  temperatureDistribution: { UNEVALUATED: 7, COLD: 1, WARM: 0, HOT: 2 },
};

test("Pipeline renders API-confirmed values, keeps URL context and distinguishes empty, loading and unavailable states", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/manager/reports/commercial-funnel" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Pipeline } = await import("../app/manager/reports/commercial-funnel/pipeline");
  const host = dom.window.document.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => { root.unmount(); await Promise.resolve(); });
    dom.window.close();
    for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  });
  let mode: "ready" | "empty" | "session" = "ready";
  let requested = "";
  let firstRequest = true;
  let releaseInitial: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (path: string): Promise<Response> => {
    requested = path;
    if (firstRequest) {
      firstRequest = false;
      await new Promise<void>((resolve) => { releaseInitial = resolve; });
    }
    await Promise.resolve();
    if (mode === "session") return Response.json({ code: "authentication_required" }, { status: 401 });
    if (mode === "empty") return Response.json({ ...snapshot, cohort: { totalUniqueLeads: 0 }, currentState: { PROSPECT: 0, CONTACTED: 0, QUALIFIED: 0, ENROLLED: 0, CLOSED_LOST: 0 }, temperatureDistribution: { UNEVALUATED: 0, COLD: 0, WARM: 0, HOT: 0 } });
    return Response.json(snapshot);
  });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  act(() => { root.render(createElement(Pipeline, { initialFilters: {} })); });
  assert.match(dom.window.document.body.textContent ?? "", /Chargement du Pipeline/u);
  assert.ok(releaseInitial); releaseInitial();
  await settle();
  const text = dom.window.document.body.textContent ?? "";
  for (const expected of ["10", "Prospects", "7", "Contactés", "1", "Qualifiés", "2", "Non évalué", "Froid", "Chaud", "Quatre dimensions indépendantes"]) assert.match(text, new RegExp(expected, "u"));
  assert.equal(requested, "/api/crm/reports/commercial-funnel?");
  const prospectLink = [...dom.window.document.querySelectorAll<HTMLAnchorElement>("a")].find((item) => item.href.includes("status=PROSPECT"));
  assert.ok(prospectLink); assert.match(prospectLink.href, /\/leads\?status=PROSPECT&returnTo=%2Fmanager%2Freports%2Fcommercial-funnel$/u);

  const form = dom.window.document.querySelector("form"); assert.ok(form);
  const from = form.querySelector<HTMLInputElement>('input[name="from"]'); assert.ok(from); from.value = "2026-09-01";
  mode = "empty";
  act(() => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
  assert.equal(dom.window.location.search, "?from=2026-09-01");
  assert.match(dom.window.document.body.textContent ?? "", /0 lead confirmé par l’API/u);

  mode = "session";
  const refresh = dom.window.document.querySelector<HTMLButtonElement>('form button[type="submit"]'); assert.ok(refresh);
  act(() => { refresh.click(); }); await settle();
  const sessionText = dom.window.document.body.textContent ?? "";
  assert.match(sessionText, /session a expiré/u);
  assert.match(sessionText, /Aucun compteur n’est affiché/u);
  assert.ok([...dom.window.document.querySelectorAll<HTMLAnchorElement>("a")].some((item) => item.textContent === "Se reconnecter" && item.pathname === "/"));

  mode = "ready";
  act(() => {
    dom.window.history.pushState(null, "", "?source=WEB_FORM");
    dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
  });
  await settle();
  assert.equal(requested, "/api/crm/reports/commercial-funnel?source=WEB_FORM");
  assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[name="source"]')?.value, "WEB_FORM");
});

test("Pipeline direct navigation and applying filters preserve the Dashboard cohort until dates are explicitly edited", async (t) => {
  const filters = { from: "2026-10-01T08:14:27.000Z", to: "2026-10-05T09:42:18.000Z", campus: "CAMPUS-SYNTHETIC", source: "SYNTHETIC", channel: "DIGITAL", adviserId: "adviser-synthetic", status: "QUALIFIED" };
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: `https://dev.example.invalid/manager/reports/commercial-funnel?${new URLSearchParams(filters)}` });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Pipeline } = await import("../app/manager/reports/commercial-funnel/pipeline");
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close();
    for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  });
  const requested: URL[] = [];
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => { requested.push(new URL(path, dom.window.location.origin)); return Promise.resolve(Response.json(snapshot)); });
  await act(async () => { root.render(createElement(Pipeline, { initialFilters: { campus: filters.campus } })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  for (const [key, value] of Object.entries(filters)) assert.equal(requested.at(-1)!.searchParams.get(key), value);
  let form = host.querySelector<HTMLFormElement>("form")!;
  let values = new dom.window.FormData(form);
  for (const [key, value] of Object.entries(filters)) assert.deepEqual(values.getAll(key), [value], "submit each original boundary or scope exactly once");
  const dates = form.querySelectorAll<HTMLInputElement>('input[type="date"]');
  assert.equal(dates[0]?.value, "2026-10-01"); assert.equal(dates[1]?.value, "2026-10-05");
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const applied = new URL(dom.window.location.href);
  for (const [key, value] of Object.entries(filters)) assert.equal(applied.searchParams.get(key), value);
  for (const [key, value] of Object.entries(filters)) assert.equal(requested.at(-1)!.searchParams.get(key), value);
  const allLeadsLink = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent?.includes("Voir les leads"));
  assert.ok(allLeadsLink);
  const allLeads = new URL(allLeadsLink.href);
  assert.equal(allLeads.searchParams.get("createdBefore"), filters.to);
  assert.equal(allLeads.searchParams.get("adviserId"), filters.adviserId);
  assert.equal(allLeads.searchParams.get("channel"), filters.channel);
  assert.equal(allLeads.searchParams.get("status"), filters.status);
  form = host.querySelector<HTMLFormElement>("form")!;
  const from = form.querySelector<HTMLInputElement>('input[type="date"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(from, "2026-10-02");
    from.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    from.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  values = new dom.window.FormData(form);
  assert.deepEqual(values.getAll("from"), ["2026-10-02"]);
  assert.deepEqual(values.getAll("to"), [filters.to]);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(requested.at(-1)!.searchParams.get("from"), "2026-10-02");
  assert.equal(requested.at(-1)!.searchParams.get("to"), filters.to);
});
