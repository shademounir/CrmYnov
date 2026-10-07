import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { bootstrapChunkBytes, bootstrapHash, type BootstrapContext, type BootstrapPackage, type BootstrapRow } from "../app/imports/bootstrap/bootstrap-client.js";
import type { BootstrapRowDecision } from "../app/imports/bootstrap/bootstrap-row-review.js";

const id = "00000000-0000-4000-8000-000000000061", campusId = "00000000-0000-4000-8000-000000000062";
const context: BootstrapContext = { campuses: [{ id: campusId, code: "SYNTHETIC", label: "Campus synthétique", canUpload: true, canMap: true, canDecide: true, canConfirm: true }], owners: [], programs: [], campaigns: [], educationLevels: [], sources: [], statuses: ["PROSPECT", "ENROLLED", "CLOSED_LOST"], canUpload: true, canMap: true, canDecide: true, canConfirm: true };
const source: BootstrapPackage = { id, campusId, fileName: "synthetic.xlsx", sizeBytes: 100, sha256: "a".repeat(64), state: "MAPPED", version: 3, receivedChunks: 1, expectedChunks: 1, sheets: [], counts: { total: 1, accepted: 0, review: 0, invalid: 0, ignored: 0, pending: 1 } };
const row: BootstrapRow = { id: "row1", sheet: "VISITES ET APPELS", rowNumber: 7, fingerprint: "b".repeat(64), version: 2, state: "READY", reasons: [], values: { firstName: "Inventé", lastName: "Synthétique" }, comments: [], sourceOwner: null, replacementOwner: null, decision: { action: "CREATE_DOSSIER", reason: "Décision synthétique dédiée" } };

async function setup(t: TestContext): Promise<{ dom: JSDOM; render: (packageId?: string) => Promise<void>; renderRow: (value: BootstrapRow, onDecision: (value: BootstrapRow, decision: BootstrapRowDecision) => Promise<void>, sourceOverride?: BootstrapPackage) => Promise<void>; flush: () => Promise<void>; click: (button: HTMLElement) => Promise<void>; dispatch: (element: HTMLElement, event: string) => Promise<void>; edit: (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => Promise<void> }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/imports/bootstrap" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client"), { BootstrapWizard } = await import("../app/imports/bootstrap/bootstrap-wizard.js"), { BootstrapRowReview } = await import("../app/imports/bootstrap/bootstrap-row-review.js");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  async function flush(): Promise<void> { await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); }); }
  return {
    dom, flush,
    render: async (packageId?: string): Promise<void> => { await act(async () => { root.render(createElement(BootstrapWizard, { ...(packageId ? { initialPackageId: packageId } : {}) })); await new Promise<void>((resolve) => setImmediate(resolve)); }); },
    renderRow: async (value, onDecision, sourceOverride): Promise<void> => { await act(async () => { root.render(createElement(BootstrapRowReview, { row: value, source: sourceOverride ?? source, context, disabled: false, onDecision })); await new Promise<void>((resolve) => setImmediate(resolve)); }); },
    click: async (button: HTMLElement): Promise<void> => { await act(async () => { button.click(); await new Promise<void>((resolve) => setImmediate(resolve)); }); },
    dispatch: async (element: HTMLElement, event: string): Promise<void> => { await act(async () => { element.dispatchEvent(new dom.window.Event(event, { bubbles: true, cancelable: true })); await new Promise<void>((resolve) => setImmediate(resolve)); }); },
    edit: async (element, value): Promise<void> => { await act(async () => {
      const prototype = element instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }); },
  };
}
function button(dom: JSDOM, label: string): HTMLButtonElement { const value = Array.from(dom.window.document.querySelectorAll("button")).find((item) => item.textContent?.includes(label)); assert.ok(value, `button ${label}`); return value; }
function requestPath(value: string | URL | Request): string { return typeof value === "string" ? value : value instanceof URL ? value.href : value.url; }
function control<T extends Element>(dom: JSDOM, label: string): T { const value = Array.from(dom.window.document.querySelectorAll("label")).find((item) => item.textContent?.startsWith(label))?.querySelector("input,textarea,select"); assert.ok(value, `control ${label}`); return value as T; }

