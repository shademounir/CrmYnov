import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { auditMetadata, auditView } from "../src/audit/audit-view.js";
import { auditId, parseAuditQuery } from "../src/audit/audit-query.js";
import { defaultConfiguration, defaultRoleScope, evaluatePermission, type EvaluationContext } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey, type ConfigurationSnapshot, type PermissionScope } from "../src/permissions/dynamic-contract.js";
import { PermissionService, GrantProvider, type Grant } from "../src/permissions/permission.service.js";
import type { Principal, Role } from "../src/auth/auth.types.js";

const principal = (roles: Role[]): Principal => ({ roles, userId: randomUUID(), sessionId: randomUUID(), scopes: [{ kind: "CAMPUS", id: "campus-a" }] });
const context: EvaluationContext = { campus: "campus-a", active: true, own: false, team: false, campusAllowed: true, globalAllowed: false };
function snapshot(role: Role, scope: PermissionScope): ConfigurationSnapshot {
  const target = { kind: "ROLE" as const, role, campus: "GLOBAL" };
  return { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), "audit.view": scope } };
}
test("CRMY-54 keeps eligible roles AND permission, restrictive cumulative scope and historical configurations", () => {
  for (const role of ["MANAGER", "ADMISSIONS"] as const) {
    assert.equal(defaultRoleScope(role, "audit.view"), "NONE");
    const historical = snapshot(role, "GLOBAL"), before = JSON.stringify(historical);
    assert.equal(evaluatePermission(principal([role]), "audit.view", [historical], context).allowed, false);
    assert.equal(JSON.stringify(historical), before);
  }
  for (const role of ["SUPER_ADMIN", "ADMIN", "AUDITOR"] as const) {
    assert.equal(evaluatePermission(principal([role]), "audit.view", [], context).allowed, true);
    assert.equal(evaluatePermission(principal([role]), "audit.view", [snapshot(role, "NONE")], context).allowed, false);
    const narrowed = evaluatePermission(principal([role]), "audit.view", [snapshot(role, "GLOBAL")], { ...context, campusAllowed: false });
    assert.equal(narrowed.allowed, false, "GLOBAL grant cannot exceed the applicable CAMPUS ceiling");
    assert.equal(narrowed.sources[0]?.campusCeiling, "CAMPUS");
    assert.equal(narrowed.restriction, "audit_scope_or_role_denied");
    assert.equal(evaluatePermission(principal([role]), "audit.view", [snapshot(role, "CAMPUS")], { ...context, campusAllowed: false }).allowed, false);
  }
  const mixed = principal(["ADMIN", "AUDITOR", "MANAGER"]), grants = [snapshot("ADMIN", "GLOBAL"), snapshot("AUDITOR", "CAMPUS"), snapshot("MANAGER", "GLOBAL")];
  assert.equal(evaluatePermission(mixed, "audit.view", grants, context).allowed, true);
  assert.equal(evaluatePermission(mixed, "audit.view", grants, { ...context, campusAllowed: false }).allowed, false);
  assert.equal(evaluatePermission(mixed, "audit.view", grants, { ...context, campus: "GLOBAL" }).allowed, false);
  const ceiling = { kind: "CEILING" as const, role: "*" as const, campus: "GLOBAL" };
  const denyCeiling = { ...ceiling, id: configurationKey(ceiling), version: 1, grants: { ...defaultConfiguration(ceiling), "audit.view": "NONE" as const } };
  assert.equal(evaluatePermission(mixed, "audit.view", [...grants, denyCeiling], context).allowed, false);
  assert.equal(evaluatePermission(principal(["AUDITOR"]), "lead.edit", [], context).allowed, false);
  assert.equal(evaluatePermission({ ...mixed, mustChangeSecret: true }, "audit.view", grants, context).allowed, false);
});
test("CRMY-54 GLOBAL is allowed only when every applicable ceiling is GLOBAL", async () => {
  const globalContext = { ...context, campus: "GLOBAL", campusAllowed: false };
  const target = { kind: "CEILING" as const, role: "*" as const, campus: "GLOBAL" };
  const limited: ConfigurationSnapshot = { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), "audit.view": "CAMPUS" } };
  for (const role of ["SUPER_ADMIN", "ADMIN", "AUDITOR"] as const) {
    const who = principal([role]), grant = snapshot(role, "GLOBAL");
    const allowed = evaluatePermission(who, "audit.view", [grant], globalContext);
    assert.equal(allowed.allowed, true);
    assert.deepEqual(allowed.sources.map(({ sourceScope, globalCeiling, campusCeiling, campusGrant }) => [sourceScope, globalCeiling, campusCeiling, campusGrant]), [["GLOBAL", "GLOBAL", "GLOBAL", "GLOBAL"]]);
    assert.equal(evaluatePermission(who, "audit.view", [grant, limited], globalContext).allowed, false);
    class LimitedProvider extends GrantProvider {
      grants(): Promise<readonly Grant[]> { return Promise.resolve([]); }
      override decision(): Promise<boolean> { return Promise.resolve(evaluatePermission(who, "audit.view", [grant, limited], globalContext).allowed); }
    }
    await assert.rejects(() => new PermissionService(new LimitedProvider()).assertCan(who, "audit.view", { scope: "GLOBAL", campusKeys: [], active: true }), (error: unknown) => {
      assert.ok(error instanceof Error && "getStatus" in error && "getResponse" in error);
      const denial = error as Error & { getStatus(): number; getResponse(): unknown };
      assert.equal(denial.getStatus(), 403); assert.deepEqual(denial.getResponse(), { code: "permission_denied" });
      return true;
    });
  }
});
test("CRMY-54 PermissionService refuses ineligible roles even with a permissive provider", async () => {
  class Provider extends GrantProvider {
    grants(): Promise<readonly Grant[]> { return Promise.resolve([]); }
    override decision(): Promise<boolean> { return Promise.resolve(true); }
  }
  const service = new PermissionService(new Provider()), resource = { scope: "GLOBAL" as const, campusKeys: [], active: true };
  assert.equal(await service.can(principal(["MANAGER"]), "audit.view", resource), false);
  assert.equal(await service.can(principal(["ADMISSIONS"]), "audit.view", resource), false);
  assert.equal(await service.can(principal(["AUDITOR", "MANAGER"]), "audit.view", resource), true);
  assert.equal(await service.can(undefined, "audit.view", resource), false);
});
test("CRMY-54 validates a closed query, exact filters and stable UTC snapshot", () => {
  const now = new Date("2026-09-03T12:00:00Z"), id = randomUUID();
  const parsed = parseAuditQuery({ page: "2", pageSize: "10", actorId: id, resourceId: id, resourceType: "LEAD", eventType: "LEAD_CREATED", campus: id, result: "SUCCESS", from: "2026-09-01T00:00:00Z", to: "2026-09-02T23:59:59Z" }, now);
  assert.equal(parsed.page, 2); assert.equal(parsed.pageSize, 10); assert.equal(parsed.snapshot, now); assert.equal(parsed.actorId, id); assert.equal(parsed.resourceId, id); assert.equal(parsed.campus, id);
  assert.equal(auditId(id), id); assert.equal(parseAuditQuery({}, now).pageSize, 25);
  assert.equal(parseAuditQuery({ snapshot: "2026-09-02T00:00:00.001Z" }, now).snapshot.toISOString(), "2026-09-02T00:00:00.001Z");
  for (const raw of [{ unknown: "x" }, { page: "0" }, { page: "10001" }, { pageSize: "101" }, { page: [] }, { actorId: "x" }, { campus: [] }, { result: "OTHER" }, { result: [] }, { eventType: "email@example.invalid" }, { eventType: [] }, { from: "2026-02-31T00:00:00Z" }, { from: "invalid" }, { snapshot: "2027-01-01T00:00:00Z" }, { from: "2026-09-02T00:00:00Z", to: "2026-09-01T00:00:00Z" }]) assert.throws(() => parseAuditQuery(raw, now));
});
test("CRMY-54 response cannot expose nested secrets, arbitrary text, sessions, hashes or identifiers", () => {
  assert.deepEqual(auditMetadata({ version: 2, active: true, token: "synthetic-do-not-expose", passwordHash: "synthetic", nested: { version: 1 }, message: "synthetic", count: -1, created: 1.5 }), { version: 2, active: true });
  for (const input of [null, [], "text"]) assert.deepEqual(auditMetadata(input), {});
  const row = { id: randomUUID(), eventType: "unsafe@example.invalid", actorId: "unsafe@example.invalid", actorRoles: ["AUDITOR", "INVALID"], campusId: null, resourceType: null, resourceId: "not-uuid", result: "untrusted", occurredAt: new Date(), before: null, after: { count: 2, hash: "synthetic", session: "synthetic" }, minimizedIp: "203.0.113.0", sessionId: randomUUID(), correlationId: "synthetic", idempotencyKey: "synthetic" };
  const view = auditView(row); assert.equal(view.actorId, null); assert.equal(view.eventType, "OTHER"); assert.equal(view.result, "UNKNOWN"); assert.equal(view.resourceId, null); assert.deepEqual(view.actorRoles, ["AUDITOR"]); assert.deepEqual(view.after, { count: 2 });
  assert.equal("sessionId" in view, false); assert.equal("minimizedIp" in view, false); assert.equal("correlationId" in view, false); assert.equal("idempotencyKey" in view, false);
});
