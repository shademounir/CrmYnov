import { BadRequestException } from "@nestjs/common";
import { isCommercialContact } from "./commercial-progression.js";
import type { LeadActivityRecord } from "./lead.service.js";

export interface TreatmentSummary {
  lastTreatmentAt?: string;
  treatmentState: "DATED" | "UNKNOWN_DATE" | "NONE";
  hasUndatedHistory: boolean;
}

/** A correction compensates evidence; its recording date never rejuvenates the
 * original exchange. An import timestamp is never a business date. */
export function treatmentSummary(activities: readonly LeadActivityRecord[], history: readonly { occurredAt: string | null }[]): TreatmentSummary {
  const dates = history.flatMap((note) => note.occurredAt ? [note.occurredAt] : []);
  const corrections = new Map<string, NonNullable<LeadActivityRecord["correction"]>>();
  for (const activity of activities) if (activity.correction) corrections.set(activity.correction.originalEventId, activity.correction);
  for (const activity of activities) {
    if (activity.correction) continue;
    const correction = corrections.get(activity.id);
    if (correction?.operation === "CANCEL") continue;
    const evidence = correction?.replacement ? { ...correction.replacement, ...(activity.note ? { note: activity.note } : {}) } : activity;
    if (isCommercialContact(evidence) || evidence.type === "STATUS_CHANGED") dates.push(activity.occurredAt);
  }
  dates.sort((first, second) => Date.parse(first) - Date.parse(second));
  const lastTreatmentAt = dates.at(-1);
  const hasUndatedHistory = history.some((note) => note.occurredAt === null);
  return { ...(lastTreatmentAt ? { lastTreatmentAt } : {}), hasUndatedHistory,
    treatmentState: hasUndatedHistory ? "UNKNOWN_DATE" : lastTreatmentAt ? "DATED" : "NONE" };
}

const casablanca = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" });
export function treatmentDay(instant: string): string {
  const parts = casablanca.formatToParts(new Date(instant));
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validateTreatmentDay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException({ code: "lead_treatment_date_invalid" });
  return value;
}

/** Historical state is not rewritten; new contact/manual Contacted leaves this queue. */
export function isToContact(lead: { status: string }): boolean { return lead.status === "PROSPECT"; }
