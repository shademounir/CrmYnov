import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { sheetApiObject, sheetApiValue } from "../app/admin/scheduled-sheets/sheets-client";

const campus = { id: "00000000-0000-4000-8000-000000000171", code: "SYNTHETIC-CAMPUS", label: "Campus synthétique", kind: "CAMPUS", state: "ACTIVE" };
const template = { mappingKey: "synthetic-map", name: "Mapping synthétique", profile: "FORMINATOR_ZAPIER", columns: [
  { sourceColumn: "First", targetField: "firstName", action: "TRIM" }, { sourceColumn: "Last", targetField: "lastName", action: "TRIM" },
  { sourceColumn: "ID", targetField: "externalId", action: "TRIM", required: true },
  { sourceColumn: "Synthetic phone", action: "METADATA", reason: "ambiguous_numeric_phone_without_country_prefix" }] };

async function browser(t: TestContext, paginated = false, googleReady = false, reconciliationRequired = false): Promise<{ doc: Document; change(name: string, value: string): Promise<void>; toggle(name: string): Promise<void>; click(name: string): Promise<void>; submit(times?: number): Promise<void>; fail(status: number): void; pause(): void; release(): Promise<void>; unmount(): Promise<void>; calls: string[] }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/scheduled-sheets" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Page } = await import("../app/admin/scheduled-sheets/page");
  const host = dom.window.document.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async (): Promise<void> => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  } });
  const calls: string[] = [];
  let failure = 0;
  let savedVersion = 0;
  let releaseResponse: (() => void) | undefined;
  let responseGate: Promise<void> | undefined;
  t.mock.method(globalThis, "fetch", (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, "http://localhost"); assert.equal(url.origin, "http://localhost"); calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/references")) {
      const kind = url.searchParams.get("kind");
      return Promise.resolve(Response.json({ items: kind === "CAMPUS" ? [campus] : [{ ...campus, id: `${kind}-synthetic`, kind, code: `SYNTHETIC-${kind}`, label: `${kind} synthétique` }] }));
    }
    if (failure) return Promise.resolve(Response.json({ code: "synthetic_refusal" }, { status: failure }));
    if (init?.method === "POST" || init?.method === "PUT") {
      if (url.pathname.endsWith("/simulations")) return Promise.resolve(Response.json({ rows: 1, mapped: reconciliationRequired ? 0 : 1, review: reconciliationRequired ? 1 : 0, mutated: false, simulated: true, reconciliationRequired, reason: reconciliationRequired ? "observed_row_changed" : null }));
      if (url.pathname.endsWith("/runs")) {
        assert.equal(init.body, JSON.stringify({ expectedVersion: savedVersion }));
        return Promise.resolve(Response.json({ queued: true, version: 1 }));
      }
      assert.ok(typeof init.body === "string");
      const body = sheetApiObject(sheetApiValue(JSON.parse(init.body)));
      assert.equal(body.campusId, campus.code);
      savedVersion = Number(body.expectedVersion) + 1;
      if (sheetApiObject(body.source).identityMode === "LOCAL_ROW") {
        assert.equal(sheetApiObject(body.mapping).profile, "CUSTOM");
        assert.equal(sheetApiObject(body.context).technicalSystem, "GOOGLE_SHEETS_LOCAL");
        assert.equal(sheetApiObject(body.context).originalSource, "Campagne synthétique déclarée");
        assert.equal(sheetApiObject(body.context).source, "OTHER_CONTROLLED");
        assert.deepEqual(body.source, { mode: "GOOGLE", identityMode: "LOCAL_ROW", sheetId: 171, range: "A1:K6" });
        assert.equal(body.enabled, false);
      }
      const response = Response.json({ id: "synthetic-connector", version: Number(body.expectedVersion) + 1, tab: body.tab, workbookId: "synthetic_crmy171",
        enabled: body.enabled, intervalMinutes: body.intervalMinutes, configuration: { source: body.source, mapping: body.mapping, context: body.context, assignment: body.assignment } });
      return responseGate ? responseGate.then(() => failure ? Response.json({ code: "synthetic_refusal" }, { status: failure }) : response) : Promise.resolve(response);
    }
    if (url.pathname.endsWith("/runs")) return Promise.resolve(Response.json(Array.from({ length: paginated && url.searchParams.get("page") === "1" ? 50 : 1 }, (_, index) => ({ id: `synthetic-run-${index}`, status: "COMPLETED", trigger: "SCHEDULED", configurationVersion: 1, createdCount: 1, duplicateCount: 0, reviewCount: 0, ignoredCount: 0 }))));
    if (url.pathname.endsWith("/reconciliation")) return Promise.resolve(Response.json({ suspended: true, reason: "source_changed", rows: [{ rowNumber: 2, status: "REVIEW", errorCode: "row_changed", firstObservedAt: "2026-09-07T10:00:00Z", lastObservedAt: "2026-09-07T10:05:00Z" }] }));
    return Promise.resolve(Response.json({ connectors: [], mappings: [template], simulated: true, googleReady }));
  });
  await act<void>(() => root.render(createElement(Page)));
  const doc = dom.window.document;
  return { doc, calls, fail: (status): void => { failure = status; },
    pause: (): void => { responseGate = new Promise<void>((done) => { releaseResponse = done; }); },
    release: async (): Promise<void> => { await act<void>(() => { releaseResponse?.(); }); responseGate = undefined; },
    unmount: async (): Promise<void> => { await act<void>(() => root.unmount()); },
    toggle: async (name): Promise<void> => { const field = doc.querySelector(`[name="${name}"]`); assert.ok(field instanceof dom.window.HTMLInputElement); await act<void>(() => field.click()); },
    change: async (name, value): Promise<void> => {
      const field = doc.querySelector(`[name="${name}"]`); assert.ok(field instanceof dom.window.HTMLSelectElement || field instanceof dom.window.HTMLInputElement);
      await act<void>(() => { field.value = value; field.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    },
    click: async (name): Promise<void> => { const button = [...doc.querySelectorAll("button")].find((item) => item.textContent === name); assert.ok(button, name); await act<void>(() => button.click()); },
    submit: async (times = 1): Promise<void> => { const form = doc.querySelector("form"); assert.ok(form); await act<void>(() => { for (let index = 0; index < times; index++) form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); },
  };
}

test("CRMY-171 Admin UI configures, simulates, queues and reads server results without retaining stale success", async (t) => {
  const ui = await browser(t);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  assert.match(ui.doc.body.textContent, /Aucune configuration/u);
  assert.deepEqual([...ui.doc.querySelectorAll('.sheets-step-nav a')].map((node) => node.textContent), ["1. Connexion", "2. Périmètre", "3. Correspondance", "4. Planification"]);
  assert.deepEqual([...ui.doc.querySelectorAll('.sheets-step-nav a')].map((node) => node.getAttribute("href")), ["#sheets-source", "#sheets-scope", "#sheets-mapping", "#sheets-schedule"]);
  for (const section of ["sheets-source", "sheets-scope", "sheets-mapping", "sheets-schedule"]) assert.ok(ui.doc.getElementById(section));
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  await ui.submit();
  assert.match(ui.doc.body.textContent, /Configuration enregistrée\. Import automatique désactivé/u);
  assert.ok(ui.calls.includes("POST /api/crm/scheduled-sheets"));
  await ui.click("Lancer manuellement");
  assert.equal(ui.calls.some((call) => call.endsWith("/runs")), false, "legacy external-ID connector still requires activation");
  await ui.toggle("enabled"); await ui.submit();
  assert.ok(ui.calls.includes("PUT /api/crm/scheduled-sheets/synthetic-connector"));
  assert.match(ui.doc.querySelector(".sheets-connector-pill")?.textContent ?? "", /Connecteur actif/u);
  assert.equal(ui.doc.querySelectorAll(".sheets-action-toolbar > div").length, 3);
  await ui.click("Lancer manuellement");
  assert.ok(ui.calls.includes("POST /api/crm/scheduled-sheets/synthetic-connector/runs"));
  assert.match(ui.doc.body.textContent, /Demande enregistrée/u);
  await ui.click("Simuler"); assert.match(ui.doc.body.textContent, /Simulation terminée sans création de prospect/u);
  const simulation = ui.doc.querySelector('[aria-label="Résultat de simulation"]'); assert.ok(simulation);
  assert.match(simulation.textContent, /Simulation · Données simulées/u);
  assert.match(simulation.textContent, /Version simulée : 2/u);
  assert.deepEqual([...simulation.querySelectorAll("dt")].map((node) => node.textContent), ["Lignes lues", "Lignes admissibles", "À vérifier"]);
  assert.deepEqual([...simulation.querySelectorAll("dd")].map((node) => node.textContent), ["1", "1", "0"]);
  assert.doesNotMatch(simulation.textContent, /Mode non renseigné|v—|Créés|Ignorés/u);
  await ui.click("Actualiser l’historique"); assert.match(ui.doc.body.textContent, /Terminé · Planifié/u);
  assert.equal(ui.doc.querySelector('[aria-label="Résultat de simulation"]'), null);
  for (const status of [403, 409, 429, 503]) {
    ui.fail(status); await ui.click("Actualiser l’historique");
    assert.equal(ui.doc.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(ui.doc.querySelectorAll('[role="status"]').length, 0);
    assert.doesNotMatch(ui.doc.body.textContent, /Historique actualisé\./u);
  }
  ui.fail(0); await ui.click("Actualiser l’historique");
  assert.equal(ui.doc.querySelectorAll('[role="alert"]').length, 0);
  assert.match(ui.doc.body.textContent, /Historique actualisé/u);
  await ui.click("Nouvelle configuration");
  assert.match(ui.doc.body.textContent, /Nouvelle configuration/u);
});

test("recorded history is paged through the API and refresh resets the first page", async (t) => {
  const ui = await browser(t, true);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN"); await ui.submit();
  await ui.click("Actualiser l’historique");
  assert.equal(ui.doc.querySelectorAll(".sheets-runs article").length, 50);
  await ui.click("Exécutions suivantes");
  assert.match(ui.doc.body.textContent, /Page 2/u);
  assert.equal(ui.doc.querySelectorAll(".sheets-runs article").length, 1);
  assert.ok(ui.calls.includes("GET /api/crm/scheduled-sheets/synthetic-connector/runs?page=2"));
  await ui.click("Exécutions précédentes"); assert.match(ui.doc.body.textContent, /Page 1/u);
  await ui.click("Exécutions suivantes"); await ui.click("Actualiser l’historique");
  assert.match(ui.doc.body.textContent, /Page 1/u);
  await ui.click("Simuler");
  assert.ok(ui.doc.querySelector('[aria-label="Pagination de l’historique"]'), "simulation preserves recorded history and its pagination");
  assert.equal(ui.doc.querySelectorAll(".sheets-runs article").length, 50);
  assert.match(ui.doc.querySelector('[aria-label="Résultat de simulation"]')?.textContent ?? "", /Lignes lues/u);
});

test("slow save rejects same-tick double submission, announces progress and confirms only the server result", async (t) => {
  const ui = await browser(t);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  ui.pause(); await ui.submit(2);
  assert.equal(ui.calls.filter((call) => call === "POST /api/crm/scheduled-sheets").length, 1);
  assert.match(ui.doc.querySelector('.sheets-save-bar [role="status"]')?.textContent ?? "", /Enregistrement en cours/u);
  assert.equal(ui.doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
  assert.doesNotMatch(ui.doc.body.textContent, /Configuration enregistrée/u);
  await ui.submit();
  assert.equal(ui.calls.filter((call) => call === "POST /api/crm/scheduled-sheets").length, 1);
  await ui.release();
  assert.match(ui.doc.querySelector('.sheets-save-bar [role="status"]')?.textContent ?? "", /Configuration enregistrée\. Import automatique désactivé/u);
  assert.equal(ui.doc.querySelectorAll('[role="alert"]').length, 0);
  await ui.toggle("enabled"); await ui.submit();
  assert.match(ui.doc.body.textContent, /Configuration enregistrée\. Import automatique actif/u);
  assert.match(ui.doc.querySelector(".sheets-persisted-state")?.textContent ?? "", /Imports automatiques actifs/u);
  await ui.toggle("enabled");
  assert.match(ui.doc.querySelector(".sheets-persisted-state")?.textContent ?? "", /Imports automatiques actifs/u, "uncommitted checkbox must not impersonate the persisted state");
});

test("save conflict and service error preserve edited fields and focus without replacing the version", async (t) => {
  const ui = await browser(t);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN"); await ui.submit();
  const tab = ui.doc.querySelector<HTMLInputElement>('[name="tab"]'); assert.ok(tab);
  await ui.change("tab", "Saisie synthétique conservée"); tab.focus();
  ui.pause(); await ui.submit(); ui.fail(409); await ui.release();
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="tab"]'), tab);
  assert.equal(tab.value, "Saisie synthétique conservée");
  assert.equal(ui.doc.activeElement, tab);
  assert.match(ui.doc.querySelector('.sheets-save-bar [role="alert"]')?.textContent ?? "", /Conflit de version/u);
  assert.equal(ui.doc.querySelectorAll('[role="status"]').length, 0);
  assert.match(ui.doc.querySelector("form h2")?.textContent ?? "", /version 1/u);
  ui.fail(503); await ui.submit();
  assert.equal(tab.value, "Saisie synthétique conservée"); assert.equal(ui.doc.activeElement, tab);
  assert.match(ui.doc.querySelector('[role="alert"]')?.textContent ?? "", /Aucune réussite n’a été confirmée/u);
  ui.fail(0); await ui.submit();
  assert.match(ui.doc.querySelector("form h2")?.textContent ?? "", /version 2/u);
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="tab"]')?.value, "Saisie synthétique conservée");
  assert.equal(ui.doc.querySelectorAll('[role="alert"]').length, 0);
});

test("late save response after navigation cannot display stale success or move focus", async (t) => {
  const ui = await browser(t);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  ui.pause(); await ui.submit(); await ui.unmount(); await ui.release();
  assert.equal(ui.doc.querySelectorAll('[role="status"], [role="alert"], form').length, 0);
  assert.equal(ui.doc.activeElement, ui.doc.body);
  assert.equal(ui.calls.filter((call) => call === "POST /api/crm/scheduled-sheets").length, 1);
});

test("real local-row configuration remains disabled without server readiness and exposes read-only reconciliation", async (t) => {
  const ui = await browser(t);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  await ui.change("sourceMode", "GOOGLE"); await ui.change("identityMode", "LOCAL_ROW");
  assert.match(ui.doc.body.textContent, /Lecture Google réelle/u);
  assert.match(ui.doc.querySelector('[role="note"]')?.textContent ?? "", /Téléphone non importé pour cette source/u);
  assert.match(ui.doc.querySelector('[role="note"]')?.textContent ?? "", /sans inventer un préfixe/u);
  assert.match(ui.doc.body.textContent, /Accès Google non configuré/u);
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="enabled"]')?.disabled, true);
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="originalSource"]')?.required, true);
  await ui.change("originalSource", "Campagne synthétique déclarée");
  await ui.change("range", "A1:K6"); await ui.change("sheetId", "171"); await ui.submit();
  assert.equal(ui.doc.querySelector<HTMLSelectElement>('[name="identityMode"]')?.value, "LOCAL_ROW");
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="originalSource"]')?.value, "Campagne synthétique déclarée");
  await ui.click("Simuler");
  assert.equal(ui.calls.some((call) => call.endsWith("/simulations")), false);
  await ui.click("Lancer manuellement");
  assert.equal(ui.calls.some((call) => call.endsWith("/runs")), false, "LOCAL_ROW never bypasses missing Google readiness");
  await ui.click("Consulter les lignes à vérifier");
  assert.match(ui.doc.body.textContent, /Import suspendu — vérification nécessaire/u);
  assert.match(ui.doc.body.textContent, /Ligne 2 · À vérifier/u);
  assert.doesNotMatch(ui.doc.body.textContent, /row_changed|source_changed/u);
  ui.fail(403); await ui.click("Consulter les lignes à vérifier");
  assert.match(ui.doc.querySelector('[role="alert"]')?.textContent ?? "", /Accès refusé/u);
  assert.equal(ui.doc.querySelectorAll('[role="status"]').length, 0);
  assert.equal(ui.doc.querySelector('[aria-label="Réconciliation des lignes"]'), null);
});

