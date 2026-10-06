import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeadFilterChips, LeadFilterForm } from "../app/leads/lead-filter-form.js";
import { LeadDirectoryTable, LeadListPagination } from "../app/leads/lead-directory.js";
import { leadListFilterLabels, leadListHref, leadListResetHref, leadProvenanceViews, leadWorkViews, readLeadListPage } from "../app/leads/lead-list-query.js";
import { savedLeadViewHref } from "../app/leads/saved-views.js";

const context = new URLSearchParams({
  search: "Sam", assignedToId: "adviser-synthetic", collaboratorId: "collaborator-synthetic", adviserId: "involved-synthetic",
  status: "CONTACTED", temperature: "HOT", source: "YNOV_COM", channel: "DIGITAL", program: "Programme synthétique",
  campus: "Campus synthétique", campaign: "Campagne synthétique", assignmentMode: "RULE", importBatchId: "batch-synthetic",
  createdFrom: "2026-09-01T10:15:00.000Z", createdTo: "2026-09-30T18:45:00.000Z", createdBefore: "2026-10-01T00:00:00.000Z",
  view: "MINE", savedView: "YNOV_COM", sortBy: "lastName", sortDirection: "asc", page: "7", pageSize: "50",
  returnTo: "/manager/reports/dashboard?period=30d",
});

test("exposes every supported work queue and usable provenance without advertising import errors as a result queue", () => {
  assert.deepEqual(leadWorkViews.map(([key]) => key), ["ALL", "MINE", "FOLLOW_UP", "UNASSIGNED", "NO_ACTIVITY", "CLOSED"]);
  assert.ok(leadProvenanceViews.some(([key]) => key === "YNOV_COM"));
  assert.ok(leadProvenanceViews.some(([key]) => key === "LEGACY_RELAUNCH"));
  assert.equal(leadProvenanceViews.length, 9);
  assert.equal(leadProvenanceViews.some(([key]) => String(key) === "IMPORT_ERRORS"), false);
});

test("changes a work queue while preserving every other filter, exact date bounds, sorting and return context", () => {
  const href = new URL(leadListHref(context, { view: "FOLLOW_UP" }), "http://crm.test");
  assert.equal(href.searchParams.get("view"), "FOLLOW_UP");
  assert.equal(href.searchParams.get("page"), "1");
  for (const [key, value] of context) if (!["view", "page"].includes(key)) assert.equal(href.searchParams.get(key), value, key);
  assert.equal(context.get("page"), "7");
});

test("preserves a shared view token and server page size in pagination links", () => {
  const current = new URLSearchParams(context); current.set("sharedViewId", "shared-synthetic");
  const next = new URL(leadListHref(current, { page: "8" }, false), "http://crm.test");
  assert.equal(next.searchParams.get("sharedViewId"), "shared-synthetic");
  assert.equal(next.searchParams.get("page"), "8");
  assert.equal(next.searchParams.get("pageSize"), "50");
  assert.equal(next.searchParams.get("collaboratorId"), "collaborator-synthetic");
});

test("reopening a saved view restores its stored page size and only defaults absent sizes", () => {
  const stored = new URL(savedLeadViewHref({ status: "CONTACTED", pageSize: "50", sortDirection: "asc", page: "7" }), "http://crm.test").searchParams;
  assert.equal(stored.get("page"), "1");
  assert.equal(stored.get("pageSize"), "50");
  assert.equal(stored.get("sortDirection"), "asc");
  assert.equal(new URL(savedLeadViewHref({ status: "CONTACTED" }), "http://crm.test").searchParams.get("pageSize"), "25");
});

test("resets the whole filter selection but retains sort, page size and safe return context", () => {
  const current = new URLSearchParams(context); current.set("sharedViewId", "shared-synthetic");
  const reset = new URL(leadListResetHref(current), "http://crm.test").searchParams;
  for (const key of Object.keys(leadListFilterLabels)) assert.equal(reset.has(key), false, key);
  assert.equal(reset.get("page"), "1");
  assert.equal(reset.get("pageSize"), "50");
  assert.equal(reset.get("sortBy"), "lastName");
  assert.equal(reset.get("sortDirection"), "asc");
  assert.equal(reset.get("returnTo"), context.get("returnTo"));
});

test("GET form retains all supported context and exact inclusive/exclusive boundaries, only resetting the page", () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(LeadFilterForm, { current: context, mode: "directory" })));
  try {
    const form = dom.window.document.querySelector("form"); assert.ok(form);
    const data = new dom.window.FormData(form);
    for (const [key, value] of context) assert.equal(data.get(key), key === "page" ? "1" : value, key);
    assert.equal(data.getAll("view").length, 1);
    assert.equal(data.getAll("pageSize").length, 1);
    assert.equal(form.querySelector<HTMLInputElement>('input[type="date"][aria-label="Créés jusqu’au (inclus)"]')?.value, "2026-09-30");
  } finally { dom.window.close(); }
});

test("a dedicated follow-up form supplies the work view when absent and never duplicates an existing view", () => {
  for (const current of [new URLSearchParams({ pageSize: "50" }), new URLSearchParams({ view: "FOLLOW_UP", pageSize: "50" })]) {
    const dom = new JSDOM(renderToStaticMarkup(createElement(LeadFilterForm, { current, mode: "follow-up" })));
    try {
      const form = dom.window.document.querySelector("form"); assert.ok(form);
      const submitted = new dom.window.FormData(form);
      assert.deepEqual(submitted.getAll("view"), ["FOLLOW_UP"]);
      assert.equal(submitted.get("pageSize"), "50");
    } finally { dom.window.close(); }
  }
});

