import { cutoverHash, cutoverInstant, cutoverInvalid, cutoverText } from "./cutover.contract.js";
import type { CutoverContract, CutoverEntry } from "./cutover.contract.js";
import type { SheetValues } from "../sheet-import/google-sheets-adapter.js";

export type CutoverExceptionKind = "SOURCE_CHANGED" | "SOURCE_REMOVED" | "EFFECT_REVIEW";
export interface CutoverObservedSource { sourceKey: string; present: boolean; fingerprint: string | null; originalArrivedAt: string | null }
export interface CutoverExceptionReference { caseId: string; sourceKey: string; kind: CutoverExceptionKind; evidenceSha256: string }
export interface CutoverExceptionObservation {
  schemaVersion: 1; bindingSha256: string; headerSha256: string; sourceEvidenceSha256: string;
  observedAt: string; observedManifestVersion: number; sources: CutoverObservedSource[]; cases: CutoverExceptionReference[];
}
export interface CutoverExceptionEvidence {
  schemaVersion: 1; bindingSha256: string; headerSha256: string; sourceKey: string; kind: CutoverExceptionKind;
  originalFingerprint: string; originalArrivedAt: string;
  source: CutoverObservedSource;
  review: { effectId: string; batchId: string | null; fingerprint: string; reason: string | null } | null;
}
export function cutoverExceptionEvidenceHash(evidence: CutoverExceptionEvidence): string { return cutoverHash(evidence); }
export function cutoverTrueObservation(contract: CutoverContract, values: SheetValues, inventory: CutoverEntry[]): {
  sources: CutoverObservedSource[]; payloads: Map<string, Record<string, string>>;
} {
  const payloads = new Map<string, Record<string, string>>(), present = new Map<string, CutoverObservedSource>();
  for (const payload of values.rows) {
    if (Object.values(payload).every((value) => !value.trim())) continue;
    const sourceKey = cutoverHash([contract.streamKey ?? contract.connectorId, cutoverText(payload[contract.externalIdColumn])]);
    if (present.has(sourceKey)) cutoverInvalid("cutover_source_identity_ambiguous");
    present.set(sourceKey, { sourceKey, present: true, fingerprint: cutoverHash(payload), originalArrivedAt: cutoverInstant(payload[contract.originalArrivalColumn]) });
    payloads.set(sourceKey, { ...payload });
  }
  const sources = inventory.map((entry) => present.get(entry.key) ?? { sourceKey: entry.key, present: false, fingerprint: null, originalArrivedAt: null });
  if (present.size !== sources.filter((item) => item.present).length || new Set(sources.map((item) => item.sourceKey)).size !== sources.length) cutoverInvalid("cutover_exception_source_coverage_invalid");
  sources.sort((a, b) => a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0);
  return { sources, payloads };
}
/** Includes what was ACTUALLY read, not the intentionally preserved old payload
 * in inventory/snapshotSha256. Row order does not create a source identity. */
export function cutoverTrueObservationHash(bindingSha256: string, headerSha256: string, sources: CutoverObservedSource[]): string {
  return cutoverHash({ schemaVersion: 1, bindingSha256, headerSha256, sources });
}
