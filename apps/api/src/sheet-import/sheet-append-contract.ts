import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { parseSheetLocalRange } from "./sheet-local-observation.js";

export const APPEND_MODE = "LOCAL_ROW_APPEND_ONLY";
export const APPEND_POLICY = "LOCAL_ROW_APPEND_ONLY_V1";
export const APPEND_MAX_BYTES = 4 * 1024 * 1024;
export interface SheetAppendBoundary {
  schemaVersion: 1; mode: typeof APPEND_MODE; workbookId: string; sheetId: number; tab: string;
  generation: string; range: string; capturedAt: string; boundaryRow: number; values: string[][];
}
export interface SheetAppendContract extends Omit<SheetAppendBoundary, "values"> {
  artifactSha256: string; headerFingerprint: string; historicalFingerprints: Array<{ row: number; fingerprint: string }>;
  bindingSha256: string; policy: typeof APPEND_POLICY; producerAttested: false;
}
export interface SheetAppendPosition { row: number; fingerprint: string; cells: string[]; empty: boolean }
export function appendHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function appendInvalid(code: string): never {
  const response = { code: `sheet_append_${code}`, message: `sheet_append_${code}` };
  if (code === "private_boundary_unavailable") throw new ServiceUnavailableException(response);
  if (["boundary_required", "suspended", "rebaseline_refused", "qualification_required", "bootstrap_binding_changed", "bootstrap_reconciliation_required", "producer_condition_before_boundary"].includes(code)) throw new ConflictException(response);
  throw new BadRequestException(response);
}
function utc(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function appendPositions(range: string, values: unknown): { header: string[]; positions: SheetAppendPosition[]; lastOccupiedRow: number } {
  const scope = parseSheetLocalRange(range), width = scope.lastColumn - scope.firstColumn + 1;
  if (!Array.isArray(values) || !values.length || values.length > scope.lastRow - scope.headerRow + 1
    || Buffer.byteLength(JSON.stringify(values)) > APPEND_MAX_BYTES) appendInvalid("observation_bounds");
  const rawHeader: unknown = values[0];
  if (!Array.isArray(rawHeader) || !rawHeader.length || rawHeader.length > width || rawHeader.some((cell) => typeof cell !== "string")) appendInvalid("headers_invalid");
  const header = Array.from(rawHeader as string[]);
  while (header.at(-1) === "") header.pop();
  if (!header.length || header.some((cell) => !cell.trim()) || new Set(header).size !== header.length) appendInvalid("headers_invalid");
  const positions: SheetAppendPosition[] = [];
  let lastOccupiedRow = scope.headerRow;
  for (let index = 1; index < values.length; index++) {
    const raw: unknown = values[index];
    if (!Array.isArray(raw) || raw.length > width || raw.some((value) => typeof value !== "string" || value.length > 4000)) appendInvalid("payload_invalid");
    const cells = Array.from({ length: width }, (_, column): string => (raw[column] as string | undefined) ?? "");
    if (cells.slice(header.length).some((cell) => cell !== "")) appendInvalid("unheaded_data");
    // A whitespace-only entered value still occupies a position; do not shift N0.
    const empty = cells.every((cell) => cell === ""), row = scope.headerRow + index;
    if (!empty) lastOccupiedRow = row;
    positions.push({ row, cells, fingerprint: appendHash(cells), empty });
  }
  // The last requested row is a sentinel, not silently accepted as full coverage.
  if (lastOccupiedRow >= scope.lastRow) appendInvalid("range_capacity_reached");
  return { header, positions: positions.filter((item) => item.row <= lastOccupiedRow), lastOccupiedRow };
}
export function readAppendBoundary(raw: unknown, now = Date.now()): SheetAppendBoundary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) appendInvalid("boundary_invalid");
  const value = Object.fromEntries(Object.entries(raw));
  if (value.schemaVersion !== 1 || value.mode !== APPEND_MODE || typeof value.workbookId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/u.test(value.workbookId)
    || typeof value.sheetId !== "number" || !Number.isSafeInteger(value.sheetId) || value.sheetId < 0
    || typeof value.tab !== "string" || !value.tab || value.tab.length > 100 || /[\p{Cc}]/u.test(value.tab)
    || typeof value.generation !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(value.generation)
    || typeof value.range !== "string" || !utc(value.capturedAt) || Date.parse(value.capturedAt) > now
    || typeof value.boundaryRow !== "number" || !Number.isSafeInteger(value.boundaryRow)) appendInvalid("boundary_invalid");
  const observation = appendPositions(value.range, value.values);
  if (observation.lastOccupiedRow !== value.boundaryRow) appendInvalid("boundary_mismatch");
  return { schemaVersion: 1, mode: APPEND_MODE, workbookId: value.workbookId, sheetId: value.sheetId, tab: value.tab,
    generation: value.generation, range: value.range, capturedAt: value.capturedAt, boundaryRow: value.boundaryRow, values: value.values as string[][] };
}
export function appendOccurrenceKey(contract: Pick<SheetAppendContract, "workbookId" | "sheetId" | "generation" | "range" | "boundaryRow">, row: number): string {
  const bounds = parseSheetLocalRange(contract.range);
  if (!Number.isSafeInteger(row) || row <= contract.boundaryRow || row > bounds.lastRow) appendInvalid("position_invalid");
  return appendHash([APPEND_MODE, contract.workbookId, contract.sheetId, contract.generation, row]);
}
/** Only previously empty cells may be completed on an unprocessed partial row.
 * Replacements, sorts, deletions and already-confirmed edits require review. */
export function appendCompletion(previous: readonly string[], current: readonly string[]): boolean {
  return previous.length === current.length && previous.every((cell, index) => cell === "" || current[index] === cell);
}
export function appendBinding(workbookId: string, tab: string, campusId: string, configuration: {
  source?: unknown; mapping: { columns: unknown }; context: unknown; assignment: unknown;
}): string {
  return appendHash({ workbookId, tab, campusId, source: configuration.source, columns: configuration.mapping.columns,
    context: configuration.context, assignment: configuration.assignment });
}
