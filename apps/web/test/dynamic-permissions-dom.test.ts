import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("CRMY-169 real React editor events: no write on cancel, confirmed save, conflict, restore and provider failure", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: RolesPage } = await import("../app/admin/roles/page");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close(); for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let version = 0, writes = 0, failing = false, conflict = false;
  let responsibilityActive = true, responsibilityVersion = 1;
  const grants: Record<string, string> = { "lead.view": "CAMPUS", "lead.edit": "CAMPUS" };
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit): Promise<Response> => {
    await Promise.resolve(); // Preserve fetch's asynchronous contract for React effects.
    assert.ok(path.startsWith("/api/crm/admin/role-permissions/"));
    if (failing) return Response.json({ code: "permission_store_unavailable" }, { status: 503 });
    const url = new URL(path, "http://localhost"); const endpoint = url.pathname.split("/").at(-1);
    const role = url.searchParams.get("role") ?? "MANAGER";
    if (endpoint === "team-responsibilities") {
      if (init?.method === "POST") {
        assert.equal(typeof init.body, "string");
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        assert.equal(body.confirmed, true); assert.equal(body.expectedVersion, responsibilityVersion);
        assert.equal(body.teamId, "synthetic-team"); assert.equal(body.campusId, "synthetic-campus");
        assert.equal(body.managerId, "synthetic-manager"); assert.equal(typeof body.active, "boolean");
        responsibilityActive = body.active as boolean; responsibilityVersion++;
      }
      return Response.json({ responsibilities: [{ id: "synthetic-relation", teamId: "synthetic-team", campusId: "synthetic-campus", managerId: "synthetic-manager", active: responsibilityActive, version: responsibilityVersion }] });
    }
    if (endpoint === "catalogue") return Response.json({ catalogueVersion: 1, campus: url.searchParams.get("campus") ?? "GLOBAL", catalogue: Object.keys(grants).map((key) => ({ key, module: "lead", mutation: key === "lead.edit", sensitive: key === "lead.edit", reserved: false, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"] })), roles: ["MANAGER", "AUDITOR"].map((role) => ({ role, label: role, description: "Rôle synthétique", users: 2, editable: true })), campuses: [{ id: "synthetic-campus", code: "SYNTHETIC" }], global: true });
    if (endpoint === "configuration" && !init?.method) return Response.json({ kind: "ROLE", role, campus: url.searchParams.get("campus"), version, inherited: version === 0, grants: { ...grants, ...(role === "AUDITOR" ? { "lead.edit": "NONE" } : {}) }, globalCeiling: { "lead.view": "GLOBAL", "lead.edit": "GLOBAL" } });
    if (endpoint === "history") return Response.json({ versions: version ? [{ number: version, createdAt: "2026-09-02T12:00:00Z", audits: [{ actorId: "synthetic-admin", actorRoles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", createdAt: "2026-09-02T12:00:00Z" }] }] : [] });
    if (endpoint === "preview") return Response.json({ changes: [{ permission: "lead.edit", from: "CAMPUS", to: "NONE", widening: false, sensitive: true }], affectedUsers: 2, mutated: false });
    if (endpoint === "effective") return Response.json({ permissions: [], businessRules: "Validation Manager conservée." });
    if (conflict) return Response.json({ code: "permission_version_conflict" }, { status: 409 });
    assert.equal(init?.method, "POST"); assert.equal(typeof init.body, "string"); const body = JSON.parse(init.body as string) as Record<string, unknown>;
    assert.equal(body.confirmed, true); assert.equal(body.expectedVersion, version);
    if (endpoint === "configuration") Object.assign(grants, body.grants);
    else { assert.equal(endpoint, "restore"); assert.ok(Number.isInteger(body.restoreVersion)); }
    writes++; version++; return Response.json({ version }, { status: 201 });
  });
  const doc = dom.window.document;
  const button = (text: string): HTMLButtonElement => { const item = [...doc.querySelectorAll("button")].find((node) => node.textContent === text); assert.ok(item, text); return item; };
  const click = async (element: HTMLElement): Promise<void> => { await act(async () => { element.click(); await Promise.resolve(); }); };
  const input = (selector: string): HTMLInputElement => { const element = doc.querySelector<HTMLInputElement>(selector); assert.ok(element, selector); return element; };
  const confirm = async (): Promise<void> => { const box = [...doc.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((node) => node.parentElement?.textContent?.includes("Je confirme les modifications")); assert.ok(box); await click(box); };
  await act(async () => { root.render(createElement(RolesPage)); await Promise.resolve(); });
  assert.match(doc.body.textContent, /Rôle synthétique/);
  assert.match(doc.body.textContent, /votre compte connecté et ses rôles cumulés, pas le rôle sélectionné ni son brouillon/);
  assert.match(doc.body.textContent, /Brouillon identique à la configuration chargée/);
  await click(input('input[role="switch"]:last-of-type'));
  assert.match(doc.body.textContent, /Brouillon non enregistré/);
  await click(button("Prévisualiser les changements")); assert.equal(button("Enregistrer la nouvelle version").disabled, true);
  assert.match(doc.body.textContent, /Avant/); assert.match(doc.body.textContent, /Après/);
  await click(button("Annuler")); assert.equal(writes, 0);
  await click(input('input[role="switch"]')); await click(button("Prévisualiser les changements")); await confirm();
  await click(button("Enregistrer la nouvelle version")); assert.equal(writes, 1); assert.match(doc.body.textContent, /Nouvelle version enregistrée/);
  await click(button("Expliquer mes droits dans ce contexte")); assert.match(doc.body.textContent, /Validation Manager conservée/);
  await click(button("Restaurer la version 1")); await click(button("Annuler la restauration")); assert.equal(writes, 1);
  await click(button("Restaurer la version 1")); await click(button("Confirmer la restauration")); assert.equal(writes, 2);
  conflict = true; await click(button("Prévisualiser les changements")); await confirm(); await click(button("Enregistrer la nouvelle version"));
  assert.equal(writes, 2); assert.match(doc.body.textContent, /Conflit de version/);
  await click(button("Charger les responsabilités"));
  await click(button("synthetic-team · synthetic-manager · v1 · Active"));
  const responsibilityBox = [...doc.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((node) => node.parentElement?.textContent === "Responsabilité active");
  assert.ok(responsibilityBox); await click(responsibilityBox);
  assert.equal(button("Enregistrer la responsabilité v2").disabled, true);
  const responsibilityConfirm = [...doc.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((node) => node.parentElement?.textContent?.includes("Je confirme cette responsabilité"));
  assert.ok(responsibilityConfirm); await click(responsibilityConfirm);
  await click(button("Enregistrer la responsabilité v2"));
  assert.equal(responsibilityActive, false); assert.equal(responsibilityVersion, 2);
  assert.match(doc.body.textContent, /Responsabilité enregistrée et auditée/);
  failing = true; await click(button("Recharger depuis le serveur")); assert.match(doc.body.textContent, /Aucun droit de secours/);
  assert.equal(doc.querySelectorAll('[role="switch"]').length, 0);
});

test("CRMY-169 stale preview and effective responses cannot cross role or Lead contexts", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: RolesPage } = await import("../app/admin/roles/page");
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); dom.window.close(); for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  let resolveEffective: ((value: Response) => void) | undefined;
  let resolvePreview: ((value: Response) => void) | undefined;
  let effectiveSignal: AbortSignal | undefined;
  let previewSignal: AbortSignal | undefined;
  let effectiveCalls = 0;
  const grants = { "lead.view": "CAMPUS", "lead.edit": "CAMPUS" };
  t.mock.method(globalThis, "fetch", async (path: string, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    if (path.startsWith("/api/crm/leads?")) return Response.json({ items: [{ id: "synthetic-lead", leadCode: "SYN-1", firstName: "Synthetic", lastName: "Prospect" }] });
    const url = new URL(path, "http://localhost"), endpoint = url.pathname.split("/").at(-1);
    if (endpoint === "catalogue") return Response.json({ catalogueVersion: 1, campus: "GLOBAL", catalogue: Object.keys(grants).map((key) => ({ key, module: "lead", mutation: key === "lead.edit", sensitive: false, reserved: false, scopes: ["NONE", "CAMPUS", "GLOBAL"] })), roles: ["MANAGER", "AUDITOR"].map((role) => ({ role, label: role, description: `Contexte ${role}`, users: 2, editable: true })), campuses: [], global: true });
    if (endpoint === "configuration") return Response.json({ kind: "ROLE", role: url.searchParams.get("role"), campus: "GLOBAL", version: 0, inherited: true, grants, globalCeiling: { "lead.view": "GLOBAL", "lead.edit": "GLOBAL" } });
    if (endpoint === "history") return Response.json({ versions: [] });
    if (endpoint === "effective") {
      effectiveCalls++;
      if (effectiveCalls > 1) return Response.json({ permissions: [], businessRules: "Explication du contexte courant." });
      effectiveSignal = init?.signal ?? undefined;
      return await new Promise<Response>((resolve) => { resolveEffective = resolve; });
    }
    assert.equal(endpoint, "preview"); previewSignal = init?.signal ?? undefined;
    return await new Promise<Response>((resolve) => { resolvePreview = resolve; });
  });
  const doc = dom.window.document;
  const button = (text: string): HTMLButtonElement => { const item = [...doc.querySelectorAll("button")].find((node) => node.textContent === text); assert.ok(item, text); return item; };
  const select = (label: string): HTMLSelectElement => { const item = [...doc.querySelectorAll("label")].find((node) => node.textContent?.startsWith(label))?.querySelector("select"); assert.ok(item, label); return item; };
  const click = async (element: HTMLElement): Promise<void> => { await act(async () => { element.click(); await Promise.resolve(); }); };
  const change = async (element: HTMLSelectElement, value: string): Promise<void> => { await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await Promise.resolve(); }); };
  await act(async () => { root.render(createElement(RolesPage)); await Promise.resolve(); });
  await click(button("Expliquer mes droits dans ce contexte"));
  assert.equal(select("Contexte Lead").disabled, true, "Lead context is disabled while a request is pending");
  // A queued event may still arrive during a context transition. The result must
  // be fenced even when a transport does not honor AbortSignal.
  await change(select("Contexte Lead"), "synthetic-lead");
  assert.equal(effectiveSignal?.aborted, true);
  await act(async () => { assert.ok(resolveEffective); resolveEffective(Response.json({ permissions: [], businessRules: "Explication obsolète." })); await Promise.resolve(); });
  assert.doesNotMatch(doc.body.textContent, /Explication obsolète/);
  await click(button("Expliquer mes droits dans ce contexte"));
  assert.match(doc.body.textContent, /Explication du contexte courant/);
  await click(button("Prévisualiser les changements"));
  await change(select("Rôle système"), "AUDITOR");
  assert.equal(previewSignal?.aborted, true);
  await act(async () => { assert.ok(resolvePreview); resolvePreview(Response.json({ changes: [{ permission: "lead.edit", from: "CAMPUS", to: "NONE", widening: false, sensitive: true }], affectedUsers: 9, expectedVersion: 0, mutated: false })); await Promise.resolve(); });
  assert.match(doc.body.textContent, /Contexte AUDITOR/);
  assert.doesNotMatch(doc.body.textContent, /9 utilisateurs|Explication du contexte courant/);
  assert.equal(select("Contexte Lead").value, "", "role changes reset the previous Lead context");
  assert.equal(button("Recharger depuis le serveur").disabled, false);
});
