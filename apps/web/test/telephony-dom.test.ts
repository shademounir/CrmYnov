import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

async function browser(t: TestContext): Promise<{ dom: JSDOM; act: typeof import("react").act; createElement: typeof import("react").createElement; root: import("react-dom/client").Root; settle(): Promise<void>; button(text: string): HTMLButtonElement; click(text: string): Promise<void>; submit(form: HTMLFormElement): Promise<void>; select(element: HTMLSelectElement, value: string): Promise<void>; text(): string }> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function (): void { this.open = false; };
  const { act, createElement } = await import("react"); const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); }); };
  const button = (text: string): HTMLButtonElement => { const element = [...dom.window.document.querySelectorAll("button")].find(b => b.textContent?.trim() === text || b.getAttribute("aria-label") === text); assert.ok(element, `button ${text}`); return element; };
  const click = async (text: string): Promise<void> => { act(() => button(text).click()); await settle(); };
  const submit = async (form: HTMLFormElement): Promise<void> => { act(() => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); await settle(); };
  const select = async (element: HTMLSelectElement, value: string): Promise<void> => { act(() => { element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); await settle(); };
  return { dom, act, createElement, root, settle, button, click, submit, select, text: (): string => dom.window.document.body.textContent ?? "" };
}

test("controlled call drawer guards readiness, double submission, uncertain dispatch and observed termination", async t => {
  const b = await browser(t); const { LeadCallDrawer } = await import("../app/leads/[leadId]/lead-call-drawer.js");
  let reason = "WORKSTATION_OFFLINE"; let mode = "LINPHONE"; let available = false; let postCount = 0; let completed = 0;
  let endMode = "uncertain"; let callMode = "valid"; let release: (() => void) | undefined; const uris: string[] = [];
  let record = { id: "synthetic-call", externalId: "123e4567-e89b-42d3-a456-426614174000", state: "REQUESTED", dispatchState: "UNCERTAIN", maskedPhone: "***165", durationSeconds: 0 };
  let poll: (() => void) | undefined;
  t.mock.method(b.dom.window, "setInterval", (fn: () => void) => { poll = fn; return 1; });
  t.mock.method(b.dom.window, "clearInterval", () => { poll = undefined; });
  t.mock.method(b.dom.window.HTMLAnchorElement.prototype, "click", function (this: HTMLAnchorElement) { uris.push(this.href); });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit): Promise<Response> => { await Promise.resolve();
    if (url.endsWith("configuration")) return Response.json({ mode, clickToCallEnabled: true, outboundEnabled: true, outboundReadiness: { available, reason, identityLabel: "Synthetic identity" } });
    if (url.endsWith("/end")) return endMode === "failure" ? Response.json({}, { status: 503 }) : Response.json({ uncertain: true });
    if (init?.method === "POST") { postCount++; assert.deepEqual(Object.keys(JSON.parse(init.body as string) as Record<string, unknown>), ["idempotencyKey"]); if (callMode === "invalid") return Response.json({}); await new Promise<void>(resolve => { release = resolve; }); }
    return Response.json(record);
  });
  b.act(() => b.root.render(b.createElement(LeadCallDrawer, { leadId: "synthetic-lead", leadCode: "LD-SYNTHETIC", phone: "+212600000165", onCompleted: () => { completed++; } })));
  for (const [next, expected] of [["WORKSTATION_OFFLINE", "hors ligne"], ["SDK_NOT_LOADED", "n’est pas chargé"], ["SIP_NOT_REGISTERED", "n’est pas enregistré"], ["WORKSTATION_NOT_PAIRED", "n’a pas de poste"], ["UNKNOWN", "injoignable"]] as const) {
    reason = next; await b.click("Appeler"); assert.ok(b.text().includes(expected)); assert.equal(b.button("Confirmer l’appel").disabled, true); await b.click("Fermer");
  }
  mode = "DISABLED"; await b.click("Appeler"); assert.match(b.text(), /mode Linphone réel/u); await b.click("Fermer");
  mode = "LINPHONE"; available = true; await b.click("Appeler"); assert.match(b.text(), /Synthetic identity/u);
  b.act(() => { b.button("Confirmer l’appel").click(); b.button("Confirmer l’appel").click(); }); await b.settle(); assert.equal(postCount, 1); assert.ok(release); release(); await b.settle();
  assert.equal(completed, 1); assert.deepEqual(uris, ["crmynov-telephony://command/123e4567-e89b-42d3-a456-426614174000"]); assert.match(b.text(), /Ne relancez pas automatiquement/u);
  await b.click("Terminer"); assert.match(b.text(), /demande de fin est incertaine/u); endMode = "failure"; await b.click("Terminer"); assert.match(b.text(), /fin d’appel n’a pas été confirmée/u);
  for (const [state, dispatchState, expected] of [["REQUESTED", "PENDING", "pas encore réclamée"], ["DIALING", "ACCEPTED", "numérotation au SDK"], ["RINGING", "ACCEPTED", "poste distant sonne"], ["ANSWERED", "ACCEPTED", "calculée depuis cet événement SDK"], ["ENDED", "ACCEPTED", "historique enregistré"]] as const) {
    record = { ...record, state, dispatchState, durationSeconds: state === "ENDED" ? 12 : 0 }; assert.ok(poll); b.act(() => poll?.()); await b.settle(); assert.ok(b.text().includes(expected));
  }
  assert.match(b.text(), /Durée observée : 12 s/u); assert.equal(poll, undefined);
  await b.click("Fermer"); callMode = "invalid"; await b.click("Appeler"); await b.click("Confirmer l’appel"); assert.match(b.text(), /commande n’a pas été confirmée/u); assert.equal(uris.length, 1);
});

