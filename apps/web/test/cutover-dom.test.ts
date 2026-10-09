import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import type { CutoverManifest } from "../app/imports/cutover/cutover-client.js";

const manifestId = "00000000-0000-4000-8000-000000000063", packageId = "00000000-0000-4000-8000-000000000062", campusId = "00000000-0000-4000-8000-000000000061";
const manifest: CutoverManifest = { id: manifestId, campusId, state: "BASELINED", version: 2, contract: { bootstrapPackageId: packageId, connectorId: "00000000-0000-4000-8000-000000000064", excelSha256: "a".repeat(64), configurationSha256: "b".repeat(64), t0: "2026-10-09T09:00:00.000Z", timeZone: "Africa/Casablanca", excelFrozenAt: "2026-10-09T09:00:00.000Z", originalArrivalColumn: "arrived_at", externalIdColumn: "id", identityEvidenceSha256: "c".repeat(64), sourceSheetId: 0 }, counts: { total: 1, excludedPreT0: 0, backlog: 1, sourceIssues: 0, overlapReview: 1, linkedBaseline: 0 }, sourceCount: 1, headerSha256: "d".repeat(64), snapshotSha256: "e".repeat(64), observedAt: "2026-10-09T10:00:00.000Z", reportSha256: null, suspensionReason: null, localT0: "Heure convertie par le serveur", submissions: [{ key: "1".repeat(64), externalId: "SYNTHETIC-ONE", fingerprint: "2".repeat(64), originalArrivedAt: "2026-10-09T09:01:00.000Z", classification: "BACKLOG", issue: null, decision: null, targetBootstrapRowId: null }], automaticActivationAvailable: false, effectsApplied: false, limitations: ["CATCHUP_CONSUMER_NOT_IMPLEMENTED", "SHEETS_REMAINS_DISABLED"], bindingValid: true, capabilities: { canObserve: true, canDecide: true, canReconcile: true, canSuspend: true, canResume: false, canConsume: false, canCompensate: false } };
const context = { campuses: [{ id: campusId, label: "Campus synthétique", canCreate: true }], connectors: [{ id: manifest.contract.connectorId, campusId, label: "Source synthétique", enabled: false, identityMode: "EXTERNAL_ID" }] };
async function setup(t: TestContext): Promise<{ dom: JSDOM; render: (id?: string) => Promise<void>; click: (element: HTMLElement) => Promise<void>; edit: (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => Promise<void> }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/imports/cutover" }), prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client"), { CutoverWorkspace } = await import("../app/imports/cutover/cutover-workspace.js");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  return { dom, render: async (id): Promise<void> => { await act(async () => { root.render(createElement(CutoverWorkspace, { ...(id ? { initialManifestId: id } : {}) })); await new Promise<void>((resolve) => setImmediate(resolve)); }); }, click: async (element): Promise<void> => { await act(async () => { element.click(); await new Promise<void>((resolve) => setImmediate(resolve)); }); }, edit: async (element, value): Promise<void> => { await act(async () => { const prototype = element instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await new Promise<void>((resolve) => setImmediate(resolve)); }); } };
}
function button(dom: JSDOM, label: string): HTMLButtonElement { const element = [...dom.window.document.querySelectorAll("button")].find((item) => item.textContent?.includes(label)); assert.ok(element, label); return element; }
function input<T extends Element>(dom: JSDOM, label: string): T { const element = [...dom.window.document.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))?.querySelector("input,textarea,select"); assert.ok(element, label); return element as T; }
function requestPath(path: string | URL | Request): string { return typeof path === "string" ? path : path instanceof URL ? path.href : path.url; }
function requestBody(init: RequestInit): Record<string, unknown> { assert.equal(typeof init.body, "string"); return JSON.parse(init.body as string) as Record<string, unknown>; }
function mockRead(t: TestContext, value: CutoverManifest = manifest): void { t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => { assert.notEqual(init?.method, "POST", "opening the page must not mutate"); const url = requestPath(path); if (url.endsWith("/context")) return Promise.resolve(Response.json(context)); if (url.endsWith(`/manifests/${manifestId}`)) return Promise.resolve(Response.json(value)); throw new Error("Unexpected read"); }); }

