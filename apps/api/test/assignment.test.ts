import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { AssignmentController } from "../src/assignment/assignment.controller.js";
import { AssignmentService, type AssignmentContext, type AssignmentRuleInput } from "../src/assignment/assignment.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const adviser = { ...manager, userId: "synthetic-adviser", roles: ["ADMISSIONS" as const] };
const firstId = "00000000-0000-4000-8000-000000000010";
const secondId = "00000000-0000-4000-8000-000000000020";
const candidates = [
  { userId: firstId, active: true, capacity: 2, activeLeadCount: 0 },
  { userId: secondId, active: true, capacity: 2, activeLeadCount: 0 },
];
const globalRule = (strategy: AssignmentRuleInput["strategy"] = "ROUND_ROBIN"): AssignmentRuleInput => ({ id: "global-rule", scope: "GLOBAL", strategy, enabled: true, candidates });
const context = (eventKey: string): AssignmentContext => ({ leadId: "00000000-0000-4000-8000-000000000100", source: "FORM", campaign: "SYNTHETIC", eventKey });
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("cycles deterministically through eligible candidates and remains idempotent", () => {
  const audit = new AuditService(); const service = new AssignmentService(audit);
  service.configure([globalRule()], manager, "config-round-robin");
  const first = service.assign(context("event-001"), adviser, "corr-1");
  const second = service.assign(context("event-002"), adviser, "corr-2");
  assert.equal(first.selectedUserId, firstId); assert.equal(second.selectedUserId, secondId);
  assert.equal(service.assign(context("event-001"), adviser, "corr-replay").id, first.id);
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_AUTO_ASSIGNED").length, 2);
});

test("controlled random is replayable and simulation never mutates cursor or history", () => {
  const service = new AssignmentService(new AuditService()); service.configure([globalRule("CONTROLLED_RANDOM")], manager, "config-random");
  const preview = service.simulate(context("stable-event"), manager);
  assert.equal(preview.mutated, false); assert.deepEqual(preview.candidateIds, [firstId, secondId]);
  assert.equal(service.simulate(context("stable-event"), manager).selectedUserId, preview.selectedUserId);
  assert.equal(service.decisionHistory(manager).length, 0);
  assert.equal(service.assign(context("stable-event"), adviser, "corr").selectedUserId, preview.selectedUserId);
});

test("applies a single specific override and fails closed on conflicting overrides", () => {
  const service = new AssignmentService(new AuditService());
  const source: AssignmentRuleInput = { id: "source-rule", scope: "SOURCE", matchValue: "FORM", strategy: "ROUND_ROBIN", enabled: true, candidates: [{ ...candidates[1]!, capacity: 1 }] };
  service.configure([globalRule(), source], manager, "config-source");
  assert.equal(service.assign(context("source-event"), adviser, "corr").ruleId, "source-rule");
  service.configure([globalRule(), source, { ...source, id: "campaign-rule", scope: "CAMPAIGN", matchValue: "SYNTHETIC" }], manager, "config-conflict");
  assert.throws(() => service.assign(context("conflict-event"), adviser, "corr"), hasCode("assignment_rule_ambiguous"));
});

test("excludes inactive, suspended, excluded and over-capacity candidates", () => {
  const service = new AssignmentService(new AuditService());
  service.configure([{ ...globalRule(), candidates: [
    { ...candidates[0]!, active: false },
    { ...candidates[1]!, suspended: true },
    { userId: "00000000-0000-4000-8000-000000000030", active: true, excluded: true, capacity: 1, activeLeadCount: 0 },
    { userId: "00000000-0000-4000-8000-000000000040", active: true, capacity: 1, activeLeadCount: 1 },
  ] }], manager, "config-none");
  assert.throws(() => service.assign(context("no-candidate"), adviser, "corr"), hasCode("assignment_candidate_unavailable"));
});

test("validates configuration and protects management endpoints", () => {
  const service = new AssignmentService(new AuditService());
  assert.throws(() => service.configure([globalRule()], adviser, "corr"), hasCode("assignment_manager_required"));
  assert.throws(() => service.configure([{ ...globalRule(), candidates: [] }], manager, "corr"), hasCode("assignment_candidate_invalid"));
  const missingMatch = { ...globalRule(), scope: "SOURCE" as const }; delete missingMatch.matchValue;
  assert.throws(() => service.configure([missingMatch], manager, "corr"), hasCode("assignment_rule_match_invalid"));
  const controller = new AssignmentController(service);
  const request = { principal: manager, header: () => "controller-corr" } as never;
  assert.equal(controller.configure({ rules: [globalRule()] }, request).rules.length, 1);
  assert.equal(controller.simulate(context("controller-event"), request).mutated, false);
  assert.equal(controller.history(request).decisions.length, 0);
  assert.throws(() => controller.history({ header: () => undefined } as never), hasCode("principal_missing"));
});
