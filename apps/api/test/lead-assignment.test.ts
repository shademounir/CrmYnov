import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentController } from "../src/assignment/lead-assignment.controller.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const firstUser = "00000000-0000-4000-8000-000000000010";
const secondUser = "00000000-0000-4000-8000-000000000020";
interface SyntheticLeadInput { leadCode: string; firstName: string; lastName: string; campus: string; campaign: string; educationLevel: string; program: string; source: string }
interface Setup { audit: AuditService; leads: LeadService; engine: AssignmentService; service: LeadAssignmentService }
const leadInput = (code: string): SyntheticLeadInput => ({ leadCode: code, firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM" });
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

function setup(strategy: "ROUND_ROBIN" | "CONTROLLED_RANDOM" = "ROUND_ROBIN"): Setup {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  engine.configure([{ id: "global-rule", scope: "GLOBAL", strategy, enabled: true, candidates: [
    { userId: firstUser, active: true, capacity: 10, activeLeadCount: 0 }, { userId: secondUser, active: true, capacity: 10, activeLeadCount: 0 },
  ] }], manager, "config");
  return { audit, leads, engine, service: new LeadAssignmentService(leads, engine, audit) };
}

test("previews without mutation then confirms a fixed assignment with timeline evidence", () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead(leadInput("LD-ASSIGN-001"));
  const input = { idempotencyKey: "batch-fixed-001", strategy: "FIXED" as const, targetUserId: firstUser, items: [{ leadId: lead.id, source: lead.source, campaign: lead.campaign }] };
  assert.deepEqual(service.preview(input, manager)[0], { leadId: lead.id, selectedUserId: firstUser, outcome: "READY" });
  assert.equal(leads.findLocalLead(lead.id)?.assignedToId, undefined);
  const result = service.assignBatch({ ...input, confirmed: true }, manager, "corr-batch");
  assert.equal(result.assigned[0]?.assignedToId, firstUser);
  assert.equal(leads.timeline(lead.id, manager)[0]?.type, "ASSIGNMENT_CHANGED");
  assert.equal(service.assignBatch({ ...input, confirmed: true }, manager, "corr-replay").batchId, result.batchId);
});

test("supports round-robin batches and reports already assigned or missing leads", () => {
  const { leads, service } = setup(); const first = leads.registerLocalLead(leadInput("LD-ASSIGN-010")); const second = leads.registerLocalLead(leadInput("LD-ASSIGN-020"));
  const result = service.assignBatch({ idempotencyKey: "batch-round-001", strategy: "ROUND_ROBIN", confirmed: true, items: [
    { leadId: first.id, source: first.source, campaign: first.campaign }, { leadId: second.id, source: second.source, campaign: second.campaign },
  ] }, manager, "corr-round");
  assert.deepEqual(result.assigned.map((lead) => lead.assignedToId), [firstUser, secondUser]);
  const followup = service.assignBatch({ idempotencyKey: "batch-round-002", strategy: "ROUND_ROBIN", confirmed: true, items: [
    { leadId: first.id, source: first.source, campaign: first.campaign }, { leadId: "missing", source: "FORM", campaign: "Campaign" },
  ] }, manager, "corr-followup");
  assert.equal(followup.skipped[0]?.reason, "lead_already_assigned"); assert.equal(followup.refused[0]?.reason, "lead_not_found");
});

test("refuses unconfirmed, duplicate, unbounded and ineligible assignments", () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead(leadInput("LD-ASSIGN-030"));
  const input = { idempotencyKey: "batch-invalid-001", strategy: "FIXED" as const, targetUserId: firstUser, items: [{ leadId: lead.id, source: lead.source, campaign: lead.campaign }] };
  assert.throws(() => service.assignBatch(input, manager, "corr"), hasCode("assignment_confirmation_required"));
  assert.throws(() => service.assignBatch({ ...input, confirmed: true, items: [...input.items, ...input.items] }, manager, "corr"), hasCode("assignment_batch_invalid"));
  assert.throws(() => service.assignOne(lead.id, "unknown-user", true, "single-fixed-001", manager, "corr"), hasCode("assignment_target_ineligible"));
});

test("controller requires a principal and exposes bounded preview", () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead(leadInput("LD-ASSIGN-040")); const controller = new LeadAssignmentController(service);
  const request = { principal: manager, header: () => "corr-controller" } as never;
  const preview = controller.preview({ idempotencyKey: "preview-001", strategy: "FIXED", targetUserId: firstUser, items: [{ leadId: lead.id, source: lead.source, campaign: lead.campaign }] }, request);
  assert.equal(preview.mutated, false); assert.equal(preview.items[0]?.outcome, "READY");
  assert.throws(() => controller.preview({ idempotencyKey: "preview-002", strategy: "FIXED", targetUserId: firstUser, items: [] }, { header: () => undefined } as never), hasCode("principal_missing"));
});

test("persists fixed API batches with replay, skip and refusal outcomes", async () => {
  const audit = new AuditService();
  const engine = new AssignmentService(audit);
  engine.configure([{ id: "persistent-rule", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [
    { userId: firstUser, active: true, capacity: 10, activeLeadCount: 0 },
  ] }], manager, "persistent-config");
  const records = new Map([
    ["persistent-ready", { ...leadInput("LD-PERSIST-READY"), id: "persistent-ready", status: "PROSPECT" as const, createdAt: "2026-08-25T12:00:00.000Z" }],
    ["persistent-assigned", { ...leadInput("LD-PERSIST-ASSIGNED"), id: "persistent-assigned", status: "PROSPECT" as const, createdAt: "2026-08-25T12:00:00.000Z", assignedToId: secondUser }],
    ["persistent-single", { ...leadInput("LD-PERSIST-SINGLE"), id: "persistent-single", status: "PROSPECT" as const, createdAt: "2026-08-25T12:00:00.000Z" }],
  ]);
  const persistentLeads = {
    persistenceEnabled: () => true,
    findLocalLeadForApi: (id: string) => Promise.resolve(records.get(id)),
    assignLocalLeadForApi: (id: string, assignedToId: string) => {
      const updated = { ...records.get(id)!, assignedToId };
      records.set(id, updated);
      return Promise.resolve(updated);
    },
  } as unknown as LeadService;
  const service = new LeadAssignmentService(persistentLeads, engine, audit);
  const input = { idempotencyKey: "persistent-batch-001", strategy: "FIXED" as const, targetUserId: firstUser, confirmed: true,
    items: [
      { leadId: "persistent-ready", source: "FORM", campaign: "Campaign" },
      { leadId: "persistent-assigned", source: "FORM", campaign: "Campaign" },
      { leadId: "persistent-missing", source: "FORM", campaign: "Campaign" },
    ] };
  const result = await service.assignBatchForApi(input, manager, "persistent-batch");
  assert.equal(result.assigned[0]?.assignedToId, firstUser);
  assert.equal(result.skipped[0]?.reason, "lead_already_assigned");
  assert.equal(result.refused[0]?.reason, "lead_not_found");
  assert.equal((await service.assignBatchForApi(input, manager, "persistent-replay")).batchId, result.batchId);
  assert.equal((await service.assignOneForApi("persistent-single", firstUser, true, "persistent-single-001", manager, "persistent-single")).assignedToId, firstUser);
});
