import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { Principal, Role } from "../src/auth/auth.types.js";
import type { PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import { leadCollectionContexts } from "../src/permissions/lead-collection-contexts.js";
import { resourceEvaluationContext, transactionResourceResolver } from "../src/permissions/dynamic-context.js";
import { leadResource } from "../src/permissions/dynamic-resources.js";
import { defaultConfiguration, evaluatePermission } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campusId = id(9000), otherCampus = id(9001);
const actor = (role: Role = "MANAGER"): Principal => ({ userId: id(8000), sessionId: "synthetic-real-session-contract", roles: [role], scopes: [{ kind: "CAMPUS", id: campusId }, { kind: "CAMPUS", id: "SYNTHETIC" }, { kind: "TEAM", id: "team-a" }] });
function fixture(count = 2398): {
  tx: PermissionTransaction; calls: Record<string, number>; state: { active: boolean; responsible: boolean; failOwner: boolean; campusActive: boolean };
} {
  const calls = { batch: 0, individual: 0, campus: 0, keys: 0, owner: 0, responsible: 0 };
  const state = { active: true, responsible: true, failOwner: false, campusActive: true };
  const rows = Array.from({ length: count }, (_, index) => ({ id: id(index + 1), campus: index === 7 ? otherCampus : campusId,
    assignedToId: index === 0 ? null : id(7000 + index % 5), collaborators: index % 3 === 0 ? [{ userId: id(8000) }] : [] }));
  const campus = (key: string): object => ({ id: key, kind: "CAMPUS", state: state.campusActive ? "ACTIVE" : "ARCHIVED", code: key === campusId ? "SYNTHETIC" : "OTHER", label: key === campusId ? "Synthetic campus" : "Other campus" });
  const tx = {
    lead: {
      findMany: (query: { where: { campus?: { in: string[] } }; select: unknown }) => { calls.batch++; assert.ok(query.select); return Promise.resolve(rows.filter((row) => !query.where.campus || query.where.campus.in.includes(row.campus))); },
      findUnique: (query: { where: { id: string } }) => { calls.individual++; return Promise.resolve(rows.find((row) => row.id === query.where.id) ?? null); },
    },
    crmReference: { findUnique: (query: { where: { id: string } }) => { calls.campus++; return Promise.resolve(campus(query.where.id)); } },
    crmReferenceKey: { findMany: (query: { where: { referenceId: string } }) => { calls.keys++; return Promise.resolve([{ key: query.where.referenceId === campusId ? "SYNTHETIC_ALIAS" : "OTHER_ALIAS" }]); } },
    collaborator: { findUnique: () => { calls.owner++; if (state.failOwner) return Promise.reject(new Error("synthetic_store_unavailable")); return Promise.resolve({ active: state.active, campusId, teamId: "team-a" }); } },
    teamResponsibility: { findUnique: () => { calls.responsible++; return Promise.resolve({ active: state.responsible }); } },
  } as unknown as PermissionTransaction;
  return { tx, calls, state };
}

test("2398-lead authorization uses one projection, distinct campuses/owners only, not per-lead SQL", async () => {
  const f = fixture(), principal = actor("SUPER_ADMIN");
  const resources = await leadCollectionContexts(f.tx, principal);
  assert.equal(resources.size, 2398);
  assert.deepEqual(f.calls, { batch: 1, individual: 0, campus: 2, keys: 2, owner: 5, responsible: 0 });
  assert.equal(resources.get(id(1))?.own, true); // Active collaborator, even without an owner.
  assert.equal(resources.get(id(8))?.campus, otherCampus);
});

for (const role of ["SUPER_ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR"] as const) {
  test(`grouped and original resource semantics are identical for ${role}`, async () => {
    const f = fixture(12), principal = actor(role);
    const grouped = await leadCollectionContexts(f.tx, principal);
    for (const [leadId, context] of grouped) {
      assert.deepEqual(context, await resourceEvaluationContext(f.tx, principal, await leadResource(f.tx, leadId)));
      for (const permission of ["lead.view", "lead.close.approve", "lead.qualification.update"]) {
        assert.deepEqual(evaluatePermission(principal, permission, [], context), evaluatePermission(principal, permission, [], await resourceEvaluationContext(f.tx, principal, await leadResource(f.tx, leadId))));
      }
    }
    assert.equal(grouped.has(id(8)), role === "SUPER_ADMIN"); // Exact previous campus query retained.
  });
}

test("Manager TEAM responsibilities are read once per tuple and refreshed next transaction", async () => {
  const f = fixture(300), principal = actor();
  const before = await leadCollectionContexts(f.tx, principal);
  assert.equal(f.calls.responsible, 1); assert.equal(f.calls.owner, 5);
  assert.equal(before.get(id(2))?.managedTeam, true);
  f.state.responsible = false;
  const after = await leadCollectionContexts(f.tx, principal);
  assert.equal(f.calls.responsible, 2); assert.equal(after.get(id(2))?.managedTeam, false);
  assert.equal(before.get(id(2))?.managedTeam, true); // Earlier snapshot was not mutated.
  f.state.active = false;
  const inactive = await leadCollectionContexts(f.tx, principal);
  assert.equal(inactive.get(id(2))?.team, false); assert.equal(inactive.get(id(2))?.managedTeam, false);
});

test("explicit NONE and OWN ceilings still deny on the grouped resource contexts", async () => {
  const f = fixture(12), principal = actor("ADMISSIONS"), resources = await leadCollectionContexts(f.tx, principal);
  const own = resources.get(id(1))!, other = resources.get(id(2))!;
  const target: ConfigurationTarget = { kind: "ROLE", role: "ADMISSIONS", campus: "GLOBAL" };
  const row: ConfigurationSnapshot = { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), "lead.view": "OWN" } };
  assert.equal(evaluatePermission(principal, "lead.view", [row], own).allowed, true);
  assert.equal(evaluatePermission(principal, "lead.view", [row], other).allowed, false);
  row.grants["lead.view"] = "NONE";
  for (const context of resources.values()) assert.equal(evaluatePermission(principal, "lead.view", [row], context).allowed, false);
});

test("unknown/archived campus or unavailable identity data fail closed, without permissive fallback", async () => {
  const f = fixture(12); f.state.campusActive = false;
  await assert.rejects(leadCollectionContexts(f.tx, actor()));
  f.state.campusActive = true; f.state.failOwner = true;
  await assert.rejects(leadCollectionContexts(f.tx, actor()), /synthetic_store_unavailable/);
});

test("resource resolver shares in-flight lookups only in this transaction, never between identities", async () => {
  const f = fixture(), resource = { scope: "CAMPUS" as const, campusKeys: [campusId], active: true, ownerId: id(7000) };
  const first = transactionResourceResolver(f.tx, actor());
  const contexts = await Promise.all(Array.from({ length: 25 }, () => first(resource)));
  assert.equal(f.calls.owner, 1); assert.equal(f.calls.responsible, 1); assert(contexts.every((context) => context.managedTeam));
  const second = transactionResourceResolver(f.tx, { ...actor(), userId: id(8001) });
  await second(resource); assert.equal(f.calls.owner, 2); assert.equal(f.calls.responsible, 2);
});
