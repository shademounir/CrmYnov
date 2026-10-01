import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../../src/assignment/lead-assignment.service.js";
import { AuditService } from "../../src/audit/audit.service.js";
import type { Principal } from "../../src/auth/auth.types.js";
import { ClosureService } from "../../src/closure/closure.service.js";
import { LeadCollaborationService } from "../../src/collaboration/lead-collaboration.service.js";
import { FollowUpService } from "../../src/follow-up/follow-up.service.js";
import { IngestionService } from "../../src/ingestion/ingestion.service.js";
import { LeadService } from "../../src/leads/lead.service.js";
import { NotificationService } from "../../src/notifications/notification.service.js";
import { QuickLeadService } from "../../src/quick-lead/quick-lead.service.js";

const principal = (userId: string, roles: Principal["roles"]): Principal => ({ userId, roles,
  scopes: [{ kind: "GLOBAL" }], sessionId: `00000000-0000-4000-8000-${userId === "synthetic-manager" ? "000000000001" : "000000000002"}` });
const responseHas = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("runs the complete synthetic commercial journey without external or replay mutation", async () => {
  const manager = principal("synthetic-manager", ["MANAGER"]); const adviser = principal("synthetic-adviser", ["ADMISSIONS"]);
  const outsider = principal("synthetic-outsider", ["ADMISSIONS"]); const audit = new AuditService();
  const leads = new LeadService(audit); const engine = new AssignmentService(audit); const assignments = new LeadAssignmentService(leads, engine, audit);
  const ingestion = new IngestionService(leads, assignments, audit); const quickLeads = new QuickLeadService(leads, ingestion, assignments);
  const notifications = new NotificationService(audit); const followUps = new FollowUpService(leads, notifications, audit);
  const collaborations = new LeadCollaborationService(leads, notifications, audit); const closures = new ClosureService(leads, notifications, audit);

  engine.configure([{ id: "synthetic-global", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true,
    candidates: [{ userId: adviser.userId, active: true, capacity: 10, activeLeadCount: 0 }] }], manager, "journey:configure");
  const quickInput = { idempotencyKey: "journey-quick-0001", channel: "PHONE_CALL" as const,
    firstName: "Nora", lastName: "Synthetic", email: "nora.synthetic@example.invalid", campus: "Synthetic Campus",
    campaign: "Synthetic 2026", educationLevel: "BAC", program: "Synthetic Program", assignment: { strategy: "ROUND_ROBIN" as const } };
  const created = quickLeads.submit(quickInput, manager, "journey:create");
  assert.equal(created.outcome, "CREATED"); assert.equal(created.assignmentOutcome, "ASSIGNED"); assert.equal(created.lead.assignedToId, adviser.userId);
  assert.equal(quickLeads.preview(quickInput.email, undefined, manager).items[0]?.leadId, created.lead.id);
  const timelineAfterCreate = leads.timeline(created.lead.id, manager).length;
  assert.equal(quickLeads.submit(quickInput, manager, "journey:create-replay").replayed, true);
  assert.equal(leads.timeline(created.lead.id, manager).length, timelineAfterCreate);

  const interaction = leads.addActivity(created.lead.id, { type: "CRM_CALL", result: "WRONG_RESULT", note: "Synthetic-only note" }, adviser, "journey:interaction");
  const correctionInput = { idempotencyKey: "journey-correction-0001", expectedCorrectionCount: 0, operation: "CORRECT" as const,
    reasonCode: "WRONG_RESULT", replacement: { type: "CRM_CALL", result: "CONTACT_ESTABLISHED" } };
  const correction = leads.correctActivity(created.lead.id, interaction.id, correctionInput, manager, "journey:correction");
  assert.equal(leads.correctActivity(created.lead.id, interaction.id, correctionInput, manager, "journey:correction-replay").id, correction.id);
  assert.throws(() => leads.correctActivity(created.lead.id, interaction.id, { ...correctionInput, idempotencyKey: "journey-correction-0002" }, outsider, "journey:idor"), responseHas("interaction_correction_forbidden"));

  const dueAt = new Date(Date.now() + 20).toISOString(); const followUp = followUps.schedule(created.lead.id,
    { dueAt, reason: "SYNTHETIC_CALLBACK", ownerId: adviser.userId }, adviser, "journey:follow-up");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(leads.listLeads({ page: 1, pageSize: 10, view: "FOLLOW_UP" }, adviser, "journey:view-due").total, 1);
  assert.deepEqual(followUps.notifyDue(new Date()), { due: 1, notifications: 1 });
  assert.deepEqual(followUps.notifyDue(new Date()), { due: 0, notifications: 0 });
  const notification = notifications.list(adviser, 1, 10).items.find((item) => item.type === "FOLLOW_UP_DUE"); assert.ok(notification);
  const read = notifications.markRead(notification.id, adviser, "journey:read");
  assert.equal(notifications.markRead(notification.id, adviser, "journey:read-replay").readAt, read.readAt);
  assert.throws(() => notifications.assertResourceAccess(notification.id, adviser, []), responseHas("notification_resource_forbidden"));

  const collaboration = collaborations.request(created.lead.id, { targetUserId: "synthetic-support", action: "ADD",
    role: "ENROLLMENT_CONTRIBUTOR", justification: "SYNTHETIC_SUPPORT" }, adviser, "journey:collaboration");
  assert.throws(() => collaborations.decide(collaboration.id, { decision: "APPROVE", reason: "VALID", expectedVersion: 1 }, adviser, "journey:self-approval"), responseHas("collaboration_self_approval_forbidden"));
  assert.equal(collaborations.decide(collaboration.id, { decision: "APPROVE", reason: "VALID", expectedVersion: 1 }, manager, "journey:collaboration-approve").state, "APPROVED");

  leads.changeStatus(created.lead.id, { status: "CONTACTED" }, adviser, "journey:contacted");
  leads.changeStatus(created.lead.id, { status: "QUALIFIED" }, adviser, "journey:qualified");
  const closure = closures.request(created.lead.id, { target: "ENROLLED", reason: "ADMISSION_CONFIRMED",
    comment: "SYNTHETIC_ENROLLMENT", evidence: ["SYNTHETIC_CONFIRMATION"] }, adviser, "journey:closure");
  assert.throws(() => closures.decide(closure.id, { decision: "APPROVE", reason: "VALID", expectedVersion: 1 }, adviser, "journey:closure-self"), responseHas("closure_self_approval_forbidden"));
  assert.equal(closures.decide(closure.id, { decision: "APPROVE", reason: "VALID", expectedVersion: 1 }, manager, "journey:closure-approve").state, "APPROVED");

  const finalTimeline = leads.timeline(created.lead.id, manager); const auditTypes = new Set(audit.list(500).map((event) => event.eventType));
  assert.ok(finalTimeline.some((event) => event.id === interaction.id)); assert.ok(finalTimeline.some((event) => event.correction?.originalEventId === interaction.id));
  for (const eventType of ["LEAD_CREATED", "LEAD_AUTO_ASSIGNED", "LEAD_ACTIVITY_COMPENSATED", "FOLLOW_UP_SCHEDULED", "NOTIFICATION_READ", "COLLABORATION_APPROVED", "CLOSURE_APPROVED"]) assert.ok(auditTypes.has(eventType), eventType);
  assert.equal(leads.listLeads({ page: 1, pageSize: 10, view: "ALL" }, adviser, "journey:view-all").total, 1);
  assert.equal(leads.listLeads({ page: 1, pageSize: 10, view: "MINE" }, adviser, "journey:view-mine").total, 1);
  assert.equal(leads.listLeads({ page: 1, pageSize: 10, view: "FOLLOW_UP" }, adviser, "journey:view-final-due").total, 0);
  assert.equal(leads.listLeads({ page: 1, pageSize: 10, view: "CLOSED" }, adviser, "journey:view-closed").total, 1);
  assert.equal(followUps.list(manager).find((item) => item.id === followUp.id)?.state, "DUE");
  assert.doesNotMatch(JSON.stringify(audit.list(500)), /nora\.synthetic|Synthetic-only note/i);
});
