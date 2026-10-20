import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import CommercialWork, { parseWorkReport, workApiEndpoint, workCohortQuery } from "../app/manager/reports/commercial-work/work";
import { preserveFilters } from "../app/manager/reports/dashboard/reporting-ui";

const keys = ["TO_CONTACT", "FIRST_TREATMENT_OVERDUE", "ACTIVE_FOLLOW_UP", "OVERDUE_FOLLOW_UP", "NEXT_ACTION_MISSING", "PENDING_CLOSURE"];
function fixture(): Record<string, unknown> {
  return { definitionVersion: "commercial-work-v1", generatedAt: "2026-10-20T12:00:00Z", timezone: "Africa/Casablanca", selectedQueue: "TO_CONTACT", definitions: ["Stock actuel, pas traitements aujourd’hui"], advisers: [],
    cohort: { leadCount: 1, attribution: "CURRENT_PRIMARY_ADVISER", dateBasis: "LEAD_CREATED_COHORT_CURRENT_STATE" }, actions: { active: 0, future: 0, dueNow: 0, overdue: 0, invalidDeadline: 0, completed: 2, cancelled: 3 },
    queues: keys.map((key, index) => ({ key, label: key === "TO_CONTACT" ? "À contacter" : key, leadCount: index < 2 ? 1 : 0, itemCount: index < 2 ? 1 : 0, itemUnit: "LEADS", href: `/manager/reports/commercial-work?campus=SYNTHETIC&queue=${key}`, leadShare: { numerator: index < 2 ? 1 : 0, denominator: 1, value: index < 2 ? 1 : 0 } })),
    page: { items: [{ id: "synthetic", firstName: "Synthetic", lastName: "Fixture" }], page: 1, pageSize: 25, total: 1 } };
}

function v2Fixture(): Record<string, unknown> {
  const value = fixture();
  value.definitionVersion = "commercial-work-v2"; value.filters = { campus: "SYNTHETIC", campaign: "CAMPAIGN", treatmentState: "NONE" };
  const queues = value.queues as Array<Record<string, unknown>>;
  queues.unshift({ ...queues[0], key: "NEW_RECEIVED", label: "Nouveaux reçus", href: "/manager/reports/commercial-work?campus=SYNTHETIC&queue=NEW_RECEIVED" });
  for (const [key, denominatorQueue, unit] of [["FIRST_TREATMENT_OVERDUE", "TO_CONTACT", "LEADS"], ["OVERDUE_FOLLOW_UP", "ACTIVE_FOLLOW_UP", "ACTIONS"]]) {
    const row = queues.find(queue => queue.key === key)!;
    const n = key === "FIRST_TREATMENT_OVERDUE" ? 1 : 0;
    row.subsetRate = { numerator: n, denominator: n, value: n ? 1 : null, unit, denominatorQueue, label: "Part explicite" };
  }
  return value;
}

test("v2 preserves exact subset rates and shared cohort filters, rejecting invented denominators", () => {
  assert.equal(parseWorkReport(v2Fixture()).queues.length, 7);
  const invalid = v2Fixture(), queues = invalid.queues as Array<Record<string, unknown>>;
  queues.find(queue => queue.key === "OVERDUE_FOLLOW_UP")!.subsetRate = { numerator: 0, denominator: 1, value: 0, unit: "LEADS", denominatorQueue: "ACTIVE_FOLLOW_UP", label: "wrong" };
  assert.throws(() => parseWorkReport(invalid), /commercial_work_rate_inconsistent/u);
  const params = new URLSearchParams(workCohortQuery({ from: "2026-10-01T00:00:00Z", campus: "SYNTHETIC", adviserId: "adviser", treatmentState: "NONE", treatmentTo: "2026-10-20", campaign: "CAMPAIGN", returnTo: "/unsafe", page: "99" }));
  assert.equal(params.get("period"), "open"); assert.equal(params.get("queue"), "NEW_RECEIVED");
  for (const key of ["campus", "adviserId", "treatmentState", "treatmentTo", "campaign"]) assert.ok(params.has(key));
  assert.equal(params.has("returnTo"), false); assert.equal(params.has("page"), false);
});

