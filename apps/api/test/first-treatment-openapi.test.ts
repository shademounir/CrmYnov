import assert from "node:assert/strict";
import test from "node:test";
import { firstTreatmentSchemas, treatmentListParameters } from "../src/leads/first-treatment.openapi.js";

test("first-treatment OpenAPI distinguishes immutable reception, unknown history and nullable evidence", () => {
  const schema = firstTreatmentSchemas.LeadTreatmentProjection;
  assert.equal(schema.readOnly, true);
  assert.deepEqual(schema.properties.receptionOrigin.enum, ["SOURCE_CONTRACT", "CRM_OBSERVATION", "CRM_OBSERVATION_BASELINE"]);
  assert.deepEqual(schema.properties.treatmentState.enum, ["DATED", "UNKNOWN_DATE", "NONE"]);
  assert.equal(schema.properties.firstTreatmentAgeMinutes.nullable, true);
  assert.equal(schema.properties.firstTreatmentDeadlineAt.nullable, true);
  assert.equal((schema.required as readonly string[]).includes("firstTreatmentAt"), false);
  assert.match(schema.properties.firstTreatmentOverdue.description, /strictly more than 24.*equality is not overdue/);
  assert.match(schema.description, /not a read, login, import/);
});

test("queue contract names the strict threshold and list documents the same targeted view", () => {
  const schema = firstTreatmentSchemas.FirstTreatmentQueue;
  assert.deepEqual(schema.properties.thresholdHours.enum, [24]);
  assert.deepEqual(schema.properties.comparison.enum, ["STRICTLY_GREATER"]);
  assert.match(schema.properties.count.description, /Distinct authorized Leads.*not actions/);
  assert.match(treatmentListParameters.find((parameter) => parameter.name === "view")!.description, /FIRST_TREATMENT_OVERDUE/);
  assert.equal(new Set(treatmentListParameters.map((parameter) => parameter.name)).size, treatmentListParameters.length);
});
