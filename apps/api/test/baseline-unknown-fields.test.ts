import assert from "node:assert/strict";
import test from "node:test";
import { baselineOptionalValues, mayPreserveBaselineUnknown } from "../src/bootstrap-import/baseline-unknown-fields.js";

const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);
test("BASELINE optional absence is explicitly empty, never a made-up reference or education", () => {
  const source = { program: null, educationLevel: "   " };
  assert.deepEqual(baselineOptionalValues(source, source, []), { program: "", educationLevel: "" });
  assert.deepEqual(source, { program: null, educationLevel: "   " }, "source values remain exact");
});
test("present values and unresolved formula evidence cannot be silently converted to unknown", () => {
  assert.throws(() => baselineOptionalValues({ program: "", educationLevel: "Bac" }, { program: "Programme source", educationLevel: "Bac" }, []), hasCode("bootstrap_baseline_known_value_cannot_clear"));
  assert.throws(() => baselineOptionalValues({ program: null, educationLevel: null }, { program: null, educationLevel: null }, ["FORMULA_REVIEW:program"]), hasCode("bootstrap_formula_review_required"));
  assert.deepEqual(baselineOptionalValues({ program: "REFERENCE_VALIDATED", educationLevel: "Bac" }, { program: null, educationLevel: null }, ["FORMULA_REVIEW:program"]), { program: "REFERENCE_VALIDATED", educationLevel: "Bac" });
});
test("only an existing unknown on a current BASELINE may be retained", () => {
  assert.equal(mayPreserveBaselineUnknown({ acquisitionKind: "BASELINE", program: "", educationLevel: "" }, "program"), true);
  assert.equal(mayPreserveBaselineUnknown({ acquisitionKind: "NEW", program: "", educationLevel: "" }, "program"), false);
  assert.equal(mayPreserveBaselineUnknown({ acquisitionKind: "BASELINE", program: "KNOWN", educationLevel: "Bac" }, "program"), false);
});
