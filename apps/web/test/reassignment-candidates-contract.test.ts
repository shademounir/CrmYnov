import assert from "node:assert/strict";
import test from "node:test";
import { parseAssignmentCandidates } from "../app/leads/[leadId]/lead-workflow-forms";
const candidate = { id: "synthetic", label: "Conseillère synthétique", activeLeadCount: 7, capacity: null };
test("manual projection accepts an honestly unconfigured ceiling and a real empty result", () => {
  assert.deepEqual(parseAssignmentCandidates({ candidates: [candidate] }), [candidate]);
  assert.deepEqual(parseAssignmentCandidates({ candidates: [] }), []);
});
for (const payload of [{}, { candidates: null }, { candidates: [{}] }, { candidates: [candidate, candidate] }, { candidates: [{ ...candidate, capacity: 7 }] }, { candidates: [{ ...candidate, activeLeadCount: -1 }] }, { candidates: [{ ...candidate, label: "" }] }, { candidates: [{ ...candidate, capacity: undefined }] }]) {
  test(`malformed candidate response is not silently converted to empty: ${JSON.stringify(payload)}`, () => { assert.throws(() => parseAssignmentCandidates(payload), /candidate_payload/u); });
}
