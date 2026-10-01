import { createHash } from "node:crypto";
import type { Prisma, SheetLocalRow } from "@prisma/client";
import { observeSheetPositions, parseSheetLocalRange, reconcileSheetObservation, type SheetLocalObservation } from "./sheet-local-observation.js";

export function sheetStreamId(workbookId: string, sheetId: number): string {
  return createHash("sha256").update(JSON.stringify([workbookId, sheetId])).digest("hex");
}

export function localObservation(workbookId: string, sheetId: number, range: string, values: string[][]): SheetLocalObservation {
  return observeSheetPositions({ workbookId, sheetId, ...parseSheetLocalRange(range) }, values);
}

export async function suspendLocalStream(tx: Prisma.TransactionClient, campusId: string, connectorId: string, runId: string,
  workbookId: string, sheetId: number, range: string, reason: string): Promise<void> {
  const id = sheetStreamId(workbookId, sheetId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 171))`;
  const bounds = parseSheetLocalRange(range);
  await tx.sheetLocalStream.upsert({ where: { id }, create: { id, campusId, workbookId, sheetId, range,
    headerFingerprint: createHash("sha256").update("unavailable-header").digest("hex"), lastObservedRow: bounds.headerRow }, update: {} });
  const stream = await lockLocalStream(tx, id, campusId);
  if (stream.suspended) return;
  await tx.sheetLocalStream.update({ where: { id }, data: { suspended: true, errorCode: reason } });
  await tx.auditEvent.create({ data: { actorId: `SYSTEM:SHEETS:${connectorId}`, actorRoles: ["SYSTEM"], campusId,
    resourceType: "SHEET_IMPORT", resourceId: connectorId, eventType: "SHEET_RECONCILIATION_REQUIRED", result: "FAILED",
    correlationId: runId, idempotencyKey: `sheet-reconcile:${id}`, after: { reason } } });
}

/** Caller supplies the existing permission/lease-fenced transaction. No transaction is opened here. */
export async function verifyLocalLedger(tx: Prisma.TransactionClient, campusId: string, connectorId: string, runId: string,
  range: string, observation: SheetLocalObservation): Promise<boolean> {
  const id = sheetStreamId(observation.scope.workbookId, observation.scope.sheetId);
  // Serialize first observation too; Prisma's empty-update upsert can otherwise race.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 171))`;
  await tx.sheetLocalStream.upsert({ where: { id }, create: { id, workbookId: observation.scope.workbookId,
    sheetId: observation.scope.sheetId, campusId, range, headerFingerprint: observation.headerFingerprint,
    lastObservedRow: observation.scope.headerRow }, update: {} });
  const stream = await lockLocalStream(tx, id, campusId);
  if (stream.suspended) return false;
  const previousRows = await tx.sheetLocalRow.findMany({ where: { streamId: id }, orderBy: { rowNumber: "asc" }, take: 10_000 });
  const previous: SheetLocalObservation = { scope: { ...observation.scope, ...parseSheetLocalRange(stream.range) },
    headerFingerprint: stream.headerFingerprint, positions: previousRows.map((row) => ({ row: row.rowNumber, fingerprint: row.fingerprint, empty: row.status === "EMPTY" })) };
  const check = reconcileSheetObservation(previous, observation);
  if (check.kind === "CONSISTENT") {
    await tx.sheetLocalRow.createMany({ data: check.newPositions.map((row) => ({ streamId: id, rowNumber: row.row,
      fingerprint: row.fingerprint, status: row.empty ? "EMPTY" : "PENDING" })), skipDuplicates: true });
    return true;
  }
  await tx.sheetLocalStream.update({ where: { id }, data: { suspended: true, errorCode: check.reason } });
  await tx.auditEvent.create({ data: { actorId: `SYSTEM:SHEETS:${connectorId}`, actorRoles: ["SYSTEM"], campusId,
    resourceType: "SHEET_IMPORT", resourceId: connectorId, eventType: "SHEET_RECONCILIATION_REQUIRED", result: "FAILED",
    correlationId: runId, idempotencyKey: `sheet-reconcile:${id}`, after: { reason: check.reason, ...(check.row ? { rowNumber: check.row } : {}) } } });
  return false;
}

export async function lockLocalStream(tx: Prisma.TransactionClient, id: string, campusId: string): Promise<{ suspended: boolean; range: string; headerFingerprint: string }> {
  await tx.$queryRaw`SELECT id FROM sheet_local_streams WHERE id = ${id} FOR UPDATE`;
  const stream = await tx.sheetLocalStream.findUniqueOrThrow({ where: { id } });
  if (stream.campusId !== campusId) throw new Error("sheet_source_scope_refused");
  return stream;
}

export async function observeLocalRow(tx: Prisma.TransactionClient, streamId: string, campusId: string,
  rowNumber: number, fingerprint: string, empty: boolean): Promise<SheetLocalRow> {
  const stream = await lockLocalStream(tx, streamId, campusId);
  if (stream.suspended) throw new Error("sheet_reconciliation_required");
  const row = await tx.sheetLocalRow.upsert({ where: { streamId_rowNumber: { streamId, rowNumber } },
    create: { streamId, rowNumber, fingerprint, status: empty ? "EMPTY" : "PENDING" }, update: { lastObservedAt: new Date() } });
  if (row.fingerprint !== fingerprint) throw new Error("sheet_reconciliation_required");
  return row;
}
