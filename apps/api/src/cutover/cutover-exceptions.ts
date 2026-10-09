import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import type { SheetValues } from "../sheet-import/google-sheets-adapter.js";
import { CUTOVER_ROW_LIMIT, cutoverHash } from "./cutover.contract.js";
import { assertCutoverJournalBounds } from "./cutover-exceptions.bounds.js";
export { assertCutoverJournalBounds } from "./cutover-exceptions.bounds.js";
import { cutoverEffects, type CutoverEffect } from "./cutover.effects.js";
import { loadCutover, type StoredCutover } from "./cutover.store.js";
import { cutoverExceptionEvidenceHash, cutoverTrueObservation, cutoverTrueObservationHash,
  type CutoverExceptionEvidence, type CutoverExceptionKind, type CutoverExceptionObservation, type CutoverObservedSource } from "./cutover-exceptions.contract.js";

export const CUTOVER_QUARANTINE_PAUSE = "cutover_quarantine_requires_reobservation";
function conflict(code: string): never { throw new ConflictException({ code }); }
export interface CutoverExceptionDisposition {
  id: string; caseId: string; action: "QUARANTINE_PRESERVE"; evidenceSha256: string; reason: string; actorId: string;
  decidedManifestVersion: number; decidedAt: Date;
}
export interface CutoverExceptionCase {
  id: string; sourceKey: string; kind: CutoverExceptionKind; generation: number; evidenceSha256: string;
  evidence: CutoverExceptionEvidence; observedPayload: Record<string, string> | null; createdAt: Date;
}
export interface CutoverExceptionState {
  coverageValid: boolean; observation: CutoverExceptionObservation | null;
  expectedCases: number; cases: Array<{ item: CutoverExceptionCase; disposition: CutoverExceptionDisposition | null; requiresReobservation: boolean }>;
  unresolvedCases: number; quarantinedCases: number; requiresReobservation: boolean;
  quarantinedKeys: Set<string>; allDispositionsReconciled: boolean;
}
export function cutoverExceptionBindingHash(row: StoredCutover): string { return cutoverHash({ contract: row.contract, headerSha256: row.headerSha256 }); }
const pair = (key: string, kind: string): string => `${key}:${kind}`;
async function cases(tx: PermissionTransaction, id: string): Promise<CutoverExceptionCase[]> {
  return tx.$queryRaw<CutoverExceptionCase[]>`SELECT id,source_key AS "sourceKey",kind,generation,evidence_sha256 AS "evidenceSha256",evidence,
    observed_payload AS "observedPayload",created_at AS "createdAt" FROM import_cutover_exception_cases WHERE manifest_id=${id}::uuid ORDER BY source_key,kind,generation`;
}
export async function loadCutoverExceptionCase(tx: PermissionTransaction, id: string, caseId: string): Promise<CutoverExceptionCase | undefined> {
  return (await cases(tx, id)).find((item) => item.id === caseId);
}
async function dispositions(tx: PermissionTransaction, id: string): Promise<CutoverExceptionDisposition[]> {
  return tx.$queryRaw<CutoverExceptionDisposition[]>`SELECT d.id,d.case_id AS "caseId",d.action,d.evidence_sha256 AS "evidenceSha256",d.reason,d.actor_id AS "actorId",
    d.decided_manifest_version AS "decidedManifestVersion",d.decided_at AS "decidedAt" FROM import_cutover_exception_dispositions d
    JOIN import_cutover_exception_cases c ON c.id=d.case_id WHERE c.manifest_id=${id}::uuid`;
}
async function expectedEvidence(tx: PermissionTransaction, row: StoredCutover, sources: CutoverObservedSource[], effects: CutoverEffect[]): Promise<CutoverExceptionEvidence[]> {
  const sourceByKey = new Map(sources.map((source) => [source.sourceKey, source])), bindingSha256 = cutoverExceptionBindingHash(row);
  const reviewEffects = effects.filter((effect) => effect.outcome === "REVIEW"), batchIds = reviewEffects.flatMap((effect) => effect.batchId ? [effect.batchId] : []);
  const batches = await tx.ingestionBatch.findMany({ where: { id: { in: batchIds } } });
  const reviewItems = await tx.ingestionReviewItem.findMany({ where: { batchId: { in: batchIds } }, orderBy: { id: "asc" }, take: CUTOVER_ROW_LIMIT + 1 });
  const reports = await tx.importReport.findMany({ where: { batchId: { in: batchIds } } });
  if (reviewItems.length > CUTOVER_ROW_LIMIT || batches.length !== new Set(batchIds).size) conflict("cutover_exception_evidence_invalid");
  const result: CutoverExceptionEvidence[] = [];
  for (const entry of row.inventory) {
    const source = sourceByKey.get(entry.key); if (!source) conflict("cutover_exception_observation_required");
    const base = { schemaVersion: 1 as const, bindingSha256, headerSha256: row.headerSha256 ?? "", sourceKey: entry.key,
      originalFingerprint: entry.fingerprint, originalArrivedAt: entry.originalArrivedAt, source };
    if (entry.issue) result.push({ ...base, kind: entry.issue, review: null });
    const effect = reviewEffects.find((item) => item.sourceKey === entry.key);
    if (effect) {
      const batch = batches.find((item) => item.id === effect.batchId), report = reports.find((item) => item.batchId === effect.batchId);
      if (!batch || !report) conflict("cutover_exception_evidence_invalid");
      const fingerprint = cutoverHash(JSON.parse(JSON.stringify({ effect, batch, report, reviewItems: reviewItems.filter((item) => item.batchId === effect.batchId) })) as unknown);
      result.push({ ...base, kind: "EFFECT_REVIEW", review: { effectId: effect.id, batchId: effect.batchId, fingerprint, reason: effect.reason } });
    }
  }
  if (reviewEffects.some((effect) => !row.inventory.some((entry) => entry.key === effect.sourceKey))) conflict("cutover_exception_evidence_invalid");
  return result.sort((a, b) => { const left = pair(a.sourceKey, a.kind), right = pair(b.sourceKey, b.kind); return left < right ? -1 : left > right ? 1 : 0; });
}
function validObservation(row: StoredCutover): boolean {
  const observation = row.exceptionObservation;
  if (!observation || observation.schemaVersion !== 1 || !Array.isArray(observation.sources) || !Array.isArray(observation.cases)
    || !row.observedAt || observation.observedAt !== row.observedAt.toISOString() || observation.observedManifestVersion > row.version
    || observation.bindingSha256 !== cutoverExceptionBindingHash(row) || observation.headerSha256 !== row.headerSha256) return false;
  const sources = observation.sources;
  if (sources.length !== row.inventory.length || new Set(sources.map((source) => source.sourceKey)).size !== sources.length
    || sources.some((source) => !row.inventory.some((entry) => entry.key === source.sourceKey) || typeof source.present !== "boolean"
      || source.present && (!source.fingerprint || !source.originalArrivedAt) || !source.present && (source.fingerprint !== null || source.originalArrivedAt !== null))) return false;
  return observation.sourceEvidenceSha256 === cutoverTrueObservationHash(observation.bindingSha256, observation.headerSha256, sources);
}
function validCase(item: CutoverExceptionCase, evidence: CutoverExceptionEvidence): boolean {
  return item.sourceKey === evidence.sourceKey && item.kind === evidence.kind && item.evidenceSha256 === cutoverExceptionEvidenceHash(evidence)
    && cutoverExceptionEvidenceHash(item.evidence) === item.evidenceSha256
    && (evidence.source.present ? !!item.observedPayload && cutoverHash(item.observedPayload) === evidence.source.fingerprint : item.observedPayload === null);
}
/** Exact current coverage, never certification through a filtered/empty subset. */
export async function cutoverExceptionState(tx: PermissionTransaction, row: StoredCutover): Promise<CutoverExceptionState> {
  const observation = row.exceptionObservation, effects = await cutoverEffects(tx, row.id);
  const rawExpectedCount = row.inventory.filter((entry) => entry.issue).length + effects.filter((effect) => effect.outcome === "REVIEW").length;
  const empty: CutoverExceptionState = { observation, coverageValid: false, expectedCases: rawExpectedCount, cases: [], unresolvedCases: rawExpectedCount,
    quarantinedCases: 0, requiresReobservation: true, quarantinedKeys: new Set(), allDispositionsReconciled: false };
  if (!validObservation(row) || !observation) return empty;
  const expected = await expectedEvidence(tx, row, observation.sources, effects), storedCases = await cases(tx, row.id), storedDispositions = await dispositions(tx, row.id);
  if (expected.length !== rawExpectedCount || observation.cases.length !== expected.length
    || new Set(observation.cases.map((item) => pair(item.sourceKey, item.kind))).size !== expected.length) return empty;
  const result: CutoverExceptionState = { ...empty, coverageValid: true, unresolvedCases: 0, requiresReobservation: false };
  for (const evidence of expected) {
    const reference = observation.cases.find((item) => item.sourceKey === evidence.sourceKey && item.kind === evidence.kind);
    const item = reference ? storedCases.find((candidate) => candidate.id === reference.caseId) : undefined;
    if (!reference || !item || reference.evidenceSha256 !== cutoverExceptionEvidenceHash(evidence) || !validCase(item, evidence)) return empty;
    const disposition = storedDispositions.find((candidate) => candidate.caseId === item.id) ?? null;
    if (disposition && (disposition.action !== "QUARANTINE_PRESERVE" || disposition.evidenceSha256 !== item.evidenceSha256)) return empty;
    const requiresReobservation = !!disposition && observation.observedManifestVersion <= disposition.decidedManifestVersion;
    result.cases.push({ item, disposition, requiresReobservation });
    if (disposition) result.quarantinedCases++; else result.unresolvedCases++;
    result.requiresReobservation ||= requiresReobservation;
  }
  for (const key of new Set(result.cases.map(({ item }) => item.sourceKey))) {
    if (result.cases.filter(({ item }) => item.sourceKey === key).every(({ disposition }) => disposition !== null)) result.quarantinedKeys.add(key);
  }
  result.allDispositionsReconciled = result.coverageValid && result.unresolvedCases === 0 && !result.requiresReobservation;
  return result;
}
export async function assertCutoverExceptions(tx: PermissionTransaction, row: StoredCutover): Promise<CutoverExceptionState> {
  const state = await cutoverExceptionState(tx, row);
  if (!state.coverageValid || state.requiresReobservation) conflict("cutover_exception_observation_required");
  if (state.unresolvedCases) conflict("cutover_exception_disposition_required");
  return state;
}
/** Caller owns permission fence and manifest lock. No historical case is reused
 * after a different current case: A→B→A cannot revive A's old authorization. */
