import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import type { OwnTelephonySnapshot } from "../app/account/telephony/own-telephony-contract";

const unpaired: OwnTelephonySnapshot = {
  global: { enabled: true, mode: "LINPHONE" }, profile: { id: "profile-synthetic", extension: "synthetic-extension", enabled: true, state: "PAIRING_REQUIRED", version: 1 },
  workstation: null, readiness: { available: false, reason: "WORKSTATION_NOT_PAIRED" }, canPair: true, canRevoke: false,
  localPreferencesOnly: true, inboundEnabled: false, recordingEnabled: false,
};
const ready: OwnTelephonySnapshot = {
  ...unpaired, profile: { ...unpaired.profile!, state: "READY" }, canPair: false, canRevoke: true, readiness: { available: true, reason: null },
  workstation: { id: "station-synthetic", displayName: "Poste synthétique", active: true, connectionState: "CONNECTED", sdkLoaded: true, sipRegistered: true, agentVersion: "synthetic-pilot", sdkVersion: "synthetic-sdk", lastSeenAt: "2026-10-04T21:00:00Z", pairedAt: "2026-10-04T20:00:00Z", revokedAt: null, version: 3, inputConfigured: true, outputConfigured: true, lastErrorCode: null },
};

async function browser(t: TestContext): Promise<{
  dom: JSDOM; act: typeof import("react").act; render(): Promise<void>; settle(): Promise<void>;
  click(text: string): Promise<void>; button(text: string): HTMLButtonElement; body(): string;
}> {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/account/telephony" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function (): void { this.open = true; this.querySelector<HTMLButtonElement>("button")?.focus(); };
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client");
  const { OwnTelephony } = await import("../app/account/telephony/own-telephony");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(() => { act(() => root.unmount()); dom.window.close(); for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  const settle = async (): Promise<void> => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  const button = (text: string): HTMLButtonElement => { const element = [...dom.window.document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text); assert.ok(element, text); return element; };
  return { dom, act, settle, button, body: (): string => dom.window.document.body.textContent ?? "", render: async (): Promise<void> => { act(() => root.render(createElement(OwnTelephony))); await settle(); }, click: async (text: string): Promise<void> => { act(() => button(text).click()); await settle(); } };
}

test("own page distinguishes missing profile, disabled, offline, revoked and ready observed states without exposing global administration", async (t) => {
  const b = await browser(t); let dto: OwnTelephonySnapshot = { ...unpaired, profile: null, canPair: false, readiness: { available: false, reason: "USER_PROFILE_NOT_CONFIGURED" } };
  t.mock.method(globalThis, "fetch", (input: string, init?: RequestInit): Promise<Response> => { assert.equal(input, "/api/crm/telephony/me"); assert.equal(init?.method, undefined); return Promise.resolve(Response.json({ ...dto, secretReference: "PRIVATE-SYNTHETIC", token: "PRIVATE-SYNTHETIC" })); });
  await b.render(); assert.match(b.body(), /Aucune extension/u); assert.doesNotMatch(b.body(), /PRIVATE-SYNTHETIC/u);
  assert.equal(b.dom.window.document.querySelector<HTMLInputElement>("#own-agent-gateway")?.value, "http://localhost/agent/");
  assert.equal(b.dom.window.document.querySelector('[href="/admin/telephony"]'), null);
  assert.equal(b.dom.window.document.querySelector('[href="crmynov-telephony://open"]')?.getAttribute("href"), "crmynov-telephony://open");
  for (const [reason, expected] of [["USER_PROFILE_DISABLED", /profil téléphonique est désactivé/u], ["WORKSTATION_OFFLINE", /dernier contact est trop ancien/u], ["WORKSTATION_AMBIGUOUS", /aucun poste n’est choisi arbitrairement/u]] as const) {
    dto = { ...ready, readiness: { available: false, reason }, canRevoke: false }; await b.click("Actualiser"); assert.match(b.body(), expected); assert.doesNotMatch(b.body(), /Votre poste est prêt/u);
  }
  dto = { ...ready, workstation: { ...ready.workstation!, active: false, revokedAt: "2026-10-04T21:01:00Z" }, readiness: { available: false, reason: "WORKSTATION_NOT_PAIRED" } }; await b.click("Actualiser"); assert.match(b.body(), /Révoquée/u);
  dto = ready; await b.click("Actualiser"); assert.match(b.body(), /Votre poste est prêt/u); assert.match(b.body(), /Poste prêt pour une demande d’appel/u); assert.match(b.body(), /enregistré au dernier contact/u);
  assert.match(b.body(), /Réception et enregistrement audio sont désactivés/u);
});

test("own page fails closed on expired session, denied read, API outage and malformed snapshot", async (t) => {
  const b = await browser(t); let status = 401; let payload: unknown = {};
  t.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(Response.json(payload, { status })));
  await b.render(); assert.match(b.body(), /session a expiré/u); assert.equal(b.dom.window.document.querySelector('[href="/"]')?.textContent, "Se reconnecter");
  status = 403; await b.click("Actualiser"); assert.match(b.body(), /permissions actuelles/u);
  status = 503; await b.click("Actualiser"); assert.match(b.body(), /service téléphonique est momentanément indisponible/u);
  status = 200; payload = {}; await b.click("Actualiser"); assert.match(b.body(), /momentanément indisponible/u);
  assert.equal(b.dom.window.document.querySelector('[href="crmynov-telephony://open"]'), null);
  assert.doesNotMatch(b.body(), /Votre poste est prêt/u);
});

test("pairing needs explicit confirmation, suppresses double submission and keeps the code transient and masked", async (t) => {
  const b = await browser(t); let dto = structuredClone(unpaired); let writes = 0; let release: (() => void) | undefined; const payloads: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit): Promise<Response> => {
    if (!init?.method) return Response.json(dto);
    assert.equal(input, "/api/crm/telephony/me/pairing-codes"); assert.equal(init.method, "POST"); payloads.push(JSON.parse(init.body as string) as unknown); writes++;
    await new Promise<void>((resolve) => { release = resolve; });
    dto = { ...dto, profile: { ...dto.profile!, version: 2 } };
    return Response.json({ code: "SYNTHETIC_ONLY_CODE", profileId: dto.profile!.id, expiresAt: "2099-01-01T10:00:00Z", version: 2 });
  });
  await b.render(); assert.equal(writes, 0); assert.equal(b.button("Générer mon code d’association").disabled, true);
  const confirm = b.dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  b.act(() => confirm.click()); b.act(() => { b.button("Générer mon code d’association").click(); b.button("Générer mon code d’association").click(); }); await b.settle();
  assert.equal(writes, 1); assert.deepEqual(payloads, [{ expectedVersion: 1 }]); assert.ok(release); release(); await b.settle();
  const code = b.dom.window.document.querySelector<HTMLInputElement>("#own-pairing-code")!;
  assert.equal(code.type, "password"); assert.equal(code.value, "SYNTHETIC_ONLY_CODE"); assert.equal(code.readOnly, true);
  assert.equal(b.button("Générer mon code d’association").disabled, true);
  await b.click("Afficher le code"); assert.equal(code.type, "text"); await b.click("Masquer le code"); assert.equal(code.type, "password");
  assert.equal(b.dom.window.localStorage.length, 0); assert.equal(b.dom.window.sessionStorage.length, 0); assert.equal(b.dom.window.location.search, "");
  await b.click("Masquer et retirer le code de cette page"); assert.equal(b.dom.window.document.querySelector("#own-pairing-code"), null);
  b.act(() => confirm.click()); b.act(() => b.button("Générer mon code d’association").click()); await b.settle();
  assert.equal(writes, 2); assert.deepEqual(payloads[1], { expectedVersion: 2 }); release(); await b.settle();
  await b.click("Actualiser"); assert.equal(b.dom.window.document.querySelector("#own-pairing-code"), null); assert.equal(writes, 2);
});

