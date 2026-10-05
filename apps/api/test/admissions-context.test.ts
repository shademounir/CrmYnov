import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { AdmissionsService } from "../src/admissions/admissions.service.js";
import type { Principal, Role } from "../src/auth/auth.types.js";
import { configurationKey, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import type { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";

const campusA = { id: "00000000-0000-4000-8000-000000000175", code: "SYNTHETIC_A", label: "Synthetic A", kind: "CAMPUS", state: "ACTIVE", keys: [] as Array<{ key: string }> };
const campusB = { ...campusA, id: "00000000-0000-4000-8000-000000000176", code: "SYNTHETIC_B", label: "Synthetic B" };
const archived = { ...campusA, id: "00000000-0000-4000-8000-000000000177", code: "SYNTHETIC_ARCHIVED", label: "Synthetic archived", state: "ARCHIVED" };
type CampusRow = typeof campusA;
type ScalarSelector = string | { in: string[] };
type Selector = { id?: ScalarSelector; code?: ScalarSelector; label?: ScalarSelector; keys?: { some: { key: ScalarSelector } } };

function fixture(role: Role = "SUPER_ADMIN", campusId: string | null = null, snapshots: ConfigurationSnapshot[] = []): { service: AdmissionsService; principal: Principal } {
  // Isolated synthetic transaction adapter: exercises currentPrincipal and actual
  // grant evaluation, but is not a PostgreSQL or permission-fence concurrency proof.
  const actor = { id: "synthetic-actor", roles: [role], campusId, teamId: null, active: true, firstLoginRequired: false, authenticationVersion: 1, professionalDisplayName: "Synthetic actor" };
  const users = [
    actor,
    { ...actor, id: "synthetic-user-a", roles: ["ADMISSIONS" as Role], campusId: campusA.id },
    { ...actor, id: "synthetic-user-b", roles: ["ADMISSIONS" as Role], campusId: campusB.id },
    { ...actor, id: "synthetic-user-archived", roles: ["ADMISSIONS" as Role], campusId: archived.id },
    { ...actor, id: "synthetic-user-inactive", roles: ["ADMISSIONS" as Role], campusId: campusA.id, active: false },
    { ...actor, id: "synthetic-user-first-access", roles: ["ADMISSIONS" as Role], campusId: campusA.id, firstLoginRequired: true },
    { ...actor, id: "synthetic-reader", roles: ["AUDITOR" as Role], campusId: campusA.id },
  ];
  const matchesScalar = (value: string, selector?: ScalarSelector): boolean => typeof selector === "string" ? value === selector : selector?.in.includes(value) === true;
  const matches = (row: CampusRow, selector: Selector): boolean =>
    matchesScalar(row.id, selector.id) || matchesScalar(row.code, selector.code) || matchesScalar(row.label, selector.label) || row.keys.some(({ key }) => matchesScalar(key, selector.keys?.some.key));
  const tx = {
    collaborator: {
      findUnique: ({ where }: { where: { id: string } }): Promise<typeof actor | null> => Promise.resolve(users.find((user) => user.id === where.id) ?? null),
      findMany: ({ where }: { where: { active: boolean; firstLoginRequired: boolean; campusId: { in: string[] } } }): Promise<typeof users> => {
        assert.equal(where.active, true); assert.equal(where.firstLoginRequired, false);
        return Promise.resolve(users.filter((user) => user.active && !user.firstLoginRequired && user.campusId !== null && where.campusId.in.includes(user.campusId)));
      },
    },
    localSession: { findUnique: (): Promise<object> => Promise.resolve({ active: true, collaboratorId: actor.id, expiresAt: new Date("2099-12-31T00:00:00Z"), authenticationVersion: actor.authenticationVersion }) },
    crmReference: {
      findUnique: ({ where }: { where: { id: string } }): Promise<CampusRow | null> => Promise.resolve([campusA, campusB, archived].find((row) => row.id === where.id) ?? null),
      findMany: ({ where }: { where: { kind: string; state: string; OR?: Selector[]; AND?: Array<{ OR: Selector[] }> } }): Promise<CampusRow[]> => {
        assert.equal(where.kind, "CAMPUS"); assert.equal(where.state, "ACTIVE");
        return Promise.resolve([campusA, campusB, archived].filter((row) => row.state === where.state && (!where.OR || where.OR.some((selector) => matches(row, selector))) && (!where.AND || where.AND.every((group) => group.OR.some((selector) => matches(row, selector))))));
      },
    },
    admissionsResponsibility: { findMany: (): Promise<[]> => Promise.resolve([]) },
  };
  const permissions = {
    transaction: <T>(action: (value: typeof tx) => Promise<T>, mode: string): Promise<T> => { assert.equal(mode, "read"); return action(tx); },
    snapshots: (): Promise<ConfigurationSnapshot[]> => Promise.resolve(snapshots),
  } as unknown as DynamicPermissionRepository;
  const principal: Principal = { userId: actor.id, sessionId: "synthetic-session", roles: [role], scopes: role === "SUPER_ADMIN" ? [{ kind: "GLOBAL" }] : [{ kind: "CAMPUS", id: campusId ?? "" }] };
  return { service: new AdmissionsService(permissions), principal };
}

test("Admissions context explicitly identifies both manageable active campuses for a global administrator without an assigned campus", async () => {
  const f = fixture(); const context = await f.service.context(f.principal);
  assert.deepEqual(context.campuses, [campusA, campusB].map(({ id, code, label }) => ({ id, code, label, canManageResponsibilities: true })));
  assert.equal(context.canManageResponsibilities, true); assert.equal(context.canUseAgenda, true);
  assert.deepEqual(context.eligibleUsers.map((user) => user.id), ["synthetic-user-a", "synthetic-user-b"]);
  assert.ok(context.eligibleUsers.every((user) => [campusA.code, campusB.code].includes(user.campus)));
});

test("Admissions context bounds management campuses and eligible users to the administrator's current persisted campus", async () => {
  const f = fixture("ADMIN", campusA.id);
  // Stale/forged incoming global claims do not override the persisted identity.
  const context = await f.service.context({ ...f.principal, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }] });
  assert.deepEqual(context.campuses, [{ id: campusA.id, code: campusA.code, label: campusA.label, canManageResponsibilities: true }]);
  assert.equal(context.canManageResponsibilities, true);
  assert.ok(context.eligibleUsers.some((user) => user.id === "synthetic-user-a"));
  assert.ok(context.eligibleUsers.every((user) => user.campus === campusA.code));
});