async function journal(tx: PermissionTransaction, row: StoredCutover, observation: CutoverExceptionObservation, payloads: Map<string, Record<string, string>>): Promise<StoredCutover> {
  const effects = await cutoverEffects(tx, row.id), expected = await expectedEvidence(tx, row, observation.sources, effects), existing = await cases(tx, row.id);
  const previous = row.exceptionObservation?.cases ?? [];
  observation.cases = [];
  for (const evidence of expected) {
    const evidenceSha256 = cutoverExceptionEvidenceHash(evidence), oldReference = previous.find((item) => item.sourceKey === evidence.sourceKey && item.kind === evidence.kind);
    let item = oldReference ? existing.find((candidate) => candidate.id === oldReference.caseId) : undefined;
    if (!item || !validCase(item, evidence)) {
      let observedPayload: Record<string, string> | null = null;
      if (evidence.source.present) {
        observedPayload = payloads.get(evidence.sourceKey) ?? existing.find((candidate) => candidate.sourceKey === evidence.sourceKey && candidate.evidence.source.fingerprint === evidence.source.fingerprint)?.observedPayload ?? null;
        if (!observedPayload) { const entry = row.inventory.find((entry) => entry.key === evidence.sourceKey); if (entry && entry.fingerprint === evidence.source.fingerprint) observedPayload = entry.payload; }
        if (!observedPayload || cutoverHash(observedPayload) !== evidence.source.fingerprint) conflict("cutover_exception_observation_required");
      }
      const generation = 1 + existing.filter((candidate) => candidate.sourceKey === evidence.sourceKey && candidate.kind === evidence.kind).reduce((max, candidate) => Math.max(max, candidate.generation), 0);
      item = { id: randomUUID(), sourceKey: evidence.sourceKey, kind: evidence.kind, generation, evidenceSha256, evidence, observedPayload, createdAt: new Date() };
      await tx.$executeRaw`INSERT INTO import_cutover_exception_cases(id,manifest_id,source_key,kind,generation,evidence_sha256,evidence,observed_payload)
        VALUES(${item.id}::uuid,${row.id}::uuid,${item.sourceKey},${item.kind},${generation},${evidenceSha256},${JSON.stringify(evidence)}::jsonb,${observedPayload === null ? null : JSON.stringify(observedPayload)}::jsonb)`;
      existing.push(item);
    }
    observation.cases.push({ caseId: item.id, sourceKey: item.sourceKey, kind: item.kind, evidenceSha256: item.evidenceSha256 });
  }
  await tx.$executeRaw`UPDATE import_cutover_manifests SET exception_observation=${JSON.stringify(observation)}::jsonb WHERE id=${row.id}::uuid AND version=${row.version}`;
  await assertCutoverJournalBounds(tx, row.id);
  return loadCutover(tx, row.id, true);
}
export async function observeCutoverExceptions(tx: PermissionTransaction, row: StoredCutover, values: SheetValues): Promise<StoredCutover> {
  if (!row.headerSha256 || !row.observedAt) conflict("cutover_exception_observation_required");
  const { sources, payloads } = cutoverTrueObservation(row.contract, values, row.inventory), bindingSha256 = cutoverExceptionBindingHash(row);
  return journal(tx, row, { schemaVersion: 1, bindingSha256, headerSha256: row.headerSha256,
    sourceEvidenceSha256: cutoverTrueObservationHash(bindingSha256, row.headerSha256, sources), observedAt: row.observedAt.toISOString(), observedManifestVersion: row.version, sources, cases: [] }, payloads);
}
/** New REVIEW effects are journaled against the last true source observation.
 * This refresh is not a new source read and cannot satisfy post-decision freshness. */
