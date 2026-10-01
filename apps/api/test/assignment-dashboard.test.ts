import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { AssignmentDashboardService } from "../src/assignment/assignment-dashboard.service.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { ReassignmentService } from "../src/assignment/reassignment.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const adviser = { ...manager, userId: "synthetic-adviser", roles: ["ADMISSIONS" as const] };
const leadInput = { firstName: "Alex", lastName: "Synthétique", email: "alex@example.invalid", campus: "TEST", campaign: "SYNTH", educationLevel: "BAC", program: "PROGRAMME", source: "FORM" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("aggregates assignment KPIs, batches and alerts without exposing lead PII", () => {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  const batches = new LeadAssignmentService(leads, engine, audit); const reassignments = new ReassignmentService(leads, engine, audit);
  engine.configure([{ id: "global", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [{ userId: adviser.userId, active: true, capacity: 5, activeLeadCount: 0 }] }], manager, "config");
  const first = leads.createLead(leadInput, adviser, "lead-1").lead;
  leads.createLead({ ...leadInput, firstName: "Sam", email: "sam@example.invalid", assignedToId: adviser.userId }, adviser, "lead-2");
  batches.assignBatch({ idempotencyKey: "batch-dashboard-1", items: [{ leadId: first.id, source: "FORM", campaign: "SYNTH" }], strategy: "ROUND_ROBIN", confirmed: true }, manager, "batch");
  const dashboard = new AssignmentDashboardService(leads, engine, batches, reassignments).read(manager);
  assert.deepEqual(dashboard.leads, { total: 2, assigned: 2, unassigned: 0, followUpDue: 0, byAdviser: [{ userId: adviser.userId, leadCount: 2 }] });
  assert.equal(dashboard.configuration.activeRules, 1); assert.deepEqual(dashboard.configuration.strategies, ["ROUND_ROBIN"]);
  assert.equal(dashboard.activity.completedBatches, 1); assert.equal(dashboard.activity.assignedByBatch, 1); assert.equal(dashboard.activity.pendingReassignments, 0);
  assert.equal(JSON.stringify(dashboard).includes("example.invalid"), false);
});

test("dashboard fails closed for non-manager roles", () => {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  const service = new AssignmentDashboardService(leads, engine, new LeadAssignmentService(leads, engine, audit), new ReassignmentService(leads, engine, audit));
  assert.throws(() => service.read(adviser), hasCode("assignment_manager_required"));
});
