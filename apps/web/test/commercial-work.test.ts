import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import CommercialWork, { parseWorkReport, QueueAdviserBreakdown, workApiEndpoint, workCohortQuery } from "../app/manager/reports/commercial-work/work";
import { preserveFilters } from "../app/manager/reports/dashboard/reporting-ui";
import { syntheticWorkReport } from "../e2e/work-report-fixture";

test("browser work fixture obeys all seven selections and exact creation cohort bounds", () => {
  for (const queue of ["NEW_RECEIVED", ...keys]) {
    const report = parseWorkReport(syntheticWorkReport(new URLSearchParams({ queue, contractVersion: "2", campus: "campus-a" })));
    assert.equal(report.queues.length, 7);
    assert.equal(report.page.total, report.queues.find(row => row.key === queue)!.leadCount);
    assert.equal(report.cohort.leadCount, 3);
  }
  const recent = parseWorkReport(syntheticWorkReport(new URLSearchParams("queue=NEW_RECEIVED&from=2026-10-19T10:00:00.000Z&to=2026-10-20T09:00:00.000Z")));
  assert.equal(recent.cohort.leadCount, 1);
  assert.equal(recent.page.items[0]!.id, "synthetic-work-action");
  const newest = parseWorkReport(syntheticWorkReport(new URLSearchParams("queue=NEW_RECEIVED&page=1&pageSize=1")));
  assert.equal(newest.page.items[0]!.id, "synthetic-work-enrolled");
  assert.equal(newest.page.total, 3);
  assert.equal(parseWorkReport(syntheticWorkReport(new URLSearchParams("queue=NEW_RECEIVED&page=2&pageSize=1"))).page.items[0]!.id, "synthetic-work-action");
  for (const filter of ["campus=outside", "campaign=outside", "source=outside", "status=QUALIFIED", "adviserId=outside", "program=outside"]) {
    const empty = parseWorkReport(syntheticWorkReport(new URLSearchParams(`queue=NEW_RECEIVED&${filter}`)));
    assert.equal(empty.page.total, 0);
    assert.ok(empty.queues.every(row => row.leadShare.value === null));
    assert.ok(empty.queues.filter(row => row.subsetRate).every(row => row.subsetRate!.value === null));
    assert.deepEqual(empty.advisers, []);
  }
  assert.throws(() => syntheticWorkReport(new URLSearchParams("queue=toString")), /synthetic_work_queue_invalid/u);
});

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

test("each work card shows the exact CRM adviser label and its own Lead count, including zero", () => {
  const report = parseWorkReport(syntheticWorkReport(new URLSearchParams("contractVersion=2&queue=NEW_RECEIVED")));
  const advisers = report.advisers.map(adviser => ({ ...adviser, adviserLabel: "mounir.baali · Admissions" }));
  for (const item of report.queues) {
    const html = renderToStaticMarkup(React.createElement(QueueAdviserBreakdown, { item, advisers }));
    const dom = new JSDOM(html);
    const row = dom.window.document.querySelector("li")!;
    assert.equal(row.querySelector("bdi")?.textContent, "mounir.baali · Admissions");
    assert.equal(row.querySelector("strong")?.textContent, String(item.leadCount));
    assert.ok(dom.window.document.querySelector('section[aria-label="Leads par conseiller · ' + item.label + '"]'));
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /adviser-synthetic/u);
    dom.window.close();
  }
});

test("per-adviser counts distinguish actions from Leads and retain unattributed dossiers", () => {
  const report = parseWorkReport(syntheticWorkReport(new URLSearchParams("contractVersion=2&queue=NEW_RECEIVED")));
  const item = { ...report.queues.find(row => row.key === "ACTIVE_FOLLOW_UP")!, leadCount: 3, itemCount: 5 };
  const advisers = [
    { ...report.advisers[0]!, adviserId: "one", adviserLabel: "Imane Hannoud", queues: [{ ...item, leadCount: 1, itemCount: 2 }] },
    { ...report.advisers[0]!, adviserId: "two", adviserLabel: "Laaziza", queues: [{ ...item, leadCount: 1, itemCount: 1 }] },
  ];
  const html = renderToStaticMarkup(React.createElement(QueueAdviserBreakdown, { item, advisers }));
  const dom = new JSDOM(html), rows = [...dom.window.document.querySelectorAll("li")];
  assert.deepEqual(rows.map(row => row.querySelector("strong")?.textContent), ["1", "1", "1"]);
  assert.deepEqual(rows.map(row => row.querySelector("small")?.textContent), ["2 actions", "1 action", "2 actions"]);
  assert.match(rows[2]!.textContent ?? "", /Sans conseiller principal/u);
  dom.window.close();
  const missing = renderToStaticMarkup(React.createElement(QueueAdviserBreakdown, { item: { ...item, leadCount: 0, itemCount: 0 }, advisers: [{ ...advisers[0]!, adviserLabel: "", queues: [{ ...item, leadCount: 0, itemCount: 0 }] }] }));
  assert.match(missing, /Conseiller · nom indisponible/u);
  assert.doesNotMatch(missing, />one</u);
});

