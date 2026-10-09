import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import type { CutoverExceptions, CutoverManifest, CutoverQuarantineInput } from "../app/imports/cutover/cutover-client.js";

const manifestId = "00000000-0000-4000-8000-000000000063", caseId = "00000000-0000-4000-8000-000000000071", effectId = "00000000-0000-4000-8000-000000000072", batchId = "00000000-0000-4000-8000-000000000073";
const path = `/api/crm/lead-import/cutover/manifests/${manifestId}/exceptions`;
const manifest: CutoverManifest = { id: manifestId, campusId: "00000000-0000-4000-8000-000000000061", state: "BASELINED", version: 2, contract: { bootstrapPackageId: "00000000-0000-4000-8000-000000000062", connectorId: "00000000-0000-4000-8000-000000000064", excelSha256: "a".repeat(64), configurationSha256: "b".repeat(64), t0: "2026-10-09T09:00:00.000Z", timeZone: "Africa/Casablanca", excelFrozenAt: "2026-10-09T09:00:00.000Z", originalArrivalColumn: "arrived_at", externalIdColumn: "id", identityEvidenceSha256: "c".repeat(64) }, counts: {}, sourceCount: 1, headerSha256: "d".repeat(64), snapshotSha256: "e".repeat(64), observedAt: "2026-10-09T10:00:00.000Z", reportSha256: null, suspensionReason: null, localT0: "Heure serveur", submissions: [], automaticActivationAvailable: false, effectsApplied: false, limitations: [], bindingValid: true };
function fixture(): CutoverExceptions {
  return { id: manifestId, version: 2, state: "BASELINED", bindingValid: true,
    observation: { sourceEvidenceSha256: "a".repeat(64), bindingSha256: "b".repeat(64), headerSha256: "c".repeat(64), observedAt: "2026-10-09T10:00:00.000Z", observedManifestVersion: 2 },
    cases: [{ id: caseId, sourceKey: "1".repeat(64), kind: "SOURCE_CHANGED", evidenceSha256: "2".repeat(64), generation: 1, present: true, originalFingerprint: "3".repeat(64), observedFingerprint: "4".repeat(64), observedOriginalArrivedAt: "2026-10-09T09:01:00.000Z", disposition: null, current: true, requiresReobservation: false }],
    summary: { currentCases: 1, unresolvedCases: 1, quarantinedCases: 0, uniqueQuarantinedSources: 0, coverageValid: true, requiresReobservation: false, allDispositionsReconciled: false }, capabilities: { canQuarantine: true, canObserve: true } };
}
function requestPath(value: string | URL | Request): string { return typeof value === "string" ? value : value instanceof URL ? value.href : value.url; }
function requestBody(init: RequestInit): CutoverQuarantineInput { assert.equal(typeof init.body, "string"); return JSON.parse(init.body as string) as CutoverQuarantineInput; }
function button(dom: JSDOM, label: string): HTMLButtonElement { const value = [...dom.window.document.querySelectorAll("button")].find((item) => item.textContent?.includes(label)); assert.ok(value, label); return value; }
function reasonInput(dom: JSDOM): HTMLTextAreaElement { const value = dom.window.document.querySelector("textarea"); assert.ok(value); return value; }
async function setup(t: TestContext): Promise<{ dom: JSDOM; render: (current?: CutoverManifest) => Promise<void>; click: (element: HTMLElement) => Promise<void>; edit: (value: string) => Promise<void>; setServerManifest: (current: CutoverManifest) => void; readCount: () => number }> {
  const dom = new JSDOM("<!doctype html><main class='cutover-page' id='root'></main>", { url: "http://localhost/imports/cutover" }), prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { act, createElement, useState } = await import("react"), { createRoot } = await import("react-dom/client"), { CutoverExceptions: Panel } = await import("../app/imports/cutover/cutover-exceptions.js");
  const root = createRoot(dom.window.document.getElementById("root")!); let serverManifest = manifest, reads = 0;
  function Harness({ current }: Readonly<{ current: CutoverManifest }>): React.JSX.Element {
    const [busy, setBusy] = useState(false);
    return createElement(Panel, { manifest: current, busy, onReadManifest: (): Promise<CutoverManifest> => { reads += 1; return Promise.resolve(serverManifest); }, onPerform: async (operation): Promise<void> => { setBusy(true); try { await operation(); } finally { setBusy(false); } } });
  }
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  return { dom, render: async (current = manifest): Promise<void> => { await act(async () => { root.render(createElement(Harness, { current })); await new Promise<void>((resolve) => setImmediate(resolve)); }); }, click: async (element): Promise<void> => { await act(async () => { element.click(); await new Promise<void>((resolve) => setImmediate(resolve)); }); }, edit: async (value): Promise<void> => { await act(async () => { const element = reasonInput(dom); Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await new Promise<void>((resolve) => setImmediate(resolve)); }); }, setServerManifest: (current): void => { serverManifest = current; }, readCount: (): number => reads };
}

