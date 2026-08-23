import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadController } from "../src/leads/lead.controller.js";
import { LeadService } from "../src/leads/lead.service.js";

const input = { firstName: " Camille ", lastName: " Exemple ", email: "CAMILLE@EXAMPLE.INVALID", phone: "+212 600-000-001", campus: "Casablanca synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "FORM" };
const principal = { userId: "synthetic-adviser", roles: ["ADMISSIONS" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("creates a normalized lead with immutable code and timeline evidence", () => {
  const audit = new AuditService(); const service = new LeadService(audit);
  const first = service.createLead(input, principal, "corr-create");
  assert.match(first.lead.leadCode, /^LD-\d{4}-[A-F0-9]{8}$/); assert.equal(first.lead.status, "PROSPECT");
  assert.equal(first.lead.email, "camille@example.invalid"); assert.equal(first.lead.phone, "+212600000001");
  assert.equal(service.timeline(first.lead.id, principal)[0]?.type, "LEAD_CREATED");
  const second = service.createLead(input, principal, "corr-duplicate");
  assert.deepEqual(second.duplicateCandidates, [first.lead.leadCode]); assert.notEqual(second.lead.leadCode, first.lead.leadCode);
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_CREATED").length, 2);
});

test("rejects malformed inputs and unauthorized callers", () => {
  const service = new LeadService(new AuditService());
  assert.throws(() => service.createLead({ ...input, email: "invalid" }, principal, "corr"), hasCode("lead_email_invalid"));
  assert.throws(() => service.createLead({ ...input, firstName: " " }, principal, "corr"), hasCode("lead_required_field_missing"));
  assert.throws(() => service.createLead(input, { ...principal, roles: ["AUDITOR"] }, "corr"), hasCode("role_forbidden"));
});

test("controller delegates creation with correlation and fails without principal", () => {
  const controller = new LeadController(new LeadService(new AuditService()));
  const result = controller.create(input, { principal, header: () => "corr-controller" } as never);
  assert.equal(result.lead.firstName, "Camille");
  assert.throws(() => controller.create(input, { header: () => undefined } as never), hasCode("principal_missing"));
});
