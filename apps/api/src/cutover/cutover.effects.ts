import { randomUUID } from "node:crypto";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import { cutoverHash } from "./cutover.contract.js";

export interface CutoverEffect {
  id: string; manifestId: string; sourceKey: string; outcome: "CREATED" | "LINKED_BASELINE" | "REVIEW";
  batchId: string | null; leadId: string | null; reason: string | null; downstreamSha256: string | null;
  compensationStatus: "REQUESTED" | "BLOCKED_DOWNSTREAM" | null; compensationReason: string | null; createdAt: Date; comparedAt: Date | null;
}
export async function cutoverEffects(tx: PermissionTransaction, id: string): Promise<CutoverEffect[]> {
  return tx.$queryRaw<CutoverEffect[]>`SELECT id,manifest_id AS "manifestId",source_key AS "sourceKey",outcome,batch_id AS "batchId",lead_id AS "leadId",reason,
    downstream_sha256 AS "downstreamSha256",compensation_status AS "compensationStatus",compensation_reason AS "compensationReason",created_at AS "createdAt",compared_at AS "comparedAt"
    FROM import_cutover_effects WHERE manifest_id=${id}::uuid ORDER BY source_key`;
}
export async function saveCutoverEffect(tx: PermissionTransaction, input: Pick<CutoverEffect, "manifestId" | "sourceKey" | "outcome" | "batchId" | "leadId" | "reason" | "downstreamSha256">): Promise<void> {
  await tx.$executeRaw`INSERT INTO import_cutover_effects (id,manifest_id,source_key,outcome,batch_id,lead_id,reason,downstream_sha256)
    VALUES (${randomUUID()}::uuid,${input.manifestId}::uuid,${input.sourceKey},${input.outcome},${input.batchId}::uuid,${input.leadId}::uuid,${input.reason},${input.downstreamSha256})`;
}
/** Hash every direct FK dependency plus Lead-scoped audit rows, not only counts.
 * Trusted catalogue identifiers are validated/quoted; values remain parameters.
 * Any downstream mutation makes this conservative comparison fail closed. */
export async function cutoverDownstreamHash(tx: PermissionTransaction, leadId: string): Promise<string> {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const dependencies = await tx.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT rel.relname AS "tableName",att.attname AS "columnName" FROM pg_constraint fk
    JOIN pg_class rel ON rel.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
    JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=fk.conkey[1]
    WHERE fk.contype='f' AND fk.confrelid='public.leads'::regclass AND ns.nspname='public' AND array_length(fk.conkey,1)=1
    ORDER BY rel.relname,att.attname`;
  const snapshot: Record<string, unknown> = { lead: JSON.parse(JSON.stringify(lead)), audits: await tx.auditEvent.findMany({ where: { resourceId: leadId }, orderBy: { id: "asc" } }) };
  for (const dependency of dependencies) {
    if (!/^[a-z_]+$/u.test(dependency.tableName) || !/^[a-z_]+$/u.test(dependency.columnName)) throw new Error("cutover_dependency_identifier_invalid");
    const result = await tx.$queryRawUnsafe<Array<{ rows: unknown }>>(`SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY to_jsonb(item)::text),'[]'::jsonb) AS rows FROM "${dependency.tableName}" item WHERE "${dependency.columnName}"=$1::uuid`, leadId);
    snapshot[`${dependency.tableName}.${dependency.columnName}`] = result[0]?.rows;
  }
  return cutoverHash(JSON.parse(JSON.stringify(snapshot)) as unknown);
}
