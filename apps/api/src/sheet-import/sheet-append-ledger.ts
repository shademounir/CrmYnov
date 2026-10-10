import { randomUUID } from "node:crypto";
import type { Prisma, SheetImportConnector } from "@prisma/client";
import { APPEND_MODE, APPEND_POLICY, appendBinding, appendCompletion, appendHash, appendInvalid, appendOccurrenceKey, appendPositions,
  type SheetAppendBoundary, type SheetAppendContract } from "./sheet-append-contract.js";
import { sheetStreamId } from "./sheet-local-ledger.js";
import type { SheetConfiguration } from "./sheet-import-configuration.js";
import type { SheetAppendQualification } from "./sheet-append-qualification.js";

export interface AppendStream { id: string; campusId: string; suspended: boolean; errorCode: string | null; contract: SheetAppendContract | null; qualification: SheetAppendQualification | null; lastObservedRow: number; lastDurableRow: number | null }
export interface AppendRow { id: string; rowNumber: number; fingerprint: string; status: string; payload: string[]; occurrenceKey: string; firstObservedAt: Date }
export const appendRowMayComplete = (row: Pick<AppendRow, "status" | "payload">, cells: string[]): boolean => ["PENDING", "INCOMPLETE"].includes(row.status) && appendCompletion(row.payload, cells);
export function appendObservationConflict(stream: AppendStream & { contract: SheetAppendContract }, observation: ReturnType<typeof appendPositions>, rows: AppendRow[]): string | null {
  if (appendHash(observation.header) !== stream.contract.headerFingerprint || observation.lastOccupiedRow < stream.lastObservedRow) return "append_source_structure_changed";
  const present = new Map(observation.positions.map((position) => [position.row, position]));
  if (stream.contract.historicalFingerprints.some((position) => present.get(position.row)?.fingerprint !== position.fingerprint)) return "append_historical_row_changed";
  if (rows.some((row) => { const current = present.get(row.rowNumber); return !current || current.fingerprint !== row.fingerprint && !appendRowMayComplete(row, current.cells); })) return "append_observed_row_changed";
  return null;
}
export const appendWorkerEnabled = (environment: Readonly<Record<string, string | undefined>>): boolean => environment.SHEETS_ENABLED === "true" && environment.SHEET_ROW_APPEND_ENABLED === "true";
export async function appendStream(tx: Prisma.TransactionClient, id: string, lock = false): Promise<AppendStream | undefined> {
  const rows = await tx.$queryRawUnsafe<AppendStream[]>(`SELECT id,campus_id AS "campusId",suspended,error_code AS "errorCode",append_contract AS contract,append_qualification AS qualification,
    last_observed_row AS "lastObservedRow",append_last_durable_row AS "lastDurableRow" FROM sheet_local_streams WHERE id=$1${lock ? " FOR UPDATE" : ""}`, id);
  return rows[0];
}
export async function registerAppendBoundary(tx: Prisma.TransactionClient, connector: SheetImportConnector, configuration: SheetConfiguration,
  boundary: SheetAppendBoundary, artifactSha256: string): Promise<SheetAppendContract> {
  const source = configuration.source;
  if (source?.identityMode !== APPEND_MODE || source.sheetId !== boundary.sheetId || source.range !== boundary.range
    || connector.workbookId !== boundary.workbookId || connector.tab !== boundary.tab || connector.enabled || connector.activeRunId || connector.manualRequested) appendInvalid("binding_invalid");
  const id = sheetStreamId(boundary.workbookId, boundary.sheetId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},171))`;
  const previous = await appendStream(tx, id, true);
  const observation = appendPositions(boundary.range, boundary.values), bindingSha256 = appendBinding(connector.workbookId, connector.tab, connector.campusId, configuration);
  if (appendHash(configuration.mapping.columns.map((column) => column.sourceColumn)) !== appendHash(observation.header)) appendInvalid("mapping_headers_mismatch");
  if (previous) {
    if (previous.campusId !== connector.campusId || previous.contract?.artifactSha256 !== artifactSha256 || previous.contract.generation !== boundary.generation
      || previous.contract.bindingSha256 !== bindingSha256) appendInvalid("rebaseline_refused");
    return previous.contract;
  }
  const contract: SheetAppendContract = { ...boundary, artifactSha256, headerFingerprint: appendHash(observation.header),
    historicalFingerprints: observation.positions.map(({ row, fingerprint }) => ({ row, fingerprint })), bindingSha256, policy: APPEND_POLICY, producerAttested: false };
  // Raw baseline cells remain in the private artifact, not historical ledger rows.
  delete (contract as Partial<SheetAppendBoundary>).values;
  await tx.$executeRaw`INSERT INTO sheet_local_streams(id,workbook_id,sheet_id,campus_id,range,header_fingerprint,last_observed_row,append_last_durable_row,append_contract)
    VALUES(${id},${boundary.workbookId},${boundary.sheetId},${connector.campusId}::uuid,${boundary.range},${contract.headerFingerprint},${boundary.boundaryRow},${boundary.boundaryRow},${JSON.stringify(contract)}::jsonb)`;
  return contract;
}
export async function assertAppendBinding(tx: Prisma.TransactionClient, connector: { workbookId: string; tab: string; campusId: string }, configuration: SheetConfiguration, lock = false): Promise<AppendStream & { contract: SheetAppendContract }> {
  if (configuration.source?.identityMode !== APPEND_MODE || configuration.source.sheetId === undefined) appendInvalid("mode_required");
  const stream = await appendStream(tx, sheetStreamId(connector.workbookId, configuration.source.sheetId), lock);
  if (!stream?.contract || stream.campusId !== connector.campusId || stream.contract.bindingSha256 !== appendBinding(connector.workbookId, connector.tab, connector.campusId, configuration)) appendInvalid("boundary_required");
  if (stream.suspended) appendInvalid("suspended");
  return stream as AppendStream & { contract: SheetAppendContract };
}
export async function suspendAppend(tx: Prisma.TransactionClient, stream: AppendStream, connectorId: string, runId: string, reason: string): Promise<false> {
  const changed = await tx.$executeRaw`UPDATE sheet_local_streams SET suspended=true,error_code=${reason} WHERE id=${stream.id} AND suspended=false`;
  if (changed) await tx.auditEvent.create({ data: { actorId: `SYSTEM:SHEETS:${connectorId}`, actorRoles: ["SYSTEM"], campusId: stream.campusId,
    resourceType: "SHEET_IMPORT", resourceId: connectorId, eventType: "SHEET_APPEND_SUSPENDED", result: "FAILED", correlationId: runId,
    idempotencyKey: `sheet-append-suspend:${stream.id}`, after: { reason, alertRequired: true, policy: APPEND_POLICY } } });
  // This is a structured operational signal, not a claim that a notification
  // transport is configured or that an operator actually received the alert.
  if (changed) process.stderr.write(`${JSON.stringify({ severity: "ERROR", event: "SHEET_APPEND_SUSPENDED", connectorId, streamId: stream.id, runId, reason, alertReceiptProven: false })}\n`);
  return false;
}
/** Caller owns permission and connector lease fences. Persist the ENTIRE bounded
 * observation before any business effect. No cursor is an ingestion decision. */
export async function persistAppendObservation(tx: Prisma.TransactionClient, connector: { id: string; workbookId: string; tab: string; campusId: string },
  configuration: SheetConfiguration, runId: string, values: string[][], observedAt = new Date()): Promise<boolean> {
  const stream = await assertAppendBinding(tx, connector, configuration, true);
  let observation: ReturnType<typeof appendPositions>;
  try { observation = appendPositions(stream.contract.range, values); }
  catch { return suspendAppend(tx, stream, connector.id, runId, "append_observation_invalid"); }
  const rows = await appendRows(tx, stream.id), earlier = new Map(rows.map((row) => [row.rowNumber, row]));
  const conflict = appendObservationConflict(stream, observation, rows);
  // Bound cumulative private journal growth as well as each Google response.
  // Never purge old versions to make room. A bound hit is an explicit halt.
  const budget = await tx.$queryRaw<Array<{ versions: number; bytes: bigint }>>`SELECT count(*)::int AS versions,COALESCE(sum(octet_length(payload::text)),0)::bigint AS bytes FROM sheet_append_observations WHERE stream_id=${stream.id}`;
  const possible = observation.positions.filter((position) => position.row > stream.contract.boundaryRow);
  const candidates = JSON.stringify(possible.map((position) => ({ key: appendOccurrenceKey(stream.contract, position.row), fingerprint: position.fingerprint, payload: position.cells })));
  const additions = await tx.$queryRaw<Array<{ versions: number; bytes: bigint }>>`SELECT count(*)::int AS versions,COALESCE(sum(octet_length(candidate.payload::text)),0)::bigint AS bytes
    FROM jsonb_to_recordset(${candidates}::jsonb) AS candidate(key text,fingerprint text,payload jsonb)
    WHERE NOT EXISTS(SELECT 1 FROM sheet_append_observations old WHERE old.stream_id=${stream.id} AND old.occurrence_key=candidate.key AND old.fingerprint=candidate.fingerprint)`;
  if ((budget[0]?.versions ?? 0) + (additions[0]?.versions ?? 0) > 50000 || Number(budget[0]?.bytes ?? 0) + Number(additions[0]?.bytes ?? 0) > 64 * 1024 * 1024) return suspendAppend(tx, stream, connector.id, runId, "append_journal_capacity_reached");
  const records = possible.map((position) => ({ id: randomUUID(), versionId: randomUUID(), row: position.row, fingerprint: position.fingerprint,
    key: appendOccurrenceKey(stream.contract, position.row), payload: position.cells, status: conflict ? "REVIEW" : position.empty ? "INCOMPLETE" : "PENDING" }));
  // Bounded bulk statements avoid one round trip per cell/row in the lease TX.
  const newRows = JSON.stringify(records.filter((position) => !earlier.has(position.row)));
  await tx.$executeRaw`INSERT INTO sheet_local_rows(id,stream_id,row_number,fingerprint,status,append_payload,append_occurrence_key,first_observed_at,last_observed_at)
    SELECT candidate.id::uuid,${stream.id},candidate.row,candidate.fingerprint,candidate.status,candidate.payload,candidate.key,${observedAt},${observedAt}
    FROM jsonb_to_recordset(${newRows}::jsonb) AS candidate(id text,row int,fingerprint text,status text,payload jsonb,key text)`;
  const updates = JSON.stringify(conflict ? [] : records.filter((position) => { const old = earlier.get(position.row); return old && old.fingerprint !== position.fingerprint; }));
  await tx.$executeRaw`UPDATE sheet_local_rows old SET fingerprint=candidate.fingerprint,append_payload=candidate.payload,status='PENDING',error_code=NULL,last_observed_at=${observedAt}
    FROM jsonb_to_recordset(${updates}::jsonb) AS candidate(row int,fingerprint text,payload jsonb) WHERE old.stream_id=${stream.id} AND old.row_number=candidate.row`;
  await tx.$executeRaw`INSERT INTO sheet_append_observations(id,stream_id,occurrence_key,row_number,fingerprint,payload,observed_at,run_id)
    SELECT candidate."versionId"::uuid,${stream.id},candidate.key,candidate.row,candidate.fingerprint,candidate.payload,${observedAt},${runId}::uuid
    FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS candidate("versionId" text,key text,row int,fingerprint text,payload jsonb)
    ON CONFLICT(stream_id,occurrence_key,fingerprint) DO NOTHING`;
  // Even a conflicting bounded snapshot retains its new queue and versions.
  // Existing confirmed payloads are never overwritten; suspension forbids work.
  await tx.$executeRaw`UPDATE sheet_local_streams SET last_observed_row=GREATEST(last_observed_row,${observation.lastOccupiedRow}),append_last_durable_row=GREATEST(append_last_durable_row,${observation.lastOccupiedRow}) WHERE id=${stream.id}`;
  if (conflict) return suspendAppend(tx, stream, connector.id, runId, conflict);
  return true;
}
export async function appendRows(tx: Prisma.TransactionClient, streamId: string): Promise<AppendRow[]> {
  return tx.$queryRaw<AppendRow[]>`SELECT id,row_number AS "rowNumber",fingerprint,status,append_payload AS payload,append_occurrence_key AS "occurrenceKey",first_observed_at AS "firstObservedAt"
    FROM sheet_local_rows WHERE stream_id=${streamId} AND append_occurrence_key IS NOT NULL ORDER BY row_number LIMIT 10000`;
}
