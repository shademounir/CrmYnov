import assert from "node:assert/strict";
import test from "node:test";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { defaultConfiguration, evaluatePermission } from "../src/permissions/dynamic-evaluator.js";
import { historicalGrants, permissionCatalogueVersion, validateGrants, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";
import { contextualPermissions, routePermissions, usesScopedReportingAuthorization } from "../src/permissions/dynamic-routes.js";
import { hasPilotageReportingScope, withPilotageReportingScope } from "../src/reporting/reporting-authority.js";
import { normalizeReportingQuery } from "../src/reporting/reporting-filter.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../src/permissions/dynamic-repository.js";

const target = (role: Role): ConfigurationTarget => ({ kind: "ROLE", role, campus: "GLOBAL" });
const commercial: Principal = { userId: "synthetic-commercial", roles: ["ADMISSIONS"], sessionId: "synthetic-session", scopes: [{ kind: "CAMPUS", id: "synthetic-campus" }] };
const context = { campus: "synthetic-campus", active: true, own: true, team: false, campusAllowed: true, globalAllowed: false };

test("v4 separates full pilotage from ordinary personal reports and all admin powers", () => {
  assert.equal(permissionCatalogueVersion, 4);
  for (const role of ["ADMISSIONS", "AUDITOR"] as const) assert.equal(defaultConfiguration(target(role))["reporting.pilotage.view"], "NONE");
  for (const role of ["MANAGER", "ADMIN"] as const) assert.equal(defaultConfiguration(target(role))["reporting.pilotage.view"], "CAMPUS");
  assert.equal(defaultConfiguration(target("SUPER_ADMIN"))["reporting.pilotage.view"], "GLOBAL");
  const grants = { ...defaultConfiguration(target("ADMISSIONS")), "reporting.pilotage.view": "CAMPUS" as const };
  const rows = [{ ...target("ADMISSIONS"), id: "ROLE:ADMISSIONS:GLOBAL", version: 1, grants }];
  assert.equal(evaluatePermission(commercial, "reporting.pilotage.view", rows, context).allowed, true);
  for (const key of ["users.roles.assign", "roles.permissions.manage", "settings.global.manage", "reporting.global.view", "lead.close.approve", "lead.reassign.approve"]) assert.equal(evaluatePermission(commercial, key, rows, context).allowed, false, key);
  assert.equal(evaluatePermission(commercial, "reporting.pilotage.view", rows, { ...context, campusAllowed: false }).allowed, false);
});

test("complete old catalogues retain only old manager/admin access without ordinary-role grants or overwriting revocation", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] as const) {
    const current = defaultConfiguration(target(role));
    const old = { ...current }; delete old["reporting.pilotage.view"];
    const upgraded = historicalGrants(old, target(role));
    assert.equal(upgraded["reporting.pilotage.view"], ["ADMISSIONS", "AUDITOR"].includes(role) ? "NONE" : current["reporting.pilotage.view"]);
    assert.equal(Object.hasOwn(old, "reporting.pilotage.view"), false, "Historical input must remain immutable");
    assert.equal(historicalGrants({ ...current, "reporting.pilotage.view": "NONE" }, target(role))["reporting.pilotage.view"], "NONE");
    assert.equal(historicalGrants({ ...old, "reporting.view": "NONE" }, target(role))["reporting.pilotage.view"], "NONE");
    const incomplete = { ...old }; delete incomplete["lead.view"]; assert.throws(() => historicalGrants(incomplete, target(role)));
  }
  const ceiling: ConfigurationTarget = { kind: "CEILING", role: "*", campus: "GLOBAL" };
  const previous: Record<string, string> = { ...defaultConfiguration(ceiling), "reporting.view": "CAMPUS" }; delete previous["reporting.pilotage.view"];
  assert.equal(historicalGrants(previous, ceiling)["reporting.pilotage.view"], "CAMPUS");
});

test("resource scopes are configurable without turning OWN or TEAM into a fabricated campus grant", () => {
  for (const key of ["reporting.view", "reporting.pilotage.view", "reporting.export"]) for (const scope of ["OWN", "TEAM"] as const) {
    const grants = { ...defaultConfiguration(target("ADMISSIONS")), [key]: scope };
    validateGrants(grants, target("ADMISSIONS"));
    const rows = [{ ...target("ADMISSIONS"), id: "ROLE:ADMISSIONS:GLOBAL", version: 1, grants }];
    assert.equal(evaluatePermission(commercial, key, rows, { ...context, own: false, team: false }).allowed, false);
    assert.equal(evaluatePermission(commercial, key, rows, { ...context, own: scope === "OWN", team: scope === "TEAM" }).allowed, true);
  }
});