test("bootstrap shows no upload, mapping or decision forms when initial context is forbidden", async (t) => {
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json({ code: "permission_denied" }, { status: 403 })));
  const { dom, render } = await setup(t); await render();
  assert.match(dom.window.document.body.textContent ?? "", /rôle ou votre périmètre/u);
  assert.equal(dom.window.document.querySelector("form"), null);
  assert.equal(dom.window.document.querySelector('input[type="file"]'), null);
});

test("bootstrap does not borrow another campus confirmation grant or call confirm for a read-only source", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestPath(path); if (init?.method === "POST") writes += 1;
    if (url.endsWith("/context")) return Promise.resolve(Response.json({ ...context, campuses: [{ ...context.campuses[0], canConfirm: false }, { id: "other", code: "OTHER", label: "Autre campus", canConfirm: true }] }));
    if (url.endsWith(`/packages/${id}`)) return Promise.resolve(Response.json(source));
    if (url.includes("/rows?")) return Promise.resolve(Response.json({ items: [row], nextAfter: null }));
    if (url.endsWith("/report")) return Promise.resolve(Response.json({ package: source, bySheet: [], cutoverBlocked: true }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const { dom, render } = await setup(t); await render(id);
  assert.equal(button(dom, "Exécuter les décisions").disabled, true);
  const check = dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]'); assert.equal(check?.disabled, true);
  assert.equal(writes, 0); assert.match(dom.window.document.body.textContent ?? "", /Bascule non qualifiée/u);
});

