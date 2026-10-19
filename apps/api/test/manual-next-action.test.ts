import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { FollowUpService } from "../src/follow-up/follow-up.service.js";
import { NotificationService } from "../src/notifications/notification.service.js";

const actor = { userId: "synthetic-adviser", roles: ["ADMISSIONS" as const], sessionId: "00000000-0000-4000-8000-000000000001", scopes: [{ kind: "GLOBAL" as const }] };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);
const plan = { mode: "SCHEDULE", dueAt: "2099-10-20T09:00:00Z", reason: "Vérifier les pièces du dossier" };
function fixture(): { audit: AuditService; leads: LeadService; service: FollowUpService; lead: ReturnType<LeadService["registerLocalLead"]> } {
  const audit = new AuditService(), leads = new LeadService(audit), service = new FollowUpService(leads, new NotificationService(audit), audit);
  const lead = leads.registerLocalLead({ leadCode: "LD-SYNTHETIC", firstName: "Test", lastName: "Synthétique", campus: "TEST", campaign: "TEST", program: "TEST", educationLevel: "TEST", source: "TEST", assignedToId: actor.userId });
  return { audit, leads, service, lead };
}

test("an open manual interaction without its next action is rejected before any append", async () => {
  const f = fixture();
  await assert.rejects(f.service.addManualActivityForApi(f.lead.id, { type: "COMMENT", result: "COMPLETED", note: "Échange synthétique", idempotencyKey: "manual-missing" }, actor, "missing"), hasCode("next_action_required"));
  assert.equal(f.leads.timeline(f.lead.id, actor).length, 0);
  assert.equal(f.service.list(actor).length, 0);
  assert.equal(f.leads.getLead(f.lead.id, actor, "read").status, "PROSPECT");
});

test("manual interaction creates the same follow-up model once and replays durably by intention", async () => {
  const f = fixture(), input = { type: "COMMENT", result: "INFORMATION_RECORDED", note: "Échange synthétique", nextAction: plan, idempotencyKey: "manual-with-action" };
  const first = await f.service.addManualActivityForApi(f.lead.id, input, actor, "one");
  assert.equal((await f.service.addManualActivityForApi(f.lead.id, input, actor, "retry")).id, first.id);
  assert.equal(f.service.list(actor).length, 1);
  assert.equal(f.leads.getLead(f.lead.id, actor, "read").nextActionAt, new Date(plan.dueAt).toISOString());
  assert.equal(f.leads.getLead(f.lead.id, actor, "read").status, "CONTACTED");
  await assert.rejects(f.service.addManualActivityForApi(f.lead.id, { ...input, nextAction: { ...plan, reason: "Autre objectif" } }, actor, "changed"), hasCode("lead_idempotency_conflict"));
});

test("confirmation reuses the exact active action, stale versions and duplicates do not append", async () => {
  const f = fixture();
  const active = f.service.schedule(f.lead.id, { dueAt: plan.dueAt, reason: plan.reason }, actor, "schedule");
  const input = { type: "COMMENT", result: "COMPLETED", note: "Échange synthétique", idempotencyKey: "manual-confirmation", nextAction: { mode: "CONFIRM", id: active.id, expectedVersion: active.version, dueAt: active.dueAt } };
  await f.service.addManualActivityForApi(f.lead.id, input, actor, "confirm");
  assert.equal(f.service.list(actor).length, 1);
  const count = f.leads.timeline(f.lead.id, actor).length;
  await assert.rejects(f.service.addManualActivityForApi(f.lead.id, { ...input, idempotencyKey: "manual-stale-confirmation", nextAction: { ...input.nextAction, expectedVersion: 99 } }, actor, "stale"), hasCode("next_action_confirmation_stale"));
  await assert.rejects(f.service.addManualActivityForApi(f.lead.id, { ...input, idempotencyKey: "manual-duplicate-action", nextAction: plan }, actor, "duplicate"), hasCode("follow_up_pending"));
  assert.equal(f.leads.timeline(f.lead.id, actor).length, count);
});

test("SDK events remain appendable without a human plan and never disappear", () => {
  const f = fixture();
  const event = f.leads.addActivity(f.lead.id, { type: "CRM_CALL", result: "CALL_REQUESTED" }, actor, "sdk-event");
  assert.ok(f.leads.timeline(f.lead.id, actor).some(item => item.id === event.id));
  assert.equal(f.leads.getLead(f.lead.id, actor, "read").nextActionAt, undefined);
});

test("completion requires a future successor and commits one completion and one successor on replay", async () => {
  const f = fixture(), active = f.service.schedule(f.lead.id, { dueAt: plan.dueAt, reason: plan.reason }, actor, "schedule");
  const command = { action: "COMPLETE" as const, reason: "Pièces vérifiées", expectedVersion: active.version, idempotencyKey: "completion-successor", nextAction: { ...plan, dueAt: "2099-10-21T09:00:00Z", reason: "Vérifier la décision du responsable" } };
  await assert.rejects(f.service.decideForApi(active.id, { ...command, nextAction: undefined }, actor, "missing"), hasCode("next_action_intent_invalid"));
  assert.equal(f.service.list(actor)[0]?.state, "SCHEDULED");
  const completed = await f.service.decideForApi(active.id, command, actor, "complete");
  assert.equal(completed.state, "COMPLETED");
  assert.equal((await f.service.decideForApi(active.id, command, actor, "replay")).id, completed.id);
  assert.equal(f.service.list(actor).filter(row => row.state === "COMPLETED").length, 1);
  assert.equal(f.service.list(actor).filter(row => row.state === "SCHEDULED").length, 1);
  assert.equal(f.leads.getLead(f.lead.id, actor, "read").nextActionAt, "2099-10-21T09:00:00.000Z");
});