test("rejects duplicate or irreconcilable adviser counters instead of showing false totals", () => {
  const original = syntheticWorkReport(new URLSearchParams("contractVersion=2&queue=NEW_RECEIVED"));
  const duplicate = structuredClone(original), duplicateRows = duplicate.advisers as unknown[];
  duplicateRows.push(structuredClone(duplicateRows[0]));
  assert.throws(() => parseWorkReport(duplicate), /commercial_work_advisers_inconsistent/u);
  const excessive = structuredClone(original);
  const rows = excessive.advisers as Array<{ queues: Array<{ leadCount: number; itemCount: number; leadShare: { numerator: number; denominator: number; value: number | null } }> }>;
  const first = rows[0]!.queues[0]!;
  first.itemCount = 4; first.leadCount = 4; first.leadShare = { numerator: 4, denominator: 3, value: 4 / 3 };
  assert.throws(() => parseWorkReport(excessive));
  const units = structuredClone(original);
  const unitRows = units.advisers as Array<{ queues: Array<{ key: string; itemUnit: string }> }>;
  unitRows[0]!.queues.find(row => row.key === "ACTIVE_FOLLOW_UP")!.itemUnit = "REQUESTS";
  assert.throws(() => parseWorkReport(units), /commercial_work_advisers_inconsistent/u);
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
  t.mock.method(globalThis, "fetch", (path: string): Promise<Response> => {
    paths.push(path); const report = v2Fixture(); report.selectedQueue = new URL(path, "https://example.invalid").searchParams.get("queue");
    report.advisers = [{ adviserId: "synthetic-user-id", adviserLabel: "Imane Hannoud", leadCount: 1, actions: report.actions,
      queues: (report.queues as Array<Record<string, unknown>>).map(row => ({ ...row, href: `${String(row.href)}&adviserId=synthetic-user-id&adviserScope=PRIMARY` })) }];
    return Promise.resolve(session ? Response.json({}, { status: 401 }) : Response.json(report));
  });
  const render = async (query: string): Promise<void> => { await act(async () => { root.render(React.createElement(CommercialWork, { query, embedded: true })); await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  await render("campus=SYNTHETIC&queue=TO_CONTACT");
  assert.equal(paths[0], "/api/crm/reports/commercial-work?campus=SYNTHETIC&queue=TO_CONTACT&contractVersion=2");
  assert.match(host.textContent ?? "", /1 leads distincts/u); assert.match(host.textContent ?? "", /1\/1/u); assert.ok(host.querySelector('a[href="/leads/synthetic"]'));
  assert.match(host.textContent ?? "", /Annulées — pas réalisées/u); assert.match(host.textContent ?? "", /pas activité réalisée aujourd’hui/u);
  const cards = [...host.querySelectorAll('[aria-label="Vues de travail"] > .work-queue')];
  assert.equal(cards.length, 7);
  for (const card of cards) {
    assert.equal(card.querySelector('.work-queue-advisers bdi')?.textContent, "Imane Hannoud");
    assert.ok(card.querySelector('.work-queue-advisers strong'));
    assert.doesNotMatch(card.textContent ?? "", /synthetic-user-id/u);
  }
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === "Nouveaux reçus")!;
  await act(async () => { button.click(); await new Promise<void>(resolve => setImmediate(resolve)); });
  assert.equal(paths.at(-1), "/api/crm/reports/commercial-work?campus=SYNTHETIC&queue=NEW_RECEIVED&contractVersion=2");
  assert.equal(host.querySelector('button[aria-pressed="true"]')?.textContent, "Nouveaux reçus");
  assert.equal(dom.window.location.pathname, "/manager/reports/commercial-work", "Embedded drilldown stays in the current page");
  await render("campus=SYNTHETIC&campaign=CHANGED&queue=TO_CONTACT");
  assert.equal(paths.at(-1), "/api/crm/reports/commercial-work?campus=SYNTHETIC&campaign=CHANGED&queue=TO_CONTACT&contractVersion=2");
  session = true; await render("campus=SYNTHETIC&queue=ACTIVE_FOLLOW_UP");
  assert.match(host.textContent ?? "", /Session expirée/u); assert.equal(host.querySelectorAll("table").length, 0);
  assert.equal(host.querySelectorAll('.work-queue-advisers').length, 0, "never retain adviser counts after access/session failure");
});
