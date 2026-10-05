import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { ReassignmentController } from "../src/assignment/reassignment.controller.js";
import { ReassignmentService } from "../src/assignment/reassignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import type { LeadWorkflowPersistenceRepository } from "../src/leads/lead-workflow-persistence.repository.js";
import type { PersistentAssignmentService } from "../src/assignment/persistent-assignment.service.js";

const ownerId = "00000000-0000-4000-8000-000000000010";
const targetId = "00000000-0000-4000-8000-000000000020";
const adviser = { userId: ownerId, roles: ["ADMISSIONS" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000002" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

function setup(): { audit: AuditService; leads: LeadService; service: ReassignmentService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  engine.configure([{ id: "global-rule", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [
    { userId: ownerId, active: true, capacity: 10, activeLeadCount: 1 }, { userId: targetId, active: true, capacity: 10, activeLeadCount: 0 },
  ] }], manager, "config");
  return { audit, leads, service: new ReassignmentService(leads, engine, audit) };
}

test("keeps ownership unchanged until a separate Manager approval", () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-001", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: ownerId });
  const request = service.request(lead.id, { targetUserId: targetId, reason: "Équilibrage de charge", moveOpenTasks: true, idempotencyKey: "reassign-001" }, adviser, "corr-request");
  assert.equal(request.status, "PENDING"); assert.equal(leads.findLocalLead(lead.id)?.assignedToId, ownerId);
  const decision = service.decide(request.id, { approved: true, reason: "Validation Manager" }, manager, "corr-decision");
  assert.equal(decision.request.status, "APPROVED"); assert.equal(decision.lead?.assignedToId, targetId);
  assert.ok(leads.timeline(lead.id, manager).some((event) => event.type === "ASSIGNMENT_CHANGED" && event.result === `${ownerId}->${targetId}`));
});

test("records rejection without changing ownership and enforces idempotence", () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-002", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: ownerId });
  const input = { targetUserId: targetId, reason: "Demande synthétique", moveOpenTasks: false, idempotencyKey: "reassign-002" };
  const first = service.request(lead.id, input, adviser, "corr-request"); assert.equal(service.request(lead.id, input, adviser, "corr-replay").id, first.id);
  assert.equal(service.decide(first.id, { approved: false, reason: "Motif insuffisant" }, manager, "corr-reject").request.status, "REJECTED");
  assert.equal(leads.findLocalLead(lead.id)?.assignedToId, ownerId);
});

test("fails closed for IDOR, self approval, duplicate pending and owner races", () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-003", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: ownerId });
  assert.throws(() => service.request(lead.id, { targetUserId: targetId, reason: "Demande valide", moveOpenTasks: true, idempotencyKey: "reassign-idor" }, { ...adviser, userId: "other-adviser" }, "corr"), hasCode("reassignment_owner_required"));
  const request = service.request(lead.id, { targetUserId: targetId, reason: "Demande valide", moveOpenTasks: true, idempotencyKey: "reassign-race" }, adviser, "corr");
  assert.throws(() => service.request(lead.id, { targetUserId: targetId, reason: "Autre demande", moveOpenTasks: true, idempotencyKey: "reassign-duplicate" }, adviser, "corr"), hasCode("reassignment_pending_exists"));
  assert.throws(() => service.decide(request.id, { approved: true, reason: "Auto validation" }, { ...manager, userId: ownerId }, "corr"), hasCode("reassignment_separation_of_duties"));
  leads.reassignLocalLead(lead.id, ownerId, targetId, manager, "external-change", "Changement concurrent");
  assert.throws(() => service.decide(request.id, { approved: true, reason: "Validation tardive" }, manager, "corr"), hasCode("reassignment_owner_changed"));
});

test("controller exposes request, list and decision contracts", async () => {
  const { leads, service } = setup(); const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-004", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: ownerId });
  const controller = new ReassignmentController(service); const adviserRequest = { principal: adviser, header: () => "corr-controller" } as never;
  const created = await controller.create(lead.id, { targetUserId: targetId, reason: "Demande contrôlée", moveOpenTasks: true, idempotencyKey: "reassign-controller" }, adviserRequest);
  assert.equal((await controller.list(lead.id, adviserRequest)).requests[0]?.id, created.id);
  assert.equal((await controller.decide(created.id, { approved: true, reason: "Validation Manager" }, { principal: manager, header: () => "corr-manager" } as never)).request.status, "APPROVED");
  assert.throws(() => controller.list(lead.id, { header: () => undefined } as never), hasCode("principal_missing"));
});

