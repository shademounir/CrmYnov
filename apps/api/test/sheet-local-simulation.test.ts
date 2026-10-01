import assert from "node:assert/strict";
import test from "node:test";
import type { IngestionRecordInput } from "../src/ingestion/ingestion.service.js";
import type { ImportMappingTemplate } from "../src/import-mapping/import-mapping.service.js";
import { evaluateLocalMappedRow } from "../src/sheet-import/sheet-local-simulation.js";

const mapping: Pick<ImportMappingTemplate, "columns"> = { columns: [
  { sourceColumn: "Given", targetField: "firstName", action: "TRIM", required: true },
  { sourceColumn: "Phone", targetField: "phone", action: "PHONE" },
] };
const raw = { Given: "Synthetic", Phone: "+12025550171" };
const valid: IngestionRecordInput = { lineNumber: 2, firstName: "Synthetic", lastName: "Example", email: "synthetic@example.invalid", phone: "+12025550171",
  campus: "SYNTHETIC-CAMPUS", campaign: "SYNTHETIC-CAMPAIGN", program: "SYNTHETIC-PROGRAM", educationLevel: "BAC", source: "OTHER_CONTROLLED", technicalSystem: "GOOGLE_SHEETS_LOCAL", originalSource: "Synthetic test" };

test("local preflight accepts complete mapped data without mutating its inputs", () => {
  const before = JSON.stringify({ valid, raw, mapping });
  assert.equal(evaluateLocalMappedRow(valid, raw, mapping), undefined);
  assert.equal(JSON.stringify({ valid, raw, mapping }), before);
});
test("required source cells cannot be replaced silently with mapped defaults", () => {
  for (const row of [{ Phone: raw.Phone }, { ...raw, Given: "   " }]) {
    assert.equal(evaluateLocalMappedRow(valid, row, mapping), "sheet_required_column_missing");
  }
});
test("both business names remain required after mapping", () => {
  for (const field of ["firstName", "lastName"] as const) {
    assert.equal(evaluateLocalMappedRow({ ...valid, [field]: " " }, raw, mapping), "identity_name_missing");
  }
});
test("email shape is validated with bounded non-sensitive error codes", () => {
  for (const email of ["missing-at.invalid", "@invalid.test", "a@@invalid.test", "a@invalid", "a@.invalid", "a@invalid.", "a b@invalid.test", `${"a".repeat(255)}@invalid.test`]) {
    assert.equal(evaluateLocalMappedRow({ ...valid, email }, raw, mapping), "email_invalid");
  }
});
test("international phone formatting is accepted without inventing a prefix", () => {
  for (const phone of [" +1 (202) 555-0171 ", "+1.202.555.0171"]) {
    assert.equal(evaluateLocalMappedRow(valid, { ...raw, Phone: phone }, mapping), undefined);
  }
});
test("ambiguous numeric phones remain reviewable even if mapping manufactured a prefix", () => {
  for (const phone of ["12025550171", "012025550171", "+012025550171", "+1e2025550171", "+12025550171 ext1", "++12025550171", "+123", `+1${"2".repeat(15)}`]) {
    assert.equal(evaluateLocalMappedRow(valid, { ...raw, Phone: phone }, mapping), "sheet_phone_ambiguous");
  }
  assert.equal(evaluateLocalMappedRow({ ...valid, phone: "12025550171" }, raw, mapping), "sheet_phone_ambiguous");
});
test("missing mandatory references are distinguished from unknown references resolved by callers", () => {
  for (const field of ["educationLevel", "program", "campus", "campaign"] as const) {
    assert.equal(evaluateLocalMappedRow({ ...valid, [field]: " " }, raw, mapping), "sheet_required_reference_missing");
  }
});
test("missing contacts remain in review even with a local tracking identity or ignored phone column", () => {
  const record = { ...valid, phone: undefined, email: undefined };
  assert.equal(evaluateLocalMappedRow(record, { Given: "Synthetic" }, mapping), "CONTACT_IDENTITY_MISSING");
  assert.equal(evaluateLocalMappedRow({ ...record, email: " ", phone: " ", externalId: "synthetic-local-tracking-id" }, { Given: "Synthetic" }, mapping), "CONTACT_IDENTITY_MISSING");
  const ignored: Pick<ImportMappingTemplate, "columns"> = { columns: [{ sourceColumn: "Phone", targetField: "phone", action: "IGNORE" }] };
  assert.equal(evaluateLocalMappedRow(record, { Phone: "ambiguous synthetic" }, ignored), "CONTACT_IDENTITY_MISSING");
  assert.equal(evaluateLocalMappedRow({ ...record, email: "synthetic@example.invalid" }, { Phone: "ambiguous synthetic" }, ignored), undefined);
});