test("exceptions opening is inert and explicit reading only exposes proof, not source payload", async (t) => {
  const calls: string[] = [], view = fixture();
  view.cases.push({ ...view.cases[0]!, id: "00000000-0000-4000-8000-000000000074", kind: "SOURCE_REMOVED", present: true, observedFingerprint: view.cases[0]!.originalFingerprint, observedOriginalArrivedAt: null, current: false });
  t.mock.method(globalThis, "fetch", (value: string | URL | Request, init?: RequestInit) => { assert.equal(init?.method, "GET"); calls.push(requestPath(value)); return Promise.resolve(Response.json({ ...view, payload: { email: "PRIVATE_CONTACT_MUST_NOT_RENDER" } })); });
  const { dom, render, click, readCount } = await setup(t); await render(); assert.equal(calls.length, 0); assert.equal(readCount(), 0);
  assert.match(dom.window.document.body.textContent ?? "", /Exceptions non encore lues/u);
  await click(button(dom, "Lire les exceptions")); assert.deepEqual(calls, [path]); assert.equal(readCount(), 1);
  assert.match(dom.window.document.body.textContent ?? "", /Incident de modification conservé/u); assert.match(dom.window.document.body.textContent ?? "", /Incident de disparition conservé/u);
  assert.equal(dom.window.document.body.textContent?.includes("Source absente de l’observation"), false, "a historical disappearance never asserts that a reappeared source is currently absent");
  const historicalCase = [...dom.window.document.querySelectorAll("article")].find((item) => item.textContent?.includes("Incident de disparition conservé")); assert.ok(historicalCase); assert.match(historicalCase.textContent ?? "", /Présente/u); assert.match(historicalCase.textContent ?? "", new RegExp(view.cases[0]!.originalFingerprint, "u"));
  assert.match(dom.window.document.body.textContent ?? "", /Inconnue ou absente/u); assert.match(dom.window.document.body.textContent ?? "", /ne s’additionnent pas/u);
  assert.equal(dom.window.document.body.textContent?.includes("PRIVATE_CONTACT_MUST_NOT_RENDER"), false);
  assert.equal(dom.window.document.querySelectorAll("form").length, 1, "historical evidence cannot be dispositioned");
});

for (const [status, text] of [[401, /session a expiré/u], [403, /périmètre actuel/u], [503, /n’a pas confirmé/u]] as const) {
  test(`exception read ${status} is controlled and never renders private failure details`, async (t) => {
    t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ code: "PRIVATE_PROVIDER_FAILURE", message: "PRIVATE_CONTACT" }, { status })));
    const { dom, render, click } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", text);
    assert.equal(dom.window.document.body.textContent?.includes("PRIVATE_"), false); assert.equal(dom.window.document.querySelector("form"), null);
  });
}

