import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import type { CutoverDelegation } from "./cutover-runtime-authority.js";
import type { StoredCutover } from "./cutover.store.js";
import { cutoverHash } from "./cutover.contract.js";

export interface CutoverQualification {
  kind: "SIMULATED_FIXTURE"; artifact: string; artifactSha256: string; bindingSha256: string;
  qualifiedManifestVersion: number; qualifiedBy: string; qualifiedAt: string;
}
export interface StoredCutoverRuntime {
  manifestId: string; version: number; state: "PREPARED" | "ARMED" | "PAUSED";
  qualification: CutoverQualification; delegation: CutoverDelegation | null; epoch: number;
  leaseOwner: string | null; leaseUntil: Date | null; leaseManifestVersion: number | null; activeRunId: string | null;
}
export function runtimeBindingHash(row: StoredCutover): string {
  return cutoverHash({ contract: row.contract, headerSha256: row.headerSha256 });
}
export async function loadCutoverRuntime(tx: PermissionTransaction, id: string, lock = false): Promise<StoredCutoverRuntime | undefined> {
  const rows = await tx.$queryRawUnsafe<StoredCutoverRuntime[]>(`SELECT manifest_id AS "manifestId",version,state,qualification,delegation,epoch,
    lease_owner AS "leaseOwner",lease_until AS "leaseUntil",lease_manifest_version AS "leaseManifestVersion",active_run_id AS "activeRunId"
    FROM import_cutover_runtimes WHERE manifest_id=$1::uuid${lock ? " FOR UPDATE" : ""}`, id); return rows[0];
}
export async function runtimeReplay(tx: PermissionTransaction, id: string, operation: string, key: string, fingerprint: string): Promise<unknown> {
  const rows = await tx.$queryRaw<Array<{ fingerprint: string; response: unknown }>>`SELECT fingerprint,response FROM import_cutover_runtime_receipts
    WHERE manifest_id=${id}::uuid AND operation=${operation} AND key=${key}`;
  if (!rows[0]) return undefined;
  if (rows[0].fingerprint !== fingerprint) throw new ConflictException({ code: "cutover_idempotency_conflict" }); return rows[0].response;
}
export async function runtimeReceipt(tx: PermissionTransaction, id: string, operation: string, key: string, fingerprint: string, actorId: string, response: unknown): Promise<void> {
  await tx.$executeRaw`INSERT INTO import_cutover_runtime_receipts(id,manifest_id,operation,key,fingerprint,actor_id,response)
    VALUES(${randomUUID()}::uuid,${id}::uuid,${operation},${key},${fingerprint},${actorId},${JSON.stringify(response)}::jsonb)`;
}
