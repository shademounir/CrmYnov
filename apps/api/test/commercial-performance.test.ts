import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { ReassignmentService } from "../src/assignment/reassignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { FollowUpService } from "../src/follow-up/follow-up.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import { CommercialPerformanceController } from "../src/reporting/commercial-performance.controller.js";
import { CommercialPerformanceService } from "../src/reporting/commercial-performance.service.js";

const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-manager" };
const adviserA: Principal = { userId: "adviser-a", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-a" };
const adviserB: Principal = { userId: "adviser-b", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-b" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify(error).includes(code);

function setup(): { audit: AuditService; leads: LeadService; followUps: FollowUpService; engine: AssignmentService;
  reassignments: ReassignmentService; service: CommercialPerformanceService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const notifications = new NotificationService(audit);
  const followUps = new FollowUpService(leads, notifications, audit); const engine = new AssignmentService(audit);
  const reassignments = new ReassignmentService(leads, engine, audit);
  const service = new CommercialPerformanceService(leads, followUps, reassignments, audit);
  return { audit, leads, followUps, engine, reassignments, service };
}

test("computes distinct primary KPIs and keeps secondary contributions separate", () => {
  const { audit, leads, followUps, engine, reassignments, service } = setup();
  const contacted = leads.registerLocalLead({ id: "lead-contacted", leadCode: "LD-SYN-1", firstName: "Prénom", lastName: "Synthétique",
    campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique",
    source: "SOURCE_SYNTHETIQUE", status: "CONTACTED", assignedToId: adviserA.userId, collaboratorIds: [adviserB.userId] });
  leads.registerLocalLead({ id: "lead-enrolled", leadCode: "LD-SYN-2", firstName: "Autre", lastName: "Synthétique",
    campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique",
    source: "SOURCE_SYNTHETIQUE", status: "ENROLLED", assignedToId: adviserA.userId, collaboratorIds: [adviserB.userId] });
  leads.addActivity(contacted.id, { type: "PHONE_CALL", result: "ANSWERED" }, adviserA, "corr-interaction");
  const future = new Date(Date.now() + 3_600_000).toISOString();
  followUps.schedule(contacted.id, { dueAt: future, reason: "Relance synthétique", ownerId: adviserA.userId }, adviserA, "corr-follow-up");
  engine.configure([{ id: "global-rule", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true,
    candidates: [{ userId: adviserA.userId, active: true, capacity: 10, activeLeadCount: 2 }, { userId: adviserB.userId, active: true, capacity: 10, activeLeadCount: 0 }] }], manager, "corr-config");
  const request = reassignments.request(contacted.id, { targetUserId: adviserB.userId, reason: "Rééquilibrage synthétique", moveOpenTasks: true, idempotencyKey: "reassign_perf_1" }, adviserA, "corr-request");
  reassignments.decide(request.id, { approved: true, reason: "Capacité synthétique confirmée" }, manager, "corr-decision");

  const result = service.read({ campus: "Campus synthétique", inactivityHours: "24" }, manager, "corr-report", new Date(Date.now() + 7_200_000));
  const a = result.advisers.find((item) => item.adviserId === adviserA.userId)!;
  const b = result.advisers.find((item) => item.adviserId === adviserB.userId)!;
  assert.equal(result.cohort.uniqueLeadCount, 2); assert.equal(a.primaryLeadCount, 1); assert.equal(b.primaryLeadCount, 1);
  assert.equal(b.secondaryLeadCount, 1); assert.equal(a.statusVolumes.enrolled, 1); assert.equal(b.statusVolumes.contacted, 1);
  assert.equal(a.rates.enrollment, 1); assert.equal(b.rates.contact, 1); assert.equal(a.followUps.overdue, 1);
  assert.deepEqual(a.reassignments, { requested: 1, approved: 1, rejected: 0 });
  assert.ok(result.definitions.every((definition) => definition.numerator && definition.denominator));
  const serialized = JSON.stringify(result); assert.equal(serialized.includes("Prénom"), false); assert.equal(serialized.includes("LD-SYN"), false);
  const event = audit.list().find((item) => item.eventType === "COMMERCIAL_PERFORMANCE_VIEWED");
  assert.deepEqual(event?.after?.activeFilterNames, ["campus", "inactivityHours"]); assert.equal(JSON.stringify(event).includes("Campus synthétique"), false);
});

test("limits advisers to their own authorised indicators and fails closed on invalid thresholds", () => {
  const { leads, service } = setup();
  leads.registerLocalLead({ leadCode: "LD-A", firstName: "A", lastName: "Synthétique", campus: "Campus synthétique",
    campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "SOURCE", assignedToId: adviserA.userId });
  leads.registerLocalLead({ leadCode: "LD-B", firstName: "B", lastName: "Synthétique", campus: "Campus synthétique",
    campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "SOURCE", assignedToId: adviserB.userId });
  const own = service.read({}, adviserA, "corr-own");
  assert.deepEqual(own.advisers.map((item) => item.adviserId), [adviserA.userId]); assert.equal(own.cohort.uniqueLeadCount, 1);
  assert.throws(() => service.read({ inactivityHours: "0" }, manager, "corr-invalid"), hasCode("performance_inactivity_threshold_invalid"));
  assert.throws(() => service.read({ from: "invalid" }, manager, "corr-invalid"), hasCode("performance_from_invalid"));
});

test("controller fails closed without a principal", () => {
  const { service } = setup(); const controller = new CommercialPerformanceController(service);
  assert.throws(() => controller.read({}, {} as never), hasCode("principal_missing"));
  assert.equal(controller.read({}, { principal: manager, header: () => "corr-controller" } as never).cohort.uniqueLeadCount, 0);
});
