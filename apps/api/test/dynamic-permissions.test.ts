import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { configurationKey, permissionCatalogue, scopeWithin, validateInput, validateTarget, type ConfigurationInput, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";
import { defaultConfiguration, evaluatePermission, resolveGrants, type EvaluationContext } from "../src/permissions/dynamic-evaluator.js";
import { configurationChanges } from "../src/permissions/dynamic-service.js";
import { GrantProvider, PermissionService, type Grant, type ResourceContext } from "../src/permissions/permission.service.js";
import { contextualPermissions, routePermissions } from "../src/permissions/dynamic-routes.js";
import { validateResponsibility } from "../src/permissions/dynamic-teams.js";

const principal = (roles: Role[] = ["MANAGER"]): Principal => ({ userId: "synthetic-manager", roles, scopes: [{ kind: "CAMPUS", id: "SYNTHETIC" }], sessionId: "synthetic-session" });
const context: EvaluationContext = { campus: "SYNTHETIC", active: true, own: false, team: false, campusAllowed: true, globalAllowed: false };
function snapshot(target: ConfigurationTarget, permission: string, scope: "NONE" | "OWN" | "TEAM" | "CAMPUS" | "GLOBAL"): ConfigurationSnapshot {
  return { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), [permission]: scope } };
}
const roleTarget = (role: Role, campus = "GLOBAL"): ConfigurationTarget => ({ kind: "ROLE", role, campus });
const ceiling = (campus = "GLOBAL"): ConfigurationTarget => ({ kind: "CEILING", role: "*", campus });
const key = "lead.edit";

test("CRMY-169 NONE contributes nothing, another legitimate role remains effective", () => {
  const rows = [snapshot(roleTarget("ADMISSIONS"), key, "NONE")];
  const decision = evaluatePermission(principal(["ADMISSIONS", "MANAGER"]), key, rows, context);
  assert.equal(decision.allowed, true); assert.equal(decision.sources[0]?.allowed, false); assert.equal(decision.sources[1]?.allowed, true);
});
test("CRMY-169 union is restricted independently by global, campus and resource scopes", () => {
  const rows = [snapshot(roleTarget("MANAGER"), key, "TEAM"), snapshot(roleTarget("ADMISSIONS"), key, "OWN"), snapshot(ceiling(), key, "OWN")];
  assert.equal(evaluatePermission(principal(["MANAGER", "ADMISSIONS"]), key, rows, { ...context, team: true }).allowed, false);
  assert.equal(evaluatePermission(principal(["MANAGER", "ADMISSIONS"]), key, rows, { ...context, own: true }).allowed, true);
});
for (const target of [ceiling(), ceiling("SYNTHETIC"), roleTarget("MANAGER", "SYNTHETIC")]) {
  test(`CRMY-169 explicit NONE has no permissive fallback: ${configurationKey(target)}`, () => {
    assert.equal(evaluatePermission(principal(), key, [snapshot(target, key, "NONE")], context).allowed, false);
  });
}
test("CRMY-169 missing configuration uses the explicit registry defaults, duplicates fail closed", () => {
  assert.equal(evaluatePermission(principal(), key, [], context).allowed, true);
  const row = snapshot(roleTarget("MANAGER"), key, "NONE");
  assert.throws(() => resolveGrants([row, row], roleTarget("MANAGER")), /ambiguous/);
});
test("CRMY-169 OWN and TEAM are incomparable; GLOBAL and CAMPUS ceilings never widen a grant", () => {
  assert.equal(scopeWithin("TEAM", "OWN"), false); assert.equal(scopeWithin("OWN", "TEAM"), false);
  assert.equal(scopeWithin("GLOBAL", "CAMPUS"), false); assert.equal(scopeWithin("CAMPUS", "GLOBAL"), true);
  assert.equal(scopeWithin("NONE", "OWN"), true); assert.equal(scopeWithin("OWN", "CAMPUS"), true);
});
for (const [name, overrides] of [
  ["other campus", { campusAllowed: false }], ["archived resource", { active: false }],
  ["business restriction", { restriction: "manager_approval_required" }],
] as const) test(`CRMY-169 ${name} remains denied even with a matching role`, () => {
  assert.equal(evaluatePermission(principal(), key, [], { ...context, ...overrides }).allowed, false);
});
test("CRMY-169 no lead.delete, absent identity/session or first-login bypass", () => {
  for (const actor of [{ ...principal(), userId: "" }, { ...principal(), sessionId: "" }, { ...principal(), mustChangeSecret: true }]) assert.equal(evaluatePermission(actor, key, [], context).allowed, false);
  assert.equal(evaluatePermission(principal(["SUPER_ADMIN"]), "lead.delete", [], { ...context, globalAllowed: true }).allowed, false);
});
test("CRMY-169 AUDITOR is structurally read-only, even if storage supplies an invalid mutative grant", () => {
  for (const item of permissionCatalogue.filter((item) => item.mutation)) {
    const decision = evaluatePermission(principal(["AUDITOR"]), item.key, [snapshot(roleTarget("AUDITOR"), item.key, "GLOBAL")], context);
    assert.equal(decision.allowed, false, item.key);
    if (item.available) assert.equal(decision.sources[0]?.restriction, "auditor_read_only");
  }
});
test("CRMY-169 AUDITOR + MANAGER does not deny the Manager's grant and exposes its source", () => {
  const decision = evaluatePermission(principal(["AUDITOR", "MANAGER"]), key, [], context);
  assert.equal(decision.allowed, true); assert.deepEqual(decision.sources.filter((source) => source.allowed).map((source) => source.role), ["MANAGER"]);
  assert.equal(decision.sources[1]?.globalCeiling, "GLOBAL"); assert.equal(decision.sources[1]?.campusCeiling, "CAMPUS");
});
function input(): ConfigurationInput { const target = roleTarget("AUDITOR"); return { ...target, grants: defaultConfiguration(target), expectedVersion: 0, reason: "ACCESS_REVIEW", confirmed: true }; }
test("CRMY-169 payload mutation of AUDITOR refused irrespective of submitting role", () => {
  validateInput(input());
  assert.throws(() => validateInput({ ...input(), grants: { ...input().grants, "lead.edit": "CAMPUS" } }));
});
test("CRMY-169 strict closed catalogue, scopes, version, reason, campus and fields", () => {
  const mutations: unknown[] = [null, { ...input(), extra: true }, { ...input(), expectedVersion: -1 }, { ...input(), confirmed: "true" }, { ...input(), reason: "FREE_TEXT" }, { ...input(), role: "UNKNOWN" }, { ...input(), kind: "DELETE" }, { ...input(), campus: "../outside" }, { ...input(), grants: {} }, { ...input(), grants: [] }, { ...input(), grants: { ...input().grants, "lead.delete": "GLOBAL" } }, { ...input(), grants: { ...input().grants, "lead.view": "SUPER" } }];
  for (const value of mutations) assert.throws(() => validateInput(value as ConfigurationInput));
  assert.throws(() => validateTarget({ kind: "CEILING", role: "ADMIN", campus: "GLOBAL" }));
  assert.throws(() => validateInput({ ...input(), campus: "SYNTHETIC", grants: { ...input().grants, "lead.view": "GLOBAL" } }));
});
test("CRMY-169 change preview distinguishes additions, reductions, removals and widening", () => {
  assert.deepEqual(configurationChanges({ a: "NONE", b: "GLOBAL", c: "CAMPUS", d: "OWN", e: "TEAM" }, { a: "OWN", b: "CAMPUS", c: "NONE", d: "TEAM", e: "TEAM" }).map((item) => [item.permission, item.widening]), [["a", true], ["b", false], ["c", false], ["d", true]]);
});
test("CRMY-169 provider errors deny without returning legacy defaults", async () => {
  class Unavailable extends GrantProvider { grants(): Promise<readonly Grant[]> { return Promise.reject(new Error("unavailable")); } }
  const service = new PermissionService(new Unavailable());
  const resource: ResourceContext = { scope: "CAMPUS", campusKeys: ["SYNTHETIC"], active: true };
  assert.equal(await service.can(principal(["SUPER_ADMIN"]), "lead.tags.assign", resource), false);
  await assert.rejects(() => service.assertCan(principal(), "lead.tags.assign", resource), ForbiddenException);
});
test("CRMY-169 route permission registry denies unknown controllers and handlers", () => {
  assert.equal(routePermissions("UnknownController", "create"), null);
  assert.equal(routePermissions("LeadController", "delete"), null);
  assert.deepEqual(routePermissions("LeadController", "update"), ["lead.edit"]);
  assert.deepEqual(routePermissions("ReassignmentController", "decide"), ["lead.reassign.approve"]);
});

