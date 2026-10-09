import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import { cutoverStreamKey, type CutoverContract, type CutoverEntry, type CutoverState } from "./cutover.contract.js";
import type { CutoverExceptionObservation } from "./cutover-exceptions.contract.js";
import { assertCutoverJournalBounds } from "./cutover-exceptions.bounds.js";

export interface StoredCutover {
  id: string; campusId: string; actorId: string; bootstrapPackageId: string; connectorId: string;
  state: CutoverState; version: number; contract: CutoverContract; inventory: CutoverEntry[];
  headerSha256: string | null; snapshotSha256: string | null; observedAt: Date | null;
  sourceCount: number; reportSha256: string | null; suspensionReason: string | null; createdAt: Date;
  exceptionObservation: CutoverExceptionObservation | null;
}
const projection = `id, campus_id AS "campusId", actor_id AS "actorId", bootstrap_package_id AS "bootstrapPackageId",
  connector_id AS "connectorId", state, version, contract, inventory, header_sha256 AS "headerSha256",
  snapshot_sha256 AS "snapshotSha256", observed_at AS "observedAt", source_count AS "sourceCount",
  report_sha256 AS "reportSha256", suspension_reason AS "suspensionReason", created_at AS "createdAt",exception_observation AS "exceptionObservation"`;

/** Serializes legacy job claims/activation with creation of a preparatory binding.
 * A bound connector must not bypass the cutover ledger through the old executor. */
export async function cutoverConnectorBound(tx: PermissionTransaction, connectorId: string, source?: { workbookId: string; sheetId: number }): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${connectorId},63))`;
  const stream = source ? cutoverStreamKey(source.workbookId, source.sheetId) : null;
  if (stream) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${stream},63))`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM import_cutover_manifests WHERE connector_id=${connectorId}::uuid OR stream_key=${stream}`;
  return rows.length !== 0;
}

/** Bound parameters only. This additive ledger does not rewrite a shared generated Prisma client. */
export async function loadCutover(tx: PermissionTransaction, id: string, lock = false): Promise<StoredCutover> {
  const rows = await tx.$queryRawUnsafe<StoredCutover[]>(`SELECT ${projection} FROM import_cutover_manifests WHERE id=$1::uuid${lock ? " FOR UPDATE" : ""}`, id);
  if (!rows[0]) throw new NotFoundException({ code: "cutover_not_found" }); return rows[0];
}
export async function cutoverReplay(tx: PermissionTransaction, id: string, operation: string, key: string, fingerprint: string): Promise<unknown> {
  const rows = await tx.$queryRaw<Array<{ fingerprint: string; response: unknown }>>`SELECT fingerprint, response FROM import_cutover_receipts WHERE manifest_id=${id}::uuid AND operation=${operation} AND key=${key}`;
  if (!rows[0]) return undefined;
  if (rows[0].fingerprint !== fingerprint) throw new ConflictException({ code: "cutover_idempotency_conflict" });
  return rows[0].response;
}
export async function insertCutover(tx: PermissionTransaction, id: string, campusId: string, actorId: string, contract: CutoverContract): Promise<StoredCutover> {
  await tx.$executeRaw`INSERT INTO import_cutover_manifests (id,campus_id,actor_id,bootstrap_package_id,connector_id,stream_key,contract)
    VALUES (${id}::uuid,${campusId}::uuid,${actorId}::uuid,${contract.bootstrapPackageId}::uuid,${contract.connectorId}::uuid,${contract.streamKey ?? null},${JSON.stringify(contract)}::jsonb)`;
  return loadCutover(tx, id, true);
}
export async function updateCutover(tx: PermissionTransaction, row: StoredCutover, next: Pick<StoredCutover, "state" | "inventory" | "headerSha256" | "snapshotSha256" | "observedAt" | "sourceCount" | "reportSha256" | "suspensionReason">): Promise<StoredCutover> {
  const changed = await tx.$executeRaw`UPDATE import_cutover_manifests SET state=${next.state},inventory=${JSON.stringify(next.inventory)}::jsonb,
    header_sha256=${next.headerSha256},snapshot_sha256=${next.snapshotSha256},observed_at=${next.observedAt},source_count=${next.sourceCount},
    report_sha256=${next.reportSha256},suspension_reason=${next.suspensionReason},version=version+1
    WHERE id=${row.id}::uuid AND version=${row.version}`;
  if (changed !== 1) throw new ConflictException({ code: "cutover_version_conflict" });
  await assertCutoverJournalBounds(tx, row.id); return loadCutover(tx, row.id, true);
}
export async function saveCutoverReceipt(tx: PermissionTransaction, row: StoredCutover, operation: string, key: string, fingerprint: string, actorId: string, response: unknown): Promise<void> {
  await tx.$executeRaw`INSERT INTO import_cutover_receipts (id,manifest_id,operation,key,fingerprint,actor_id,response)
    VALUES (${randomUUID()}::uuid,${row.id}::uuid,${operation},${key},${fingerprint},${actorId}::uuid,${JSON.stringify(response)}::jsonb)`;
}
