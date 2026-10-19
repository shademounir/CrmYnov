import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadService, type LeadStatus, type LeadRecord } from "../src/leads/lead.service.js";
import { isCommercialContact, positiveQualificationEvidence } from "../src/leads/commercial-progression.js";
import type { Principal } from "../src/auth/auth.types.js";
const actor: Principal = { userId: "commercial-fixture", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "fixture-session" };
const make = (status: LeadStatus = "PROSPECT"): { audit: AuditService; service: LeadService; lead: LeadRecord } => {
  const audit = new AuditService(), service = new LeadService(audit);
  const lead = service.registerLocalLead({ leadCode: "SYNTHETIC-PROGRESSION", firstName: "Test", lastName: "Fixture", campus: "CASABLANCA", campaign: "FIXTURE", educationLevel: "Bac", program: "Informatique", source: "FIXTURE", status });
  return { audit, service, lead };
};
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);
test("new real business interaction contacts a prospect once and persists separate status evidence", () => {
  const { service, lead, audit } = make();
  service.addActivity(lead.id, { type: "PHONE_CALL", result: "NO_ANSWER" }, actor, "first-business-action");
  service.addActivity(lead.id, { type: "COMMENT", result: "INFORMATION_RECORDED", note: "Échange commercial synthétique" }, actor, "second-business-action");
  assert.equal(service.getLead(lead.id, actor, "read").status, "CONTACTED");
  assert.equal(service.timeline(lead.id, actor).filter(x => x.type === "STATUS_CHANGED").length, 1);
  assert.equal(audit.list().filter(x => x.eventType === "LEAD_STATUS_CHANGED").length, 1);
});
test("imports, dispatch markers, planned appointments and technical metadata never fabricate first contact", () => {
  for (const activity of [{ type: "LEGACY_IMPORT", result: "IMPORTED", note: "Historique" }, { type: "CRM_CALL", result: "CALL_REQUESTED" }, { type: "MEETING", result: "APPOINTMENT_PLANIFIE" }, { type: "ASSIGNMENT_CHANGED", result: "ASSIGNED" }, { type: "COMMENT", result: "FOLLOW_UP" }]) {
    const { service, lead } = make();service.addActivity(lead.id, activity, actor, "technical");
    assert.equal(service.getLead(lead.id, actor, "read").status, "PROSPECT");
  }
});

test("planning, completion metadata and closure cancellation are not commercial exchanges even with an objective note", () => {
  for (const result of ["FOLLOW_UP_SCHEDULED", "FOLLOW_UP_POSTPONE", "FOLLOW_UP_COMPLETE", "FOLLOW_UP_CANCEL", "FOLLOW_UP_CANCELLED_FOR_CLOSURE", "FOLLOW_UP_DUE"]) {
    assert.equal(isCommercialContact({ type: "COMMENT", result, note: "Objectif de suivi technique synthétique" }), false);
  }
  assert.equal(isCommercialContact({ type: "COMMENT", result: "FOLLOW_UP_REQUIRED", note: "Échange commercial déclaré" }), true);
});
test("first-contact classification includes real notes, emails, WhatsApp and traced call results", () => {
  for (const type of ["MANUAL_EMAIL", "WHATSAPP", "PHYSICAL_VISIT", "PHONE_CALL", "EXTERNAL_CALL", "CRM_CALL", "MEETING", "COMMENT"]) {
    assert.equal(isCommercialContact({ type, result: "COMPLETED", note: "Échange synthétique" }), true);
  }
});
test("manual contact and a positive qualification need no manager, but temperature alone is never evidence", () => {
  const { service, lead } = make();
  assert.equal(service.changeStatus(lead.id, { status: "CONTACTED" }, actor, "manual-contact").status, "CONTACTED");
  assert.throws(() => service.changeStatus(lead.id, { status: "QUALIFIED", reason: "Température chaude" }, actor, "not-qualified"), hasCode("commercial_positive_qualification_required"));
  assert.equal(service.changeStatus(lead.id, { status: "QUALIFIED", reason: "Intérêt explicite et prérequis vérifiés", qualification: { interestConfirmed: true, eligibilityConfirmed: true } }, actor, "positive-qualification").status, "QUALIFIED");
  assert(service.timeline(lead.id, actor).some(x => x.type === "STATUS_CHANGED" && x.note?.includes("éligibilité vérifiée")));
});
test("unknown baseline fields and negative/unconfirmed eligibility do not qualify a dossier", () => {
  for (const qualification of [undefined, { interestConfirmed: true, eligibilityConfirmed: false }, { interestConfirmed: false, eligibilityConfirmed: true }])
    assert.throws(() => positiveQualificationEvidence({ program: "Informatique", educationLevel: "Bac" }, qualification, "Motif synthétique valide"), hasCode("commercial_positive_qualification_required"));
  assert.throws(() => positiveQualificationEvidence({ program: "", educationLevel: "Bac" }, { interestConfirmed: true, eligibilityConfirmed: true }, "Motif synthétique valide"), hasCode("commercial_positive_qualification_required"));
});
test("new activity never regresses a qualified, enrolled or lost historical dossier", () => {
  for (const status of ["QUALIFIED", "ENROLLED", "CLOSED_LOST"] as const) {
    const { service, lead } = make(status);service.addActivity(lead.id, { type: "PHONE_CALL", result: "CONNECTED" }, actor, "new-interaction");
    assert.equal(service.getLead(lead.id, actor, "read").status, status);
    assert.throws(() => service.changeStatus(lead.id, { status: "CONTACTED" }, actor, "regression"), hasCode("lead_status_transition_forbidden"));
  }
});
test("direct API terminal status remains forbidden even to an administrator", async () => {
  const { service, lead } = make();
  await assert.rejects(service.changeStatusForApi(lead.id, { status: "CLOSED_LOST", reason: "Test" }, { ...actor, roles: ["ADMIN"] }, "direct-terminal"), hasCode("lead_closure_approval_required"));
});

test("stable action keys replay once, bind the actor and reject forged technical interactions", async () => {
  const { service, lead } = make();
  const body = { type: "COMMENT", result: "INFORMATION_RECORDED", note: "Échange synthétique", idempotencyKey: "fixture-interaction-001" };
  const first = await service.addActivityForApi(lead.id, body, actor, "first-request");
  assert.equal((await service.addActivityForApi(lead.id, body, actor, "other-proxy-correlation")).id, first.id);
  await assert.rejects(service.addActivityForApi(lead.id, { ...body, note: "Autre intention" }, actor, "conflict"), hasCode("lead_idempotency_conflict"));
  await assert.rejects(service.addActivityForApi(lead.id, body, { ...actor, userId: "other-commercial" }, "other-actor"), hasCode("lead_idempotency_conflict"));
  await assert.rejects(service.addActivityForApi(lead.id, { ...body, type: "LEGACY_IMPORT" }, actor, "forged-import"), hasCode("activity_invalid"));
  const status = { status: "QUALIFIED", reason: "Projet et conditions vérifiés", qualification: { interestConfirmed: true, eligibilityConfirmed: true }, idempotencyKey: "fixture-status-001" };
  const qualified = await service.changeStatusForApi(lead.id, status, actor, "first-status");
  assert.deepEqual(await service.changeStatusForApi(lead.id, status, actor, "second-proxy-correlation"), qualified);
  assert.equal(service.timeline(lead.id, actor).filter(item => item.type === "STATUS_CHANGED").length, 2);
});