test("quarantine requires exact evidence, reason and explicit confirmation; uncertain replay keeps the complete original body", async (t) => {
  const writes: CutoverQuarantineInput[] = []; let view = fixture(), fail = true;
  t.mock.method(globalThis, "fetch", (value: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      assert.equal(requestPath(value), `${path}/${caseId}/disposition`); const body = requestBody(init); writes.push(body);
      if (fail) return Promise.resolve(Response.json({ code: "PRIVATE_UNCERTAIN_WRITE" }, { status: 503 }));
      const disposition = { action: body.action, reason: body.reason, actorId: "synthetic-reviewer", decidedAt: "2026-10-09T11:00:00.000Z", decidedManifestVersion: 3 };
      view = { ...view, cases: [{ ...view.cases[0]!, disposition, requiresReobservation: true }], summary: { ...view.summary, unresolvedCases: 0, quarantinedCases: 1, uniqueQuarantinedSources: 1 } };
      return Promise.resolve(Response.json({ ...view, receipt: { ...disposition, caseId, evidenceSha256: body.evidenceSha256 }, replayed: true }));
    }
    assert.equal(requestPath(value), path); return Promise.resolve(Response.json(view));
  });
  const { dom, render, click, edit, setServerManifest } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
  let submit = button(dom, "Préserver cette preuve"); assert.equal(submit.disabled, true); await edit("Court");
  const check = dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!; await click(check); assert.equal(submit.disabled, true);
  await edit("Écart synthétique vérifié, preuve à conserver"); assert.equal(check.checked, false); await click(check); assert.equal(submit.disabled, false); await click(submit);
  assert.equal(writes.length, 1); assert.equal(reasonInput(dom).disabled, true); assert.equal(dom.window.document.querySelector('input[type="checkbox"]'), null);
  assert.equal(writes[0]!.action, "QUARANTINE_PRESERVE"); assert.equal(writes[0]!.evidenceSha256, "2".repeat(64)); assert.equal(writes[0]!.expectedVersion, 2); assert.equal(writes[0]!.confirmed, true);
  setServerManifest({ ...manifest, version: 3 }); view = { ...view, version: 3 }; await click(button(dom, "Relire les exceptions")); await render({ ...manifest, version: 3 });
  fail = false; submit = button(dom, "Rejouer exactement"); await click(submit);
  assert.equal(writes.length, 2); assert.deepEqual(writes[1], writes[0], "rereading a newer manifest never mints a rebased decision or key");
  assert.match(dom.window.document.body.textContent ?? "", /Disposition et reçu relus/u); assert.match(dom.window.document.body.textContent ?? "", /Quarantaine préservée · non ingérée/u);
  assert.match(dom.window.document.body.textContent ?? "", /nouvelle observation puis une réconciliation restent nécessaires/u);
  assert.equal(dom.window.document.querySelector("form"), null); assert.equal(dom.window.document.body.textContent?.includes("PRIVATE_UNCERTAIN_WRITE"), false);
});

test("quarantine preserves REVIEW and previous effect/batch; reconciliation does not assert complete ingestion", async (t) => {
  const view = fixture(); view.cases[0] = { ...view.cases[0]!, kind: "EFFECT_REVIEW", effectId, batchId, disposition: { action: "QUARANTINE_PRESERVE", reason: "Qualification synthétique à conserver", actorId: "synthetic-reviewer", decidedAt: "2026-10-09T11:00:00Z", decidedManifestVersion: 3 }, requiresReobservation: false };
  view.summary = { currentCases: 1, unresolvedCases: 0, quarantinedCases: 1, uniqueQuarantinedSources: 1, coverageValid: true, requiresReobservation: false, allDispositionsReconciled: true };
  t.mock.method(globalThis, "fetch", (value: string | URL | Request, init?: RequestInit) => { assert.equal(init?.method, "GET"); return Promise.resolve(Response.json(view)); });
  const { dom, render, click } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
  const text = dom.window.document.body.textContent ?? "";
  for (const expected of [/Effet en revue, non ingéré/u, /Un effet en revue reste en revue/u, /cela ne signifie pas/u, /ni que le rattrapage est complet/u]) assert.match(text, expected);
  assert.ok(text.includes(effectId)); assert.ok(text.includes(batchId)); assert.equal(dom.window.document.querySelector("form"), null); assert.equal(dom.window.document.querySelectorAll("a").length, 0);
});

