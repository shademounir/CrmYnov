import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionEditor } from "../app/admin/roles/permission-editor";
import { ChangePreview, EffectivePermissions, PermissionHistory } from "../app/admin/roles/permission-evidence";
import { ConfigurationImpact, DashboardGuidance } from "../app/admin/roles/permission-guidance";
import { changeLabel, draftChanges, isLocked, lockReason, offeredScopes, permissionRequest, scopeLabels, type Catalogue, type Configuration, type Definition } from "../app/admin/roles/permission-types";
const item: Definition = { key: "lead.edit", module: "lead", mutation: true, sensitive: true, scopes: ["NONE", "OWN", "TEAM", "CAMPUS", "GLOBAL"], reserved: false };
const config: Configuration = { kind: "ROLE", role: "AUDITOR", campus: "GLOBAL", version: 0, inherited: true, grants: { "lead.edit": "NONE" }, globalCeiling: { "lead.edit": "GLOBAL" } };
test("CRMY-169 AUDITOR mutative toggle and scope are disabled with an accessible explanation", () => {
  const html = renderToStaticMarkup(createElement(PermissionEditor, { items: [item], configuration: config, grants: config.grants, editable: true, busy: false, onChange: () => { throw new Error("render must not mutate"); } }));
  assert.match(html, /role="switch"[^>]*disabled=""/); assert.match(html, /non attribuables/); assert.match(html, /Affecté ou collaborateur actif/);
  assert.match(html, /aria-label="Activer cette capacité :/); assert.match(html, /aria-describedby="permission-lead-edit-help"/);
  assert.equal(isLocked(item, config, true), true); assert.equal(isLocked(item, { ...config, role: "MANAGER" }, true), false);
  assert.equal(isLocked(item, { ...config, role: "MANAGER" }, false), true);
  assert.deepEqual(offeredScopes(item, "synthetic-campus"), ["NONE", "OWN", "TEAM", "CAMPUS"]);
});
test("CRMY-178 grouped permissions identify local deltas and precise read-only reasons", () => {
  const pilotage: Definition = { ...item, key: "reporting.pilotage.view", module: "reporting", mutation: false, sensitive: false };
  const saved = { ...config, role: "MANAGER", inherited: false, version: 3, grants: { "lead.edit": "CAMPUS" as const, "reporting.pilotage.view": "NONE" as const }, globalCeiling: { "lead.edit": "GLOBAL" as const, "reporting.pilotage.view": "GLOBAL" as const } };
  const draft = { ...saved.grants, "reporting.pilotage.view": "TEAM" as const };
  const html = renderToStaticMarkup(createElement(PermissionEditor, { items: [item, pilotage], configuration: saved, grants: draft, editable: true, busy: false, onChange: () => {} }));
  assert.equal(draftChanges([item, pilotage], saved, draft), 1);
  assert.equal(draftChanges([item, pilotage], saved, saved.grants), 0);
  assert.match(html, /permission-module-lead/); assert.match(html, /permission-module-reporting/);
  assert.match(html, /Accéder au tableau de bord Pilotage/); assert.match(html, /Enregistré : Aucun droit/); assert.match(html, /Modifié/);
  assert.match(html, /ne prennent effet qu’après enregistrement/);
  assert.equal(lockReason(item, saved, false), "Cette configuration est accessible en lecture seule.");
  assert.match(lockReason({ ...item, available: false }, saved, true) ?? "", /non encore exposée/);
  assert.match(lockReason({ ...item, reserved: true }, { ...saved, campus: "synthetic-campus" }, true) ?? "", /réservé/);
});
test("CRMY-178 Pilotage guidance separates draft from saved rights and does not infer administrative authority", () => {
  const pilotage: Definition = { ...item, key: "reporting.pilotage.view", module: "reporting", mutation: false, sensitive: false };
  const catalogue: Catalogue = { catalogueVersion: 4, campus: "synthetic-campus", catalogue: [pilotage], roles: [], campuses: [], global: false };
  const configuration = { ...config, campus: "synthetic-campus", role: "ADMISSIONS", grants: { "reporting.pilotage.view": "NONE" as const } };
  const html = renderToStaticMarkup(createElement(DashboardGuidance, { catalogue, configuration, grants: { "reporting.pilotage.view": "OWN" } }));
  assert.match(html, /Enregistré/); assert.match(html, /Brouillon local/); assert.match(html, /Aucun droit/); assert.match(html, /Affecté ou collaborateur actif/);
  assert.match(html, /exige la consultation des indicateurs/); assert.match(html, /chaque Lead/); assert.match(html, /L’export dispose de sa propre permission/);
  assert.match(html, /responsabilité Admissions ne donne pas automatiquement/); assert.match(html, /n’accorde aucun droit d’administration/);
  assert.match(html, /Super Admin doit d’abord autoriser son périmètre global/);
  const previous = renderToStaticMarkup(createElement(DashboardGuidance, { catalogue: { ...catalogue, catalogueVersion: 3, catalogue: [] }, configuration, grants: {} }));
  assert.match(previous, /ne propose pas encore une autorisation Pilotage distincte/);
  assert.doesNotMatch(previous, /Attribué dans ce brouillon/);
});
test("CRMY-178 review states the role-campus audience, not a per-user exception", () => {
  const catalogue: Catalogue = { catalogueVersion: 4, campus: "GLOBAL", catalogue: [], roles: [{ role: "ADMISSIONS", label: "Commercial", description: "", editable: true, users: 7 }], campuses: [{ id: "synthetic-campus", code: "Campus synthétique" }], global: true };
  const html = renderToStaticMarkup(createElement(ConfigurationImpact, { catalogue, configuration: { ...config, role: "ADMISSIONS" } }));
  assert.match(html, /rôle Commercial/); assert.match(html, /7 utilisateurs associés/);
  assert.match(html, /pas les droits d’une personne seule/); assert.match(html, /campus sans configuration propre/);
  const campus = renderToStaticMarkup(createElement(ConfigurationImpact, { catalogue, configuration: { ...config, role: "ADMISSIONS", campus: "synthetic-campus" } }));
  assert.match(campus, /Campus synthétique/); assert.doesNotMatch(campus, /campus sans configuration propre/);
});
test("CRMY-169 mandatory Super Admin capacity and reserved global permissions remain locked", () => {
  assert.equal(isLocked({ ...item, key: "roles.permissions.manage" }, { ...config, role: "SUPER_ADMIN" }, true), true);
  assert.equal(isLocked({ ...item, reserved: true }, { ...config, campus: "synthetic-campus", role: "MANAGER" }, true), true);
  assert.match(renderToStaticMarkup(createElement(PermissionEditor, { items: [], configuration: { ...config, inherited: false, version: 2 }, grants: {}, editable: false, busy: true, onChange: () => {} })), /Aucune permission/);
});
test("CRMY-169 preview explains business changes and never claims a save", () => {
  const changes = [{ permission: "lead.edit", from: "NONE" as const, to: "OWN" as const, widening: true, sensitive: true }];
  const html = renderToStaticMarkup(createElement(ChangePreview, { preview: { changes, affectedUsers: 3, expectedVersion: 2, mutated: false } }));
  assert.match(html, /3 utilisateurs/); assert.match(html, /Ajout/); assert.match(html, /aucune modification enregistrée/); assert.doesNotMatch(html, /lead\.edit/);
  assert.equal(changeLabel({ ...changes[0]!, from: "CAMPUS", to: "NONE" }), "Retrait");
  assert.equal(changeLabel({ ...changes[0]!, from: "OWN", to: "TEAM" }), "Élargissement / changement de ressources");
  assert.equal(changeLabel({ ...changes[0]!, from: "CAMPUS", to: "OWN", widening: false }), "Réduction");
  assert.match(renderToStaticMarkup(createElement(ChangePreview, { preview: { changes: [], affectedUsers: 0, expectedVersion: 0, mutated: false } })), /Aucun changement/);
});
test("CRMY-169 history hides technical identifiers and restores as a new immutable version", () => {
  const versions = [{ number: 2, createdAt: "2026-09-02T12:00:00Z", audits: [{ actorId: "synthetic-admin-id", actorRoles: ["SUPER_ADMIN"], reason: "ACCESS_REVIEW", createdAt: "2026-09-02T12:00:00Z" }] }];
  const html = renderToStaticMarkup(createElement(PermissionHistory, { versions, busy: false, editable: true, onRestore: () => {} }));
  assert.doesNotMatch(html, /synthetic-admin-id/); assert.match(html, /Modification auditée/); assert.match(html, /Restaurer la version 2/); assert.match(html, /nouvelle version/);
  assert.match(renderToStaticMarkup(createElement(PermissionHistory, { versions: [], busy: true, editable: false, onRestore: () => {} })), /Aucune version/);
});
test("CRMY-169 multi-role explanation identifies the role which actually grants access", () => {
  const explanation = { businessRules: "Validation Manager obligatoire.", permissions: [{ permission: "lead.edit", allowed: true, restriction: null, sources: [{ role: "AUDITOR", sourceScope: "NONE" as const, globalCeiling: "GLOBAL" as const, campusCeiling: "CAMPUS" as const, campusGrant: "NONE" as const, allowed: false, restriction: "auditor_read_only" }, { role: "MANAGER", sourceScope: "TEAM" as const, globalCeiling: "GLOBAL" as const, campusCeiling: "CAMPUS" as const, campusGrant: "TEAM" as const, allowed: true, restriction: null }] }] };
  const html = renderToStaticMarkup(createElement(EffectivePermissions, { explanation }));
  assert.match(html, /MANAGER/); assert.match(html, /Rôle Lecteur limité/); assert.doesNotMatch(html, /auditor_read_only/); assert.match(html, /Validation Manager obligatoire/); assert.match(html, /plafond global/);
  assert.match(renderToStaticMarkup(createElement(EffectivePermissions, { explanation: { ...explanation, permissions: [{ ...explanation.permissions[0]!, allowed: false, restriction: "campus_forbidden" }] } })), /Une règle métier limite cette action/);
  assert.equal(scopeLabels.OWN, "Affecté ou collaborateur actif");
});
test("CRMY-169 no-store same-origin requests, version conflict and fail-closed errors", async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "/api/crm/admin/role-permissions/configuration"); assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.method, "POST"); assert.equal(init.body, JSON.stringify({ expectedVersion: 2 })); return Promise.resolve(Response.json({ version: 3 }));
  });
  assert.deepEqual(await permissionRequest("configuration", { expectedVersion: 2 }, controller.signal), { version: 3 });
  context.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 409 })));
  await assert.rejects(() => permissionRequest("configuration"), /Conflit de version/);
  context.mock.method(globalThis, "fetch", (): Promise<Response> => Promise.resolve(new Response(null, { status: 503 })));
  await assert.rejects(() => permissionRequest("configuration"), /Aucun droit de secours/);
});
