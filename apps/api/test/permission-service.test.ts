import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { DefaultGrantProvider, PermissionService, businessRoleLabels, permissionKeys, type GrantProvider, type ResourceContext } from "../src/permissions/permission.service.js";
import { roles, type Principal, type Role } from "../src/auth/auth.types.js";

const service = new PermissionService(new DefaultGrantProvider());
const principal = (role: Role): Principal => ({ userId: "synthetic-user", sessionId: "synthetic-session", roles: [role], scopes: [{ kind: "CAMPUS", id: "SYNTHETIC" }] });
const campus: ResourceContext = { scope: "CAMPUS", campusKeys: ["SYNTHETIC"], active: true };
const global: ResourceContext = { scope: "GLOBAL", campusKeys: [], active: true };
const expected: Record<Role, boolean[]> = {
  SUPER_ADMIN: [true, true, true, true, true, true, true],
  ADMIN: [true, true, true, true, true, true, false],
  MANAGER: [true, false, true, false, false, false, false],
  ADMISSIONS: [false, false, true, false, false, false, false],
  AUDITOR: [false, false, false, false, false, false, false],
};
for (const role of roles) test(`CRMY-44 complete permission matrix: ${role}`, async () => {
  for (const [index, permission] of permissionKeys.entries()) assert.equal(await service.can(principal(role), permission, campus), expected[role][index], permission);
});
test("global definitions cannot be administered through Admin's legacy GLOBAL session", async () => {
  const admin = { ...principal("ADMIN"), scopes: [{ kind: "GLOBAL" as const }] };
  for (const key of permissionKeys.filter((key) => key !== "lead.references.view")) {
    assert.equal(await service.can(admin, key, global), false, key);
    assert.equal(await service.can(admin, key, campus), false, key);
  }
  assert.equal(await service.can(admin, "lead.references.view", global), true);
});
test("another campus is refused; owner and active collaboration are required for adviser tags", async () => {
  for (const role of ["ADMIN", "MANAGER", "ADMISSIONS"] as const) assert.equal(await service.can(principal(role), "lead.tags.assign", { ...campus, campusKeys: ["OTHER"], ownerId: "synthetic-user" }), false);
  assert.equal(await service.can(principal("ADMISSIONS"), "lead.tags.assign", { ...campus, ownerId: "synthetic-user" }), true);
  assert.equal(await service.can(principal("ADMISSIONS"), "lead.tags.assign", { ...campus, collaboratorIds: ["synthetic-user"] }), true);
  assert.equal(await service.can(principal("ADMISSIONS"), "lead.tags.assign", { ...campus, readableResource: true }), false);
});
test("Lecteur can only read references of an already-readable resource", async () => {
  assert.equal(await service.can(principal("AUDITOR"), "lead.references.view", { ...campus, readableResource: true, active: false }), true);
  for (const key of permissionKeys.filter((key) => key !== "lead.references.view")) assert.equal(await service.can(principal("AUDITOR"), key, { ...campus, readableResource: true }), false);
  for (const role of ["MANAGER", "ADMISSIONS"] as const) assert.equal(await service.can(principal(role), "lead.references.view", { ...global, active: false }), false);
});
test("unknown permission, lead.delete, missing session, forced rotation and provider errors fail closed", async () => {
  for (const key of ["lead.delete", "unknown", "__proto__"]) assert.equal(await service.can(principal("SUPER_ADMIN"), key, global), false);
  assert.equal(await service.can(undefined, "lead.references.view", global), false);
  assert.equal(await service.can({ ...principal("SUPER_ADMIN"), sessionId: "" }, "lead.references.view", global), false);
  assert.equal(await service.can({ ...principal("SUPER_ADMIN"), mustChangeSecret: true }, "lead.references.view", global), false);
  const failed: GrantProvider = { grants: () => Promise.reject(new Error("provider unavailable")) };
  await assert.rejects(() => new PermissionService(failed).assertCan(principal("SUPER_ADMIN"), "lead.tags.assign", campus), (error: unknown) => error instanceof ForbiddenException && JSON.stringify(error.getResponse()).includes("permission_denied"));
  await service.assertCan(principal("SUPER_ADMIN"), "lead.tags.assign", global);
  assert.equal(businessRoleLabels.ADMISSIONS, "Conseiller"); assert.equal(businessRoleLabels.AUDITOR, "Lecteur");
});
