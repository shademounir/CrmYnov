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
  assert.throws(() => service.listLeads({ page: 1, pageSize: 25, view: "FORGED" }, principal, "corr"), hasCode("lead_view_invalid"));
});

test("serves global, personal, due and unassigned views with deterministic filters", () => {
  const service = new LeadService(new AuditService());
  const mine = service.registerLocalLead({ ...base, leadCode: "LD-VIEW-001", assignedToId: principal.userId, nextActionAt: "2020-01-01T09:00:00.000Z", assignmentMode: "ROUND_ROBIN", importBatchId: "SYNTH-LOT-1" });
  const shared = service.registerLocalLead({ ...base, leadCode: "LD-VIEW-002", assignedToId: "00000000-0000-4000-8000-000000000099", collaboratorIds: [principal.userId], nextActionAt: "2020-01-01T08:00:00.000Z" });
  const { assignedToId: _assignedToId, ...withoutOwner } = base;
  void _assignedToId;
  const unassigned = service.registerLocalLead({ ...withoutOwner, leadCode: "LD-VIEW-003" });
  assert.equal(service.listLeads({ page: 1, pageSize: 25, view: "ALL" }, principal, "all").total, 3);
  assert.deepEqual(service.listLeads({ page: 1, pageSize: 25, view: "MINE" }, principal, "mine").items.map((lead) => lead.id).sort(), [mine.id, shared.id].sort());
  assert.deepEqual(service.listLeads({ page: 1, pageSize: 25, view: "FOLLOW_UP" }, principal, "due").items.map((lead) => lead.id), [shared.id, mine.id]);
  assert.equal(service.listLeads({ page: 1, pageSize: 25, view: "UNASSIGNED" }, principal, "unassigned").items[0]?.id, unassigned.id);
  assert.equal(service.listLeads({ page: 1, pageSize: 25, assignmentMode: "round_robin", importBatchId: "synth-lot-1" }, principal, "mode").items[0]?.id, mine.id);
});
