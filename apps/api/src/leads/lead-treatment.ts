import { BadRequestException } from "@nestjs/common";
import { isCommercialContact } from "./commercial-progression.js";
import type { LeadActivityRecord } from "./lead.service.js";

export interface TreatmentSummary {
  firstTreatmentAt?: string;
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
  return { ...(dates[0] ? { firstTreatmentAt: dates[0] } : {}), ...(lastTreatmentAt ? { lastTreatmentAt } : {}), hasUndatedHistory,
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

export interface TreatmentFilters { treatmentFrom?: string | undefined; treatmentTo?: string | undefined; treatmentState?: string | undefined }
export function normalizeTreatmentFilters(query: TreatmentFilters): TreatmentFilters {
  const treatmentFrom = validateTreatmentDay(query.treatmentFrom), treatmentTo = validateTreatmentDay(query.treatmentTo);
  if (treatmentFrom && treatmentTo && treatmentFrom > treatmentTo) throw new BadRequestException({ code: "lead_treatment_range_invalid" });
  if (query.treatmentState && !["DATED", "UNKNOWN_DATE", "NONE"].includes(query.treatmentState)) throw new BadRequestException({ code: "lead_treatment_state_invalid" });
  return { ...(treatmentFrom ? { treatmentFrom } : {}), ...(treatmentTo ? { treatmentTo } : {}), ...(query.treatmentState ? { treatmentState: query.treatmentState } : {}) };
}
/** Inclusive Casablanca days; an unknown historical date is never invented. A
 * mixed history may still have a known last dated treatment within the range. */
export function matchesTreatmentFilters(lead: Partial<TreatmentSummary>, query: TreatmentFilters): boolean {
  return (!query.treatmentState || lead.treatmentState === query.treatmentState)
    && (!query.treatmentFrom || Boolean(lead.lastTreatmentAt && treatmentDay(lead.lastTreatmentAt) >= query.treatmentFrom))
    && (!query.treatmentTo || Boolean(lead.lastTreatmentAt && treatmentDay(lead.lastTreatmentAt) <= query.treatmentTo));
}

/** Historical state is never rewritten to implement a queue. A known exchange
 * without a date is not evidence that a Prospect has never been treated. */
export function isToContact(lead: { status: string } & Partial<TreatmentSummary>): boolean {
  return lead.status === "PROSPECT" && !lead.firstTreatmentAt && !lead.lastTreatmentAt
    && !lead.hasUndatedHistory && !["DATED", "UNKNOWN_DATE"].includes(lead.treatmentState ?? "");
}

/** A known old treatment is not an absence of treatment. Unknown dated history
 * and never-treated dossiers keep their own queues; technical writes do not
 * supply a new business clock. The cutoff is frozen by the report, not a read. */
export function isTreatmentInactive(lead: { status: string } & Partial<TreatmentSummary>, before: string): boolean {
  return !["ENROLLED", "CLOSED_LOST"].includes(lead.status) && lead.treatmentState === "DATED"
    && lead.hasUndatedHistory === false && Boolean(lead.lastTreatmentAt)
    && Date.parse(lead.lastTreatmentAt!) < Date.parse(before);
}
export function inactiveTreatmentBoundary(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new BadRequestException({ code: "lead_inactive_treatment_boundary_invalid" });
  }
  return value;
}
