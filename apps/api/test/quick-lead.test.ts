import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { QuickLeadController } from "../src/quick-lead/quick-lead.controller.js";
import type { ReferenceService } from "../src/references/reference.service.js";
import { QuickLeadService, type QuickLeadInput } from "../src/quick-lead/quick-lead.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const adviser = "synthetic-adviser";
const input = (channel: "PHONE_CALL" | "PHYSICAL_VISIT", key: string): QuickLeadInput => ({ idempotencyKey: key, channel,
  firstName: "Prénom", lastName: "Synthétique", email: `${key}@example.invalid`, assignment: { strategy: "UNASSIGNED" } });
function setup(): { service: QuickLeadService; leads: LeadService; ingestion: IngestionService; audit: AuditService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  engine.configure([{ id: "global", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true,
    candidates: [{ userId: adviser, active: true, capacity: 10, activeLeadCount: 0 }] }], manager, "synthetic-config");
  const assignments = new LeadAssignmentService(leads, engine, audit); const ingestion = new IngestionService(leads, assignments, audit);
  return { service: new QuickLeadService(leads, ingestion, assignments), leads, ingestion, audit };
}

test("creates synthetic call and visit leads with provenance, timeline and idempotence", () => {
  for (const [channel, key] of [["PHONE_CALL", "quick-call-0001"], ["PHYSICAL_VISIT", "quick-visit-0001"]] as const) {
    const { service, leads, ingestion } = setup(); const first = service.submit(input(channel, key), manager, "corr-quick");
    const replay = service.submit(input(channel, key), manager, "corr-replay");
    assert.equal(first.outcome, "CREATED"); assert.equal(replay.replayed, true); assert.equal(replay.lead.id, first.lead.id);
    assert.equal(first.lead.campus, "À compléter"); assert.equal(ingestion.listProvenance(first.lead.id, manager)[0]?.source, channel);
    assert.ok(leads.timeline(first.lead.id, manager).some((event) => event.type === channel));
  }
});

test("attaches an activity to a reliable match without changing canonical ownership, source or status", () => {
  const { service, leads, ingestion } = setup();
  const existing = leads.registerLocalLead({ leadCode: "LD-SYNTH-001", firstName: "Lead", lastName: "Existant", email: "known@example.invalid",
    campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme", source: "WEB_FORM",
    assignedToId: adviser, status: "CONTACTED" });
  const result = service.submit({ ...input("PHONE_CALL", "quick-existing-1"), email: "known@example.invalid", nextActionAt: "2026-09-01T10:00:00Z" }, manager, "corr-existing");
  assert.equal(result.outcome, "EXISTING"); assert.equal(result.lead.id, existing.id); assert.equal(result.lead.source, "WEB_FORM");
  assert.equal(result.lead.status, "CONTACTED"); assert.equal(result.lead.assignedToId, adviser);
  assert.equal(ingestion.listProvenance(existing.id, manager).length, 1);
});

test("fails closed for contradictory identities, missing identity and unauthorized access", () => {
  const { service, leads } = setup();
  leads.registerLocalLead({ leadCode: "LD-SYNTH-010", firstName: "A", lastName: "A", email: "a@example.invalid", phone: "+212600000010", campus: "C", campaign: "C", educationLevel: "E", program: "P", source: "WEB_FORM" });
  leads.registerLocalLead({ leadCode: "LD-SYNTH-011", firstName: "B", lastName: "B", email: "b@example.invalid", phone: "+212600000011", campus: "C", campaign: "C", educationLevel: "E", program: "P", source: "WEB_FORM" });
  assert.throws(() => service.submit({ ...input("PHONE_CALL", "quick-collision"), email: "a@example.invalid", phone: "+212600000011" }, manager, "corr"));
  assert.throws(() => service.preview(undefined, undefined, manager));
  assert.throws(() => service.preview("a@example.invalid", undefined, { ...manager, roles: ["AUDITOR"] }));
});

test("controller exposes minimal match evidence and correlation", async () => {
  const { service } = setup(); let validated = false;
  const references = { validateForLead: (): Promise<void> => { validated = true; return Promise.resolve(); } } as unknown as ReferenceService;
  const controller = new QuickLeadController(service, references); const request = { principal: manager, header: () => "corr-controller" } as never;
  assert.deepEqual(controller.matches({ email: "none@example.invalid" }, request), { items: [] });
  assert.equal((await controller.submit(input("PHONE_CALL", "quick-controller"), request)).activityType, "PHONE_CALL");
  assert.equal(validated, true);
});
