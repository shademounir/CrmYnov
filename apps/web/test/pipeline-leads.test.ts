import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { PipelineLeadCards, PipelineLeads, pipelineLeadEndpoint } from "../app/manager/reports/commercial-funnel/pipeline-leads";

test("Pipeline cards reuse directory cohort parameters without navigation context or untrusted filters", () => {
  const url = new URL(pipelineLeadEndpoint({ from: "2026-10-01T08:00:00Z", to: "2026-10-19T12:00:00Z", adviserId: "synthetic", status: "CONTACTED", campus: "Synthetic Campus", channel: "DIGITAL", treatmentFrom: "2026-01-02", treatmentState: "UNKNOWN_DATE", admin: "true" }, 2), "https://example.invalid");
  assert.equal(url.pathname, "/api/crm/leads");
  assert.equal(url.searchParams.get("createdFrom"), "2026-10-01T08:00:00Z");
  assert.equal(url.searchParams.get("createdBefore"), "2026-10-19T12:00:00Z");
  for (const [key, value] of Object.entries({ adviserId: "synthetic", status: "CONTACTED", campus: "Synthetic Campus", channel: "DIGITAL", page: "2", pageSize: "12" })) assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.has("returnTo"), false); assert.equal(url.searchParams.has("admin"), false);
  assert.equal(url.searchParams.get("treatmentFrom"), "2026-01-02"); assert.equal(url.searchParams.get("treatmentState"), "UNKNOWN_DATE");
  assert.equal(url.searchParams.get("sortBy"), "lastTreatmentAt"); assert.equal(url.searchParams.get("sortDirection"), "asc");
});

test("Pipeline cards separate status, temperature, historical deadline, persistent plan and SLA", () => {
  const base = { firstName: "Synthetic", lastName: "Fixture", status: "CONTACTED", temperature: "HOT", assignedToId: "adviser-fixture", assignedToLabel: "Conseiller synthétique", lastTreatmentAt: "2026-10-18T12:00:00Z", nextActionAt: "2026-10-19T10:00:00Z", hasUndatedHistory: true };
  const html = renderToStaticMarkup(React.createElement(PipelineLeadCards, { generatedAt: "2026-10-19T12:00:00Z", data: { page: 1, pageSize: 12, total: 3, items: [{ ...base, id: "a/b", hasActiveNextAction: false }, { ...base, id: "active", hasActiveNextAction: true, firstTreatmentOverdue: true, firstTreatmentAgeMinutes: 1501 }, { ...base, id: "unknown" }] } }));
  for (const text of ["Contacté · Chaud", "Conseiller synthétique", "Dernier traitement commercial", "Historique également non daté", "Aucune action active persistée", "ne prouve pas une planification", "Action persistée", "En retard à la génération du rapport", "Planification non confirmée", "Premier traitement en retard"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes('/leads/a%2Fb'));
  assert.equal((html.match(/En retard à la génération du rapport/gu) ?? []).length, 1);
});

test("Pipeline cards do not fabricate overdue actions or identities from missing fields", () => {
  const html = renderToStaticMarkup(React.createElement(PipelineLeadCards, { generatedAt: "invalid", data: { items: [{ status: "CLOSED_LOST", hasActiveNextAction: false }], total: 1, page: 1, pageSize: 12 } }));
  for (const text of ["Prospect à vérifier", "Non affecté", "Date inconnue", "Dossier clôturé", "Fiche indisponible"]) assert.ok(html.includes(text));
  assert.ok(!html.includes("En retard à la génération du rapport"));
});

test("Pipeline dossiers paginate server totals, preserve scope, and clear cards on session or invalid response", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.invalid/manager/reports/commercial-funnel" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act } = await import("react"); const { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root")!; const root = createRoot(host);
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  let mode: "ready" | "session" | "invalid" = "ready";
  const requested: URL[] = [];
  t.mock.method(globalThis, "fetch", async (path: string): Promise<Response> => {
    await Promise.resolve();
    const url = new URL(path, "https://example.invalid"); requested.push(url);
    if (mode === "session") return Response.json({}, { status: 401 });
    if (mode === "invalid") return Response.json({ items: [] });
    const page = Number(url.searchParams.get("page"));
    return Response.json({ items: [{ id: `page-${page}`, firstName: "Synthetic", lastName: `Page ${page}`, status: "PROSPECT" }], total: 13, page, pageSize: 12 });
  });
  const filters = { adviserId: "scope-synthetic", campus: "SYNTHETIC", status: "PROSPECT" };
  const render = async (key: string): Promise<void> => { await act(async () => { root.render(React.createElement(PipelineLeads, { key, filters, generatedAt: "2026-10-19T12:00:00Z" })); await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  await render("ready");
  assert.match(host.textContent ?? "", /1 dossiers affichés sur 13/u);
  const next = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Dossiers suivants")!;
  await act(async () => { next.click(); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.equal(requested.at(-1)!.searchParams.get("page"), "2");
  assert.ok(host.querySelector('a[href="/leads/page-2"]'));
  for (const url of requested) for (const [key, value] of Object.entries(filters)) assert.equal(url.searchParams.get(key), value);
  assert.equal([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Dossiers suivants")!.disabled, true);
  mode = "session"; await render("session");
  assert.match(host.textContent ?? "", /Session expirée/u); assert.equal(host.querySelectorAll(".pipeline-lead-card").length, 0);
  mode = "invalid";
  const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Réessayer les dossiers")!;
  await act(async () => { retry.click(); await new Promise<void>((resolve) => setImmediate(resolve)); });
  assert.ok(host.querySelector('[role="alert"]')); assert.ok(!host.textContent?.includes("0 dossiers affichés"));
});
