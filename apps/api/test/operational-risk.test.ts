import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { ReassignmentService } from "../src/assignment/reassignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { ClosureService } from "../src/closure/closure.service.js";
import { FollowUpService } from "../src/follow-up/follow-up.service.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import { OperationalRiskController } from "../src/reporting/operational-risk.controller.js";
import { OperationalRiskService } from "../src/reporting/operational-risk.service.js";

const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-manager" };
const adviser: Principal = { userId: "adviser-a", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-adviser" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify(error).includes(code);

function setup(): { audit: AuditService; leads: LeadService; assignments: AssignmentService; reassignments: ReassignmentService; followUps: FollowUpService; closures: ClosureService; ingestion: IngestionService; service: OperationalRiskService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const notifications = new NotificationService(audit);
  const assignments = new AssignmentService(audit); const leadAssignments = new LeadAssignmentService(leads, assignments, audit);
  const reassignments = new ReassignmentService(leads, assignments, audit); const followUps = new FollowUpService(leads, notifications, audit);
  const closures = new ClosureService(leads, notifications, audit); const ingestion = new IngestionService(leads, leadAssignments, audit);
  const service = new OperationalRiskService(leads, followUps, closures, reassignments, assignments, ingestion, audit);
  return { audit, leads, assignments, reassignments, followUps, closures, ingestion, service };
}

test("reports explicit workload, reactivity, approval and source alerts without PII", () => {
  const { audit, leads, assignments, reassignments, followUps, closures, ingestion, service } = setup();
  assignments.configure([{ id: "global", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [
    { userId: "adviser-a", active: true, capacity: 1, activeLeadCount: 0 }, { userId: "adviser-b", active: true, capacity: 10, activeLeadCount: 0 },
  ] }], manager, "corr-config");
  const assigned = leads.registerLocalLead({ id: "lead-assigned", leadCode: "LD-SYNTH-1", firstName: "Prénom", lastName: "Synthétique", campus: "Campus synthétique", campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "WEB_FORM", assignedToId: "adviser-a", status: "CONTACTED" });
  leads.registerLocalLead({ id: "lead-unassigned", leadCode: "LD-SYNTH-2", firstName: "Autre", lastName: "Synthétique", campus: "Campus synthétique", campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "WEB_FORM" });
  followUps.schedule(assigned.id, { dueAt: "2026-08-24T16:00:00.000Z", reason: "Relance synthétique" }, adviser, "corr-follow");
  closures.request(assigned.id, { target: "CLOSED_LOST", reason: "NOT_INTERESTED", comment: "Motif synthétique", evidence: ["EVIDENCE_SYNTHETIC"] }, adviser, "corr-close");
  reassignments.request(assigned.id, { targetUserId: "adviser-b", reason: "Besoin synthétique", moveOpenTasks: true, idempotencyKey: "reassign_synth_1" }, adviser, "corr-reassign");
  for (let index = 0; index < 3; index += 1) ingestion.ingest({ idempotencyKey: `risk_batch_${index}`, profile: "FORMINATOR_ZAPIER", confirmed: true, assignment: { strategy: "UNASSIGNED" }, records: [{ lineNumber: 1, firstName: "Lead", lastName: "Synthétique", email: `risk-${index}@example.invalid`, campus: "", campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "WEB_FORM", technicalSystem: "SYNTHETIC", originalSource: "SYNTHETIC", externalId: `risk-${index}` }] }, manager, `corr-risk-${index}`);
  const report = service.read({ noInteractionHours: "1", capacityWarningPercent: "90", loadGap: "1", sourceRiskPercent: "30", minSourceVolume: "3" }, manager, "corr-report", new Date("2026-08-25T18:00:00.000Z"));
  assert.equal(report.queues.unassigned >= 1, true); assert.equal(report.queues.withoutFirstInteraction >= 2, true);
  assert.equal(report.queues.overdueFollowUps, 1); assert.equal(report.queues.pendingClosures, 1); assert.equal(report.queues.pendingReassignments, 1);
  assert.equal(report.capacity.find((item) => item.adviserId === "adviser-a")?.utilizationPercent, 100);
  assert.equal(report.sourceRisks.find((item) => item.source === "WEB_FORM")?.rate, 100);
  assert.equal(report.alerts.some((item) => item.code === "unassigned_leads"), true);
  assert.deepEqual(report.safeguards, { disciplinaryScore: false, financialDecision: false });
  const serialized = JSON.stringify(report); assert.equal(serialized.includes("Prénom"), false); assert.equal(serialized.includes("example.invalid"), false);
  const event = audit.list().find((item) => item.eventType === "OPERATIONAL_RISK_VIEWED"); assert.equal(event?.after?.definitionVersion, "operational-risk-v1");
});

test("fails closed for advisers and invalid thresholds", () => {
  const { service } = setup();
  assert.throws(() => service.read({}, adviser, "corr-forbidden"), hasCode("operational_reporting_role_required"));
  assert.throws(() => service.read({ capacityWarningPercent: "49" }, manager, "corr-threshold"), hasCode("operational_capacity_threshold_invalid"));
});

test("controller refuses a missing principal", () => {
  const { service } = setup(); const controller = new OperationalRiskController(service);
  assert.throws(() => controller.read({}, {} as never), hasCode("principal_missing"));
});
