import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "../src/auth/auth.types.js";
import { configurationKey, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";
import { businessMailRecipientCapability, defaultConfiguration, type EvaluationContext } from "../src/permissions/dynamic-evaluator.js";

const context: EvaluationContext = { campus: "SYNTHETIC", active: true, own: false, team: false, campusAllowed: true, globalAllowed: false };
const purposes = ["COPY", "FOLLOW_UP_OWNER", "LEAD_PRIMARY", "ADMISSIONS_RESPONSIBLE"] as const;
function denied(target: ConfigurationTarget, permission: string): ConfigurationSnapshot {
  return { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), [permission]: "NONE" } };
}
test("Internal recipients use actual finite grants without a fabricated session or ownership", () => {
  for (const purpose of purposes) {
    assert.equal(businessMailRecipientCapability(["ADMIN"], purpose, [], context), true);
    assert.equal(businessMailRecipientCapability(["ADMISSIONS"], purpose, [], context), true);
    assert.equal(businessMailRecipientCapability(["AUDITOR"], purpose, [], context), false);
    assert.equal(businessMailRecipientCapability([], purpose, [], context), false);
    assert.equal(businessMailRecipientCapability(["ADMIN"], purpose, [], { ...context, campusAllowed: false }), false);
    assert.equal(businessMailRecipientCapability(["SUPER_ADMIN"], purpose, [], { ...context, active: false, globalAllowed: true }), false);
    assert.equal(businessMailRecipientCapability(["SUPER_ADMIN"], purpose, [], { ...context, restriction: "lead_closed", globalAllowed: true }), false);
  }
  for (const purpose of ["constructor", "__proto__", "settings.global.manage"]) {
    assert.equal(businessMailRecipientCapability(["SUPER_ADMIN"], purpose as "COPY", [], context), false);
  }
});
test("Global and campus ceilings restrict both action recipient and copies, regardless of role", () => {
  for (const campus of ["GLOBAL", "SYNTHETIC"]) {
    for (const purpose of purposes) assert.equal(businessMailRecipientCapability(["SUPER_ADMIN", "ADMIN"], purpose,
      [denied({ kind: "CEILING", role: "*", campus }, "lead.view")], context), false);
    for (const [purpose, permission] of [["FOLLOW_UP_OWNER", "reminder.manage"], ["LEAD_PRIMARY", "interaction.create"], ["ADMISSIONS_RESPONSIBLE", "appointment.manage"]] as const) {
      assert.equal(businessMailRecipientCapability(["ADMIN"], purpose, [denied({ kind: "CEILING", role: "*", campus }, permission)], context), false);
      assert.equal(businessMailRecipientCapability(["ADMIN"], "COPY", [denied({ kind: "CEILING", role: "*", campus }, permission)], context), true);
    }
  }
});
test("Role NONE has no fallback; another legitimate role may contribute its grant", () => {
  const row = denied({ kind: "ROLE", role: "ADMISSIONS", campus: "SYNTHETIC" }, "reminder.manage");
  assert.equal(businessMailRecipientCapability(["ADMISSIONS"], "FOLLOW_UP_OWNER", [row], context), false);
  assert.equal(businessMailRecipientCapability(["ADMISSIONS", "MANAGER"], "FOLLOW_UP_OWNER", [row], context), true);
  const own: ConfigurationSnapshot = { ...row, grants: { ...row.grants, "reminder.manage": "OWN" } };
  assert.equal(businessMailRecipientCapability(["ADMISSIONS"], "FOLLOW_UP_OWNER", [own], context), false);
  assert.equal(businessMailRecipientCapability(["ADMISSIONS"], "FOLLOW_UP_OWNER", [own], { ...context, own: true }), true);
  for (const role of ["AUDITOR", "UNKNOWN"] as Role[]) assert.equal(businessMailRecipientCapability([role], "COPY", [], context), false);
  assert.equal(businessMailRecipientCapability(["ADMISSIONS"], "FOLLOW_UP_OWNER", [row, row], context), false);
});
