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
import { CommercialWorkService } from "../src/reporting/commercial-work.service.js";
import { normalizeWorkQuery } from "../src/reporting/commercial-work-query.js";
import type { ClosureService } from "../src/closure/closure.service.js";
import type { FollowUpRecord } from "../src/follow-up/follow-up.service.js";

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
    source: "SOURCE_SYNTHETIQUE", status: "CONTACTED", assignedToId: adviserA.userId, assignedToLabel: "Conseillère A", collaboratorIds: [adviserB.userId] });
  leads.registerLocalLead({ id: "lead-enrolled", leadCode: "LD-SYN-2", firstName: "Autre", lastName: "Synthétique",
    campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique",
    source: "SOURCE_SYNTHETIQUE", status: "ENROLLED", assignedToId: adviserA.userId, assignedToLabel: "Conseillère A", collaboratorIds: [adviserB.userId] });
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
  assert.equal(a.adviserLabel, "Conseillère A");
  const work = new CommercialWorkService(leads, followUps, { reportingSnapshot: () => [] } as unknown as ClosureService, audit);
  const { queue, adviserScope, taskOwnerId, ...filters } = Object.fromEntries(new URL(a.drillDown.overdue, "https://crm.invalid").searchParams);
  const detail = work.read(normalizeWorkQuery(filters, manager, new Date()), { queue, adviserScope, taskOwnerId }, manager, "corr-owner-detail", new Date(result.generatedAt));
  assert.equal(taskOwnerId, adviserA.userId); assert.equal(detail.queues.find((item) => item.key === "OVERDUE_FOLLOW_UP")!.itemCount, a.followUps.overdue);
  assert.deepEqual(detail.page.items.map((item) => item.id), [contacted.id], "task owner A still links to authorized Lead now assigned to B");
  assert.ok(detail.queues.every((item) => new URL(item.href, "https://crm.invalid").searchParams.get("taskOwnerId") === adviserA.userId));
  assert.equal(new URL(a.drillDown.assigned, "https://crm.invalid").searchParams.get("assignedToLabel"), "Conseillère A");
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

test("controller fails closed without a principal", async () => {
  const { service } = setup(); const controller = new CommercialPerformanceController(service);
  assert.throws(() => controller.read({}, {} as never), hasCode("principal_missing"));
  assert.equal((await controller.read({}, { principal: manager, header: () => "corr-controller" } as never)).cohort.uniqueLeadCount, 0);
});

test("task owner counts share strict overdue, due-now, future, invalid, completed and cancelled semantics", () => {
  const { leads, followUps, service } = setup(); const now = new Date("2026-10-20T12:00:00Z");
  const lead = leads.registerLocalLead({ id: "owner-test", leadCode: "SYN-OWNER", firstName: "Synthetic", lastName: "Fixture", campus: "CAMPUS", campaign: "CAMPAIGN", educationLevel: "Bac", program: "PROGRAM", source: "WEB_FORM", status: "CONTACTED", assignedToId: adviserB.userId });
  const record = (id: string, dueAt: string, state: FollowUpRecord["state"] = "SCHEDULED"): FollowUpRecord => ({ id, leadId: lead.id, ownerId: adviserA.userId, dueAt, state, reason: "Synthetic", version: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  followUps.reportingSnapshot = (): FollowUpRecord[] => [record("late", "2026-10-20T11:59:59.999Z"), record("equal", "2026-10-20T13:00:00+01:00", "DUE"), record("future", "2026-10-21T00:00:00Z", "DUE"), record("invalid", "invalid"), record("done", "2026-10-19T00:00:00Z", "COMPLETED"), record("cancel", "2026-10-19T00:00:00Z", "CANCELLED")];
  const result = service.read({ campus: "CAMPUS" }, manager, "owner-states", now);
  const owner = result.advisers.find((item) => item.adviserId === adviserA.userId)!;
  assert.equal(owner.primaryLeadCount, 0, "former owner not silently made current principal adviser");
  assert.deepEqual(owner.followUps, { planned: 1, completed: 1, overdue: 1, cancelled: 1, active: 4, dueNow: 1, invalidDeadline: 1 });
  assert.equal(result.advisers.find((item) => item.adviserId === adviserB.userId)!.followUps.overdue, 0);
});
