import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadController } from "../src/leads/lead.controller.js";
import { LeadService } from "../src/leads/lead.service.js";

const input = { leadCode: "LD-READ-001", firstName: "Alex", lastName: "Synthétique", email: "alex@example.invalid", phone: "+212600000002", campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "TEST" };
const admissions = { userId: "synthetic-adviser", roles: ["ADMISSIONS" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const auditor = { ...admissions, userId: "synthetic-auditor", roles: ["AUDITOR" as const] };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("lists every authorized lead with deterministic bounded pagination", () => {
  const service = new LeadService(new AuditService()); service.registerLocalLead(input); service.registerLocalLead({ ...input, leadCode: "LD-READ-002", email: "second@example.invalid" });
  const page = service.listLeads({ page: 1, pageSize: 1 }, admissions, "corr-list");
  assert.equal(page.total, 2); assert.equal(page.items.length, 1); assert.equal(page.pageSize, 1);
  assert.throws(() => service.listLeads({ page: 0, pageSize: 101 }, admissions, "corr"), hasCode("lead_pagination_invalid"));
});

test("returns authorized detail, masks auditor contacts and fails closed", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(input);
  assert.equal(service.getLead(lead.id, admissions, "corr-detail").email, input.email);
  assert.equal(service.getLead(lead.id, auditor, "corr-audit").email, "***");
  assert.throws(() => service.getLead("00000000-0000-4000-8000-000000000099", admissions, "corr"), hasCode("lead_not_found"));
});

test("controller exposes list and detail without trusting forged identifiers", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(input); const controller = new LeadController(service);
  const request = { principal: admissions, header: () => "corr-controller" } as never;
  assert.equal(controller.list({ page: "1", pageSize: "25" }, request).items[0]?.id, lead.id);
  assert.equal(controller.detail(lead.id, request).leadCode, input.leadCode);
  assert.throws(() => controller.detail(lead.id, { header: () => undefined } as never), hasCode("principal_missing"));
});

test("filters deterministic saved provenance and incomplete views", () => {
  const service = new LeadService(new AuditService());
  service.registerLocalLead({ ...input, source: "FORMINATOR_ZAPIER" });
  service.registerLocalLead({ ...input, leadCode: "LD-READ-003", email: "incomplete@example.invalid", source: "PHONE_CALL", campus: "À compléter" });
  assert.equal(service.listLeads({ page: 1, pageSize: 25, savedView: "FORMINATOR_ZAPIER" }, admissions, "corr-saved").total, 1);
  assert.equal(service.listLeads({ page: 1, pageSize: 25, savedView: "INCOMPLETE" }, admissions, "corr-incomplete").items[0]?.leadCode, "LD-READ-003");
  assert.equal(service.listLeads({ page: 1, pageSize: 25, savedView: "IMPORT_ERRORS" }, admissions, "corr-errors").total, 0);
  assert.throws(() => service.listLeads({ page: 1, pageSize: 25, savedView: "UNSAFE" }, admissions, "corr-invalid"), hasCode("lead_saved_view_invalid"));
});
