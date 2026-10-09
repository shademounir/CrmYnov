import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { SheetValues } from "../sheet-import/google-sheets-adapter.js";

export const CUTOVER_ROW_LIMIT = 10_000;
export const CUTOVER_BYTE_LIMIT = 4 * 1024 * 1024;
export type CutoverState = "DRAFT" | "BASELINED" | "READY_FOR_CATCHUP" | "SUSPENDED";
export interface CutoverContract {
  schemaVersion: 1 | 2;
  streamKey?: string;
  sourceSheetId?: number;
  bootstrapPackageId: string;
  connectorId: string;
  excelSha256: string;
  connectorVersion: number;
  configurationSha256: string;
  t0: string;
  timeZone: string;
  equality: "POST_T0";
  excelFrozenAt: string;
  originalArrivalColumn: string;
  externalIdColumn: string;
  identityEvidenceSha256: string;
}
export interface CutoverEntry {
  key: string;
  externalId: string;
  fingerprint: string;
  originalArrivedAt: string;
  classification: "EXCLUDED_PRE_T0" | "BACKLOG";
  issue: "SOURCE_CHANGED" | "SOURCE_REMOVED" | null;
  decision: "KEEP_FOR_CATCHUP" | "LINK_BASELINE" | null;
  targetBootstrapRowId: string | null;
  payload: Record<string, string>;
}
export interface ObservedCutover {
  headerSha256: string;
  snapshotSha256: string;
  sourceCount: number;
  entries: CutoverEntry[];
}

export function cutoverHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function cutoverStreamKey(workbookId: string, sheetId: number): string {
  if (!workbookId || !Number.isSafeInteger(sheetId) || sheetId < 0) cutoverInvalid("cutover_sheet_identity_required");
  return cutoverHash(["GOOGLE_SHEETS", workbookId, sheetId]);
}
export function cutoverInvalid(code = "cutover_input_invalid"): never { throw new BadRequestException({ code }); }
export function cutoverObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) cutoverInvalid();
  return Object.fromEntries(Object.entries(value));
}
export function cutoverText(value: unknown, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) cutoverInvalid();
  return value;
}
export function cutoverUuid(value: unknown): string {
  const result = cutoverText(value, 36);
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu.test(result)) cutoverInvalid();
  return result;
}
export function cutoverSha(value: unknown): string {
  const result = cutoverText(value, 64); if (!/^[a-f\d]{64}$/u.test(result)) cutoverInvalid(); return result;
}
export function cutoverInstant(value: unknown): string {
  const result = cutoverText(value, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(result)) cutoverInvalid("cutover_original_instant_required");
  const date = new Date(result);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().replace(".000Z", "Z") !== result.replace(".000Z", "Z")) cutoverInvalid("cutover_original_instant_required");
  return date.toISOString();
}
/** This first lot has no independently attested Excel delta covering a gap.
 * Equal declared instants are necessary, not proof of the actual final freeze. */
export function cutoverFinalFreeze(excelFrozenAt: unknown, t0: unknown): void {
  if (cutoverInstant(excelFrozenAt) !== cutoverInstant(t0)) cutoverInvalid("cutover_freeze_delta_unqualified");
}
export function cutoverTimeZone(value: unknown): string {
  const result = cutoverText(value, 80);
  try { new Intl.DateTimeFormat("fr-MA", { timeZone: result }).format(new Date(0)); }
  catch { cutoverInvalid("cutover_time_zone_invalid"); }
  return result;
}
export function cutoverVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) cutoverInvalid(); return value;
}
export function cutoverRequest(value: unknown): { body: Record<string, unknown>; key: string; fingerprint: string; expectedVersion: number } {
  const body = cutoverObject(value), key = cutoverText(body.idempotencyKey), expectedVersion = cutoverVersion(body.expectedVersion);
  return { body, key, expectedVersion, fingerprint: cutoverHash(body) };
}

/** A source ID and its original UTC arrival are required, never a row position or modification date.
 * Invalid identity/capacity refuses the entire observation, preserving the last durable inventory. */
export function observeCutover(contract: CutoverContract, values: SheetValues, previous: CutoverEntry[], headerSha256?: string): ObservedCutover {
  if (!Array.isArray(values.columns) || !values.columns.length || values.columns.length > 100 || new Set(values.columns).size !== values.columns.length
    || values.columns.some((column) => !column.trim() || column.length > 200)
    || !values.columns.includes(contract.externalIdColumn) || !values.columns.includes(contract.originalArrivalColumn)) cutoverInvalid("cutover_source_columns_invalid");
  if (values.rows.length > CUTOVER_ROW_LIMIT || previous.length > CUTOVER_ROW_LIMIT || Buffer.byteLength(JSON.stringify(values)) > CUTOVER_BYTE_LIMIT) cutoverInvalid("cutover_source_bound_exceeded");
  const header = cutoverHash(values.columns);
  if (headerSha256 && headerSha256 !== header) cutoverInvalid("cutover_source_headers_changed");
  const earlier = new Map(previous.map((entry) => [entry.key, entry]));
  const observed = new Set<string>(), entries: CutoverEntry[] = [];
  for (const payload of values.rows) {
    if (Object.entries(payload).some(([key, value]) => !values.columns.includes(key) || typeof value !== "string" || value.length > 4000)) cutoverInvalid("cutover_source_payload_invalid");
    if (Object.values(payload).every((value) => !value.trim())) continue;
    const externalId = cutoverText(payload[contract.externalIdColumn]), originalArrivedAt = cutoverInstant(payload[contract.originalArrivalColumn]);
    const key = cutoverHash([contract.streamKey ?? contract.connectorId, externalId]);
    if (observed.has(key)) cutoverInvalid("cutover_source_identity_ambiguous");
    observed.add(key);
    const fingerprint = cutoverHash(payload), old = earlier.get(key);
    if (old) {
      // Keep the original payload/classification/decision. Changed historical rows can never become NEW.
      entries.push({ ...old, issue: old.issue ?? (old.fingerprint !== fingerprint || old.originalArrivedAt !== originalArrivedAt ? "SOURCE_CHANGED" : null) });
    } else {
      entries.push({ key, externalId, fingerprint, originalArrivedAt,
        classification: originalArrivedAt < contract.t0 ? "EXCLUDED_PRE_T0" : "BACKLOG", issue: null,
        decision: null, targetBootstrapRowId: null, payload: { ...payload } });
    }
  }
  for (const old of previous) if (!observed.has(old.key)) entries.push({ ...old, issue: old.issue ?? "SOURCE_REMOVED" });
  if (entries.length > CUTOVER_ROW_LIMIT || Buffer.byteLength(JSON.stringify(entries)) > CUTOVER_BYTE_LIMIT) cutoverInvalid("cutover_ledger_bound_exceeded");
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return { headerSha256: header, snapshotSha256: cutoverHash(entries.map(({ key, fingerprint, originalArrivedAt, issue }) => ({ key, fingerprint, originalArrivedAt, issue }))), sourceCount: observed.size, entries };
}

export function cutoverCounts(entries: CutoverEntry[]): Record<string, number> {
  return { total: entries.length, excludedPreT0: entries.filter((row) => row.classification === "EXCLUDED_PRE_T0").length,
    backlog: entries.filter((row) => row.classification === "BACKLOG").length, sourceIssues: entries.filter((row) => row.issue).length,
    overlapReview: entries.filter((row) => row.classification === "BACKLOG" && !row.decision).length,
    linkedBaseline: entries.filter((row) => row.decision === "LINK_BASELINE").length,
    keptForCatchup: entries.filter((row) => row.decision === "KEEP_FOR_CATCHUP").length };
}
