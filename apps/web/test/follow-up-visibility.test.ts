import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

const row = { id: "task-synthetic", leadId: "lead-a", ownerId: "owner-synthetic", dueAt: "2026-10-21T09:30:00.000Z", state: "SCHEDULED", reason: "Préparation synthétique autorisée", version: 1 };
async function setup(t: TestContext): Promise<{ dom: JSDOM; host: HTMLElement; root: import("react-dom/client").Root; act: typeof import("react").act; createElement: typeof import("react").createElement; settle: () => Promise<void> }> {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/leads/lead-a/follow-ups" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client");
  const host = dom.window.document.getElementById("root")!; const root = createRoot(host);
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); }); };
  t.after(async () => { await act<void>(() => root.unmount()); dom.window.close(); for (const [key, value] of prior) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } });
  return { dom, host, root, act, createElement, settle };
}

test("empty authorized history never asserts that no follow-up exists for other roles", async t => {
  const { host, root, act, createElement, settle } = await setup(t);
  const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms");
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ items: [] })));
  act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-a" }))); await settle();
  assert.match(host.textContent ?? "", /Aucune relance visible dans votre périmètre pour ce dossier/u);
  assert.doesNotMatch(host.textContent ?? "", /Aucune relance enregistrée pour ce Lead/u);
});

for (const payload of [{}, { items: null }, { items: [{}] }, { items: [{ ...row, version: 0 }] }, { items: [{ ...row, dueAt: "invalid" }] }, { items: [row, row] }]) {
  test(`invalid follow-up contract is unavailable, never empty: ${JSON.stringify(payload)}`, async t => {
    const { host, root, act, createElement, settle } = await setup(t);
    const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms");
    t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json(payload)));
    act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-a" }))); await settle();
    assert.match(host.textContent ?? "", /Les relances sont indisponibles/u);
    assert.doesNotMatch(host.textContent ?? "", /Aucune relance|Préparation synthétique/u);
    assert.equal(host.querySelector("form"), null);
  });
}

test("late prior-lead response is aborted and cannot disclose its reason on the next lead", async t => {
  const { host, root, act, createElement, settle } = await setup(t);
  const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms");
  const pending: Array<{ resolve: (r: Response) => void; signal: AbortSignal | null | undefined }> = [];
  t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) => new Promise<Response>(resolve => pending.push({ resolve, signal: init?.signal })));
  act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-a" }))); await settle();
  act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-b" }))); await settle();
  assert.equal(pending.length, 2); assert.equal(pending[0]!.signal?.aborted, true);
  await act(async () => { pending[1]!.resolve(Response.json({ items: [{ ...row, id: "task-b", leadId: "lead-b", reason: "Motif du dossier B" }] })); await Promise.resolve(); }); await settle();
  assert.match(host.textContent ?? "", /Motif du dossier B/u);
  await act(async () => { pending[0]!.resolve(Response.json({ items: [{ ...row, reason: "Motif privé du dossier A" }] })); await Promise.resolve(); }); await settle();
  assert.match(host.textContent ?? "", /Motif du dossier B/u); assert.doesNotMatch(host.textContent ?? "", /Motif privé du dossier A/u);
});

test("follow-up time is explicitly Casablanca, independent of browser timezone", async t => {
  const { host, root, act, createElement, settle } = await setup(t);
  const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms");
  const Original = Intl.DateTimeFormat; const zones: Array<string | undefined> = [];
  t.mock.method(Intl, "DateTimeFormat", function (locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) { zones.push(options?.timeZone); return new Original(locale, options); });
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ items: [row, { ...row, id: "foreign-task", leadId: "lead-b", reason: "Autre dossier, pas à afficher" }] })));
  act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-a" }))); await settle();
  assert(zones.includes("Africa/Casablanca")); assert.match(host.textContent ?? "", /Horaires : Africa\/Casablanca/u);
  assert.doesNotMatch(host.textContent ?? "", /Autre dossier, pas à afficher/u);
  assert.equal(host.querySelector("time")?.dateTime, row.dueAt);
});