test("shared definitions are explicitly read-only and expose an exit that only removes the shared token", () => {
  const current = new URLSearchParams(context); current.set("sharedViewId", "shared-synthetic");
  const dom = new JSDOM(renderToStaticMarkup(createElement(LeadFilterForm, { current, mode: "directory" })));
  try {
    assert.equal(dom.window.document.querySelector("fieldset")?.disabled, true);
    assert.equal(dom.window.document.querySelector("fieldset")?.hidden, true);
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('input[name="sharedViewId"]')?.value, "shared-synthetic");
    assert.match(dom.window.document.body.textContent ?? "", /lecture seule/u);
    const exit = new URL(dom.window.document.querySelector("a")?.getAttribute("href") ?? "", "http://crm.test");
    assert.equal(exit.searchParams.has("sharedViewId"), false);
    assert.equal(exit.searchParams.get("savedView"), "YNOV_COM");
    assert.equal(exit.searchParams.get("pageSize"), "50");
  } finally { dom.window.close(); }
});

test("removing a filter chip preserves all other criteria and avoids technical ID labels", () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(LeadFilterChips, { current: context })));
  try {
    const remove = dom.window.document.querySelector('a[aria-label="Retirer le filtre Campus"]'); assert.ok(remove);
    const query = new URL(remove.getAttribute("href") ?? "", "http://crm.test").searchParams;
    assert.equal(query.has("campus"), false);
    assert.equal(query.get("collaboratorId"), "collaborator-synthetic");
    assert.equal(query.get("createdBefore"), context.get("createdBefore"));
    assert.equal(query.get("page"), "1");
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /adviser-synthetic|collaborator-synthetic|involved-synthetic|batch-synthetic/u);
  } finally { dom.window.close(); }
});

test("requires valid server pagination instead of treating a missing total as zero", () => {
  assert.deepEqual(readLeadListPage({ items: [], page: 3, pageSize: 25, total: 80 }), { items: [], page: 3, pageSize: 25, total: 80 });
  for (const invalid of [[], { items: [] }, { items: [], page: 0, pageSize: 25, total: 0 }, { items: [], page: 1, pageSize: 101, total: 0 }, { items: [], page: 1, pageSize: 25, total: -1 }, { items: [null], page: 1, pageSize: 25, total: 1 }, { items: [{ id: "synthetic" }], page: 3, pageSize: 25, total: 1 }]) assert.throws(() => readLeadListPage(invalid), /lead_list_contract_invalid/u);
});

test("renders actual adviser, campus, provenance and both activity timestamps, hiding UUID labels", () => {
  const id = "00000000-0000-4000-8000-000000000172";
  const item = { id: "synthetic-lead", leadCode: "LD-SYN", firstName: "Camille", lastName: "Essai", assignedToId: id,
    assignedToLabel: "Conseillère synthétique", campus: "Campus synthétique", program: "Formation synthétique", source: "YNOV_COM",
    lastActivityAt: "2026-09-15T09:30:00.000Z", nextActionAt: "2026-09-16T10:30:00.000Z" };
  const html = renderToStaticMarkup(createElement(LeadDirectoryTable, { items: [item], total: 131, ariaLabel: "Leads" }));
  for (const label of ["Conseillère synthétique", "Campus synthétique", "Formation synthétique", "Ynov.com", "Dernière activité", "Prochaine action", "sur 131"]) assert.ok(html.includes(label), label);
  const dom = new JSDOM(html);
  try {
    assert.deepEqual([...dom.window.document.querySelectorAll("time")].map((time) => time.getAttribute("datetime")), ["2026-09-15T09:30:00.000Z", "2026-09-16T10:30:00.000Z"]);
    assert.equal(dom.window.document.querySelector('[role="region"]')?.getAttribute("tabindex"), "0");
  } finally { dom.window.close(); }
  assert.ok(!html.includes(id));
  const missing = renderToStaticMarkup(createElement(LeadDirectoryTable, { items: [{ ...item, assignedToLabel: id, campus: id, source: id, lastActivityAt: "", nextActionAt: "" }], ariaLabel: "Leads" }));
  for (const label of ["Affecté · nom indisponible", "Campus à préciser", "Source à préciser", "Aucune activité enregistrée", "Non planifiée"]) assert.ok(missing.includes(label), label);
  assert.ok(!missing.includes(id));
});

test("pagination uses the server total and actual visible range, not the number of rows as a total", () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(LeadListPagination, { result: { items: [{ id: "synthetic" }], total: 151, page: 3, pageSize: 25 }, current: context })));
  try {
    assert.match(dom.window.document.body.textContent ?? "", /51–51 sur 151 résultats · Page 3 sur 7/u);
    const next = new URL(dom.window.document.querySelector('a[rel="next"]')?.getAttribute("href") ?? "", "http://crm.test").searchParams;
    assert.equal(next.get("page"), "4");
    assert.equal(next.get("pageSize"), "25");
    assert.equal(next.get("savedView"), "YNOV_COM");
    assert.equal(next.get("sortDirection"), "asc");
  } finally { dom.window.close(); }
});
