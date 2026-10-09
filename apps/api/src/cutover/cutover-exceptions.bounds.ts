import { ConflictException } from "@nestjs/common";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import { CUTOVER_BYTE_LIMIT, CUTOVER_ROW_LIMIT } from "./cutover.contract.js";

/** One cumulative durable bound, not independent 4 MiB allowances. Receipts and
 * audits retain their existing contract; no evidence/history is truncated. */
export async function assertCutoverJournalBounds(tx: PermissionTransaction, id: string): Promise<void> {
  const [result] = await tx.$queryRaw<Array<{ count: number; bytes: bigint }>>`SELECT jsonb_array_length(m.inventory)+
    (SELECT count(*)::int FROM import_cutover_exception_cases c WHERE c.manifest_id=m.id)+
    (SELECT count(*)::int FROM import_cutover_exception_dispositions d JOIN import_cutover_exception_cases c ON c.id=d.case_id WHERE c.manifest_id=m.id) AS count,
    octet_length(to_jsonb(m)::text)::bigint+
    (SELECT COALESCE(sum(octet_length(to_jsonb(c)::text)),0)::bigint FROM import_cutover_exception_cases c WHERE c.manifest_id=m.id)+
    (SELECT COALESCE(sum(octet_length(to_jsonb(d)::text)),0)::bigint FROM import_cutover_exception_dispositions d JOIN import_cutover_exception_cases c ON c.id=d.case_id WHERE c.manifest_id=m.id) AS bytes
    FROM import_cutover_manifests m WHERE m.id=${id}::uuid`;
  if (!result || result.count > CUTOVER_ROW_LIMIT || result.bytes > BigInt(CUTOVER_BYTE_LIMIT)) throw new ConflictException({ code: "cutover_exception_journal_bound_exceeded" });
}