test("server-ready real transport permits simulation but a failed read never announces simulated success", async (t) => {
  const ui = await browser(t, false, true);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  await ui.change("sourceMode", "GOOGLE"); await ui.submit();
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="enabled"]')?.disabled, false);
  assert.doesNotMatch(ui.doc.body.textContent, /Accès Google non configuré/u);
  ui.fail(503); await ui.click("Simuler");
  assert.equal(ui.calls.filter((call) => call.endsWith("/simulations")).length, 1);
  assert.match(ui.doc.querySelector('[role="alert"]')?.textContent ?? "", /Aucune réussite n’a été confirmée/u);
  assert.equal(ui.doc.querySelectorAll('[role="status"]').length, 0);
  assert.doesNotMatch(ui.doc.body.textContent, /Simulation terminée/u);
});

test("disabled LOCAL_ROW can request one manual run without enabling the automatic connector", async (t) => {
  const ui = await browser(t, false, true);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN");
  await ui.change("sourceMode", "GOOGLE"); await ui.change("identityMode", "LOCAL_ROW");
  await ui.change("originalSource", "Campagne synthétique déclarée");
  await ui.change("range", "A1:K6"); await ui.change("sheetId", "171"); await ui.submit();
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="enabled"]')?.checked, false);
  assert.match(ui.doc.querySelector(".sheets-persisted-state")?.textContent ?? "", /Imports automatiques désactivés/u);
  await ui.click("Lancer manuellement");
  assert.equal(ui.calls.filter((call) => call === "POST /api/crm/scheduled-sheets/synthetic-connector/runs").length, 1);
  assert.equal(ui.calls.some((call) => call.startsWith("PUT ")), false);
  assert.equal(ui.doc.querySelector<HTMLInputElement>('[name="enabled"]')?.checked, false);
  assert.match(ui.doc.body.textContent, /Il n’active pas les prochains imports automatiques/u);
});

test("simulation reconciliation result is an explicit blocking notice, never an admissible import or stale success", async (t) => {
  const ui = await browser(t, false, false, true);
  await ui.change("consultedCampus", campus.code); await ui.click("Charger / actualiser");
  await ui.change("program", "SYNTHETIC-PROGRAM"); await ui.change("campaign", "SYNTHETIC-CAMPAIGN"); await ui.submit();
  await ui.click("Simuler");
  assert.match(ui.doc.querySelector('[role="alert"]')?.textContent ?? "", /Simulation bloquée/u);
  assert.equal(ui.doc.querySelectorAll('[role="status"]').length, 0);
  assert.doesNotMatch(ui.doc.body.textContent, /Configuration enregistrée|observed_row_changed/u);
  assert.match(ui.doc.body.textContent, /Aucune ligne ne peut être importée/u);
});
