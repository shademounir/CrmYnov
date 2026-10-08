import { hash, record } from "./bootstrap-import.contract.js";
import { normalizeHistoricalEmail, normalizeHistoricalPhone } from "./bootstrap-create-guards.js";

type Values = Record<string, string | null>;
export interface ReconciliationRow {
  id: string; sheet: string; relationId: string; rowNumber: number; sourceKey: string;
  fingerprint: string; payload: unknown; mapped: unknown; decision: unknown;
  decisionFingerprint: string | null; state: string; leadId: string | null;
}
export interface ReconciliationNote {
  rowId: string; leadId: string; cellKey: string; fingerprint: string; sourceSheet: string;
  sourceRow: number; sourceColumn: string; text: string; sourceValue: unknown;
  author: string | null; occurredAt: Date | null;
}
export interface ReconciliationReceipt { key: string; fingerprint: string; actorId: string; response: unknown }
export interface ReconciliationProvenance { leadId: string; externalId: string | null; submissionFingerprint: string | null; technicalSystem: string | null; sourceType: string }
export interface ReconciliationLead { id: string; status: string; assignedToId: string | null; acquisitionKind: string; baselineTemperature: string | null; visibleForCurrentAxes?: boolean }
interface ExpectedNote { rowId: string; leadId: string; sheet: string; row: number; column: string; text: string; value: unknown; author: string | null }
const valueRecord = (value: unknown): Values => record(value) ? value as Values : {};
const object = (value: unknown): Record<string, unknown> => record(value) ? value : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const increment = (counts: Record<string, number>, value: unknown): void => {
  const key = typeof value === "string" && value.length ? value : "UNSPECIFIED";
  Object.defineProperty(counts, key, { value: (Object.hasOwn(counts, key) ? counts[key]! : 0) + 1, enumerable: true, configurable: true, writable: true });
};
// No inferred country, fuzzy name, or contact equivalence. Groups can overlap;
// neither their sum nor one key is a count of unique people/candidatures.
function contactGroups(rows: ReconciliationRow[], field: "email" | "phone"): { groups: number; occurrences: number } {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const raw = valueRecord(object(row.mapped).values)[field];
    if (typeof raw !== "string") continue;
    const key = field === "email" ? normalizeHistoricalEmail(raw) : normalizeHistoricalPhone(raw);
    if (!key) continue;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const collisions = [...groups.values()].filter(count => count > 1);
  return { groups: collisions.length, occurrences: collisions.reduce((sum, count) => sum + count, 0) };
}

/** Reconcile persisted, authorized package projections in ONE read transaction.
 * Exact cells/notes/receipts are checked, not just totals. Current business
 * status/owner are separate from historical source and CREATE decisions: a
 * legitimate later edit or LINK must not be called an import discrepancy.
 * This is not a certification of reference/owner interpretation or STAGING. */
