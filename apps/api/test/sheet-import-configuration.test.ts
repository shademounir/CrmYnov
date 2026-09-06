import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { readSheetConfiguration, sheetObject, sheetText, sheetVersion } from "../src/sheet-import/sheet-import-configuration.js";

const configuration = {
  mapping: { id: "synthetic-mapping", mappingKey: "synthetic", name: "Mapping synthétique", profile: "FORMINATOR_ZAPIER", version: 1,
    createdAt: "2026-09-06T00:00:00.000Z", createdBy: "synthetic-admin", columns: [{ sourceColumn: " Submission ", targetField: "externalId", action: "TRIM", required: true }] },
  context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", campus: "SYNTHETIC-CAMPUS", campaign: "SYNTHETIC-CAMPAIGN" },
  assignment: { strategy: "UNASSIGNED" },
};

function invalid(operation: () => unknown): void {
  assert.throws(operation, (error: unknown): boolean => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    assert.deepEqual(error.getResponse(), { code: "sheet_configuration_invalid" });
    return true;
  });
}

test("persistent Sheets configuration normalizes metadata and retains canonical cross-channel identity", () => {
  const result = readSheetConfiguration(configuration);
  assert.equal(result.mapping.columns[0]?.sourceColumn, "Submission");
  assert.equal(result.mapping.columns[0]?.required, true);
  assert.deepEqual(result.assignment, { strategy: "UNASSIGNED" });
  assert.deepEqual(result.context, { ...configuration.context, originalSource: "FORMINATOR", recentSource: "GOOGLE_SHEETS" });
  assert.equal(result.mapping.builtIn, false);
  assert.equal(result.mapping.version, 1);
});

test("malformed metadata, control characters and invalid versions fail with an expurgated business error", () => {
  for (const value of [null, [], "synthetic", 1]) invalid(() => sheetObject(value));
  for (const value of [null, "", "  ", "synthetic\n", "synthetic\u0000", "x".repeat(201)]) invalid(() => sheetText(value));
  for (const value of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) invalid(() => sheetVersion(value));
  assert.equal(sheetText(" synthetic "), "synthetic");
  assert.equal(sheetVersion(2), 2);
});

test("mapping refuses unknown actions, targets and required flags rather than accepting client-controlled fields", () => {
  const column = configuration.mapping.columns[0]; assert.ok(column);
  for (const change of [{ action: "EXECUTE" }, { targetField: "assignedToId" }, { required: "true" }, { reason: "" }]) {
    invalid(() => readSheetConfiguration({ ...configuration, mapping: { ...configuration.mapping, columns: [{ ...column, ...change }] } }));
  }
  for (const change of [{ profile: "ARBITRARY" }, { columns: null }, { columns: Array.from({ length: 101 }, () => column) }]) {
    invalid(() => readSheetConfiguration({ ...configuration, mapping: { ...configuration.mapping, ...change } }));
  }
});

test("only documented assignment strategies are parsed and fixed assignment requires an explicit target", () => {
  for (const strategy of ["UNASSIGNED", "ROUND_ROBIN", "CONTROLLED_RANDOM"]) {
    assert.deepEqual(readSheetConfiguration({ ...configuration, assignment: { strategy } }).assignment, { strategy });
  }
  assert.deepEqual(readSheetConfiguration({ ...configuration, assignment: { strategy: "FIXED", targetUserId: " synthetic-adviser " } }).assignment,
    { strategy: "FIXED", targetUserId: "synthetic-adviser" });
  invalid(() => readSheetConfiguration({ ...configuration, assignment: { strategy: "FIXED" } }));
  invalid(() => readSheetConfiguration({ ...configuration, assignment: { strategy: "CLIENT_DECIDES" } }));
  for (const context of [{ ...configuration.context, source: "UNKNOWN" }, { ...configuration.context, technicalSystem: "ZAPIER" }]) {
    invalid(() => readSheetConfiguration({ ...configuration, context }));
  }
});
