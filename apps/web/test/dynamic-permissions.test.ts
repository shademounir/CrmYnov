import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionEditor } from "../app/admin/roles/permission-editor";
import { ChangePreview, EffectivePermissions, PermissionHistory } from "../app/admin/roles/permission-evidence";
import { changeLabel, isLocked, offeredScopes, permissionRequest, scopeLabels, type Configuration, type Definition } from "../app/admin/roles/permission-types";
const item: Definition = { key: "lead.edit", module: "lead", mutation: true, sensitive: true, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"], reserved: false };
const config: Configuration = { kind: "ROLE", role: "AUDITOR", campus: "GLOBAL", version: 0, inherited: true, grants: { "lead.edit": "NONE" }, globalCeiling: { "lead.edit": "GLOBAL" } };
test("CRMY-169 AUDITOR mutative toggle and scope are disabled with an accessible explanation", () => {
  const html = renderToStaticMarkup(createElement(PermissionEditor, { items: [item], configuration: config, grants: config.grants, editable: true, busy: false, onChange: () => { throw new Error("render must not mutate"); } }));
  assert.match(html, /role="switch" disabled=""/); assert.match(html, /non attribuables/); assert.match(html, /Affecté ou collaborateur actif/);
  assert.equal(isLocked(item, config, true), true); assert.equal(isLocked(item, { ...config, role: "MANAGER" }, true), false);
  assert.equal(isLocked(item, { ...config, role: "MANAGER" }, false), true);
  assert.deepEqual(offeredScopes(item, "synthetic-campus"), ["NONE", "OWN", "TEAM", "CAMPUS"]);
});
test("CRMY-169 mandatory Super Admin capacity and reserved global permissions remain locked", () => {
  assert.equal(isLocked({ ...item, key: "roles.permissions.manage" }, { ...config, role: "SUPER_ADMIN" }, true), true);
  assert.equal(isLocked({ ...item, reserved: true }, { ...config, campus: "synthetic-campus", role: "MANAGER" }, true), true);
  assert.match(renderToStaticMarkup(createElement(PermissionEditor, { items: [], configuration: { ...config, inherited: false, version: 2 }, grants: {}, editable: false, busy: true, onChange: () => {} })), /Aucune permission/);
});
test("CRMY-169 preview explains business changes and never claims a save", () => {
  const changes = [{ permission: "lead.edit", from: "NONE" as const, to: "OWN" as const, widening: true, sensitive: true }];
  const html = renderToStaticMarkup(createElement(ChangePreview, { preview: { changes, affectedUsers: 3, expectedVersion: 2, mutated: false } }));
  assert.match(html, /3 utilisateurs/); assert.match(html, /Ajout/); assert.match(html, /aucune mutation effectuée/);
  assert.equal(changeLabel({ ...changes[0]!, from: "CAMPUS", to: "NONE" }), "Retrait");
  assert.equal(changeLabel({ ...changes[0]!, from: "OWN", to: "TEAM" }), "Élargissement / changement de ressources");
  assert.equal(changeLabel({ ...changes[0]!, from: "CAMPUS", to: "OWN", widening: false }), "Réduction");
  assert.match(renderToStaticMarkup(createElement(ChangePreview, { preview: { changes: [], affectedUsers: 0, expectedVersion: 0, mutated: false } })), /Aucun changement/);
});
test("CRMY-169 history exposes minimized author and restoration as a new immutable version", () => {
  const versions = [{ number: 2, createdAt: "2026-09-02T12:00:00Z", audits: [{ actorId: "synthetic-admin-id", actorRoles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", createdAt: "2026-09-02T12:00:00Z" }] }];
  const html = renderToStaticMarkup(createElement(PermissionHistory, { versions, busy: false, editable: true, onRestore: () => {} }));
  assert.match(html, /synthetic-admin-id/); assert.match(html, /Restaurer la version 2/); assert.match(html, /nouvelle version/);
  assert.match(renderToStaticMarkup(createElement(PermissionHistory, { versions: [], busy: true, editable: false, onRestore: () => {} })), /Aucune version/);
});
test("CRMY-169 multi-role explanation identifies the role which actually grants access", () => {
  const explanation = { businessRules: "Validation Manager obligatoire.", permissions: [{ permission: "lead.edit", allowed: true, restriction: null, sources: [{ role: "AUDITOR", sourceScope: "NONE" as const, globalCeiling: "GLOBAL" as const, campusCeiling: "CAMPUS" as const, campusGrant: "NONE" as const, allowed: false, restriction: "auditor_read_only" }, { role: "MANAGER", sourceScope: "TEAM" as const, globalCeiling: "GLOBAL" as const, campusCeiling: "CAMPUS" as const, campusGrant: "TEAM" as const, allowed: true, restriction: null }] }] };
  const html = renderToStaticMarkup(createElement(EffectivePermissions, { explanation }));
  assert.match(html, /MANAGER/); assert.match(html, /auditor_read_only/); assert.match(html, /Validation Manager obligatoire/); assert.match(html, /plafond global/);
  assert.match(renderToStaticMarkup(createElement(EffectivePermissions, { explanation: { ...explanation, permissions: [{ ...explanation.permissions[0]!, allowed: false, restriction: "campus_forbidden" }] } })), /campus_forbidden/);
  assert.equal(scopeLabels.OWN, "Affecté ou collaborateur actif");
});
test("CRMY-169 no-store same-origin requests, version conflict and fail-closed errors", async (context) => {
  context.mock.method(globalThis, "fetch", (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "/api/crm/admin/role-permissions/configuration"); assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin");
    assert.equal(init.method, "POST"); assert.equal(init.body, JSON.stringify({ expectedVersion: 2 })); return Promise.resolve(Response.json({ version: 3 }));
  });
  assert.deepEqual(await permissionRequest("configuration", { expectedVersion: 2 }), { version: 3 });
  context.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 409 })));
  await assert.rejects(() => permissionRequest("configuration"), /Conflit de version/);
  context.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 503 })));
  await assert.rejects(() => permissionRequest("configuration"), /Aucun droit de secours/);
});
