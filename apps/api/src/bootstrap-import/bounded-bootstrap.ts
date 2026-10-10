import { hash, record, SHA, UUID, type HistoricalDecisionInput } from "./bootstrap-import.contract.js";
import { historicalReconciliation, type ReconciliationRow, type ReconciliationReceipt } from "./historical-reconciliation.js";
import { historicalContactSignals } from "./bootstrap-create-guards.js";

export const BOUNDED_BOOTSTRAP_POLICY = "EXPLICIT_DEFERRED_V1" as const;
type Row = ReconciliationRow & { planId: string; version: number; decisionKey: string | null; reasons: string[] };
const object = (value: unknown): Record<string, unknown> => record(value) ? value : {};
const same = (a: unknown, b: unknown): boolean => hash(a) === hash(b);

/** An explicit unresolved disposition, not IGNORE and not a decision about a
 * person's identity, owner, status or comments. Everything is source-bound. */
export function deferralBinding(sha256: string, row: Pick<Row, "planId" | "fingerprint" | "mapped" | "sourceKey" | "version" | "state" | "reasons">): Record<string, unknown> {
  return { policy: BOUNDED_BOOTSTRAP_POLICY, excelSha256: sha256, planId: row.planId, sourceKey: row.sourceKey,
    sourceFingerprint: row.fingerprint, mappedFingerprint: hash(row.mapped), reasons: [...row.reasons], previousState: row.state, previousVersion: row.version };
}
export function isDeferralInput(input: HistoricalDecisionInput): boolean {
  return input.action === "DEFER" && input.confirmed === true && typeof input.idempotencyKey === "string"
    && Object.keys(input).every(key => ["action", "confirmed", "expectedVersion", "idempotencyKey", "reason"].includes(key));
}
export function deferralReceiptResponse(rowId: string, decisionFingerprint: string, binding: unknown): Record<string, unknown> {
  return { rowId, state: "DEFERRED", leadId: null, decisionFingerprint, binding };
}
export function validDeferral(sha256: string, row: Row, receipts: ReconciliationReceipt[]): boolean {
  const decision = object(row.decision), binding = object(decision.deferral);
  const expectedBinding = deferralBinding(sha256, { ...row, state: "REVIEW", version: row.version - 1 });
  const matches = receipts.filter(receipt => receipt.key === row.decisionKey);
  return row.state === "DEFERRED" && row.leadId === null && SHA.test(sha256) && UUID.test(row.planId)
    && row.version > 1 && row.fingerprint === hash(row.payload) && row.sourceKey === hash([sha256, row.relationId, row.rowNumber])
    && decision.action === "DEFER" && decision.confirmed === true && decision.expectedVersion === binding.previousVersion
    && typeof decision.reason === "string" && decision.reason.trim().length >= 8 && decision.reason.length <= 1000
    && typeof decision.actorId === "string" && UUID.test(decision.actorId) && decision.idempotencyKey === row.decisionKey
    && Object.keys(decision).every(key => ["action", "confirmed", "expectedVersion", "idempotencyKey", "reason", "actorId", "deferral"].includes(key))
    && same(binding, expectedBinding) && row.decisionFingerprint === hash({ ...decision, expectedVersion: undefined })
    && matches.length === 1 && matches[0]!.actorId === decision.actorId && matches[0]!.fingerprint === row.decisionFingerprint
    && same(matches[0]!.response, deferralReceiptResponse(row.id, row.decisionFingerprint!, binding));
}

/** Separate from strict complete. Terminal effects are still checked by the
 * original reconciler; a deferred occurrence has no COMMIT_ROW/note/provenance.
 * Reopening, remapping or changing one source byte invalidates this inventory. */
export function boundedBootstrapReconciliation(input: Omit<Parameters<typeof historicalReconciliation>[0], "rows"> & {
  rows: Row[]; deferralReceipts: ReconciliationReceipt[]; coverageQualified: boolean;
}): {
  policy: typeof BOUNDED_BOOTSTRAP_POLICY; qualified: boolean; inventorySha256: string;
  totalOccurrences: number; deferredOccurrences: number; unresolvedOccurrences: number;
  deferredWithoutUsableContact: number; deferredBySheet: Record<string, number>;
  deferredComments: number; deferredNativeAnnotations: number; executedComplete: boolean;
  reservationsAreConservativeNotIdentityProof: true; discrepancies: Array<{ code: string; count: number }>;
} {
  const deferred = input.rows.filter(row => row.state === "DEFERRED");
  const terminal = input.rows.filter(row => ["ACCEPTED", "IGNORED"].includes(row.state));
  const executed = historicalReconciliation({ ...input, rows: terminal });
  const failures: Record<string, number> = {};
  const add = (code: string, count = 1): void => { failures[code] = (failures[code] ?? 0) + count; };
  const unresolved = input.rows.length - terminal.length - deferred.length;
  if (new Set(input.rows.map(row => row.id)).size !== input.rows.length || new Set(input.rows.map(row => row.sourceKey)).size !== input.rows.length) add("OCCURRENCE_IDENTITY_COLLISION");
  if (unresolved) add("UNDISPOSED_OCCURRENCES", unresolved);
  if (!input.coverageQualified) add("SOURCE_COVERAGE_NOT_DISPOSED");
  const bySheet: Record<string, number> = {};
  let unmatchable = 0, comments = 0, annotations = 0;
  for (const row of deferred) {
    if (!validDeferral(input.sha256, row, input.deferralReceipts)) add("DEFERRAL_INTEGRITY_MISMATCH");
    Object.defineProperty(bySheet, row.sheet, { value: (Object.hasOwn(bySheet, row.sheet) ? bySheet[row.sheet]! : 0) + 1, writable: true, configurable: true, enumerable: true });
    const mapped = object(row.mapped), payload = object(row.payload), signals = historicalContactSignals(mapped, payload);
    if (!signals.emails.length && !signals.phones.length) unmatchable++;
    comments += Array.isArray(mapped.comments) ? mapped.comments.filter(value => typeof object(value).text === "string" && String(object(value).text).trim()).length : 0;
    annotations += Array.isArray(payload.annotations) ? payload.annotations.length : 0;
  }
  for (const failure of executed.discrepancies) add(failure.code, failure.count);
  if (input.truncated) add("BOUNDED_READ_TRUNCATED");
  // These remain unresolved globally; this qualified inventory is never called complete.
  return { policy: BOUNDED_BOOTSTRAP_POLICY, qualified: !input.truncated && !unresolved && input.coverageQualified && executed.complete && !Object.keys(failures).length,
    inventorySha256: hash(input.rows.map(row => ({ id: row.id, sourceKey: row.sourceKey, fingerprint: row.fingerprint, mapped: hash(row.mapped), state: row.state,
      version: row.version, planId: row.planId, decisionKey: row.decisionKey, decisionFingerprint: row.decisionFingerprint, leadId: row.leadId })).sort((a, b) => a.id.localeCompare(b.id))),
    totalOccurrences: input.rows.length, deferredOccurrences: deferred.length, unresolvedOccurrences: unresolved, deferredWithoutUsableContact: unmatchable,
    deferredBySheet: bySheet, deferredComments: comments, deferredNativeAnnotations: annotations, executedComplete: executed.complete,
    reservationsAreConservativeNotIdentityProof: true, discrepancies: Object.entries(failures).sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })) };
}