test("CRMY-169 TEAM for a Manager requires explicit responsibility without denying another role's membership", () => {
  const rows = [snapshot(roleTarget("MANAGER"), key, "TEAM"), snapshot(roleTarget("ADMISSIONS"), key, "TEAM")];
  assert.equal(evaluatePermission(principal(), key, rows, { ...context, team: true }).allowed, false);
  assert.equal(evaluatePermission(principal(), key, rows, { ...context, managedTeam: true }).allowed, true);
  const union = evaluatePermission(principal(["MANAGER", "ADMISSIONS"]), key, rows, { ...context, team: true });
  assert.deepEqual(union.sources.filter((source) => source.allowed).map((source) => source.role), ["ADMISSIONS"]);
});
test("CRMY-169 closing statuses and unscoped global reports cannot bypass dedicated grants", () => {
  assert.deepEqual(contextualPermissions("LeadStatusController", ["lead.edit"], { status: "ENROLLED" }, {}, false), ["lead.edit", "lead.close.approve"]);
  assert.deepEqual(contextualPermissions("LeadStatusController", ["lead.edit"], { status: "CLOSED_LOST" }, {}, false), ["lead.edit", "lead.close.approve"]);
  assert.deepEqual(contextualPermissions("LeadStatusController", ["lead.edit"], { status: "CONTACTED" }, {}, false), ["lead.edit"]);
  assert.deepEqual(contextualPermissions("ManagerDashboardController", ["reporting.view"], null, {}, true), ["reporting.view", "reporting.global.view"]);
  assert.deepEqual(contextualPermissions("ManagerDashboardController", ["reporting.view"], null, { campus: "synthetic" }, true), ["reporting.view"]);
});
test("CRMY-169 responsibility payload is closed, confirmed and versioned", () => {
  const valid = { teamId: "synthetic-team", campusId: "00000000-0000-4000-8000-000000000001", managerId: "00000000-0000-4000-8000-000000000002", active: true, expectedVersion: 0, confirmed: true };
  validateResponsibility(valid);
  for (const value of [null, [], { ...valid, extra: true }, { ...valid, teamId: "../team" }, { ...valid, teamId: undefined }, { ...valid, expectedVersion: -1 }, { ...valid, confirmed: false }, { ...valid, active: "true" }]) assert.throws(() => validateResponsibility(value as typeof valid));
});
