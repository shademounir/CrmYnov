import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import CommercialPerformancePage from "../app/manager/reports/commercial-performance/page.js";
import React from "react";
import { JSDOM } from "jsdom";
import PerformanceReport, { readPerformance, PerformanceResults, performanceEndpoint } from "../app/manager/reports/commercial-performance/performance.js";

test("renders explicit operational KPIs, filters and non-disciplinary safeguards", async () => {
  const html = renderToStaticMarkup(await CommercialPerformancePage({}));
  for (const expected of ["Performance et activité", "Leads principaux", "contributions secondaires", "Charge active",
    "Africa/Casablanca", "divisions par zéro", "ne doublonnent jamais", "score opaque", "Chargement du portefeuille"])
    assert.match(html, new RegExp(expected, "i"));
  assert.equal(html.includes("@example."), false);
  assert.match(html, /Historiques non datés, dossiers jamais traités et clôturés exclus/u);
  assert.match(html, /affectations et écritures techniques ne rajeunissent pas/u);
  assert.doesNotMatch(html, /Sans interaction|Inactivité après/u);
});

function fixture(): Record<string, unknown> {
  const acquisition = { definitionVersion: "acquisition-cohort-v1", periodDateBasis: "STORED_CREATED_AT_NOT_HISTORICAL_RECEPTION", newAcquisitionCount: 1, baselinePortfolioCount: 2 };
  return { definitionVersion: "commercial-performance-v1", timezone: "Africa/Casablanca", generatedAt: "2026-10-19T12:00:00.000Z", cohort: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-19T12:00:00.000Z", inactivityHours: 72, uniqueLeadCount: 3 }, acquisition,
    advisers: [{ adviserId: "owner-a", adviserLabel: "Conseiller synthétique", primaryLeadCount: 3, secondaryLeadCount: 1, activeLoad: 2, inactiveLeadCount: 1, acquisition,
      statusVolumes: { contacted: 2, qualified: 1, enrolled: 1, closedLost: 0 }, rates: { contact: 0.6667, qualification: 0.3333, enrollment: 0.3333, loss: 0 },
      followUps: { planned: 2, overdue: 1, dueNow: 1, invalidDeadline: 1, active: 5, completed: 4, cancelled: 2 },
      drillDown: { assigned: "/leads?assignedToId=owner-a&source=WEB_FORM", overdue: "/manager/reports/commercial-work?queue=OVERDUE_FOLLOW_UP&taskOwnerId=owner-a&source=WEB_FORM", inactive: "/leads?assignedToId=owner-a&portfolioState=OPEN&inactiveTreatmentBefore=2026-10-16T12%3A00%3A00.000Z&source=WEB_FORM" } }] };
}
test("performance contract separates portfolio and task units, rejects missing counts, unsafe or mismatched links", () => {
  const data = readPerformance(fixture()), html = renderToStaticMarkup(React.createElement(PerformanceResults, { data }));
  for (const expected of ["Conseiller synthétique", "Contributions secondaires", "Relances en retard", "Traitements datés anciens", "2 / 3", "66,67", "4 actions", "Annulées", "Échues à cet instant", "pas des dossiers distincts", "historique", "ne mesure pas le travail effectué aujourd’hui"]) assert.ok(html.includes(expected), expected);
  assert.ok(html.includes("taskOwnerId=owner-a&amp;source=WEB_FORM")); assert.ok(!html.includes("owner-a</h3>"));
  assert.ok(html.includes('class="pipeline-lead-cards"')); assert.ok(!html.includes('class="pipeline-panel"'));
  for (const mutate of [
    (row: Record<string, unknown>): void => { row.activeLoad = undefined; },
    (row: Record<string, unknown>): void => { (row.followUps as Record<string, unknown>).active = 6; },
    (row: Record<string, unknown>): void => { (row.rates as Record<string, unknown>).contact = 1; },
    (row: Record<string, unknown>): void => { (row.drillDown as Record<string, unknown>).overdue = "https://evil.invalid"; },
    (row: Record<string, unknown>): void => { (row.drillDown as Record<string, unknown>).assigned = "/leads?assignedToId=other"; },
    (row: Record<string, unknown>): void => { (row.drillDown as Record<string, unknown>).inactive = "/leads?assignedToId=owner-a&portfolioState=OPEN&inactiveTreatmentBefore=2026-10-15T12:00:00.000Z"; },
  ]) {
    const raw = fixture(); mutate((raw.advisers as Record<string, unknown>[])[0]!); assert.throws(() => readPerformance(raw));
  }
  const raw = fixture(), row = (raw.advisers as Record<string, unknown>[])[0]!;
  row.primaryLeadCount = 0; row.activeLoad = 0; row.inactiveLeadCount = 0;
  row.acquisition = { ...(row.acquisition as object), newAcquisitionCount: 0, baselinePortfolioCount: 0 };
  row.statusVolumes = { contacted: 0, qualified: 0, enrolled: 0, closedLost: 0 }; row.rates = { contact: null, qualification: null, enrollment: null, loss: null };
  const ownerOnly = renderToStaticMarkup(React.createElement(PerformanceResults, { data: readPerformance(raw) }));
  assert.ok(ownerOnly.includes("Non calculable")); assert.ok(ownerOnly.includes("1 actions strictement en retard"));
});
test("performance first query and GET form preserve cohort, personal scope and repeated invalid parameters without broadening", async () => {
  const query = "view=personal&adviserId=owner-a&source=WEB_FORM&treatmentState=DATED&treatmentFrom=2026-10-01&from=2026-10-01T00%3A00%3A00Z&to=2026-10-19T12%3A00%3A00Z&period=custom&returnTo=%2Fmanager&status=CONTACTED&status=QUALIFIED";
  const endpoint = new URL(performanceEndpoint(query), "https://example.invalid");
  assert.equal(endpoint.pathname, "/api/crm/reports/commercial-performance"); assert.ok(!endpoint.searchParams.has("returnTo"));
  assert.deepEqual(endpoint.searchParams.getAll("status"), ["CONTACTED", "QUALIFIED"]);
  const params: Record<string, string | string[]> = {}; for (const key of new Set(new URLSearchParams(query).keys())) { const all = new URLSearchParams(query).getAll(key); params[key] = all.length === 1 ? all[0]! : all; }
  const dom = new JSDOM(renderToStaticMarkup(await CommercialPerformancePage({ searchParams: Promise.resolve(params) })));
  const form = dom.window.document.querySelector("form")!, fields = new URLSearchParams([...new dom.window.FormData(form).entries()] as [string, string][]);
  for (const key of ["view", "adviserId", "source", "treatmentState", "treatmentFrom", "from", "to", "period"]) assert.equal(fields.get(key), endpoint.searchParams.get(key));
  assert.deepEqual(fields.getAll("status"), ["CONTACTED", "QUALIFIED"]); dom.window.close();
});
test("performance loads authorized report, clears on query/session/rights/invalid contract, and bounds a hanging request", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.invalid" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"), { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root")!, root = createRoot(host);
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  let mode = "ready"; const requested: string[] = []; let timeout: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (path: string): Promise<Response> => {
    requested.push(path); await Promise.resolve();
    if (mode === "hang") return new Promise<Response>(() => {});
    if (["401", "403", "400"].includes(mode)) return Response.json({}, { status: Number(mode) });
    return Response.json(mode === "invalid" ? { advisers: [] } : fixture());
  });
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
    if (delay === 15_000) timeout = callback;
    return originalTimeout(callback, delay);
  }) as typeof setTimeout);
  const render = async (query: string): Promise<void> => { await act(async () => { root.render(React.createElement(PerformanceReport, { query })); await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  await render("view=personal&source=WEB_FORM&returnTo=%2Fmanager"); assert.match(host.textContent ?? "", /Conseiller synthétique/u);
  assert.equal(requested[0], "/api/crm/reports/commercial-performance?view=personal&source=WEB_FORM");
  for (const [value, expected] of [["401", "Session expirée"], ["403", "pas accessible"], ["400", "Filtres invalides"], ["invalid", "Aucun compteur affiché"]]) {
    mode = value!; await render(`source=${value}`); assert.ok(host.textContent?.includes(expected!)); assert.ok(!host.textContent?.includes("Conseiller synthétique"));
  }
  mode = "ready"; await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); await new Promise<void>((resolve) => setImmediate(resolve)); }); assert.ok(host.textContent?.includes("Conseiller synthétique"));
  mode = "hang"; await render("source=HANG"); assert.ok(!host.textContent?.includes("Conseiller synthétique"));
  await act(async () => { timeout!(); await Promise.resolve(); }); assert.match(host.textContent ?? "", /15 secondes/u);
});
