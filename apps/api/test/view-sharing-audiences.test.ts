import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { HttpException } from "@nestjs/common";
import type { Principal, Scope } from "../src/auth/auth.types.js";
import { canonicalAudienceCampusIds } from "../src/leads/view-sharing-campus.js";
import { ViewSharingAudiences } from "../src/leads/view-sharing-audiences.js";
import { PermissionService, type Grant } from "../src/permissions/permission.service.js";
import { evaluatePermission } from "../src/permissions/dynamic-evaluator.js";
import { referenceKey } from "../src/references/reference.contract.js";
import { referenceStore } from "./helpers/reference-store.js";

const campusA = "00000000-0000-4000-8000-000000000170", campusB = "00000000-0000-4000-8000-000000000171";
function actor(values: string[], extra: Scope[] = []): Principal {
  return { userId: "synthetic-actor", sessionId: "synthetic-session", roles: ["ADMIN"], scopes: [...values.map((id): Scope => ({ kind: "CAMPUS", id })), ...extra] };
}
function fixture(): ReturnType<typeof referenceStore> {
  const store = referenceStore();
  for (const [id, code, label] of [[campusA, "SYN-A", "Campus synthétique A"], [campusB, "SYN-B", "Campus synthétique B"]]) {
    store.rows.crmReference.push({ id, kind: "CAMPUS", code, label, scopeKey: "GLOBAL", state: "ACTIVE" });
    for (const key of [code, label]) store.rows.crmReferenceKey.push({ referenceId: id, kind: "CAMPUS", key: referenceKey(key!), scopeKey: "GLOBAL" });
  }
  return store;
}
function controlledRefusal(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403 && JSON.stringify(error.getResponse()) === JSON.stringify({ code: "permission_denied" });
}

for (const [name, value] of [["UUID", campusA], ["canonical code", "SYN-A"], ["unique label", "Campus synthétique A"]]) {
  test(`audiences resolve ${name} through the existing server resolver`, async () => {
    const store = fixture();
    assert.deepEqual(await canonicalAudienceCampusIds(store.repository.client, actor([value!])), [campusA]);
  });
}
test("audiences deduplicate UUID/code/label of one campus without modifying the principal", async () => {
  const store = fixture(), principal = actor([campusA, "SYN-A", "Campus synthétique A", campusA]), before = structuredClone(principal);
  assert.deepEqual(await canonicalAudienceCampusIds(store.repository.client, principal), [campusA]); assert.deepEqual(principal, before);
});
test("audiences resolve several authorized campuses to distinct UUIDs only", async () => {
  const store = fixture();
  assert.deepEqual(await canonicalAudienceCampusIds(store.repository.client, actor(["SYN-A", campusB, "Campus synthétique B"])), [campusA, campusB]);
});
test("unknown scope fails closed instead of querying all campuses", async () => {
  const store = fixture();
  await assert.rejects(() => canonicalAudienceCampusIds(store.repository.client, actor(["UNKNOWN-SYNTHETIC"])), controlledRefusal);
});
test("ambiguous registered label is refused by the shared resolver, not broadened", async () => {
  const store = fixture();
  // Simulate an inconsistent registry read; production uniqueness also prevents this collision.
  for (const id of [campusA, campusB]) store.rows.crmReferenceKey.push({ referenceId: id, kind: "CAMPUS", scopeKey: "GLOBAL", key: "AMBIGUOUS" });
  await assert.rejects(() => canonicalAudienceCampusIds(store.repository.client, actor(["AMBIGUOUS"])), controlledRefusal);
});
test("empty, TEAM-only and legacy GLOBAL scopes never grant a global campus query", async () => {
  const store = fixture();
  for (const extra of [[], [{ kind: "GLOBAL" }], [{ kind: "TEAM", id: "SYNTHETIC-TEAM" }]] satisfies Scope[][]) {
    assert.deepEqual(await canonicalAudienceCampusIds(store.repository.client, actor([], extra)), []);
  }
});
test("GLOBAL is separate for a server-authorized Super Admin, never a UUID", async () => {
  const store = fixture();
  assert.equal(await canonicalAudienceCampusIds(store.repository.client, { ...actor([], [{ kind: "GLOBAL" }]), roles: ["SUPER_ADMIN"] }), null);
  await assert.rejects(() => canonicalAudienceCampusIds(store.repository.client, actor(["GLOBAL"])), controlledRefusal);
});
test("malformed UUID-like scope and inactive campus are controlled refusals", async () => {
  const store = fixture();
  await assert.rejects(() => canonicalAudienceCampusIds(store.repository.client, actor(["-".repeat(36)])), controlledRefusal);
  store.rows.crmReference[0]!.state = "ARCHIVED";
  await assert.rejects(() => canonicalAudienceCampusIds(store.repository.client, actor([campusA])), controlledRefusal);
});

function listFixture(t: TestContext): { store: ReturnType<typeof referenceStore>; audiences: ViewSharingAudiences; queriedIds: string[][] } {
  const store = fixture(), queriedIds: string[][] = [];
  Object.defineProperty(store.repository.client, "teamResponsibility", { value: { findMany: (): Promise<[]> => Promise.resolve([]) } });
  t.mock.method(store.repository.client.crmReference, "findMany", (args: { where: { id?: { in: string[] } } }): Promise<typeof store.rows.crmReference> => {
    const ids = args.where.id?.in;
    if (ids) { for (const id of ids) assert.match(id, /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i); queriedIds.push(ids); }
    return Promise.resolve(store.rows.crmReference.filter((row) => !ids || typeof row.id === "string" && ids.includes(row.id)));
  });
  const permissions = new PermissionService({
    grants: (): Promise<readonly Grant[]> => Promise.resolve([]),
    decision: (principal, key, resource): Promise<boolean> => Promise.resolve(evaluatePermission(principal, key, [], {
      campus: resource.campusKeys[0]!, active: resource.active, own: false, team: false,
      globalAllowed: principal.roles.includes("SUPER_ADMIN"), campusAllowed: principal.scopes.some((s) => s.kind === "CAMPUS" && resource.campusKeys.includes(s.id)),
    }).allowed),
  });
  return { store, queriedIds, audiences: new ViewSharingAudiences(permissions) };
}
test("final Prisma id IN receives one canonical UUID and never leaks the other campus", async (t) => {
  const { store, audiences, queriedIds } = listFixture(t);
  const result = await audiences.list(store.repository.client, actor([campusA, "SYN-A", "Campus synthétique A"]));
  assert.deepEqual(queriedIds, [[campusA]]); assert.deepEqual(result.map((row) => [row.id, row.campusId]), [[campusA, campusA]]);
  await assert.rejects(() => audiences.resolve(store.repository.client, actor([campusA]), "CAMPUS", campusB), (error: unknown) => error instanceof HttpException && error.getStatus() === 404);
});
test("empty resolved campuses return an empty audience list without a global query", async (t) => {
  const { store, audiences, queriedIds } = listFixture(t);
  assert.deepEqual(await audiences.list(store.repository.client, actor([], [{ kind: "GLOBAL" }])), []); assert.deepEqual(queriedIds, []);
});
