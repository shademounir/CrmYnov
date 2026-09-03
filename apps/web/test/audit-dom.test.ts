import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import type { AuditItem, AuditPage } from "../app/admin/audit/audit-client.js";

const campus = "00000000-0000-4000-8000-000000000054";
const actor = "00000000-0000-4000-8000-000000000055";
const resource = "00000000-0000-4000-8000-000000000056";
const item: AuditItem = { id: "00000000-0000-4000-8000-000000000057", eventType: "LEAD_UPDATED", actorId: actor, actorRoles: ["ADMIN"], campusId: campus, resourceType: "LEAD", resourceId: resource, result: "SUCCESS", occurredAt: "2026-09-03T10:30:00Z", before: { version: 1 }, after: { version: 2 } };
const snapshot = "2026-09-03T12:00:00Z";
function page(items: AuditItem[] = [item], total = items.length, number = 1): AuditPage {
  return { items, total, page: number, pageSize: 25, snapshot, campuses: [{ id: campus }], global: false };
}
type Reply = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;
interface AuditBrowser {
  dom: JSDOM; doc: Document; root: import("react-dom/client").Root; act: typeof import("react").act;
  click(element: HTMLElement): Promise<void>; button(name: string): HTMLButtonElement;
  field(name: string): HTMLInputElement | HTMLSelectElement; submit(): Promise<void>; requests: URL[];
}