test("Admissions context does not advertise responsibility management or eligible users for a USE-only campus", async () => {
  const target: ConfigurationTarget = { kind: "CEILING", role: "*", campus: campusB.id };
  const restricted: ConfigurationSnapshot = { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), "settings.campus.manage": "NONE" } };
  const f = fixture("SUPER_ADMIN", null, [restricted]); const context = await f.service.context(f.principal);
  assert.deepEqual(context.campuses.map(({ code, canManageResponsibilities }) => ({ code, canManageResponsibilities })), [
    { code: campusA.code, canManageResponsibilities: true }, { code: campusB.code, canManageResponsibilities: false },
  ]);
  assert.equal(context.canManageResponsibilities, true); assert.equal(context.canUseAgenda, true);
  assert.deepEqual(context.eligibleUsers.map((user) => user.id), ["synthetic-user-a"]);
  assert.ok(context.eligibleUsers.every((user) => user.campus === campusA.code));
  const useOnly = await f.service.context(f.principal, campusB.code);
  assert.deepEqual(useOnly.campuses, [{ id: campusB.id, code: campusB.code, label: campusB.label, canManageResponsibilities: false }]);
  assert.equal(useOnly.canUseAgenda, true); assert.equal(useOnly.canManageResponsibilities, false);
  assert.deepEqual(useOnly.eligibleUsers, []);
});
