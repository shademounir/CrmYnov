import { BadRequestException, ConflictException } from "@nestjs/common";

/** A human intention, not a second task model. dueAt is repeated on CONFIRM so
 * the exact appointment the adviser saw is fingerprinted with the interaction. */
export type NextActionIntent =
  | { mode: "SCHEDULE"; dueAt: string; reason: string }
  | { mode: "CONFIRM"; id: string; expectedVersion: number; dueAt: string };

export function parseNextActionIntent(value: unknown): NextActionIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const allowed = row.mode === "SCHEDULE" ? ["mode", "dueAt", "reason"] : ["mode", "id", "expectedVersion", "dueAt"];
  if (Object.keys(row).some(key => !allowed.includes(key)) || typeof row.dueAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.dueAt)
    || !Number.isFinite(Date.parse(row.dueAt))) invalid();
  const calendarDay = row.dueAt.slice(0, 10);
  if (new Date(`${calendarDay}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDay) invalid();
  const dueAt = new Date(row.dueAt).toISOString();
  if (row.mode === "SCHEDULE") {
    if (typeof row.reason !== "string" || row.reason.trim().length < 3 || row.reason.trim().length > 1000) invalid();
    return { mode: "SCHEDULE", dueAt, reason: row.reason.trim() };
  }
  if (row.mode !== "CONFIRM" || typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)
    || !Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 1) invalid();
  return { mode: "CONFIRM", id: row.id, expectedVersion: Number(row.expectedVersion), dueAt };
}

export function assertFutureNextAction(intent: NextActionIntent, now: Date): void {
  if (Date.parse(intent.dueAt) <= now.valueOf()) throw new BadRequestException({ code: "next_action_chronology_invalid" });
}

export function assertConfirmedNextAction(
  intent: Extract<NextActionIntent, { mode: "CONFIRM" }>,
  record: { id: string; leadId: string; version: number; state: string; dueAt: string } | undefined,
  leadId: string,
  now: Date,
): void {
  if (!record || record.id !== intent.id || record.leadId !== leadId || record.version !== intent.expectedVersion
    || !["SCHEDULED", "DUE"].includes(record.state) || Date.parse(record.dueAt) !== Date.parse(intent.dueAt)) {
    throw new ConflictException({ code: "next_action_confirmation_stale" });
  }
  assertFutureNextAction(intent, now);
}

function invalid(): never { throw new BadRequestException({ code: "next_action_intent_invalid" }); }

/** Persisted presence is authoritative; a legacy datetime alone is not a task.
 * The date-only fallback is for the explicitly nonpersistent fixture adapter. */
export function needsNextAction(lead: { status: string; treatmentState?: string; hasUndatedHistory?: boolean; nextActionAt?: string; hasActiveNextAction?: boolean }): boolean {
  const treated = ["CONTACTED", "QUALIFIED"].includes(lead.status) || lead.treatmentState === "DATED" || lead.hasUndatedHistory === true;
  const active = lead.hasActiveNextAction ?? Boolean(lead.nextActionAt);
  return !["ENROLLED", "CLOSED_LOST"].includes(lead.status) && treated && !active;
}