test("expired code is removed before reveal without another mutation", async (t) => {
  const b = await browser(t); let now = Date.parse("2026-10-04T21:00:00Z"); let writes = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", (input: string, init?: RequestInit): Promise<Response> => {
    if (!init?.method) return Promise.resolve(Response.json(unpaired)); writes++; assert.equal(input, "/api/crm/telephony/me/pairing-codes");
    return Promise.resolve(Response.json({ code: "SYNTHETIC_ONLY_CODE", profileId: unpaired.profile!.id, expiresAt: "2026-10-04T21:10:00Z", version: 2 }));
  });
  await b.render(); b.act(() => b.dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await b.click("Générer mon code d’association");
  now = Date.parse("2026-10-04T21:10:00Z"); await b.click("Afficher le code"); assert.equal(b.dom.window.document.querySelector("#own-pairing-code"), null); assert.equal(writes, 1);
});

test("a delayed pairing response cannot restore a credential after pagehide or a cached page return", async (t) => {
  const b = await browser(t); let writes = 0; let reads = 0; let release: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit): Promise<Response> => {
    if (!init?.method) { reads++; return Response.json(unpaired); }
    assert.equal(input, "/api/crm/telephony/me/pairing-codes"); writes++;
    await new Promise<void>((resolve) => { release = resolve; });
    return Response.json({ code: "SYNTHETIC_LATE_CODE", profileId: unpaired.profile!.id, expiresAt: "2099-01-01T10:00:00Z", version: 2 });
  });
  await b.render(); b.act(() => b.dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  b.act(() => b.button("Générer mon code d’association").click()); await b.settle(); assert.equal(writes, 1);
  b.act(() => b.dom.window.dispatchEvent(new b.dom.window.Event("pagehide"))); await b.settle();
  assert.match(b.body(), /page a été quittée pendant une opération/u); assert.equal(b.button("Générer mon code d’association").disabled, true);
  assert.ok(release); release(); await b.settle();
  assert.equal(b.dom.window.document.querySelector("#own-pairing-code"), null); assert.doesNotMatch(b.body(), /SYNTHETIC_LATE_CODE/u); assert.equal(writes, 1);
  const returned = new b.dom.window.Event("pageshow"); Object.defineProperty(returned, "persisted", { value: true });
  b.act(() => b.dom.window.dispatchEvent(returned)); await b.settle(); assert.equal(reads, 2); assert.equal(writes, 1);
  assert.equal(b.dom.window.document.querySelector("#own-pairing-code"), null); assert.equal(b.button("Actualiser").disabled, false);
});

