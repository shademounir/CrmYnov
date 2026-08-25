import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadStatusController } from "../src/leads/lead.controller.js";
import { LeadService } from "../src/leads/lead.service.js";

const leadInput = { leadCode: "LD-STATUS-001", firstName: "Nora", lastName: "Synthétique", campus: "Synthetic Campus", campaign: "Synthetic 2026", educationLevel: "BAC", program: "Synthetic Program", source: "TEST" };
const adviser = { userId: "synthetic-adviser", roles: ["ADMISSIONS" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const manager = { ...adviser, userId: "synthetic-manager", roles: ["ADMIN" as const] };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("applies the controlled pipeline and appends immutable status events", () => {
  const audit = new AuditService(); const service = new LeadService(audit); const lead = service.registerLocalLead(leadInput);
  assert.equal(service.changeStatus(lead.id, { status: "CONTACTED" }, adviser, "corr-contacted").status, "CONTACTED");
  assert.equal(service.changeStatus(lead.id, { status: "QUALIFIED" }, adviser, "corr-qualified").status, "QUALIFIED");
  assert.equal(service.changeStatus(lead.id, { status: "ENROLLED", reason: "Dossier synthétique validé" }, manager, "corr-enrolled").status, "ENROLLED");
  assert.deepEqual(service.timeline(lead.id, manager).map((event) => event.type), ["STATUS_CHANGED", "STATUS_CHANGED", "STATUS_CHANGED"]);
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_STATUS_CHANGED").length, 3);
});

test("fails closed for invalid transitions and controlled closures", () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(leadInput);
  assert.throws(() => service.changeStatus(lead.id, { status: "QUALIFIED" }, adviser, "corr"), hasCode("lead_status_transition_forbidden"));
  service.changeStatus(lead.id, { status: "CONTACTED" }, adviser, "corr-contacted");
  assert.throws(() => service.changeStatus(lead.id, { status: "CLOSED_LOST", reason: "Synthétique" }, adviser, "corr"), hasCode("lead_closure_approval_required"));
  assert.throws(() => service.changeStatus(lead.id, { status: "CLOSED_LOST" }, manager, "corr"), hasCode("lead_closure_reason_required"));
  assert.throws(() => service.changeStatus(lead.id, { status: "UNKNOWN" }, manager, "corr"), hasCode("lead_status_invalid"));
});

test("controller preserves correlation and rejects a missing principal", async () => {
  const service = new LeadService(new AuditService()); const lead = service.registerLocalLead(leadInput); const controller = new LeadStatusController(service);
  const request = { principal: adviser, header: () => "corr-controller" } as never;
  assert.equal((await controller.update(lead.id, { status: "CONTACTED" }, request)).status, "CONTACTED");
  await assert.rejects(() => controller.update(lead.id, { status: "QUALIFIED" }, { header: () => undefined } as never), hasCode("principal_missing"));
});