for (const status of [401, 403]) test(`decision ${status} clears protected history without retrying or displaying reason`, async t => {
  const { dom, host, root, act, createElement, settle } = await setup(t);
  const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms"); let patches = 0;
  t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) => { if (init?.method === "PATCH") { patches++; return Promise.resolve(Response.json({ code: "forbidden" }, { status })); } return Promise.resolve(Response.json({ items: [row] })); });
  act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-a" }))); await settle();
  const form = host.querySelector("form"); assert(form);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); }); await settle();
  assert.equal(patches, 1); assert.match(host.textContent ?? "", /Les relances sont indisponibles/u);
  assert.doesNotMatch(host.textContent ?? "", /Préparation synthétique autorisée/u); assert.equal(host.querySelector("form"), null);
});

for (const status of ["CLOSED_LOST", "ENROLLED"]) test(`final dossier ${status} preserves history and offers no new follow-up form`, async t => {
  const { host, root, act, createElement, settle } = await setup(t);
  const { LeadWorkflowPage } = await import("../app/leads/[leadId]/lead-workflow-page");
  t.mock.method(globalThis, "fetch", (url: string) => Promise.resolve(Response.json(url.endsWith("/follow-ups") ? { items: [{ ...row, state: "CANCELLED" }] } : { id: "lead-a", leadCode: "LD-SYNTHETIC", status, assignedToId: "owner-synthetic" })));
  act(() => root.render(createElement(LeadWorkflowPage, { leadId: "lead-a", surface: "follow-up" }))); await settle();
  assert.match(host.textContent ?? "", /Ce dossier est clôturé/u); assert.match(host.textContent ?? "", /Annulée/u);
  assert.equal(host.querySelector('button[type="submit"]'), null);
  const { LeadProfileView } = await import("../app/leads/[leadId]/lead-profile");
  const html = renderToStaticMarkup(createElement(LeadProfileView, { lead: { id: "lead-a", leadCode: "LD-SYNTHETIC", firstName: "Lead", lastName: "Synthétique", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC", program: "SYNTHETIC", source: "WEB_FORM", status, assignedToId: "owner-synthetic", collaboratorIds: [], temperature: "UNEVALUATED", temperatureLabel: "Non évalué", qualificationVersion: 0 }, events: [] }));
  assert.match(html, /Consulter les relances/u); assert.doesNotMatch(html, /Planifier une relance/u);
});

test("workflow grid contains controls rather than forcing overflowing minimum columns", () => {
  const css = readFileSync(new URL("../app/leads/lead-profile.css", import.meta.url), "utf8");
  assert.match(css, /\.lead-workflow-page__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.86fr\)\s+minmax\(0,\s*1\.14fr\)/u);
  assert.match(css, /@media\s*\(max-width:\s*1040px\)\s*\{\s*\.lead-workflow-page__grid/u);
  assert.match(css, /\.lead-follow-up-history[^{]*input[^{]*\{[^}]*min-width:\s*0/u);
});

test("read timeout exposes unavailable state and clears any protected controls without a second request", async t => {
  const { host, root, act, createElement, settle } = await setup(t);
  const { FollowUpHistory } = await import("../app/leads/[leadId]/lead-workflow-forms"); let calls = 0;
  t.mock.method(AbortSignal, "timeout", (ms: number): AbortSignal => { assert.equal(ms, 15_000); return AbortSignal.abort(); });
  t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit): Promise<Response> => { calls++; assert(init?.signal?.aborted); return Promise.resolve(Response.json({ items: [row] })); });
  act(() => root.render(createElement(FollowUpHistory, { leadId: "lead-a" }))); await settle();
  assert.equal(calls, 1); assert.match(host.textContent ?? "", /Les relances sont indisponibles/u);
  assert.doesNotMatch(host.textContent ?? "", /Préparation synthétique autorisée|Aucune relance/u); assert.equal(host.querySelector("form"), null);
});
