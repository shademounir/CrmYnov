import assert from "node:assert/strict";
import test from "node:test";
import { applicableCampusRule, parseCampusRules } from "../src/assignment/campus-assignment-policy.js";
const fallback = { scope: "GLOBAL" as const, enabled: true };
const source = { scope: "SOURCE" as const, enabled: true, matchValue: "WEB_FORM" };
const campaign = { scope: "CAMPAIGN" as const, enabled: true, matchValue: "SYNTHETIC" };
test("campus priority selects Campaign, Source, fallback or no configuration", () => {
  assert.equal(applicableCampusRule([fallback, source, campaign], "WEB_FORM", "SYNTHETIC"), campaign);
  assert.equal(applicableCampusRule([fallback, source], "WEB_FORM", "SYNTHETIC"), source);
  assert.equal(applicableCampusRule([fallback], "WEB_FORM", "SYNTHETIC"), fallback);
  assert.equal(applicableCampusRule([], "WEB_FORM", "SYNTHETIC"), undefined);
  assert.throws(() => applicableCampusRule([fallback, campaign, campaign], "WEB_FORM", "SYNTHETIC"), /Conflict/u);
  assert.equal(applicableCampusRule([fallback, source, source, campaign], "WEB_FORM", "SYNTHETIC"), campaign, "lower-priority ambiguity does not replace Campaign");
});
test("persisted configuration rejects malformed rules instead of falling back", () => {
  assert.throws(() => parseCampusRules([{ ...campaign, strategy: "INVALID", candidates: [] }]));
  assert.throws(() => parseCampusRules([{ ...fallback, strategy: "ROUND_ROBIN", candidates: [{ userId: "synthetic", active: true, capacity: -1 }] }]));
  assert.deepEqual(parseCampusRules([]), []);
});