test("bootstrap confirmation is explicit, bounded and duplicate-click guarded; receipt appears only after the server reread", async (t) => {
  let committed = false; let posts = 0; const gets: string[] = [];
  const completed: BootstrapPackage = { ...source, state: "COMPLETED", version: 4, counts: { ...source.counts, accepted: 1, pending: 0 } };
  t.mock.method(globalThis, "fetch", (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestPath(path);
    if (url.endsWith("/context")) return Promise.resolve(Response.json(context));
    if (url.endsWith("/confirm")) { posts += 1; assert.equal(typeof init?.body, "string"); const body = JSON.parse(init?.body as string) as Record<string, unknown>; assert.equal(body.confirmed, true); assert.equal(body.limit, 25); assert.match(String(body.idempotencyKey), /^bootstrap-/); committed = true; return Promise.resolve(Response.json(completed)); }
    if (url.endsWith(`/packages/${id}`)) { gets.push(url); return Promise.resolve(Response.json(committed ? completed : source)); }
    if (url.includes("/rows?")) return Promise.resolve(Response.json({ items: [committed ? { ...row, state: "ACCEPTED", leadId: id, version: 3 } : row], nextAfter: null }));
    if (url.endsWith("/report")) return Promise.resolve(Response.json({ package: committed ? completed : source, bySheet: [], cutoverBlocked: !committed }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const { dom, render, click } = await setup(t); await render(id);
  assert.equal(button(dom, "Exécuter les décisions").disabled, true);
  await click(dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  const execute = button(dom, "Exécuter les décisions"); assert.equal(execute.disabled, false);
  await click(execute); await click(execute);
  assert.equal(posts, 1); assert.ok(gets.length >= 2);
  assert.match(dom.window.document.body.textContent ?? "", /Reçu d’import acquis/u);
  assert.match(dom.window.document.body.textContent ?? "", /résultat et les reçus sont relus/u);
  assert.equal(button(dom, "Exécuter les décisions").disabled, true);
});

test("a lost confirmation response never becomes success or an automatic second write; explicit reread recovers the durable receipt", async (t) => {
  let committed = false; let posts = 0;
  const completed: BootstrapPackage = { ...source, state: "COMPLETED", version: 4, counts: { ...source.counts, accepted: 1, pending: 0 } };
  t.mock.method(globalThis, "fetch", (path: string | URL | Request): Promise<Response> => {
    const url = requestPath(path);
    if (url.endsWith("/context")) return Promise.resolve(Response.json(context));
    if (url.endsWith("/confirm")) { posts += 1; committed = true; return Promise.reject(new TypeError("lost response")); }
    if (url.endsWith(`/packages/${id}`)) return Promise.resolve(Response.json(committed ? completed : source));
    if (url.includes("/rows?")) return Promise.resolve(Response.json({ items: [committed ? { ...row, state: "ACCEPTED", version: 3 } : row], nextAfter: null }));
    if (url.endsWith("/report")) return Promise.resolve(Response.json({ package: committed ? completed : source, bySheet: [], cutoverBlocked: !committed }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const { dom, render, click } = await setup(t); await render(id); await click(dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button(dom, "Exécuter les décisions"));
  assert.equal(posts, 1); assert.match(dom.window.document.body.textContent ?? "", /serveur n’a pas confirmé/u); assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Reçu d’import acquis/u);
  await click(button(dom, "Relire le lot sans réexécuter")); assert.equal(posts, 1); assert.match(dom.window.document.body.textContent ?? "", /Reçu d’import acquis/u);
  assert.equal(button(dom, "Exécuter les décisions").disabled, true);
});

test("upload resumes exact bytes without assuming received chunks form a contiguous prefix and seals only the server-backed package", async (t) => {
  const bytes = new Uint8Array(bootstrapChunkBytes + 7).fill(65), file = new File([bytes], "synthetic.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const sha256 = await bootstrapHash(bytes.buffer);
  const uploading: BootstrapPackage = { ...source, state: "UPLOADING", sizeBytes: bytes.length, sha256, receivedChunks: 1, expectedChunks: 2, version: 1, counts: { total: 0, accepted: 0, review: 0, invalid: 0, ignored: 0, pending: 0 } };
  let sealed = false; const indices: number[] = [];
  t.mock.method(globalThis, "fetch", async (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestPath(path);
    if (url.endsWith("/context")) return Response.json(context);
    if (url.endsWith(`/packages/${id}`)) return Response.json(sealed ? { ...uploading, state: "SEALED", receivedChunks: 2, version: 2, sheets: ["VISITES ET APPELS", "LEADS YNOV.COM", "LEADS YNOV.MA", "JOBINTECH REACT"].map((name) => ({ name, relationId: name, rowCount: 1, columns: [] })) } : uploading);
    if (url.endsWith("/chunks")) {
      assert.equal(typeof init?.body, "string"); const body = JSON.parse(init?.body as string) as { index: number; sha256: string; contentBase64: string };
      indices.push(body.index); const expected = bytes.slice(body.index * bootstrapChunkBytes, (body.index + 1) * bootstrapChunkBytes);
      assert.deepEqual(Buffer.from(body.contentBase64, "base64"), Buffer.from(expected)); assert.equal(body.sha256, await bootstrapHash(expected.buffer));
      assert.ok(new TextEncoder().encode(init?.body as string).byteLength < 100 * 1024);
      return Response.json({ ...uploading, receivedChunks: 2 });
    }
    if (url.endsWith("/seal")) { const body = JSON.parse(init?.body as string) as { sha256: string }; assert.equal(body.sha256, sha256); assert.deepEqual(indices, [0, 1]); sealed = true; return Response.json({ ...uploading, state: "SEALED", receivedChunks: 2 }); }
    return new Response(null, { status: 404 });
  });
  const { dom, render, click, dispatch, flush } = await setup(t); await render(id);
  const input = dom.window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] }); await dispatch(input, "change");
  await click(dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  const form = input.closest("form")!; await dispatch(form, "submit");
  for (let pass = 0; pass < 100 && !dom.window.document.body.textContent?.includes("Aucun dossier n’est encore importé"); pass += 1) await flush();
  assert.equal(sealed, true); assert.deepEqual(indices, [0, 1]);
  assert.match(dom.window.document.body.textContent ?? "", /Aucun dossier n’est encore importé/u);
  assert.match(dom.window.document.body.textContent ?? "", /Mapping et rapprochement/u);
});

test("historical terminal status requires explicit same-row evidence and saves only a reviewed decision, not a closure", async (t) => {
  const decisions: BootstrapRowDecision[] = [];
  t.mock.method(globalThis, "fetch", (): Promise<Response> => { throw new Error("no confirmation or closure request is permitted in row review"); });
  const { dom, renderRow, edit, click, dispatch } = await setup(t);
  const reviewRow: BootstrapRow = { ...row, state: "REVIEW", values: { ...row.values, status: "ENROLLED" }, reasons: ["HISTORICAL_TERMINAL_STATUS_REVIEW"], sourceEvidence: [{ reference: "L7", column: "L", text: "Ancienne inscription", raw: "Ancienne inscription", type: "inlineStr", formula: false }, { reference: "O7", column: "O", text: "Inscription historique 2025-2026", raw: "Inscription historique 2025-2026", type: "inlineStr", formula: false }] }; delete reviewRow.decision;
  await renderRow(reviewRow, (_value, decision) => { decisions.push(decision); return Promise.resolve(); });
  const status = control<HTMLSelectElement>(dom, "Statut source explicitement qualifié");
  assert.match(status.textContent ?? "", /Inscrit · antériorité historique qualifiée/u);
  assert.match(status.textContent ?? "", /Sans suite · antériorité historique qualifiée/u);
  await edit(control<HTMLTextAreaElement>(dom, "Justification conservée"), "Antériorité certaine et qualifiée");
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  await edit(status, "ENROLLED");
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  const cells = control<HTMLInputElement>(dom, "Cellule(s) source");
  await edit(cells, "L8");
  const confirmation = control<HTMLInputElement>(dom, "J’ai vérifié");
  assert.equal(confirmation.disabled, true);
  await dispatch(cells.closest("form")!, "submit");
  assert.equal(decisions.length, 0);
  await edit(cells, "L7, O7"); assert.equal(confirmation.disabled, false);
  await click(confirmation); assert.equal(button(dom, "Enregistrer la décision").disabled, false);
  await click(button(dom, "Enregistrer la décision"));
  assert.equal(decisions.length, 1);
  const first = decisions[0]; assert.ok(first);
  assert.equal(first.action, "CREATE_DOSSIER"); assert.equal(first.overrides?.status, "ENROLLED");
  assert.match(first.reason, /VISITES ET APPELS · L7, O7/u);
  assert.match(first.reason, /pas une nouvelle clôture ni une approbation actuelle/u);
  assert.ok(first.reason.length <= 1000);
  await edit(status, "CLOSED_LOST");
  assert.equal(confirmation.checked, false); assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  await click(confirmation); await click(button(dom, "Enregistrer la décision"));
  assert.equal(decisions.length, 2); const second = decisions[1]; assert.ok(second); assert.equal(second.overrides?.status, "CLOSED_LOST");
});

test("a historical duplicate cannot create a dossier or enrollment; explicit ignore remains possible", async (t) => {
  const decisions: BootstrapRowDecision[] = [];
  const { dom, renderRow, edit, click } = await setup(t);
  const reviewRow: BootstrapRow = { ...row, state: "REVIEW", reasons: ["HISTORICAL_DUPLICATE_STATUS_REVIEW"], values: { ...row.values, status: "ENROLLED" } }; delete reviewRow.decision;
  await renderRow(reviewRow, (_value, decision) => { decisions.push(decision); return Promise.resolve(); });
  const action = control<HTMLSelectElement>(dom, "Décision explicite");
  assert.equal(action.value, "LINK_EXISTING");
  assert.equal(action.querySelector<HTMLOptionElement>('option[value="CREATE_DOSSIER"]')?.disabled, true);
  assert.match(dom.window.document.body.textContent ?? "", /Doublon/u);
  await edit(control<HTMLTextAreaElement>(dom, "Justification conservée"), "Doublon vérifié sans création");
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  await edit(action, "IGNORE"); await click(button(dom, "Enregistrer la décision"));
  assert.equal(decisions.length, 1); const saved = decisions[0]; assert.ok(saved); assert.equal(saved.action, "IGNORE"); assert.equal(saved.overrides, undefined);
});

test("cycle stays unspecified by default and requires consecutive source-proven years without fabricating an enrollment", async (t) => {
  const decisions: BootstrapRowDecision[] = [];
  const { dom, renderRow, edit, click } = await setup(t);
  const cycleText = "Ancienne inscription 2025-2026 ; candidature explicitement souhaitée pour 2027-2028";
  const reviewRow: BootstrapRow = { ...row, state: "REVIEW", values: { ...row.values, status: "PROSPECT" }, comments: [{ column: "O", text: cycleText }], sourceEvidence: [{ reference: "O7", column: "O", text: cycleText, raw: cycleText, type: "inlineStr", formula: false }] }; delete reviewRow.decision;
  const packageWithColumns: BootstrapPackage = { ...source, sheets: [{ name: row.sheet, relationId: "rId1", rowCount: 1, columns: [{ letter: "O", name: "Indication source" }] }] };
  await renderRow(reviewRow, (_value, decision) => { decisions.push(decision); return Promise.resolve(); }, packageWithColumns);
  const qualification = control<HTMLSelectElement>(dom, "Qualification explicite du cycle");
  assert.equal(qualification.value, "UNSPECIFIED");
  await edit(control<HTMLTextAreaElement>(dom, "Justification conservée"), "Dossier distinct source conservée");
  await click(button(dom, "Enregistrer la décision"));
  const unspecified = decisions[0]; assert.ok(unspecified); assert.equal(unspecified.cycle, undefined);
  await edit(qualification, "CONFIRMED_TARGET");
  await edit(control<HTMLInputElement>(dom, "Cycle indiqué explicitement"), "2027-2029");
  await edit(control<HTMLTextAreaElement>(dom, "Motif de qualification"), "Candidature explicite dans la cellule source");
  await click(control<HTMLInputElement>(dom, "O7"));
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  await edit(control<HTMLInputElement>(dom, "Cycle indiqué explicitement"), "2027-2028");
  assert.equal(button(dom, "Enregistrer la décision").disabled, false);
  await click(button(dom, "Enregistrer la décision"));
  const target = decisions[1]; assert.ok(target); assert.deepEqual(target.cycle, { state: "CONFIRMED_TARGET", label: "2027-2028", sourceColumns: ["O"], reason: "Candidature explicite dans la cellule source" });
  await edit(qualification, "HISTORICAL_ENROLMENT");
  await edit(control<HTMLInputElement>(dom, "Année de l’inscription"), "2025-2026");
  await edit(control<HTMLTextAreaElement>(dom, "Motif de qualification"), "Ancienne inscription explicitement qualifiée");
  await click(control<HTMLInputElement>(dom, "O7")); await click(button(dom, "Enregistrer la décision"));
  const historical = decisions[2]; assert.ok(historical); assert.equal(historical.cycle?.state, "HISTORICAL_ENROLMENT"); assert.equal(historical.overrides?.status, undefined);
  await edit(qualification, "REVIEW");
  await edit(control<HTMLTextAreaElement>(dom, "Motif de qualification"), "Cycle de candidature encore indéterminable");
  await click(control<HTMLInputElement>(dom, "O7")); await click(button(dom, "Enregistrer la décision"));
  const review = decisions[3]; assert.ok(review); assert.equal(review.cycle?.state, "REVIEW"); assert.equal(review.cycle?.label, undefined);
  assert.match(dom.window.document.body.textContent ?? "", /candidature explicitement souhaitée pour 2027-2028/u);
});

test("every native annotation requires an explicit disposition and source-preserving reason before saving", async (t) => {
  const decisions: BootstrapRowDecision[] = [];
  const { dom, renderRow, edit, click } = await setup(t);
  const reviewRow: BootstrapRow = { ...row, state: "REVIEW", annotations: [{ annotationId: "native1", reference: "I7", relationshipId: "rId1", text: "Note exacte à conserver", author: null }, { annotationId: "native2", reference: "J7", relationshipId: "rId2", text: "Annotation administrative hors reprise", author: "Auteur source" }] }; delete reviewRow.decision;
  await renderRow(reviewRow, (_value, decision) => { decisions.push(decision); return Promise.resolve(); });
  await edit(control<HTMLTextAreaElement>(dom, "Justification conservée"), "Décision synthétique justifiée");
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  const first = control<HTMLSelectElement>(dom, "Action sur l’annotation I7");
  assert.equal(first.value, ""); assert.equal(control<HTMLTextAreaElement>(dom, "Motif de l’annotation I7").disabled, true);
  await edit(first, "PRESERVE_NOTE"); await edit(control<HTMLTextAreaElement>(dom, "Motif de l’annotation I7"), "Source historique utile à conserver exactement");
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  await edit(control<HTMLSelectElement>(dom, "Action sur l’annotation J7"), "EXCLUDE");
  await edit(control<HTMLTextAreaElement>(dom, "Motif de l’annotation J7"), "Annotation administrative explicitement exclue");
  assert.equal(button(dom, "Enregistrer la décision").disabled, false);
  await click(button(dom, "Enregistrer la décision"));
  const decision = decisions[0]; assert.ok(decision);
  assert.deepEqual(decision.annotations, [{ annotationId: "native1", reference: "I7", relationshipId: "rId1", action: "PRESERVE_NOTE", reason: "Source historique utile à conserver exactement" }, { annotationId: "native2", reference: "J7", relationshipId: "rId2", action: "EXCLUDE", reason: "Annotation administrative explicitement exclue" }]);
  assert.match(dom.window.document.body.textContent ?? "", /Note exacte à conserver/u);
  assert.equal(decisions.length, 1);
});

test("contact exclusion is explicit, preserved as an empty override and cannot silently remove both contacts", async (t) => {
  const decisions: BootstrapRowDecision[] = [];
  const { dom, renderRow, edit, click, dispatch } = await setup(t);
  const reviewRow: BootstrapRow = { ...row, state: "REVIEW", values: { email: "synthetic@example.invalid", phone: "ambiguë" } }; delete reviewRow.decision;
  await renderRow(reviewRow, (_value, decision) => { decisions.push(decision); return Promise.resolve(); });
  await edit(control<HTMLTextAreaElement>(dom, "Justification conservée"), "Téléphone ambigu explicitement non repris, email source conservé");
  await click(control<HTMLInputElement>(dom, "Ne pas reprendre le téléphone"));
  assert.equal(control<HTMLInputElement>(dom, "Correction explicite du téléphone").disabled, true);
  await click(button(dom, "Enregistrer la décision"));
  const first = decisions[0]; assert.ok(first); assert.equal(first.overrides?.phone, ""); assert.equal(first.overrides?.email, undefined);
  await click(control<HTMLInputElement>(dom, "Ne pas reprendre l’email"));
  assert.equal(button(dom, "Enregistrer la décision").disabled, true);
  await dispatch(control<HTMLInputElement>(dom, "Ne pas reprendre l’email").closest("form")!, "submit");
  assert.equal(decisions.length, 1);
  await click(control<HTMLInputElement>(dom, "Ne pas reprendre le téléphone"));
  await edit(control<HTMLInputElement>(dom, "Correction explicite du téléphone"), "+212600000000");
  await click(button(dom, "Enregistrer la décision"));
  const second = decisions[1]; assert.ok(second); assert.equal(second.overrides?.email, ""); assert.equal(second.overrides?.phone, "+212600000000");
});