export function historicalReconciliation(input: {
  sha256: string; rows: ReconciliationRow[]; notes: ReconciliationNote[];
  receipts: ReconciliationReceipt[]; provenance: ReconciliationProvenance[];
  leads: ReconciliationLead[]; truncated: boolean;
}): {
  complete: boolean; truncated: boolean; totalOccurrences: number; unresolvedOccurrences: number;
  effects: { createdOccurrences: number; linkedOccurrences: number; ignoredOccurrences: number; distinctTargetDossiers: number; expectedNotes: number; persistedNotes: number; exactNotes: number; expectedRowReceipts: number; persistedRowReceipts: number; exactRowReceipts: number; expectedProvenance: number; persistedProvenance: number; exactProvenance: number };
  contacts: { email: { groups: number; occurrences: number }; phone: { groups: number; occurrences: number }; overlappingGroupsNotUniquePeople: true };
  currentDossierAxes: { visible: number; withheld: number };
  axes: Record<string, Record<string, number>>; discrepancies: Array<{ code: string; count: number }>;
} {
  const discrepancies: Record<string, number> = {};
  const fail = (code: string): void => increment(discrepancies, code);
  const axes: Record<string, Record<string, number>> = {
    sourceStatus: {}, mappedStatus: {}, resolvedStatus: {}, resolvedOwner: {}, cycle: {}, cyclePeriod: {},
    mappedTemperature: {}, resolvedTemperature: {}, currentDossierStatus: {}, currentDossierOwner: {},
  };
  const leadById = new Map(input.leads.map(lead => [lead.id, lead]));
  const receiptByKey = new Map<string, ReconciliationReceipt[]>();
  for (const receipt of input.receipts) receiptByKey.set(receipt.key, [...(receiptByKey.get(receipt.key) ?? []), receipt]);
  const provenanceByKey = new Map<string, ReconciliationProvenance[]>();
  for (const provenance of input.provenance) {
    const key = provenance.externalId ?? "";
    provenanceByKey.set(key, [...(provenanceByKey.get(key) ?? []), provenance]);
  }
  const expectedNotes = new Map<string, ExpectedNote>();
  const targets = new Set<string>();
  let created = 0, linked = 0, ignored = 0, expectedReceipts = 0, exactReceipts = 0, expectedProvenance = 0, exactProvenance = 0, unresolved = 0;
  for (const row of input.rows) {
    const mapped = object(row.mapped), source = object(row.payload), decision = object(row.decision);
    const values = valueRecord(mapped.values), resolved = valueRecord(decision.values), cells = object(source.cells);
    increment(axes.sourceStatus!, mapped.rawStatus); increment(axes.mappedStatus!, values.status);
    increment(axes.mappedTemperature!, values.temperature);
    increment(axes.cycle!, object(decision.cycle).state);
    const cycle = object(decision.cycle);
    increment(axes.cyclePeriod!, typeof cycle.state === "string" ? `${cycle.state}:${typeof cycle.label === "string" ? cycle.label : "UNSPECIFIED"}` : "UNSPECIFIED");
    if (Object.keys(decision).length) {
      increment(axes.resolvedStatus!, resolved.status); increment(axes.resolvedOwner!, resolved.ownerId || "UNASSIGNED");
      increment(axes.resolvedTemperature!, resolved.temperature);
    }
    if (row.fingerprint !== hash(row.payload) || row.sourceKey !== hash([input.sha256, row.relationId, row.rowNumber])) fail("SOURCE_INTEGRITY_MISMATCH");
    if (!["ACCEPTED", "IGNORED"].includes(row.state)) { unresolved++; continue; }
    const action = decision.action;
    if (typeof decision.reason !== "string" || decision.reason.trim().length < 8
      || row.decisionFingerprint !== hash({ ...decision, expectedVersion: undefined, values: undefined })) fail("DECISION_INTEGRITY_MISMATCH");
    if ((row.state === "IGNORED" && action !== "IGNORE") || (row.state === "ACCEPTED" && !["CREATE_DOSSIER", "LINK_EXISTING"].includes(String(action)))) fail("STATE_DECISION_MISMATCH");
    expectedReceipts++;
    const receipts = receiptByKey.get(row.id) ?? [];
    if (receipts.length === 1 && receipts[0]!.fingerprint === row.decisionFingerprint && receipts[0]!.actorId === decision.actorId
      && object(receipts[0]!.response).rowId === row.id && object(receipts[0]!.response).leadId === row.leadId) exactReceipts++;
    else fail("ROW_RECEIPT_MISMATCH");
    if (row.state === "IGNORED") { ignored++; if (row.leadId !== null) fail("IGNORED_ROW_TARGET_PRESENT"); continue; }
    if (action === "CREATE_DOSSIER") created++; else if (action === "LINK_EXISTING") linked++;
    const lead = row.leadId ? leadById.get(row.leadId) : undefined;
    if (!lead) { fail("TARGET_DOSSIER_MISSING"); continue; }
    if (action === "CREATE_DOSSIER" && lead.acquisitionKind !== "BASELINE") fail("BASELINE_KIND_MISMATCH");
    if (action === "CREATE_DOSSIER" && lead.baselineTemperature !== (resolved.temperature || null)) fail("BASELINE_TEMPERATURE_MISMATCH");
    if (action === "LINK_EXISTING" && decision.targetLeadId !== lead.id) fail("LINK_TARGET_MISMATCH");
    targets.add(lead.id);
    expectedProvenance++;
    const provenance = provenanceByKey.get(row.sourceKey) ?? [];
    if (provenance.length === 1 && provenance[0]!.leadId === lead.id && provenance[0]!.submissionFingerprint === row.fingerprint
      && provenance[0]!.sourceType === "LEGACY_CRM" && provenance[0]!.technicalSystem === "EXCEL_BOOTSTRAP_R8") exactProvenance++;
    else fail("PROVENANCE_MISMATCH");
    const addNote = (key: string, note: ExpectedNote): void => { if (expectedNotes.has(key)) fail("EXPECTED_NOTE_KEY_COLLISION"); expectedNotes.set(key, note); };
    for (const value of array(mapped.comments)) {
      const comment = object(value);
      if (typeof comment.column !== "string" || typeof comment.text !== "string" || !Object.hasOwn(cells, comment.column)) { fail("COMMENT_SOURCE_INVALID"); continue; }
      addNote(hash([input.sha256, row.relationId, row.rowNumber, comment.column]), {
        rowId: row.id, leadId: lead.id, sheet: row.sheet, row: row.rowNumber, column: comment.column, text: comment.text, value: cells[comment.column], author: null,
      });
    }
    for (const value of array(source.annotations)) {
      const native = object(value);
      const disposition = array(decision.annotations).map(object).find(item => item.annotationId === native.annotationId && item.reference === native.reference && item.relationshipId === native.relationshipId);
      if (!disposition) { fail("ANNOTATION_DISPOSITION_MISSING"); continue; }
      if (disposition.action === "EXCLUDE") continue;
      if (disposition.action !== "PRESERVE_NOTE" || typeof native.reference !== "string" || typeof native.text !== "string") { fail("ANNOTATION_DISPOSITION_INVALID"); continue; }
      addNote(hash([input.sha256, row.relationId, row.rowNumber, "native-annotation", native.relationshipId, native.annotationId, native.reference]), {
        rowId: row.id, leadId: lead.id, sheet: row.sheet, row: row.rowNumber, column: native.reference.replace(/\d+$/, ""), text: native.text, value,
        author: typeof native.author === "string" ? native.author : null,
      });
    }
  }
  let exactNotes = 0;
  const seenNoteKeys = new Set<string>();
  for (const note of input.notes) {
    const expected = expectedNotes.get(note.cellKey);
    if (!expected || seenNoteKeys.has(note.cellKey)) { fail("UNEXPECTED_OR_DUPLICATE_NOTE"); continue; }
    seenNoteKeys.add(note.cellKey);
    if (note.rowId === expected.rowId && note.leadId === expected.leadId && note.sourceSheet === expected.sheet && note.sourceRow === expected.row && note.sourceColumn === expected.column
      && note.text === expected.text && note.author === expected.author && note.occurredAt === null && note.fingerprint === hash(expected.value) && hash(note.sourceValue) === hash(expected.value)) exactNotes++;
    else fail("NOTE_EXACT_CONTENT_MISMATCH");
  }
  for (const key of expectedNotes.keys()) if (!seenNoteKeys.has(key)) fail("EXPECTED_NOTE_MISSING");
  if (input.receipts.length !== expectedReceipts) fail("ROW_RECEIPT_TOTAL_MISMATCH");
  if (input.provenance.length !== expectedProvenance) fail("PROVENANCE_TOTAL_MISMATCH");
  const currentDossierAxes = { visible: 0, withheld: 0 };
  for (const id of targets) {
    const lead = leadById.get(id)!;
    if (lead.visibleForCurrentAxes !== true) { currentDossierAxes.withheld++; continue; }
    currentDossierAxes.visible++;
    increment(axes.currentDossierStatus!, lead.status); increment(axes.currentDossierOwner!, lead.assignedToId || "UNASSIGNED");
  }
  if (input.truncated) fail("RECONCILIATION_READ_TRUNCATED");
  return {
    complete: !input.truncated && unresolved === 0 && Object.keys(discrepancies).length === 0, truncated: input.truncated,
    totalOccurrences: input.rows.length, unresolvedOccurrences: unresolved,
    effects: { createdOccurrences: created, linkedOccurrences: linked, ignoredOccurrences: ignored, distinctTargetDossiers: targets.size,
      expectedNotes: expectedNotes.size, persistedNotes: input.notes.length, exactNotes,
      expectedRowReceipts: expectedReceipts, persistedRowReceipts: input.receipts.length, exactRowReceipts: exactReceipts,
      expectedProvenance, persistedProvenance: input.provenance.length, exactProvenance },
    contacts: { email: contactGroups(input.rows, "email"), phone: contactGroups(input.rows, "phone"), overlappingGroupsNotUniquePeople: true },
    currentDossierAxes, axes, discrepancies: Object.entries(discrepancies).sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
  };
}
