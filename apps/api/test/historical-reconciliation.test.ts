import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "../src/bootstrap-import/bootstrap-import.contract.js";
import { historicalReconciliation, type ReconciliationRow } from "../src/bootstrap-import/historical-reconciliation.js";

const sha256 = "a".repeat(64);
type Fixture = Parameters<typeof historicalReconciliation>[0];
function fixture(): Fixture {
  const payload = { rowNumber: 7, cells: { I: { value: "  Note exacte\né & espaces  ", raw: null, type: "inlineStr" } } };
  const mapped = { values: { email: "synth@example.invalid", phone: "+212 612-345-678", status: "PROSPECT", temperature: "COLD" }, rawStatus: "À contacter", comments: [{ column: "I", text: payload.cells.I.value }] };
  const decision = { expectedVersion: 1, idempotencyKey: "decision-synth", action: "CREATE_DOSSIER", actorId: "actor-synth", reason: "Résolution synthétique vérifiée", values: { ...mapped.values, ownerId: null } };
  const row: ReconciliationRow = { id: "row-synth", sheet: "VISITES ET APPELS", relationId: "rId1", rowNumber: 7, sourceKey: hash([sha256, "rId1", 7]),
    fingerprint: hash(payload), payload, mapped, decision, decisionFingerprint: hash({ ...decision, expectedVersion: undefined, values: undefined }), state: "ACCEPTED", leadId: "lead-synth" };
  return { sha256, rows: [row], notes: [{ rowId: row.id, leadId: row.leadId!, cellKey: hash([sha256, "rId1", 7, "I"]), fingerprint: hash(payload.cells.I), sourceSheet: row.sheet, sourceRow: 7, sourceColumn: "I", text: payload.cells.I.value, sourceValue: payload.cells.I, author: null, occurredAt: null }],
    receipts: [{ key: row.id, fingerprint: row.decisionFingerprint!, actorId: "actor-synth", response: { rowId: row.id, leadId: row.leadId } }],
    provenance: [{ leadId: row.leadId!, externalId: row.sourceKey, submissionFingerprint: row.fingerprint, technicalSystem: "EXCEL_BOOTSTRAP_R8", sourceType: "LEGACY_CRM" }],
    leads: [{ id: row.leadId!, status: "PROSPECT", assignedToId: null, acquisitionKind: "BASELINE", baselineTemperature: "COLD", visibleForCurrentAxes: true }], truncated: false };
}

test("reconciliation verifies exact source, notes, durable receipt and provenance, not totals alone", () => {
  const input = fixture(), report = historicalReconciliation(input);
  assert.equal(report.complete, true); assert.deepEqual(report.discrepancies, []);
  assert.equal(report.effects.exactNotes, 1); assert.equal(report.effects.exactRowReceipts, 1); assert.equal(report.effects.exactProvenance, 1);
  assert.equal(report.effects.distinctTargetDossiers, 1);
  assert.deepEqual(report.axes.sourceStatus, { "À contacter": 1 }); assert.deepEqual(report.axes.cycle, { UNSPECIFIED: 1 });
  assert.deepEqual(historicalReconciliation(input), report, "reread/replay does not fabricate effects");
});

test("comments retain trailing spaces, declared unknown authors and exact source cell fingerprints", () => {
  const mutations = [
    (input: Fixture): void => { input.notes[0]!.text = input.notes[0]!.text.trim(); },
    (input: Fixture): void => { input.notes[0]!.sourceValue = { ...(input.notes[0]!.sourceValue as Record<string, unknown>), type: "changed" }; },
    (input: Fixture): void => { input.notes[0]!.sourceColumn = "J"; },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); const report = historicalReconciliation(input); assert.equal(report.complete, false); assert.ok(report.discrepancies.some(item => item.code === "NOTE_EXACT_CONTENT_MISMATCH")); }
  const missing = fixture(); missing.notes = []; assert.equal(historicalReconciliation(missing).complete, false);
  const duplicate = fixture(); duplicate.notes.push(duplicate.notes[0]!); assert.equal(historicalReconciliation(duplicate).complete, false);
});
test("whitespace source is not an interaction; old exact blank records remain technical traces without backfill", () => {
  const input = fixture(), row = input.rows[0]!;
  const source = row.payload as { cells: { I: { value: string; raw: null; type: string } } }; source.cells.I.value = " \t\n "; row.fingerprint = hash(row.payload);
  (row.mapped as { comments: Array<{ column: string; text: string }> }).comments = [{ column: "I", text: source.cells.I.value }];
  input.provenance[0]!.submissionFingerprint = row.fingerprint;
  input.notes[0]!.text = source.cells.I.value; input.notes[0]!.sourceValue = source.cells.I; input.notes[0]!.fingerprint = hash(source.cells.I);
  const old = historicalReconciliation(input); assert.equal(old.complete, true); assert.equal(old.effects.expectedNotes, 0); assert.equal(old.effects.persistedNotes, 0); assert.equal(old.effects.exactNotes, 0); assert.equal(old.effects.preservedNonInteractionBlankRecords, 1);
  input.notes = []; const fresh = historicalReconciliation(input); assert.equal(fresh.complete, true); assert.equal(fresh.effects.expectedNotes, 0); assert.equal(fresh.effects.preservedNonInteractionBlankRecords, 0);
});