test("pilotage proof is server-local, discarded on failure and never fabricated by query or copied identity", async () => {
  const forged = { ...commercial, permissionLeadIds: new Set(["synthetic-lead"]), canViewPilotageDashboard: true };
  assert.equal(hasPilotageReportingScope(forged), false);
  assert.throws(() => normalizeReportingQuery({ view: "global" }, forged));
  await assert.rejects(() => withPilotageReportingScope(forged, () => {
    assert.equal(hasPilotageReportingScope(forged), true);
    assert.equal(hasPilotageReportingScope({ ...forged }), false);
    assert.equal(normalizeReportingQuery({ view: "global" }, forged).view, "global");
    throw new Error("synthetic_failure");
  }));
  assert.equal(hasPilotageReportingScope(forged), false);
  assert.throws(() => normalizeReportingQuery({ view: "global" }, forged));
});

test("only reviewed reporting adapters defer resource scope checks; global reporting stays reserved", () => {
  assert.deepEqual(routePermissions("ManagerDashboardController", "read"), ["reporting.view", "reporting.pilotage.view"]);
  assert.deepEqual(routePermissions("DashboardCapabilitiesController", "read"), []);
  assert.equal(usesScopedReportingAuthorization("ManagerDashboardController", "read"), true);
  assert.equal(usesScopedReportingAuthorization("ManagerDashboardController", "unknown"), false);
  assert.equal(usesScopedReportingAuthorization("UserController", "read"), false);
  assert.deepEqual(contextualPermissions("ManagerDashboardController", ["reporting.pilotage.view"], null, {}, true), ["reporting.pilotage.view", "reporting.global.view"]);
});

test("catalogue adoption appends an auditable compatibility version, preserves old history and is idempotent", async () => {
  const roles: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"];
  const rows = roles.map((role) => {
    const grants = { ...defaultConfiguration(target(role)) }; delete grants["reporting.pilotage.view"];
    return { ...target(role), id: `ROLE:${role}:GLOBAL`, version: 1, versions: [{ number: 1, grants: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })) }] };
  });
  const originals = structuredClone(rows);
  const audits: Array<{ previous: Record<string, string>; next: Record<string, string> }> = [];
  const tx = {
    rolePermissionConfiguration: {
      findMany: (): Promise<typeof rows> => Promise.resolve(rows),
      update: ({ where, data }: { where: { id: string; version: number }; data: { version: number } }): Promise<typeof rows[number]> => {
        const row = rows.find((item) => item.id === where.id)!; assert.equal(row.version, where.version); row.version = data.version; return Promise.resolve(row);
      },
    },
    rolePermissionVersion: {
      create: ({ data }: { data: { configurationId: string; number: number; grants: { create: Array<{ permission: string; scope: string }> }; audits: { create: { previous: Record<string, string>; next: Record<string, string> } } } }): Promise<Record<string, never>> => {
        const row = rows.find((item) => item.id === data.configurationId)!;
        row.versions.push({ number: data.number, grants: data.grants.create as typeof row.versions[number]["grants"] });
        audits.push(data.audits.create); return Promise.resolve({});
      },
    },
  };
  const repository = new DynamicPermissionRepository({} as never);
  // Synthetic transaction only: this test cannot open any database connection.
  repository.transaction = <T>(action: (value: PermissionTransaction) => Promise<T>): Promise<T> => action(tx as never);
  assert.equal(await repository.upgradeCurrentCatalogue(), 5);
  assert.equal(audits.length, 5);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.version, 2); assert.deepEqual(row.versions[0], originals[index]!.versions[0]);
    const upgraded = Object.fromEntries(row.versions[1]!.grants.map((grant) => [grant.permission, grant.scope]));
    assert.equal(upgraded["reporting.pilotage.view"], defaultConfiguration(target(row.role as Role))["reporting.pilotage.view"]);
    assert.equal(Object.hasOwn(audits[index]!.previous, "reporting.pilotage.view"), false);
  }
  assert.equal(await repository.upgradeCurrentCatalogue(), 0); assert.equal(audits.length, 5);
  rows[2]!.versions[1]!.grants.find((grant) => grant.permission === "reporting.pilotage.view")!.scope = "NONE";
  assert.equal(await repository.upgradeCurrentCatalogue(), 0);
  assert.equal(rows[2]!.versions[1]!.grants.find((grant) => grant.permission === "reporting.pilotage.view")!.scope, "NONE");
});