test("opening a cutover recipe only reads; draft inputs have no guessed T0, freeze or source identity", async (t) => {
  mockRead(t); const { dom, render } = await setup(t); await render();
  for (const label of ["Gel final Excel", "Frontière T0", "Identifiant numérique", "SHA-256"]) assert.equal(input<HTMLInputElement>(dom, label).value, "");
  assert.equal(input<HTMLSelectElement>(dom, "Connecteur autorisé").value, "");
  assert.equal(button(dom, "Enregistrer le manifeste").disabled, true);
  assert.match(dom.window.document.body.textContent ?? "", /Sheets reste OFF/u);
  assert.match(dom.window.document.body.textContent ?? "", /snapshot Excel final, incluant le delta/u);
  assert.match(dom.window.document.body.textContent ?? "", /L’égalité des valeurs saisies ne prouve pas la couverture réelle du snapshot/u);
});
test("forbidden or expired context shows a controlled state without creation or source actions", async (t) => {
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ code: "private" }, { status: 401 })));
  const { dom, render } = await setup(t); await render();
  assert.match(dom.window.document.body.textContent ?? "", /session a expiré/u);
  assert.equal(dom.window.document.querySelector("form"), null); assert.equal(dom.window.document.querySelector('input[type="checkbox"]'), null);
});
test("manifest reading does not activate or decide, and missing/stale capabilities disable mutations", async (t) => {
  const value = { ...manifest, bindingValid: false }; mockRead(t, value);
  const { dom, render } = await setup(t); await render(manifestId);
  assert.equal(button(dom, "Observer la source").disabled, true); assert.equal(button(dom, "Vérifier la réconciliation").disabled, true);
  assert.equal([...dom.window.document.querySelectorAll("button")].some((item) => item.textContent?.includes("Enregistrer la disposition")), false);
  assert.match(dom.window.document.body.textContent ?? "", /Aucun effet Lead/u);
});
test("an uncertain decision keeps its exact key, requires explicit disposition/reason and never exposes private errors", async (t) => {
  const calls: object[] = [];
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => { if (init?.method === "POST") { calls.push(requestBody(init)); return Promise.reject(new Error("private response text")); } return Promise.resolve(Response.json(requestPath(path).endsWith("/context") ? context : manifest)); });
  const { dom, render, edit, click } = await setup(t); await render(manifestId);
  const submit = button(dom, "Enregistrer la disposition"); assert.equal(submit.disabled, true);
  assert.equal(input<HTMLSelectElement>(dom, "Disposition explicite").value, "");
  await edit(input<HTMLSelectElement>(dom, "Disposition explicite"), "KEEP_FOR_CATCHUP"); assert.equal(submit.disabled, true);
  await edit(input<HTMLTextAreaElement>(dom, "Motif du rapprochement"), "Source synthétique distincte vérifiée"); await click(submit); await click(submit);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal((calls[0] as { expectedVersion: number }).expectedVersion, manifest.version);
  assert.equal(dom.window.document.body.textContent?.includes("private response text"), false);
});
test("baseline link demands an explicit accepted-row reference rather than an auto-match", async (t) => {
  mockRead(t); const { dom, render, edit } = await setup(t); await render(manifestId);
  await edit(input<HTMLSelectElement>(dom, "Disposition explicite"), "LINK_BASELINE");
  await edit(input<HTMLTextAreaElement>(dom, "Motif du rapprochement"), "Rapprochement synthétique vérifié");
  assert.equal(button(dom, "Enregistrer la disposition").disabled, true);
  await edit(input<HTMLInputElement>(dom, "Identifiant de l’occurrence"), "row-1"); assert.equal(button(dom, "Enregistrer la disposition").disabled, true);
  await edit(input<HTMLInputElement>(dom, "Identifiant de l’occurrence"), packageId); assert.equal(button(dom, "Enregistrer la disposition").disabled, false);
});