export async function refreshCutoverExceptions(tx: PermissionTransaction, row: StoredCutover): Promise<StoredCutover> {
  if (!validObservation(row) || !row.exceptionObservation) conflict("cutover_exception_observation_required");
  return journal(tx, row, structuredClone(row.exceptionObservation), new Map());
}
export async function quarantineCutoverCase(tx: PermissionTransaction, row: StoredCutover, item: CutoverExceptionCase, actorId: string, reason: string): Promise<CutoverExceptionDisposition> {
  const disposition: CutoverExceptionDisposition = { id: randomUUID(), caseId: item.id, action: "QUARANTINE_PRESERVE", evidenceSha256: item.evidenceSha256,
    reason, actorId, decidedManifestVersion: row.version + 1, decidedAt: new Date() };
  await tx.$executeRaw`INSERT INTO import_cutover_exception_dispositions(id,case_id,action,evidence_sha256,reason,actor_id,decided_manifest_version,decided_at)
    VALUES(${disposition.id}::uuid,${item.id}::uuid,'QUARANTINE_PRESERVE',${item.evidenceSha256},${reason},${actorId}::uuid,${disposition.decidedManifestVersion},${disposition.decidedAt})`;
  await assertCutoverJournalBounds(tx, row.id);
  // Atomic with the decision/manifest suspension. An in-flight old epoch can
  // finish its source read, but cannot commit effects or clear a new owner's lease.
  await tx.$executeRaw`UPDATE import_cutover_runtime_runs SET status='ABANDONED',finished_at=CURRENT_TIMESTAMP,error_code='cutover_quarantined'
    WHERE id IN (SELECT active_run_id FROM import_cutover_runtimes WHERE manifest_id=${row.id}::uuid) AND status='RUNNING'`;
  await tx.$executeRaw`UPDATE import_cutover_runtimes SET state='PAUSED',version=version+1,epoch=epoch+1,lease_owner=NULL,lease_until=NULL,active_run_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE manifest_id=${row.id}::uuid`;
  return disposition;
}
