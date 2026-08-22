import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const leadInput = { leadCode: "LD-SYNTH-001", firstName: "Camille", lastName: "Test", email: "camille@example.invalid", campus: "Synthetic Campus", campaign: "Synthetic 2026", educationLevel: "BAC", program: "Synthetic Program", source: "TEST" };
const admissions = { userId: "synthetic-adviser", roles: ["ADMISSIONS" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };

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
});