test("work contract requires all six queues, exact selected total and explicit rate denominator", () => {
  assert.equal(parseWorkReport(fixture()).page.total, 1);
  for (const mutate of [
    (value: Record<string, unknown>): void => { value.queues = []; },
    (value: Record<string, unknown>): void => { value.page = { items: [], page: 1, pageSize: 25, total: 2 }; },
    (value: Record<string, unknown>): void => { (value.queues as Array<{ leadShare: unknown }>)[0]!.leadShare = { numerator: 1, denominator: 0, value: 0 }; },
    (value: Record<string, unknown>): void => { (value.queues as Array<{ href: string }>)[0]!.href = "https://example.invalid"; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => parseWorkReport(value)); }
  assert.match(renderToStaticMarkup(React.createElement(CommercialWork, { query: "campus=SYNTHETIC" })), /Chargement des files autorisées/u);
});

test("dashboard navigation context never becomes an API filter or changes frozen selection scope", () => {
  const href = preserveFilters("/manager/reports/commercial-work?queue=OVERDUE_FOLLOW_UP&adviserScope=INVOLVED&period=open", new URLSearchParams({ campus: "SYNTHETIC", adviserId: "synthetic" }));
  const endpoint = workApiEndpoint(href.split("?")[1]!);
  const params = new URL(endpoint, "https://example.invalid").searchParams;
  assert.equal(params.has("returnTo"), false); assert.equal(params.get("adviserScope"), "INVOLVED"); assert.equal(params.get("period"), "open");
  assert.equal(params.get("campus"), "SYNTHETIC"); assert.equal(params.get("adviserId"), "synthetic");
});

test("work UI reads server units and selected dossiers then removes them after session failure", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.invalid/manager/reports/commercial-work" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true }); }
  const { act } = await import("react"), { createRoot } = await import("react-dom/client"); const host = dom.window.document.getElementById("root")!; const root = createRoot(host);
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  let session = false; const paths: string[] = [];
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => { paths.push(path); const report = v2Fixture(); report.selectedQueue = new URL(path, "https://example.invalid").searchParams.get("queue"); return Promise.resolve(session ? Response.json({}, { status: 401 }) : Response.json(report)); });
  const render = async (query: string): Promise<void> => { await act(async () => { root.render(React.createElement(CommercialWork, { query, embedded: true })); await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  await render("campus=SYNTHETIC&queue=TO_CONTACT");
  assert.equal(paths[0], "/api/crm/reports/commercial-work?campus=SYNTHETIC&queue=TO_CONTACT&contractVersion=2");
  assert.match(host.textContent ?? "", /1 leads distincts/u); assert.match(host.textContent ?? "", /1\/1/u); assert.ok(host.querySelector('a[href="/leads/synthetic"]'));
  assert.match(host.textContent ?? "", /Annulées — pas réalisées/u); assert.match(host.textContent ?? "", /pas activité réalisée aujourd’hui/u);
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === "Nouveaux reçus")!;
  await act(async () => { button.click(); await new Promise<void>(resolve => setImmediate(resolve)); });
  assert.equal(paths.at(-1), "/api/crm/reports/commercial-work?campus=SYNTHETIC&queue=NEW_RECEIVED&contractVersion=2");
  assert.equal(host.querySelector('button[aria-pressed="true"]')?.textContent, "Nouveaux reçus");
  assert.equal(dom.window.location.pathname, "/manager/reports/commercial-work", "Embedded drilldown stays in the current page");
  await render("campus=SYNTHETIC&campaign=CHANGED&queue=TO_CONTACT");
  assert.equal(paths.at(-1), "/api/crm/reports/commercial-work?campus=SYNTHETIC&campaign=CHANGED&queue=TO_CONTACT&contractVersion=2");
  session = true; await render("campus=SYNTHETIC&queue=ACTIVE_FOLLOW_UP");
  assert.match(host.textContent ?? "", /Session expirée/u); assert.equal(host.querySelectorAll("table").length, 0);
});
