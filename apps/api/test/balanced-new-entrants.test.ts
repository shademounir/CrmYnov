import assert from "node:assert/strict";
import test from "node:test";
import { balancedNewEntrant } from "../src/assignment/balanced-new-entrants.js";
import { parseCampusRules } from "../src/assignment/campus-assignment-policy.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { routePermissions } from "../src/permissions/dynamic-routes.js";

const candidates = ["alice", "bravo", "charlie"].map(userId => ({ userId, active: true, capacity: 1000, activeLeadCount: 700 }));
test("pool administration uses the closed current campus-management permission binding", () => {
  assert.deepEqual(routePermissions("AssignmentController", "poolAdministration"), ["settings.campus.manage"]);
  assert.equal(routePermissions("AssignmentController", "unknownPoolWrite"), null);
});
test("new entrant balance is exact across 3000 selections, with random tie order instead of historical load", () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 3000; i++) {
    const selected = balancedNewEntrant(candidates, counts, upper => i % upper)!;
    assert.equal(selected.previousCount, counts.get(selected.userId) ?? 0);
    counts.set(selected.userId, selected.previousCount + 1);
    const values = candidates.map(c => counts.get(c.userId) ?? 0);
    assert.ok(Math.max(...values) - Math.min(...values) <= 1);
  }
  assert.deepEqual([...counts.values()], [1000, 1000, 1000]);
});
test("a returning eligible peer catches up, and missing or ineligible peers receive nothing", () => {
  const counts = new Map([["alice", 10], ["bravo", 7], ["charlie", 9]]);
  assert.equal(balancedNewEntrant(candidates, counts, () => 0)!.userId, "bravo");
  const current = candidates.map(c => c.userId === "bravo" ? { ...c, suspended: true } : c);
  assert.equal(balancedNewEntrant(current, counts, () => 0)!.userId, "charlie");
  assert.deepEqual([...counts.values()], [10, 7, 9], "selection is read-only");
});
test("inactive, excluded, suspended and at-capacity peers are excluded, including an empty pool", () => {
  for (const state of [{ active: false }, { excluded: true }, { suspended: true }, { activeLeadCount: 1000 }]) {
    assert.equal(balancedNewEntrant(candidates.map(c => ({ ...c, ...state })), new Map()), undefined);
  }
  assert.equal(balancedNewEntrant([], new Map()), undefined);
});
test("invalid durable counts and random indexes fail closed", () => {
  for (const count of [-1, NaN, Infinity, 1.1, 2_147_483_647]) assert.throws(() => balancedNewEntrant(candidates, new Map([["alice", count]])));
  for (const index of [-1, 3, NaN, 0.2]) assert.throws(() => balancedNewEntrant(candidates, new Map(), () => index));
});
test("each tied peer can be chosen, input order does not bias the tie set", () => {
  for (let i = 0; i < 3; i++) assert.equal(balancedNewEntrant([...candidates].reverse(), new Map(), () => i)!.userId, candidates[i]!.userId);
});
test("the new policy is explicit and only valid for controlled random; legacy snapshots stay unchanged", () => {
  const rule = { id: "new-only", scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", enabled: true, candidates };
  assert.equal(parseCampusRules([rule])[0]!.balanceNewEntrants, undefined);
  assert.equal(parseCampusRules([{ ...rule, balanceNewEntrants: true }])[0]!.balanceNewEntrants, true);
  for (const value of ["true", 1, null]) assert.throws(() => parseCampusRules([{ ...rule, balanceNewEntrants: value }]));
  assert.throws(() => parseCampusRules([{ ...rule, strategy: "ROUND_ROBIN", balanceNewEntrants: true }]));
});
test("volatile fallback cannot silently emulate a durable balanced policy", () => {
  const service = new AssignmentService(new AuditService());
  const actor = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
  service.configure([{ id: "new-only", scope: "GLOBAL", strategy: "CONTROLLED_RANDOM", enabled: true, balanceNewEntrants: true, candidates }], actor, "configure");
  assert.throws(() => service.assign({ leadId: "synthetic-lead", source: "WEB_FORM", campaign: "SYNTHETIC", eventKey: "synthetic-event" }, actor, "synthetic-correlation"), /Conflict/);
  assert.equal(service.decisionHistory(actor).length, 0);
});