test("missing capability, stale binding and a newly changed manifest never permit a fresh disposition", async (t) => {
  let view = fixture(); view.capabilities.canQuarantine = false;
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json(view)));
  const { dom, render, click } = await setup(t); await render(); await click(button(dom, "Lire les exceptions")); assert.equal(dom.window.document.querySelector("form"), null);
  view = fixture(); await click(button(dom, "Relire les exceptions")); assert.ok(dom.window.document.querySelector("form"));
  await render({ ...manifest, version: 3 }); assert.equal(dom.window.document.querySelector("form"), null); assert.match(dom.window.document.body.textContent ?? "", /manifeste a évolué/u);
  await render({ ...manifest, bindingValid: false }); assert.equal(dom.window.document.querySelector("form"), null);
});

test("no observation is an explicitly unqualified state, never a successful empty-source attestation", async (t) => {
  const view: CutoverExceptions = { ...fixture(), observation: null, cases: [], summary: { currentCases: 0, unresolvedCases: 0, quarantinedCases: 0, uniqueQuarantinedSources: 0, coverageValid: false, requiresReobservation: true, allDispositionsReconciled: false }, capabilities: { canQuarantine: false, canObserve: true } };
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json(view)));
  const { dom, render, click } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
  const text = dom.window.document.body.textContent ?? ""; assert.match(text, /Aucune observation source acquise/u); assert.match(text, /n’atteste pas l’absence d’écarts/u); assert.match(text, /couverture de la dernière observation n’est pas encore qualifiée/u);
  assert.equal(dom.window.document.querySelector("form"), null);
});

test("concurrent versions between the manifest and exception GETs require a fresh read, never a new decision", async (t) => {
  t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ ...fixture(), version: 3 })));
  const { dom, render, click } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
  assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /une version a changé/u);
  assert.match(dom.window.document.body.textContent ?? "", /manifeste a évolué/u); assert.equal(dom.window.document.querySelector("form"), null);
});

test("a valid POST receipt is not claimed as reread when the following GET fails", async (t) => {
  let afterWrite = false; const view = fixture(), writes: CutoverQuarantineInput[] = [];
  t.mock.method(globalThis, "fetch", (_value: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") { const body = requestBody(init); writes.push(body); afterWrite = true; return Promise.resolve(Response.json({ ...view, receipt: { caseId, evidenceSha256: body.evidenceSha256, action: body.action, reason: body.reason, actorId: "synthetic-reviewer", decidedAt: "2026-10-09T11:00:00Z" }, replayed: false })); }
    return Promise.resolve(Response.json(afterWrite ? { code: "PRIVATE_REREAD_FAILURE" } : view, { status: afterWrite ? 503 : 200 }));
  });
  const { dom, render, click, edit } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
  await edit("Preuve synthétique à conserver exactement"); await click(dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button(dom, "Préserver cette preuve"));
  assert.equal(writes.length, 1); assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’a pas confirmé/u);
  assert.equal(reasonInput(dom).disabled, true); assert.equal(dom.window.document.body.textContent?.includes("Disposition et reçu relus"), false); assert.equal(dom.window.document.body.textContent?.includes("PRIVATE_REREAD_FAILURE"), false);
});

test("a successful HTTP response without the matching receipt never clears the pending attempt", async (t) => {
  const writes: CutoverQuarantineInput[] = [];
  t.mock.method(globalThis, "fetch", (_value: string | URL | Request, init?: RequestInit) => { if (init?.method === "POST") writes.push(requestBody(init)); return Promise.resolve(Response.json(fixture())); });
  const { dom, render, click, edit } = await setup(t); await render(); await click(button(dom, "Lire les exceptions"));
  await edit("Preuve synthétique à conserver exactement"); await click(dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button(dom, "Préserver cette preuve"));
  assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /n’a pas confirmé/u); assert.equal(reasonInput(dom).disabled, true);
  await click(button(dom, "Rejouer exactement")); assert.deepEqual(writes[0], writes[1]); assert.equal(dom.window.document.body.textContent?.includes("Disposition et reçu relus"), false);
});
