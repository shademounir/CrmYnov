import type { BootstrapImportService } from "../bootstrap-import/bootstrap-import.service.js";
import { cutoverHash, cutoverObject } from "../cutover/cutover.contract.js";
import { assertCutoverRuntimeAuthority, type CutoverDelegation } from "../cutover/cutover-runtime-authority.js";
import type { DynamicPermissionRepository, PermissionTransaction } from "../permissions/dynamic-repository.js";
import { APPEND_MODE, APPEND_POLICY, appendInvalid } from "./sheet-append-contract.js";
import type { AppendStream } from "./sheet-append-ledger.js";
import { BOUNDED_BOOTSTRAP_POLICY } from "../bootstrap-import/bounded-bootstrap.js";

export const DEFERRED_RESERVATION_POLICY = "CONTACT_OR_EXACT_NAME_REVIEW_NO_AUTO_LINK" as const;

export interface SheetAppendQualificationArtifact {
  schemaVersion: 1 | 2; mode: typeof APPEND_MODE; policy: typeof APPEND_POLICY; boundaryArtifactSha256: string;
  bootstrapPackageId: string; excelSha256: string; reportSha256: string; bindingSha256: string; evidenceSha256: string; qualifiedAt: string;
  producerCondition: { confirmedAt: string; evidenceSha256: string };
  boundedBootstrap?: { policy: typeof BOUNDED_BOOTSTRAP_POLICY; inventorySha256: string; deferredOccurrences: number; deferredWithoutUsableContact: number; reservationPolicy: typeof DEFERRED_RESERVATION_POLICY };
}
export interface SheetAppendQualification extends SheetAppendQualificationArtifact { artifactSha256: string; delegation: CutoverDelegation }
export function readAppendQualification(raw: unknown): SheetAppendQualificationArtifact {
  const value = cutoverObject(raw), producer = cutoverObject(value.producerCondition);
  const bounded = value.schemaVersion === 2 ? cutoverObject(value.boundedBootstrap) : {};
  if (![1, 2].includes(Number(value.schemaVersion)) || value.schemaVersion !== Number(value.schemaVersion) || value.mode !== APPEND_MODE || value.policy !== APPEND_POLICY
    || (value.schemaVersion === 1 ? value.boundedBootstrap !== undefined : bounded.policy !== BOUNDED_BOOTSTRAP_POLICY || bounded.reservationPolicy !== DEFERRED_RESERVATION_POLICY
      || typeof bounded.inventorySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(bounded.inventorySha256)
      || !Number.isSafeInteger(bounded.deferredOccurrences) || Number(bounded.deferredOccurrences) < 0 || Number(bounded.deferredOccurrences) > 10000
      || !Number.isSafeInteger(bounded.deferredWithoutUsableContact) || Number(bounded.deferredWithoutUsableContact) < 0 || Number(bounded.deferredWithoutUsableContact) > Number(bounded.deferredOccurrences))
    || [value.boundaryArtifactSha256, value.excelSha256, value.reportSha256, value.bindingSha256, value.evidenceSha256].some((sha) => typeof sha !== "string" || !/^[a-f0-9]{64}$/u.test(sha))
    || typeof value.bootstrapPackageId !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(value.bootstrapPackageId)
    || typeof value.qualifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.qualifiedAt)
    || !Number.isFinite(Date.parse(value.qualifiedAt)) || new Date(value.qualifiedAt).toISOString() !== value.qualifiedAt || Date.parse(value.qualifiedAt) > Date.now()
    || typeof producer.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(producer.evidenceSha256)
    || typeof producer.confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(producer.confirmedAt)
    || !Number.isFinite(Date.parse(producer.confirmedAt)) || new Date(producer.confirmedAt).toISOString() !== producer.confirmedAt
    || producer.confirmedAt > value.qualifiedAt) appendInvalid("qualification_invalid");
  return value as unknown as SheetAppendQualificationArtifact;
}
/** Current dossier status/owner are live business axes, not immutable import
 * evidence. All historical effects, exact notes/receipts and coverage remain
 * hashed; authority/visibility and reconciliation.complete are recalculated. */
export function appendBootstrapProofHash(raw: unknown, schemaVersion: 1 | 2 = 1): string {
  const report = cutoverObject(raw), reconciliation = cutoverObject(report.reconciliation), axes = cutoverObject(reconciliation.axes);
  const stableAxes = Object.fromEntries(Object.entries(axes).filter(([key]) => !["currentDossierStatus", "currentDossierOwner"].includes(key)));
  // Version 1 keeps its byte-for-byte semantic projection. The new separate
  // bounded result must not invalidate an otherwise unchanged strict artifact.
  const { boundedReconciliation: bounded, ...strictReport } = report;
  return cutoverHash({ ...strictReport, ...(schemaVersion === 2 ? { boundedReconciliation: bounded } : {}), reconciliation: { ...reconciliation, axes: stableAxes } });
}

export function appendBootstrapQualified(report: Record<string, unknown>, qualification: SheetAppendQualificationArtifact): boolean {
  if (appendBootstrapProofHash(report, qualification.schemaVersion) !== qualification.reportSha256) return false;
  if (qualification.schemaVersion === 1) return report.cutoverBlocked === false;
  const bounded = cutoverObject(report.boundedReconciliation), expected = qualification.boundedBootstrap;
  return !!expected && bounded.policy === BOUNDED_BOOTSTRAP_POLICY && bounded.qualified === true && bounded.executedComplete === true
    && bounded.unresolvedOccurrences === 0 && bounded.inventorySha256 === expected.inventorySha256
    && bounded.deferredOccurrences === expected.deferredOccurrences && bounded.deferredWithoutUsableContact === expected.deferredWithoutUsableContact
    && bounded.reservationsAreConservativeNotIdentityProof === true;
}
/** This is NOT producer attestation. It binds an independently qualified policy
 * and a currently reconciled bootstrap package. V1 stays globally strict. V2
 * explicitly binds a fully disposed inventory with durable unresolved DEFERRED
 * cases; it never asserts complete or changes the legacy cutover contract. */
export async function assertAppendQualification(tx: PermissionTransaction, stream: AppendStream, permissions: DynamicPermissionRepository,
  bootstrap: BootstrapImportService | undefined, assignment: boolean): Promise<void> {
  const qualification = stream.qualification, contract = stream.contract;
  if (!bootstrap || !contract || !qualification || stream.suspended || qualification.mode !== APPEND_MODE || qualification.policy !== APPEND_POLICY
    || qualification.boundaryArtifactSha256 !== contract.artifactSha256 || qualification.bindingSha256 !== contract.bindingSha256) appendInvalid("qualification_required");
  readAppendQualification(qualification);
  if (qualification.producerCondition.confirmedAt < contract.capturedAt) appendInvalid("producer_condition_before_boundary");
  await assertCutoverRuntimeAuthority(tx, permissions, qualification.delegation, stream.campusId, stream.id, assignment);
  const pack = await tx.bootstrapImportPackage.findUnique({ where: { id: qualification.bootstrapPackageId } });
  if (!pack?.sealedAt || pack.campusId !== stream.campusId || pack.sha256 !== qualification.excelSha256) appendInvalid("bootstrap_binding_changed");
  const report = cutoverObject(await bootstrap.reportCutoverRuntime(tx, pack.id, qualification.delegation, stream.id, assignment));
  if (!appendBootstrapQualified(report, qualification)) appendInvalid("bootstrap_reconciliation_required");
}