async function browser(t: TestContext, respond: Reply): Promise<AuditBrowser> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/admin/audit" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function (): void { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AuditPageView } = await import("../app/admin/audit/page");
  const host = dom.window.document.getElementById("root"); assert.ok(host);
  const root = createRoot(host);
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(path, "http://localhost");
    assert.equal(url.origin, "http://localhost"); assert.ok(url.pathname.startsWith("/api/crm/audit-events"));
    assert.equal(init?.method, undefined, "read-only viewer never sends a mutation");
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    requests.push(url); return await respond(url, init);
  });
  const doc = dom.window.document;
  const click = async (element: HTMLElement): Promise<void> => { await act(async () => { element.click(); await Promise.resolve(); }); };
  const button = (name: string): HTMLButtonElement => { const found = [...doc.querySelectorAll("button")].find((node) => node.textContent === name); assert.ok(found, name); return found; };
  const field = (name: string): HTMLInputElement | HTMLSelectElement => { const found = doc.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`); assert.ok(found, name); return found; };
  const submit = async (): Promise<void> => { const form = doc.querySelector("form"); assert.ok(form); await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); }); };
  await act(async () => { root.render(createElement(AuditPageView)); await Promise.resolve(); });
  return { dom, doc, root, act, click, button, field, submit, requests };
}

test("CRMY-54 audit screen exposes loading, scoped cards, safe labels and keyboard focus", async (t) => {
  let deliver: (response: Response) => void = () => { throw new Error("request_missing"); };
  const ui = await browser(t, () => new Promise<Response>((resolve) => { deliver = resolve; }));
  assert.match(ui.doc.body.textContent, /Chargement du journal/);
  assert.equal(ui.button("Appliquer les filtres").disabled, true);
  assert.equal(ui.doc.querySelectorAll("article").length, 0);
  const masked = { ...item, id: "00000000-0000-4000-8000-000000000058", actorId: null, resourceType: null, resourceId: null, campusId: null };
  await ui.act<void>(() => deliver(Response.json({ ...page([item, masked]), password: "synthetic-never-render", token: "synthetic-never-render" })));
  assert.match(ui.doc.body.textContent, /2 événement\(s\) · Page 1/);
  assert.equal(ui.doc.querySelectorAll("article").length, 2);
  assert.equal(ui.doc.querySelectorAll("table").length, 0, "mobile layout retains complete vertical cards");
  for (const expected of [item.eventType, actor, resource, campus, "Identité technique masquée", "Historique sans identifiant structuré", "Global ou historique non attribué", "11:30:00"]) assert.ok(ui.doc.body.textContent.includes(expected), expected);
  assert.equal(ui.doc.body.textContent.includes("synthetic-never-render"), false);
  const select = ui.field("campus"); assert.ok(select instanceof ui.dom.window.HTMLSelectElement);
  assert.deepEqual([...select.options].map((option) => option.value), ["", campus]);
  for (const name of ["from", "to", "actorId", "eventType", "resourceId", "resourceType", "result", "campus"]) assert.ok(ui.field(name).closest("label")?.textContent);
  const detailButton = ui.button("Consulter le détail"); detailButton.focus();
  assert.equal(ui.doc.activeElement, detailButton); assert.equal(detailButton.getAttribute("aria-label"), `Détail de l’événement ${item.id}`);
  assert.equal(ui.button("Précédent").disabled, true); assert.equal(ui.button("Suivant").disabled, true);
  const css = await readFile(new URL("../app/admin/audit/audit.css", import.meta.url), "utf8");
  assert.match(css, /min-height: 44px/); assert.match(css, /@media \(max-width: 600px\).*grid-template-columns: 1fr/s);
});

test("CRMY-54 audit filters, UTC periods, CAMPUS and pagination preserve the read snapshot", async (t) => {
  const ui = await browser(t, (url) => Response.json(page([item], 51, Number(url.searchParams.get("page") ?? 1))));
  await ui.click(ui.button("Suivant"));
  assert.equal(ui.requests.at(-1)?.searchParams.get("page"), "2"); assert.equal(ui.requests.at(-1)?.searchParams.get("snapshot"), snapshot);
  assert.match(ui.doc.body.textContent, /Page 2/);
  await ui.click(ui.button("Précédent")); assert.equal(ui.requests.at(-1)?.searchParams.get("page"), "1");
  const values = { from: "2026-09-01T08:00", to: "2026-09-02T18:30", actorId: actor, eventType: "LEAD_UPDATED", resourceId: resource, resourceType: "LEAD", result: "SUCCESS", campus };
  for (const [key, value] of Object.entries(values)) ui.field(key).value = value;
  await ui.submit();
  const filtered = ui.requests.at(-1); assert.ok(filtered);
  assert.equal(filtered.searchParams.get("snapshot"), null, "a new period starts a fresh server snapshot");
  assert.equal(filtered.searchParams.get("from"), "2026-09-01T08:00:00.000Z"); assert.equal(filtered.searchParams.get("to"), "2026-09-02T18:30:00.000Z");
  for (const [key, value] of Object.entries(values).filter(([key]) => key !== "from" && key !== "to")) assert.equal(filtered.searchParams.get(key), value);
  await ui.click(ui.button("Suivant")); assert.equal(ui.requests.at(-1)?.searchParams.get("campus"), campus);
  await ui.click(ui.button("Réinitialiser"));
  assert.equal(ui.requests.at(-1)?.search, "?page=1&pageSize=25");
  for (const key of Object.keys(values)) assert.equal(ui.field(key).value, "");
});

test("CRMY-54 audit screen clears stale data on empty results, forbidden or failed API responses", async (t) => {
  let result: Response = Response.json(page());
  const ui = await browser(t, () => result.clone());
  assert.equal(ui.doc.querySelectorAll("article").length, 1);
  result = Response.json(page([])); await ui.submit();
  assert.match(ui.doc.body.textContent, /Aucun événement ne correspond/); assert.equal(ui.doc.querySelectorAll("article").length, 0);
  for (const [status, message] of [[403, "Accès refusé"], [401, "Votre session a expiré"], [400, "Filtres invalides"], [503, "Journal indisponible"]] as const) {
    result = Response.json({ code: "synthetic_denial" }, { status }); await ui.submit();
    assert.ok(ui.doc.querySelector('[role="alert"]')?.textContent.includes(message));
    assert.equal(ui.doc.querySelectorAll("article").length, 0); assert.equal(ui.doc.body.textContent.includes(actor), false);
  }
});

test("CRMY-54 audit detail has loading, sanitized evidence, close, cancel and indistinguishable refusal", async (t) => {
  let detailResponse: (response: Response) => void = () => { throw new Error("detail_request_missing"); };
  const ui = await browser(t, (url) => url.pathname.endsWith(item.id) ? new Promise<Response>((resolve) => { detailResponse = resolve; }) : Promise.resolve(Response.json(page())));
  await ui.click(ui.button("Consulter le détail"));
  const dialog = ui.doc.querySelector("dialog"); assert.ok(dialog?.open); assert.match(dialog.textContent, /Chargement du détail/);
  assert.equal(ui.requests.at(-1)?.pathname, `/api/crm/audit-events/${item.id}`);
  await ui.act<void>(() => detailResponse(Response.json({ ...item, sessionId: "synthetic-never-render", token: "synthetic-never-render" })));
  assert.match(dialog.textContent, /Aucune modification ou suppression possible/);
  assert.equal(dialog.querySelectorAll("pre").length, 2); assert.deepEqual(JSON.parse(dialog.querySelectorAll("pre")[1]?.textContent ?? "null"), { version: 2 });
  assert.equal(dialog.textContent.includes("synthetic-never-render"), false);
  await ui.click(ui.button("Fermer")); assert.equal(dialog.open, false);
  await ui.click(ui.button("Consulter le détail")); await ui.act<void>(() => detailResponse(Response.json({}, { status: 404 })));
  assert.match(dialog.textContent, /Événement absent ou inaccessible/); assert.equal(dialog.querySelectorAll("pre").length, 0);
  await ui.act<void>(() => { dialog.dispatchEvent(new ui.dom.window.Event("cancel", { cancelable: true })); });
  assert.equal(dialog.open, false);
  await ui.click(ui.button("Consulter le détail")); await ui.act<void>(() => detailResponse(Response.json({ ...item, actorId: null })));
  assert.match(dialog.textContent, /Acteur : Masqué/);
});

test("CRMY-54 unmount aborts outstanding requests and ignores late results", async (t) => {
  let signal: AbortSignal | null | undefined;
  let complete: (response: Response) => void = () => { throw new Error("request_missing"); };
  const ui = await browser(t, (_url, init) => { signal = init?.signal; return new Promise<Response>((resolve) => { complete = resolve; }); });
  assert.equal(signal?.aborted, false);
  await ui.act<void>(() => ui.root.unmount()); assert.equal(signal?.aborted, true);
  await ui.act<void>(() => complete(Response.json(page())));
  assert.equal(ui.doc.querySelectorAll("article").length, 0);
});