test("own revocation is explicitly confirmed, rejects in-flight work and never replaces a workstation automatically", async (t) => {
  const b = await browser(t); let dto = structuredClone(ready), status = 409; const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", (input: string, init?: RequestInit): Promise<Response> => {
    if (!init?.method) return Promise.resolve(Response.json(dto));
    assert.equal(input, "/api/crm/telephony/me/workstations/station-synthetic/revoke"); assert.equal(init.method, "PATCH"); writes.push(JSON.parse(init.body as string) as unknown);
    if (status === 409) return Promise.resolve(Response.json({ code: "telephony_workstation_busy" }, { status }));
    dto = { ...unpaired, workstation: { ...ready.workstation!, active: false, revokedAt: "2026-10-04T21:10:00Z", version: 4 } };
    return Promise.resolve(Response.json(dto));
  });
  await b.render(); await b.click("Révoquer mon poste"); assert.equal(writes.length, 0);
  assert.equal(b.dom.window.document.activeElement, b.button("Conserver mon poste"));
  await b.click("Conserver mon poste"); assert.equal(writes.length, 0); await b.click("Révoquer mon poste"); await b.click("Confirmer la révocation");
  assert.equal(writes.length, 1); assert.deepEqual(writes[0], { expectedVersion: 3 });
  assert.match(b.dom.window.document.querySelector("dialog")!.textContent ?? "", /commande est encore en cours/u);
  assert.equal(b.button("Confirmer la révocation").disabled, true);
  await b.click("Conserver mon poste"); await b.click("Actualiser"); status = 200; await b.click("Révoquer mon poste"); await b.click("Confirmer la révocation");
  assert.equal(writes.length, 2); assert.equal(b.dom.window.document.querySelector("dialog"), null); assert.match(b.body(), /Cela ne confirme pas l’arrêt du client SIP/u);
  assert.equal(b.button("Générer mon code d’association").disabled, true); assert.equal(b.dom.window.document.querySelector("#own-pairing-code"), null);
});
