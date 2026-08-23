import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const principal = { userId: "synthetic-manager", roles: ["ADMIN" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const base = { firstName: "Camille", lastName: "Exemple", email: "camille@example.invalid", phone: "+212600000001", campus: "Campus A", campaign: "Campagne A", educationLevel: "BAC", program: "Programme A", source: "FORM", assignedToId: "00000000-0000-4000-8000-000000000010" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("combines identity, identifier, adviser and business filters", () => {
  const audit = new AuditService(); const service = new LeadService(audit);
  const lead = service.registerLocalLead({ ...base, leadCode: "LD-SEARCH-001", status: "QUALIFIED" });
  service.registerLocalLead({ ...base, leadCode: "LD-SEARCH-002", firstName: "Autre", lastName: "Personne", email: "other@example.invalid", phone: "+212600000099", assignedToId: "00000000-0000-4000-8000-000000000099" });
  for (const [index, search] of ["camille", "exemple", "camille@example.invalid", "+212600000001", "LD-SEARCH-001"].entries()) {
    assert.equal(service.listLeads({ page: 1, pageSize: 25, search }, principal, `corr-search-${index}`).items[0]?.id, lead.id);
  }
  const filtered = service.listLeads({ page: 1, pageSize: 25, search: "Camille", assignedToId: base.assignedToId,
    status: "qualified", source: "form", program: "Programme A", campaign: "Campagne A", campus: "Campus A", sortBy: "leadCode", sortDirection: "asc" }, principal, "corr-combined");
  assert.equal(filtered.total, 1); assert.equal(filtered.items[0]?.leadCode, "LD-SEARCH-001");
  assert.equal(audit.list().at(-1)?.eventType, "LEADS_LISTED");
  assert.equal(JSON.stringify(audit.list()).includes("camille@example.invalid"), false);
});

test("rejects invalid query values fail-closed", () => {
  const service = new LeadService(new AuditService());
  assert.throws(() => service.listLeads({ page: 1, pageSize: 25, status: "UNKNOWN" }, principal, "corr"), hasCode("lead_status_filter_invalid"));
  assert.throws(() => service.listLeads({ page: 1, pageSize: 25, sortBy: "email" }, principal, "corr"), hasCode("lead_sort_invalid"));
  assert.throws(() => service.listLeads({ page: 1, pageSize: 25, createdFrom: "invalid" }, principal, "corr"), hasCode("lead_created_from_invalid"));
});
