import assert from "node:assert/strict";
import test from "node:test";
import { referenceKey, referenceText, referenceVersion, strictBody, validateReferenceInput, validateAliases, type ReferenceInput } from "../src/references/reference.contract.js";
const input: ReferenceInput = { kind: "TAG", code: " priorité ", label: "Priorité", scope: "GLOBAL", campusId: null };
test("reference normalization is explicit, accent-preserving and not fuzzy", () => {
  assert.equal(referenceKey(" priorité "), "PRIORITÉ"); assert.notEqual(referenceKey("priorité"), referenceKey("priorite"));
  assert.equal(validateReferenceInput(input).code, "PRIORITÉ");
  assert.equal(validateReferenceInput({ ...input, kind: "CAMPUS", code: " Campus-Synthetique " }).code, "Campus-Synthetique");
  assert.throws(() => validateReferenceInput({ ...input, kind: "CAMPUS", code: "c".repeat(81) }));
  assert.equal(validateReferenceInput({ ...input, scope: "CAMPUS", campusId: "00000000-0000-4000-8000-000000000444" }).scope, "CAMPUS");
  for (const code of ["20", "30", "40"]) assert.equal(validateReferenceInput({ ...input, kind: "SCHOLARSHIP", code }).code, code);
});
test("mass assignment, inconsistent scope, arbitrary scholarships and invalid keys are rejected", () => {
  assert.throws(() => strictBody({ roles: ["SUPER_ADMIN"] }, []));
  assert.throws(() => validateReferenceInput({ ...input, scope: "GLOBAL", campusId: "unexpected" }));
  assert.throws(() => validateReferenceInput({ ...input, scope: "CAMPUS", campusId: null }));
  assert.throws(() => validateReferenceInput({ ...input, kind: "CAMPUS", scope: "CAMPUS" }));
  assert.throws(() => validateReferenceInput({ ...input, kind: "SCHOLARSHIP", code: "50" }));
  for (const value of [null, [], "", "\u0000", "https://host.invalid", "a".repeat(121)]) assert.throws(() => referenceText(value));
  for (const value of [0, -1, 1.2, "1", undefined]) assert.throws(() => referenceVersion(value));
  assert.throws(() => validateAliases(["ok", "\n"])); assert.throws(() => validateAliases(Array.from({ length: 21 }, () => "alias")));
  validateAliases(undefined); validateAliases(["Synthétique"]); referenceVersion(1);
});