test("call queue handles denied reads, empty state and explicit association conflict then success", async t => {
  const b = await browser(t); const { CallQueue } = await import("../app/calls/queue/call-queue.js");
  let status = 401; let candidates: unknown = {}; let associationStatus = 409; let associated = false; const writes: unknown[] = [];
  const call = { id: "synthetic-call", direction: "OUTBOUND", state: "MISSED", maskedPhone: "***165", matchState: "AMBIGUOUS", requestedAt: "2026-09-22T09:00:00Z" };
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit): Promise<Response> => { await Promise.resolve();
    if (url.endsWith("association-candidates")) return Response.json(candidates);
    if (url.endsWith("/association")) { writes.push(JSON.parse(init?.body as string) as Record<string, unknown>); if (associationStatus === 200) associated = true; return Response.json({}, { status: associationStatus }); }
    return Response.json({ missed: associated ? [] : [call], toVerify: associated ? [] : [call] }, { status });
  });
  b.act(() => b.root.render(b.createElement(CallQueue))); await b.settle(); assert.match(b.text(), /session a expiré/u);
  status = 403; await b.click("Réessayer"); assert.match(b.text(), /rôle ne permet pas/u);
  status = 500; await b.click("Réessayer"); assert.match(b.text(), /momentanément indisponible/u);
  status = 200; await b.click("Réessayer"); assert.match(b.text(), /heure de Casablanca/u);
  await b.click("Rapprocher"); assert.match(b.text(), /correspondances autorisées sont indisponibles/u);
  candidates = { items: [] }; await b.click("Réessayer"); assert.match(b.text(), /Aucune correspondance disponible/u); await b.click("Fermer le rapprochement");
  candidates = { items: [{ id: "lead-a", leadCode: "LD-A", displayName: "Synthetic A", campus: "A" }, { id: "lead-b", leadCode: "LD-B", displayName: "Synthetic B", campus: "A" }] };
  await b.click("Rapprocher"); await b.select(b.dom.window.document.querySelector("dialog select")!, "lead-b");
  await b.submit(b.dom.window.document.querySelector("dialog form")!); assert.match(b.text(), /décision a déjà été prise/u); assert.deepEqual(writes, [{ leadId: "lead-b" }]);
  associationStatus = 403; await b.submit(b.dom.window.document.querySelector("dialog form")!); assert.match(b.text(), /rapprochement n’a pas pu être confirmé/u);
  associationStatus = 200; await b.submit(b.dom.window.document.querySelector("dialog form")!); assert.equal(b.dom.window.document.querySelector("dialog"), null); assert.match(b.text(), /Aucun appel dans cette file/u);
});

