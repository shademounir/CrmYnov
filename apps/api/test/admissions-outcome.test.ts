import assert from "node:assert/strict";
import test from "node:test";
import { admissionsOutcomeStatus } from "../src/admissions/admissions-outcome.js";

const end = new Date("2099-10-03T10:30:00Z");
test("Admissions return expectation uses server observation at the exact end, never infers absence", () => {
  for (const [delta, expected] of [[-1, "UPCOMING"], [0, "RETURN_EXPECTED"], [1, "RETURN_EXPECTED"], [86400000, "RETURN_EXPECTED"]] as const) {
    assert.equal(admissionsOutcomeStatus("ACCEPTED", "CONFIRME", end, false, new Date(end.valueOf() + delta)), expected);
  }
  assert.equal(admissionsOutcomeStatus("ACCEPTED", "PLANIFIE", end, false, end), "UNAVAILABLE");
  assert.equal(admissionsOutcomeStatus("PENDING", "PLANIFIE", end, false, end), "DECISION_PENDING");
  assert.equal(admissionsOutcomeStatus("ACCEPTED", "CONFIRME", new Date("invalid"), false, end), "UNAVAILABLE");
  assert.equal(admissionsOutcomeStatus("ACCEPTED", "CONFIRME", end, false, new Date("invalid")), "UNAVAILABLE");
});
test("Admissions explicit outcomes, rescheduling and actual report presence remain distinct", () => {
  for (const [state, appointment, report, expected] of [
    ["ACCEPTED", "REALISE", false, "REPORT_EXPECTED"], ["ACCEPTED", "REALISE", true, "REPORTED"],
    ["ACCEPTED", "ABSENT", false, "ABSENT"], ["CANCELLED", "ANNULE", false, "CANCELLED"],
    ["PENDING", "REPORTE", false, "RESCHEDULED"], ["REFUSED", "REFUSE", false, "REFUSED"],
    ["UNKNOWN", "BROUILLON", false, "UNAVAILABLE"],
  ] as const) assert.equal(admissionsOutcomeStatus(state, appointment, end, report, end, true), expected);
  assert.equal(admissionsOutcomeStatus("ACCEPTED", "REALISE", end, false, end, false), "HELD", "A visit without an evaluator must not request an impossible interview report");
});
