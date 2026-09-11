import { createHash } from "node:crypto";

/** A source position is not a Forminator submission ID or a Lead ID. */
export interface SheetLocalScope {
  workbookId: string;
  sheetId: number;
  headerRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}
export interface SheetObservedPosition { row: number; fingerprint: string; empty: boolean }
export interface SheetLocalObservation {
  scope: SheetLocalScope;
  headerFingerprint: string;
  positions: readonly SheetObservedPosition[];
}
export type SheetObservationCheck =
  | { kind: "CONSISTENT"; newPositions: readonly SheetObservedPosition[] }
  | { kind: "RECONCILIATION"; reason: "scope_changed" | "headers_changed" | "observed_row_changed"; row?: number };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseSheetLocalRange(range: string): Pick<SheetLocalScope, "headerRow" | "lastRow" | "firstColumn" | "lastColumn"> {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6}):([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(range);
  if (!match) throw new Error("sheet_local_range_invalid");
  const column = (value: string): number => [...value].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  const scope = { headerRow: Number(match[2]), lastRow: Number(match[4]), firstColumn: column(match[1] ?? ""), lastColumn: column(match[3] ?? "") };
  validateScope({ ...scope, workbookId: "synthetic_validation", sheetId: 0 });
  return scope;
}

function validateScope(scope: SheetLocalScope): void {
  if (!/^[A-Za-z0-9_-]{10,200}$/u.test(scope.workbookId)
    || !Number.isSafeInteger(scope.sheetId) || scope.sheetId < 0) throw new Error("sheet_local_scope_invalid");
  for (const number of [scope.headerRow, scope.lastRow, scope.firstColumn, scope.lastColumn]) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("sheet_local_scope_invalid");
  }
  if (scope.lastRow <= scope.headerRow || scope.lastRow - scope.headerRow > 10_000
    || scope.lastColumn < scope.firstColumn || scope.lastColumn - scope.firstColumn >= 100) {
    throw new Error("sheet_local_scope_invalid");
  }
}

/** Called only on a complete, bounded Google response. Missing trailing cells are empty.
 * Interior empty rows remain observed; unread trailing positions are not a cursor.
 * Raw values are hashed before mapping, without normalization. */
export function observeSheetPositions(scope: SheetLocalScope, values: readonly (readonly string[])[]): SheetLocalObservation {
  validateScope(scope);
  const width = scope.lastColumn - scope.firstColumn + 1;
  if (values.length > scope.lastRow - scope.headerRow + 1) throw new Error("sheet_local_range_exceeded");
  const header = values[0];
  if (!header || header.length !== width || header.some((cell) => !cell.trim()) || new Set(header).size !== width) {
    throw new Error("sheet_local_headers_invalid");
  }
  if (values.some((row) => row.length > width)) throw new Error("sheet_local_range_exceeded");
  const positions: SheetObservedPosition[] = [];
  for (let row = scope.headerRow + 1; row < scope.headerRow + values.length; row++) {
    const cells = values[row - scope.headerRow] ?? [];
    const padded = Array.from({ length: width }, (_, index) => cells[index] ?? "");
    positions.push({ row, fingerprint: hash(padded), empty: padded.every((cell) => cell.trim() === "") });
  }
  return { scope: { ...scope }, headerFingerprint: hash(header), positions };
}

/** Opaque lookup key only: persistence must create a separate immutable local record ID.
 * Content, connector, mapping and run are deliberately not part of this position key. */
export function sheetPositionKey(scope: SheetLocalScope, row: number): string {
  validateScope(scope);
  if (!Number.isSafeInteger(row) || row <= scope.headerRow || row > scope.lastRow) throw new Error("sheet_local_position_invalid");
  return hash(["SHEETS_LOCAL_POSITION_V1", scope.workbookId, scope.sheetId, row]);
}

export function reconcileSheetObservation(previous: SheetLocalObservation, current: SheetLocalObservation): SheetObservationCheck {
  if (scopeKey(previous.scope) !== scopeKey(current.scope)) return { kind: "RECONCILIATION", reason: "scope_changed" };
  if (previous.headerFingerprint !== current.headerFingerprint) return { kind: "RECONCILIATION", reason: "headers_changed" };
  const currentByRow = new Map(current.positions.map((position) => [position.row, position]));
  for (const position of previous.positions) {
    if (currentByRow.get(position.row)?.fingerprint !== position.fingerprint) {
      return { kind: "RECONCILIATION", reason: "observed_row_changed", row: position.row };
    }
  }
  const previousRows = new Set(previous.positions.map((position) => position.row));
  return { kind: "CONSISTENT", newPositions: current.positions.filter((position) => !previousRows.has(position.row)) };
}

function scopeKey(scope: SheetLocalScope): string {
  return JSON.stringify([scope.workbookId, scope.sheetId, scope.headerRow, scope.lastRow, scope.firstColumn, scope.lastColumn]);
}