test("provisioning edits retain versions, pairs and revokes explicitly, and activates outbound only", async t => {
  const b = await browser(t); const { TelephonyAdmin } = await import("../app/admin/telephony/telephony-admin.js");
  const server = { id: "server-a", name: "Synthetic", sipDomain: "sip.example.invalid", proxyUri: null, transport: "TLS", campusId: null, enabled: true, version: 3 };
  const user = { id: "user-a", professionalEmail: "synthetic@example.invalid", professionalDisplayName: "Synthetic", active: true };
  const workstation = { id: "station-a", active: true, displayName: "Synthetic station", sdkLoaded: true, sipRegistered: true };
  const profile = { id: "profile-a", userId: user.id, sipAddress: "sip:synthetic@example.invalid", authUsername: null, version: 4, state: "PAIRING_REQUIRED", user, server, workstations: [] as typeof workstation[] };
  let ready = false; let enabled = false; let failure = ""; const writes: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit): Promise<Response> => { await Promise.resolve();
    if (init?.method) {
      writes.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
      if (failure) return Response.json({ code: failure }, { status: 409 });
      if (url.endsWith("pairing-codes")) return Response.json({ code: "SYNTHETIC-ONLY", expiresAt: "2099-01-01T10:00:00Z", profileId: profile.id });
      if (url.endsWith("revoke")) { profile.workstations = []; ready = false; }
      if (url.endsWith("configuration")) enabled = true;
      return Response.json(server);
    }
    if (url.endsWith("provisioning")) return Response.json({ servers: [server], users: [profile] });
    if (url.endsWith("configuration")) return Response.json({ mode: enabled ? "LINPHONE" : "DISABLED", outboundEnabled: enabled, version: 7, outboundReadiness: { available: ready, reason: ready ? "READY" : "WORKSTATION_NOT_PAIRED" } });
    return Response.json({ users: [user] });
  });
  b.act(() => b.root.render(b.createElement(TelephonyAdmin))); await b.settle(); assert.equal(b.button("Activer les appels sortants").disabled, true);
  await b.submit(b.dom.window.document.querySelectorAll("form")[0]!); assert.equal(writes.at(-1)?.body.expectedVersion, 3); assert.match(b.text(), /mis à jour sans credential/u);
  await b.select(b.dom.window.document.querySelectorAll("form")[1]!.querySelector("select")!, user.id);
  await b.submit(b.dom.window.document.querySelectorAll("form")[1]!); assert.equal(writes.at(-1)?.body.expectedVersion, 4); assert.equal(writes.at(-1)?.body.authUsername, null);
  failure = "telephony_user_profile_version_conflict"; await b.submit(b.dom.window.document.querySelectorAll("form")[1]!); assert.match(b.text(), /profil a changé/u); failure = "";
  await b.click("Générer le code d’association"); assert.match(b.text(), /SYNTHETIC-ONLY/u);
  profile.workstations = [workstation]; ready = true; await b.click("Actualiser"); assert.doesNotMatch(b.text(), /SYNTHETIC-ONLY/u); assert.match(b.text(), /SDK chargé/u);
  await b.click("Activer les appels sortants"); assert.deepEqual(writes.at(-1)?.body, { expectedVersion: 7, mode: "LINPHONE", clickToCallEnabled: true, inboundEnabled: false, outboundEnabled: true, recordingPolicy: "DISABLED", maxCallDurationSeconds: 7200 }); assert.equal(b.button("Émission activée").disabled, true);
  await b.click("Révoquer"); assert.match(b.text(), /Poste révoqué/u); assert.equal(writes.at(-1)?.url.endsWith("/station-a/revoke"), true);
  assert.equal(b.dom.window.document.querySelector('input[type="password"]'), null);
});