test("create is explicit, UTC-only, same-campus-capability bound and rereads the new server manifest", async (t) => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") { calls.push({ path: requestPath(path), body: requestBody(init) }); return Promise.resolve(Response.json(manifest)); }
    return Promise.resolve(Response.json(requestPath(path).endsWith("/context") ? context : manifest));
  });
  const { dom, render, edit, click } = await setup(t); await render();
  await edit(input<HTMLInputElement>(dom, "Identifiant du lot Excel"), packageId);
  await edit(input<HTMLSelectElement>(dom, "Connecteur autorisé"), manifest.contract.connectorId);
  await edit(input<HTMLInputElement>(dom, "Gel final Excel"), "2026-10-01T08:00:00Z");
  assert.equal(input<HTMLInputElement>(dom, "Frontière T0").value, "", "entering a freeze never fills T0 automatically");
  await edit(input<HTMLInputElement>(dom, "Frontière T0"), "2026-10-01T09:00:00+01:00");
  await edit(input<HTMLInputElement>(dom, "Identifiant numérique"), "0");
  await edit(input<HTMLInputElement>(dom, "Colonne d’arrivée"), "arrived_at");
  await edit(input<HTMLInputElement>(dom, "SHA-256"), "a".repeat(64));
  await click(input<HTMLInputElement>(dom, "Les références et instants"));
  assert.equal(button(dom, "Enregistrer le manifeste").disabled, true);
  await edit(input<HTMLInputElement>(dom, "Frontière T0"), "2026-10-01T09:00:00Z");
  assert.equal(input<HTMLInputElement>(dom, "Les références et instants").checked, false, "changed T0 invalidates the explicit confirmation");
  await click(input<HTMLInputElement>(dom, "Les références et instants"));
  assert.equal(button(dom, "Enregistrer le manifeste").disabled, true, "an earlier freeze is not a qualified final delta window");
  assert.equal(input<HTMLInputElement>(dom, "Gel final Excel").value, "2026-10-01T08:00:00Z", "entering T0 never changes the declared freeze");
  assert.equal(calls.length, 0);
  await edit(input<HTMLInputElement>(dom, "Frontière T0"), "2026-10-01T08:00:00.000Z");
  assert.equal(input<HTMLInputElement>(dom, "Les références et instants").checked, false);
  await click(input<HTMLInputElement>(dom, "Les références et instants"));
  assert.equal(button(dom, "Enregistrer le manifeste").disabled, false, "Z and .000Z designate the same real instant");
  await click(button(dom, "Enregistrer le manifeste"));
  assert.equal(calls.length, 1); assert.equal(calls[0]!.path, "/api/crm/lead-import/cutover/manifests");
  assert.equal(calls[0]!.body.sourceSheetId, 0); assert.equal(calls[0]!.body.t0, "2026-10-01T08:00:00.000Z");
  assert.equal(calls[0]!.body.excelFrozenAt, "2026-10-01T08:00:00.000Z");
  assert.ok(String(calls[0]!.body.idempotencyKey).startsWith("cutover-"));
  assert.equal(dom.window.location.search, `?manifest=${manifestId}`);
  assert.match(dom.window.document.body.textContent ?? "", /Manifeste immuable enregistré puis relu/u);
});

test("suspension requires a reason and successful mutations reread without enabling Sheets", async (t) => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let state = manifest;
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") { const body = requestBody(init); calls.push({ path: requestPath(path), body }); state = { ...state, state: "SUSPENDED", version: 3, suspensionReason: String(body.reason), capabilities: { ...manifest.capabilities!, canResume: true } }; return Promise.resolve(Response.json(state)); }
    return Promise.resolve(Response.json(requestPath(path).endsWith("/context") ? context : state));
  });
  const { dom, render, edit, click } = await setup(t); await render(manifestId);
  assert.equal(button(dom, "Suspendre la préparation").disabled, true);
  await edit(input<HTMLTextAreaElement>(dom, "Motif conservé"), "  Pause synthétique pour rapprochement  ");
  await click(button(dom, "Suspendre la préparation"));
  assert.equal(calls.length, 1); assert.equal(calls[0]!.path.endsWith("/suspend"), true); assert.equal(calls[0]!.body.reason, "Pause synthétique pour rapprochement");
  assert.equal(button(dom, "Observer la source").disabled, true); assert.equal(button(dom, "Reprendre la préparation").disabled, true, "reason resets after acknowledgment");
  assert.match(dom.window.document.body.textContent ?? "", /Préparation suspendue/u);
  assert.equal(calls.some((call) => call.path.includes("enable") || call.path.includes("consume")), false);
});

