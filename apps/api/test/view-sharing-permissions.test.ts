import assert from "node:assert/strict";
import test from "node:test";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { configurationKey, historicalGrants, permissionCatalogue, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";
import { defaultConfiguration, defaultRoleScope, evaluatePermission, type EvaluationContext } from "../src/permissions/dynamic-evaluator.js";
import { viewGrantKeys } from "../src/permissions/view-grants.js";

const target: ConfigurationTarget = { kind: "ROLE", role: "MANAGER", campus: "GLOBAL" };
const context: EvaluationContext = { campus: "synthetic-campus", active: true, own: true, team: true, managedTeam: true, campusAllowed: true, globalAllowed: false };
function principal(role: Role): Principal { return { userId: "synthetic-actor", sessionId: "synthetic-session", roles: [role], scopes: [{ kind: "CAMPUS", id: context.campus }] }; }
function row(selected: ConfigurationTarget, key: string, scope: "NONE" | "TEAM" | "CAMPUS" | "GLOBAL"): ConfigurationSnapshot {
  return { ...selected, id: configurationKey(selected), version: 1, grants: { ...defaultConfiguration(selected), [key]: scope } };
}

test("sharing default matrix enables governed Manager TEAM, not CAMPUS or adviser sharing", () => {
  assert.equal(defaultRoleScope("MANAGER", "lead.views.share.team"), "TEAM");
  assert.equal(defaultRoleScope("MANAGER", "lead.views.share.campus"), "NONE");
  assert.equal(defaultRoleScope("ADMISSIONS", "lead.views.share.team"), "NONE");
  assert.equal(defaultRoleScope("ADMISSIONS", "lead.views.share.campus"), "NONE");
  for (const key of viewGrantKeys) {
    assert.equal(defaultRoleScope("SUPER_ADMIN", key), "GLOBAL");
    assert.equal(defaultRoleScope("AUDITOR", key), key === "lead.views.view" ? "CAMPUS" : "NONE");
  }
  assert.equal(defaultRoleScope("ADMIN", "lead.views.share.campus"), "CAMPUS");
  assert.equal(defaultRoleScope("ADMISSIONS", "lead.views.revoke.own"), "OWN");
});

test("Manager TEAM needs explicit responsibility, even with matching team membership", () => {
  const key = "lead.views.share.team", actor = principal("MANAGER");
  assert.equal(evaluatePermission(actor, key, [], context).allowed, true);
  assert.equal(evaluatePermission(actor, key, [], { ...context, managedTeam: false }).allowed, false);
  assert.equal(evaluatePermission(actor, key, [], { ...context, campusAllowed: false }).allowed, false);
});

test("explicit adviser grant is usable only within all ceilings and does not revive a forbidden global grant", () => {
  const key = "lead.views.share.campus", actor = principal("ADMISSIONS");
  const global = row({ ...target, role: "ADMISSIONS" }, key, "CAMPUS");
  const campus = row({ ...target, role: "ADMISSIONS", campus: context.campus }, key, "CAMPUS");
  assert.equal(evaluatePermission(actor, key, [global, campus], context).allowed, true);
  assert.equal(evaluatePermission(actor, key, [campus], context).allowed, false);
  const denied = row({ kind: "CEILING", role: "*", campus: "GLOBAL" }, key, "NONE");
  assert.equal(evaluatePermission(actor, key, [global, campus, denied], context).allowed, false);
  assert.equal(evaluatePermission(actor, key, [global, campus], { ...context, campusAllowed: false }).allowed, false);
});

test("AUDITOR-only remains nonmutative even if an erroneous row grants GLOBAL", () => {
  for (const key of viewGrantKeys) {
    if (key === "lead.views.view") continue;
    const granted = row({ ...target, role: "AUDITOR" }, key, "GLOBAL");
    assert.equal(evaluatePermission(principal("AUDITOR"), key, [granted], context).allowed, false);
  }
});

test("complete historical catalogues retain every old decision and deny all new sharing capabilities", () => {
  const original = Object.fromEntries(Object.entries(defaultConfiguration(target)).filter(([key]) => !(viewGrantKeys as readonly string[]).includes(key)));
  const before = structuredClone(original), resolved = historicalGrants(original, target);
  assert.deepEqual(original, before);
  for (const [key, value] of Object.entries(original)) assert.equal(resolved[key], value);
  for (const key of viewGrantKeys) assert.equal(resolved[key], "NONE");
  assert.equal(Object.keys(resolved).length, permissionCatalogue.length);
  assert.equal(evaluatePermission(principal("MANAGER"), "lead.views.share.team", [{ ...target, id: configurationKey(target), version: 1, grants: resolved }], context).allowed, false);
});

test("partial, unknown and invalid historical grants stay fail-closed", () => {
  const original = defaultConfiguration(target);
  assert.deepEqual(historicalGrants(original, target), original);
  const incomplete = { ...original }; delete incomplete["lead.view"];
  assert.throws(() => historicalGrants(incomplete, target));
  assert.throws(() => historicalGrants({ ...original, "view.unknown": "GLOBAL" }, target));
  assert.throws(() => historicalGrants({ ...original, "lead.view": "UNBOUNDED" }, target));
  assert.throws(() => historicalGrants({ ...original, "lead.views.share.team": "GLOBAL" }, { ...target, role: "AUDITOR" }));
});
