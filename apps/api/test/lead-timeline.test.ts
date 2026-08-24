import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { LeadTimelineController } from "../src/leads/lead.controller.js";

const leadInput = { leadCode: "LD-SYNTH-001", firstName: "Camille", lastName: "Test", email: "camille@example.invalid", campus: "Synthetic Campus", campaign: "Synthetic 2026", educationLevel: "BAC", program: "Synthetic Program", source: "TEST" };
const admissions = { userId: "synthetic-adviser", roles: ["ADMISSIONS" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000002" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("appends immutable, server-timestamped activities in deterministic order", () => {
  const audit = new AuditService(); const service = new LeadService(audit); const lead = service.registerLocalLead(leadInput);
  const first = service.addActivity(lead.id, { type: "CRM_CALL", result: "Answered" }, admissions, "corr-1");
  const second = service.addActivity(lead.id, { type: "COMMENT", result: "Follow-up", nextActionAt: "2026-09-01T09:00:00Z" }, admissions, "corr-2");
  const events = service.timeline(lead.id, admissions);
  assert.equal(events.length, 2); assert.ok(events.some((event) => event.id === first.id)); assert.ok(events.some((event) => event.id === second.id));
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_ACTIVITY_ADDED").length, 2);
  assert.equal(Object.isFrozen(first), false);
});

test("refuses unauthorized writers and invalid activity types", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(leadInput);
  assert.throws(() => service.addActivity(lead.id, { type: "COMMENT", result: "x" }, { ...admissions, roles: ["AUDITOR"] }, "corr"), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("role_forbidden"));
  assert.throws(() => service.addActivity(lead.id, { type: "SIP_SECRET", result: "x" }, admissions, "corr"), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("activity_invalid"));
  assert.throws(() => service.addActivity(lead.id, { type: "COMMENT", result: "x", nextActionAt: "not-a-date" }, admissions, "corr"), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("next_action_invalid"));
  assert.throws(() => service.timeline("00000000-0000-4000-8000-000000000099", admissions), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("lead_not_found"));
});

test("controller delegates append and read without exposing another lead", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(leadInput);
  const controller = new LeadTimelineController(service);
  const request = { principal: admissions, header: (name: string) => name === "x-correlation-id" ? "corr-controller" : undefined } as never;
  const created = controller.create(lead.id, { type: "MEETING", result: "Scheduled", note: "Synthetic note" }, request);
  assert.equal(created.correlationId, "corr-controller");
  assert.equal(controller.list(lead.id, request).events[0]?.id, created.id);
  assert.throws(() => controller.list(lead.id, { header: () => undefined } as never), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("principal_missing"));
  assert.throws(() => controller.create(lead.id, { type: "COMMENT", result: "x" }, { header: () => undefined } as never), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("principal_missing"));
});

test("adds an idempotent expurgated correction while preserving the original", () => {
  const audit = new AuditService(); const service = new LeadService(audit); const lead = service.registerLocalLead(leadInput);
  const original = service.addActivity(lead.id, { type: "CRM_CALL", result: "Free synthetic wording", note: "Synthetic private note" }, admissions, "corr-original");
  const input = { idempotencyKey: "correction-0001", expectedCorrectionCount: 0, operation: "CORRECT" as const,
    reasonCode: "WRONG_RESULT", replacement: { type: "CRM_CALL", result: "CONTACT_ESTABLISHED" } };
  const correction = service.correctActivity(lead.id, original.id, input, manager, "corr-compensate");
  const replay = service.correctActivity(lead.id, original.id, input, manager, "corr-replay");
  const timeline = service.timeline(lead.id, manager);
  assert.equal(replay.id, correction.id); assert.equal(timeline.length, 2);
  assert.equal(timeline.find((item) => item.id === original.id)?.result, "Free synthetic wording");
  assert.deepEqual(correction.correction?.previous, { type: "CRM_CALL", result: "[redacted]", noteState: "REDACTED" });
  assert.deepEqual(correction.correction?.replacement, { type: "CRM_CALL", result: "CONTACT_ESTABLISHED", noteState: "ABSENT" });
  const auditEvent = audit.list().find((event) => event.eventType === "LEAD_ACTIVITY_COMPENSATED");
  assert.ok(auditEvent); assert.doesNotMatch(JSON.stringify(auditEvent), /Free synthetic wording|Synthetic private note/);
});

test("fails closed for authorization, IDOR, invalid values and concurrent correction", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(leadInput);
  const original = service.addActivity(lead.id, { type: "WHATSAPP", result: "DECLARED" }, admissions, "corr-original");
  const valid = { idempotencyKey: "correction-0002", expectedCorrectionCount: 0, operation: "CANCEL" as const, reasonCode: "DUPLICATE_ENTRY" };
  assert.throws(() => service.correctActivity(lead.id, original.id, valid, admissions, "corr"), hasCode("interaction_correction_forbidden"));
  assert.throws(() => service.correctActivity(lead.id, original.id, valid, { ...manager, scopes: [{ kind: "CAMPUS", id: "Other Campus" }] }, "corr"), hasCode("lead_not_found"));
  assert.throws(() => service.correctActivity(lead.id, "missing-event", valid, manager, "corr"), hasCode("interaction_not_found"));
  assert.throws(() => service.correctActivity(lead.id, original.id, { ...valid, reasonCode: "FREE_TEXT" }, manager, "corr"), hasCode("interaction_correction_reason_invalid"));
  const cancelled = service.correctActivity(lead.id, original.id, valid, manager, "corr"); assert.equal(cancelled.correction?.operation, "CANCEL");
  assert.throws(() => service.correctActivity(lead.id, original.id, { ...valid, idempotencyKey: "correction-0003", expectedCorrectionCount: 0 }, manager, "corr"), hasCode("interaction_correction_concurrent"));
  assert.throws(() => service.correctActivity(lead.id, original.id, { ...valid, idempotencyKey: "correction-0004", expectedCorrectionCount: 1 }, manager, "corr"), hasCode("interaction_correction_concurrent"));
});

test("controller exposes the compensating correction contract", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(leadInput);
  const original = service.addActivity(lead.id, { type: "MANUAL_EMAIL", result: "DECLARED" }, admissions, "corr-original");
  const controller = new LeadTimelineController(service); const request = { principal: manager, header: () => "corr-controller" } as never;
  const correction = controller.correct(lead.id, original.id, { idempotencyKey: "correction-0005", expectedCorrectionCount: 0,
    operation: "CORRECT", reasonCode: "WRONG_CHANNEL", replacement: { type: "WHATSAPP", result: "DECLARED" } }, request);
  assert.equal(correction.type, "CORRECTION"); assert.equal(correction.correction?.originalEventId, original.id);
});