test("manual catchup is bounded and separately confirmed; opening ready state never starts it", async (t) => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const value: CutoverManifest = { ...manifest, state: "READY_FOR_CATCHUP", capabilities: { ...manifest.capabilities!, canConsume: true }, catchup: { total: 0, created: 0, linkedBaseline: 0, review: 0, pending: 1, complete: false }, effects: [] };
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") { calls.push({ path: requestPath(path), body: requestBody(init) }); return Promise.reject(new Error("Unacknowledged")); }
    return Promise.resolve(Response.json(requestPath(path).endsWith("/context") ? context : value));
  });
  const { dom, render, edit, click } = await setup(t); await render(manifestId); assert.equal(calls.length, 0);
  const submit = button(dom, "Traiter ce bloc de rattrapage"), confirmation = input<HTMLInputElement>(dom, "J’autorise uniquement ce bloc");
  assert.equal(submit.disabled, true); await click(confirmation);
  await edit(input<HTMLInputElement>(dom, "Soumissions maximum"), "26"); assert.equal(submit.disabled, true); assert.equal(confirmation.checked, false);
  await edit(input<HTMLInputElement>(dom, "Soumissions maximum"), "1"); await click(confirmation); await click(submit); await click(submit);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0]!.path.endsWith("/consume"), true); assert.equal(calls[0]!.body.limit, 1); assert.equal(calls[0]!.body.confirmed, true);
  assert.equal(calls.some((call) => call.path.includes("enable")), false);
});

test("compensation is an explicit request, never a delete; downstream refusal preserves the Lead and history", async (t) => {
  const effect = { id: "synthetic-effect", sourceKey: "1".repeat(64), outcome: "CREATED" as const, batchId: "synthetic-batch", reason: null, compensationStatus: null, compensationReason: null, createdAt: "2026-10-09T10:00:00Z", comparedAt: null, leadVisible: true, leadId: packageId };
  let value: CutoverManifest = { ...manifest, effectsApplied: true, capabilities: { ...manifest.capabilities!, canCompensate: true }, effects: [effect], compensationApplied: false, catchup: { total: 1, created: 1, linkedBaseline: 0, review: 0, pending: 0, complete: false } };
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") { const body = requestBody(init); calls.push({ path: requestPath(path), body }); value = { ...value, state: "SUSPENDED", version: 3, effects: [{ ...effect, compensationStatus: "BLOCKED_DOWNSTREAM", compensationReason: String(body.reason) }] }; return Promise.resolve(Response.json(value)); }
    return Promise.resolve(Response.json(requestPath(path).endsWith("/context") ? context : value));
  });
  const { dom, render, edit, click } = await setup(t); await render(manifestId);
  assert.equal(button(dom, "Consigner la demande et suspendre").disabled, true);
  await edit(input<HTMLTextAreaElement>(dom, "Motif de demande de compensation"), "Vérification synthétique de préservation du suivi");
  await click(input<HTMLInputElement>(dom, "Je demande l’examen")); await click(button(dom, "Consigner la demande et suspendre"));
  assert.equal(calls.length, 1); assert.equal(calls[0]!.path.endsWith("/compensate"), true); assert.equal(calls[0]!.body.confirmed, true);
  assert.match(dom.window.document.body.textContent ?? "", /Compensation refusée/u); assert.match(dom.window.document.body.textContent ?? "", /Le Lead et son historique sont conservés/u);
  assert.equal([...dom.window.document.querySelectorAll("button")].some((item) => item.textContent?.includes("Consigner la demande")), false);
});

test("hidden Lead receipts and review outcomes never offer compensation or leak a target link", async (t) => {
  const value: CutoverManifest = { ...manifest, capabilities: { ...manifest.capabilities!, canCompensate: true }, effects: [{ id: "effect", sourceKey: "1".repeat(64), outcome: "REVIEW", batchId: "batch", reason: "Contact en revue", compensationStatus: null, compensationReason: null, createdAt: "2026-10-09T10:00:00Z", comparedAt: null, leadVisible: false, leadId: packageId }] };
  mockRead(t, value); const { dom, render } = await setup(t); await render(manifestId);
  assert.equal(dom.window.document.querySelector(`a[href="/leads/${packageId}"]`), null);
  assert.equal([...dom.window.document.querySelectorAll("button")].some((item) => item.textContent?.includes("Consigner la demande")), false);
  assert.match(dom.window.document.body.textContent ?? "", /En revue · pas de création acquise/u);
});
