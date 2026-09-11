import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePermission, scheduledImportCapability, defaultConfiguration, type EvaluationContext } from "../src/permissions/dynamic-evaluator.js";
import { configurationKey, type ConfigurationSnapshot, type ConfigurationTarget } from "../src/permissions/dynamic-contract.js";

const context: EvaluationContext = { campus: "synthetic-campus", active: true, own: false, team: false, globalAllowed: false, campusAllowed: true };
function restriction(target: ConfigurationTarget): ConfigurationSnapshot {
  return { ...target, id: configurationKey(target), version: 1, grants: { ...defaultConfiguration(target), "import.confirm": "NONE" } };
}

test("scheduled import uses delegated capabilities without relaxing HTTP session requirements", () => {
  assert.equal(scheduledImportCapability(["ADMIN"], "import.confirm", [], context), true);
  assert.equal(scheduledImportCapability(["SUPER_ADMIN"], "import.confirm", [], { ...context, globalAllowed: true }), true);
  for (const roles of [["MANAGER"], ["ADMISSIONS"], ["AUDITOR"]] as const) {
    assert.equal(scheduledImportCapability(roles, "import.confirm", [], context), false);
  }
  assert.equal(evaluatePermission({ userId: "synthetic-admin", sessionId: "", roles: ["ADMIN"], scopes: [] }, "import.confirm", [], context).allowed, false);
});

test("scheduled import honors dynamic revocation, campus and restrictive ceilings", () => {
  for (const target of [
    { kind: "ROLE", role: "ADMIN", campus: "GLOBAL" },
    { kind: "ROLE", role: "ADMIN", campus: context.campus },
    { kind: "CEILING", role: "*", campus: "GLOBAL" },
    { kind: "CEILING", role: "*", campus: context.campus },
  ] as const) assert.equal(scheduledImportCapability(["ADMIN"], "import.confirm", [restriction(target)], context), false);
  assert.equal(scheduledImportCapability(["ADMIN"], "import.confirm", [], { ...context, campusAllowed: false }), false);
  assert.equal(scheduledImportCapability(["ADMIN"], "import.confirm", [], { ...context, active: false }), false);
  assert.equal(scheduledImportCapability(["ADMIN"], "import.confirm", [], { ...context, restriction: "synthetic_refusal" }), false);
});