test("an unresolved, truncated, corrupt, missing-target or missing-receipt projection blocks cutover", () => {
  const cases: Array<(input: ReturnType<typeof fixture>) => void> = [
    (input): void => { input.truncated = true; }, (input): void => { input.rows[0]!.state = "READY"; }, (input): void => { input.rows[0]!.fingerprint = "b".repeat(64); },
    (input): void => { input.rows[0]!.sourceKey = "c".repeat(64); }, (input): void => { input.rows[0]!.decisionFingerprint = "d".repeat(64); },
    (input): void => { input.receipts = []; }, (input): void => { input.receipts[0]!.actorId = "foreign-synth"; }, (input): void => { input.provenance = []; }, (input): void => { input.leads = []; }, (input): void => { input.leads[0]!.baselineTemperature = "HOT"; },
  ];
  for (const mutate of cases) { const input = fixture(); mutate(input); assert.equal(historicalReconciliation(input).complete, false); }
});

test("current business status/owner and LINK are distinct from historical decisions, never overwritten", () => {
  const input = fixture(); input.leads[0]!.status = "ENROLLED";
  const row = input.rows[0]!, old = row.decision as Record<string, unknown>;
  const decision = { ...old, action: "LINK_EXISTING", targetLeadId: row.leadId };
  row.decision = decision; row.decisionFingerprint = hash({ ...decision, expectedVersion: undefined, values: undefined }); input.receipts[0]!.fingerprint = row.decisionFingerprint;
  input.leads[0]!.acquisitionKind = "NEW";
  const report = historicalReconciliation(input);
  assert.equal(report.complete, true); assert.equal(report.effects.linkedOccurrences, 1); assert.equal(report.effects.createdOccurrences, 0);
  assert.deepEqual(report.axes.resolvedStatus, { PROSPECT: 1 }); assert.deepEqual(report.axes.currentDossierStatus, { ENROLLED: 1 });
});

test("ignored occurrences require a justified decision and receipt but create neither notes nor dossier", () => {
  const input = fixture(), row = input.rows[0]!;
  const decision = { ...(row.decision as Record<string, unknown>), action: "IGNORE" };
  row.decision = decision; row.decisionFingerprint = hash({ ...decision, expectedVersion: undefined, values: undefined }); row.state = "IGNORED"; row.leadId = null;
  input.receipts[0]!.fingerprint = row.decisionFingerprint; input.receipts[0]!.response = { rowId: row.id, leadId: null };
  input.notes = []; input.provenance = []; input.leads = [];
  const report = historicalReconciliation(input); assert.equal(report.complete, true); assert.equal(report.effects.ignoredOccurrences, 1); assert.equal(report.effects.expectedNotes, 0);
  row.decision = { ...decision, reason: "" }; assert.equal(historicalReconciliation(input).complete, false);
});

test("contact groups overlap and never infer a person, country, candidature or surname equivalence", () => {
  const input = fixture(), row = input.rows[0]!;
  input.rows.push({ ...row, id: "second-source", state: "REVIEW", leadId: null, decision: null, decisionFingerprint: null,
    mapped: { values: { email: " SYNTH@EXAMPLE.INVALID ", phone: "+212612345678" } } });
  const report = historicalReconciliation(input);
  assert.deepEqual(report.contacts.email, { groups: 1, occurrences: 2 }); assert.deepEqual(report.contacts.phone, { groups: 1, occurrences: 2 });
  assert.equal(report.contacts.overlappingGroupsNotUniquePeople, true); assert.equal(report.complete, false);
  input.rows[1]!.mapped = { values: { email: "other@example.invalid", phone: "0612345678 / 0612345679" } };
  assert.equal(historicalReconciliation(input).contacts.phone.groups, 0);
});

test("source status prototype-shaped text stays data and cannot change report object prototypes", () => {
  const input = fixture(); (input.rows[0]!.mapped as { rawStatus: string }).rawStatus = "__proto__";
  const result = historicalReconciliation(input); assert.equal(Object.getPrototypeOf(result.axes.sourceStatus!), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result.axes.sourceStatus!, "__proto__")?.value, 1);
});

test("historical cycle period is reconciled explicitly, never inferred from current date", () => {
  const input = fixture(), row = input.rows[0]!;
  const decision = { ...(row.decision as Record<string, unknown>), cycle: { state: "CONFIRMED_TARGET", label: "2027-2028", sourceColumns: ["I"], reason: "Interprétation synthétique explicitement confirmée" } };
  row.decision = decision; row.decisionFingerprint = hash({ ...decision, expectedVersion: undefined, values: undefined }); input.receipts[0]!.fingerprint = row.decisionFingerprint;
  const report = historicalReconciliation(input);
  assert.equal(report.complete, true); assert.deepEqual(report.axes.cyclePeriod, { "CONFIRMED_TARGET:2027-2028": 1 });
});

test("import.view alone never exposes current dossier status or owner after permission revocation", () => {
  const input = fixture(); input.leads[0]!.visibleForCurrentAxes = false;
  const report = historicalReconciliation(input);
  assert.equal(report.complete, true); assert.deepEqual(report.currentDossierAxes, { visible: 0, withheld: 1 });
  assert.deepEqual(report.axes.currentDossierStatus, {}); assert.deepEqual(report.axes.currentDossierOwner, {});
  assert.equal(report.effects.distinctTargetDossiers, 1);
});
