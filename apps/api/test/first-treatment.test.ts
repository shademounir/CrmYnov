import assert from "node:assert/strict";
import test from "node:test";
import { firstTreatmentState, receptionSummary } from "../src/leads/first-treatment.js";
import { isToContact, treatmentDay, treatmentSummary } from "../src/leads/lead-treatment.js";
import type { LeadActivityRecord } from "../src/leads/lead.service.js";

const receivedAt = "2026-10-19T08:30:00.000Z";
const prospect = { status: "PROSPECT", createdAt: receivedAt, ...receptionSummary(receivedAt), ...treatmentSummary([], []) };
test("first treatment is strictly overdue after 24 consecutive hours, not at the boundary", () => {
  for (const [instant, overdue] of [["2026-10-20T08:29:59.999Z", false], ["2026-10-20T08:30:00.000Z", false], ["2026-10-20T08:30:00.001Z", true]] as const) {
    const state = firstTreatmentState(prospect, new Date(instant));
    assert.equal(state.firstTreatmentOverdue, overdue); assert.equal(state.firstTreatmentPending, true);
    assert.equal(state.firstTreatmentDeadlineAt, "2026-10-20T08:30:00.000Z");
  }
});
test("elapsed threshold is independent of Casablanca civil-day boundaries and offset", () => {
  const start = "2026-09-10T23:30:00+01:00";
  const lead = { ...prospect, receivedAt: start };
  assert.equal(firstTreatmentState(lead, new Date("2026-09-11T23:30:00+01:00")).firstTreatmentOverdue, false);
  assert.equal(firstTreatmentState(lead, new Date("2026-09-11T23:30:00.001+01:00")).firstTreatmentOverdue, true);
  assert.equal(treatmentDay(start), "2026-09-10");
  assert.equal(treatmentDay("2026-09-10T23:30:00Z"), "2026-09-11");
});
test("historical exchanges, including undated notes, never become never-treated", () => {
  for (const notes of [[{ occurredAt: null }], [{ occurredAt: "2025-01-01T08:00:00Z" }], [{ occurredAt: null }, { occurredAt: "2025-01-01T08:00:00Z" }]]) {
    const lead = { ...prospect, ...treatmentSummary([], notes) };
    assert.equal(isToContact(lead), false); assert.equal(firstTreatmentState(lead, new Date("2027-01-01T00:00:00Z")).firstTreatmentOverdue, false);
  }
  for (const status of ["CONTACTED", "QUALIFIED", "ENROLLED", "CLOSED_LOST"]) assert.equal(isToContact({ ...prospect, status }), false);
});
test("technical events, reads, imports and follow-up bookkeeping do not constitute first treatment", () => {
  const event = (type: string, result: string, note?: string): LeadActivityRecord => ({ id: result, leadId: "synthetic", authorId: "synthetic", correlationId: "synthetic", occurredAt: receivedAt, type: type as LeadActivityRecord["type"], result, ...(note ? { note } : {}) });
  const technical = [event("LEAD_CREATED", "PROSPECT"), event("LEGACY_IMPORT", "IMPORT_COMPLETE"), event("COMMENT", "FOLLOW_UP_SCHEDULED", "Planification technique"), event("COMMENT", "FOLLOW_UP_CANCELLED_FOR_CLOSURE", "Annulation technique"), event("PROVENANCE_ATTACHED", "WEB_FORM")];
  assert.equal(isToContact({ ...prospect, ...treatmentSummary(technical, []) }), true);
  const business = event("COMMENT", "INFORMATION_RECORDED", "Échange réel synthétique consigné");
  const summary = treatmentSummary([...technical, business], []);
  assert.equal(summary.firstTreatmentAt, receivedAt); assert.equal(isToContact({ ...prospect, ...summary }), false);
});
test("first reception uses only a recognized source contract; historical and future dates remain CRM observations", () => {
  const first = { batchId: "creation", sourceType: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", occurredAt: "2026-10-18T07:30:00Z" };
  assert.deepEqual(receptionSummary(receivedAt, "NEW", first, "creation"), { receivedAt: "2026-10-18T07:30:00.000Z", receptionOrigin: "SOURCE_CONTRACT" });
  for (const evidence of [{ ...first, occurredAt: "2099-01-01T00:00:00Z" }, { ...first, technicalSystem: "UNQUALIFIED" }, { ...first, occurredAt: null }, { ...first, batchId: "later-attachment" }]) assert.deepEqual(receptionSummary(receivedAt, "NEW", evidence, "creation"), { receivedAt, receptionOrigin: "CRM_OBSERVATION" });
  assert.deepEqual(receptionSummary(receivedAt, "NEW", first), { receivedAt, receptionOrigin: "CRM_OBSERVATION" }, "a manually created Lead cannot acquire a new source clock on later attachment");
  assert.deepEqual(receptionSummary(receivedAt, "BASELINE", first, "creation"), { receivedAt, receptionOrigin: "CRM_OBSERVATION_BASELINE" });
});
test("re-evaluation never rewrites reception; invalid evidence is unavailable, never a fake epoch", () => {
  const before = structuredClone(prospect);
  assert.equal(firstTreatmentState(prospect, new Date("2026-10-21T08:30:00Z")).firstTreatmentAgeMinutes, 2880);
  assert.deepEqual(prospect, before);
  const invalid = firstTreatmentState({ ...prospect, receivedAt: "invalid" }, new Date());
  assert.equal(invalid.firstTreatmentOverdue, false); assert.equal(invalid.firstTreatmentDeadlineAt, null); assert.equal(invalid.firstTreatmentAgeMinutes, null);
});
