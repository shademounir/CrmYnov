import { createHash } from "node:crypto";

/** Transport-independent rules; neither spreadsheet row positions nor channel names identify a submission. */
export const sheetImportDefaults = Object.freeze({ enabled: false, intervalMinutes: 15 });
export const sheetImportSource = "FORMINATOR_ZAPIER";

export type SheetRowDecision =
  | { kind: "REVIEW"; reason: "submission_id_missing" | "submission_id_invalid" | "submission_changed" }
  | { kind: "IMPORT" | "REPLAY"; source: typeof sheetImportSource; externalId: string; fingerprint: string };

export interface ProcessedSubmission {
  externalId: string;
  fingerprint: string;
}

export function sheetInterval(value: number): number {
  if (!Number.isInteger(value) || value < 5 || value > 15) throw new Error("sheet_interval_invalid");
  return value;
}

/** Keys are sorted with an ordinal comparator, independent of host locale. No raw cell is returned. */
export function sheetRowFingerprint(cells: Readonly<Record<string, string>>): string {
  const entries = Object.entries(cells).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function classifySheetRow(
  submissionId: string | undefined,
  cells: Readonly<Record<string, string>>,
  previous: ProcessedSubmission | undefined,
): SheetRowDecision {
  const externalId = submissionId?.trim();
  if (!externalId) return { kind: "REVIEW", reason: "submission_id_missing" };
  if (externalId.length > 128 || [...externalId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return { kind: "REVIEW", reason: "submission_id_invalid" };
  }
  const fingerprint = sheetRowFingerprint(cells);
  if (!previous) return { kind: "IMPORT", source: sheetImportSource, externalId, fingerprint };
  if (previous.externalId !== externalId) throw new Error("sheet_submission_tracking_mismatch");
  if (previous.fingerprint !== fingerprint) return { kind: "REVIEW", reason: "submission_changed" };
  return { kind: "REPLAY", source: sheetImportSource, externalId, fingerprint };
}

export type SheetRetryDecision =
  | { kind: "STOP"; reason: "access_denied" | "source_rejected" | "attempts_exhausted" | "retry_after_exceeds_budget" }
  | { kind: "RETRY"; delayMs: number };

/** At most three attempts in total. Long provider backoffs are never shortened into an aggressive retry. */
export function sheetRetry(status: number | "NETWORK", attempt: number, retryAfter: string | undefined, nowMs: number): SheetRetryDecision {
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isFinite(nowMs)) throw new Error("sheet_retry_context_invalid");
  if (status === 401 || status === 403) return { kind: "STOP", reason: "access_denied" };
  if (status !== "NETWORK" && status !== 429 && (status < 500 || status > 599)) return { kind: "STOP", reason: "source_rejected" };
  if (attempt >= 3) return { kind: "STOP", reason: "attempts_exhausted" };
  const providerDelay = parseRetryAfter(retryAfter, nowMs);
  if (providerDelay > 15 * 60_000) return { kind: "STOP", reason: "retry_after_exceeds_budget" };
  return { kind: "RETRY", delayMs: Math.max(providerDelay, 1_000 * 2 ** (attempt - 1)) };
}

function parseRetryAfter(value: string | undefined, nowMs: number): number {
  if (!value?.trim()) return 0;
  if (/^\d+$/u.test(value.trim())) return Number(value.trim()) * 1_000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - nowMs) : 0;
}