test("request replay compares the full normalized intent and never discloses another request", () => {
  const { leads, service } = setup();
  const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-005", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: ownerId });
  const input = { targetUserId: targetId, reason: "  Motif complet  ", moveOpenTasks: false, idempotencyKey: "reassign-full-intent" };
  const request = service.request(lead.id, input, adviser, "request-intent");
  assert.equal(service.request(lead.id, { ...input, reason: "Motif complet" }, adviser, "replay-intent").id, request.id);
  for (const changed of [{ ...input, targetUserId: ownerId }, { ...input, reason: "Autre motif" }, { ...input, moveOpenTasks: true }]) {
    assert.throws(() => service.request(lead.id, changed, adviser, "collision"), hasCode("reassignment_idempotency_conflict"));
  }
  assert.throws(() => service.request(lead.id, input, manager, "other-requester"), hasCode("reassignment_idempotency_conflict"));
  assert.throws(() => service.request("other-lead", input, adviser, "other-lead"), hasCode("reassignment_idempotency_conflict"));
  assert.equal(leads.timeline(lead.id, manager).length, 1);
});

test("terminal decision replays only the exact authenticated intention without new effects", () => {
  const { leads, service, audit } = setup();
  const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-006", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: ownerId });
  const request = service.request(lead.id, { targetUserId: targetId, reason: "Motif complet", moveOpenTasks: false, idempotencyKey: "reassign-terminal" }, adviser, "request");
  const input = { approved: true, reason: "Décision distincte", expectedVersion: 1, idempotencyKey: "decision-terminal" };
  assert.equal(service.decide(request.id, input, manager, "decision").request.version, 2);
  const before = JSON.stringify({ timeline: leads.timeline(lead.id, manager), audit: audit.list() });
  assert.equal(service.decide(request.id, input, manager, "replay").request.version, 2);
  assert.equal(JSON.stringify({ timeline: leads.timeline(lead.id, manager), audit: audit.list() }), before);
  assert.throws(() => service.decide(request.id, { ...input, reason: "Autre décision" }, manager, "collision"), hasCode("reassignment_idempotency_conflict"));
  assert.throws(() => service.decide(request.id, input, { ...manager, userId: "another-manager" }, "collision"), hasCode("reassignment_idempotency_conflict"));
});

test("persistent API rejects non-UUID targets without widening the historical in-memory engine contract", async () => {
  const { audit, leads } = setup();
  const engine = new AssignmentService(audit);
  engine.configure([{ id: "legacy-rule", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [
    { userId: "adviser-a", active: true, capacity: 10, activeLeadCount: 1 },
    { userId: "adviser-b", active: true, capacity: 10, activeLeadCount: 0 },
  ] }], manager, "legacy-config");
  const lead = leads.registerLocalLead({ leadCode: "LD-REASSIGN-LEGACY", firstName: "Lead", lastName: "Synthétique", campus: "Campus", campaign: "Campaign", educationLevel: "BAC", program: "Programme", source: "FORM", assignedToId: "adviser-a" });
  const input = { targetUserId: "adviser-b", reason: "Motif historique", moveOpenTasks: false, idempotencyKey: "reassign-legacy-contract" };
  const memory = new ReassignmentService(leads, engine, audit);
  assert.equal((await memory.requestForApi(lead.id, input, { ...adviser, userId: "adviser-a" }, "memory-request")).targetUserId, "adviser-b");
  const persistent = new ReassignmentService(leads, engine, audit, { enabled: true } as unknown as LeadWorkflowPersistenceRepository,
    {} as PersistentAssignmentService);
  await assert.rejects(() => persistent.requestForApi(lead.id, input, adviser, "persistent-invalid"), hasCode("reassignment_request_invalid"));
});
