import { isToContact, type TreatmentSummary } from "./lead-treatment.js";

export const FIRST_TREATMENT_LIMIT_HOURS = 24;
const limitMs = FIRST_TREATMENT_LIMIT_HOURS * 3_600_000;
export type ReceptionOrigin = "SOURCE_CONTRACT" | "CRM_OBSERVATION" | "CRM_OBSERVATION_BASELINE";
export interface ReceptionSummary { receivedAt: string; receptionOrigin: ReceptionOrigin }
export interface FirstTreatmentIndicators { firstTreatmentPending: boolean; firstTreatmentOverdue: boolean; firstTreatmentAgeMinutes: number | null; firstTreatmentDeadlineAt: string | null }
export interface FirstReceptionEvidence {
  sourceType: string; technicalSystem: string; occurredAt: string | null;
}

/** Only the FIRST persisted provenance is eligible: later arrivals/duplicate
 * feeds never reset a counter. Currently the append contract authenticates
 * WEB_FORM/FORMinator events. Other source timestamps remain explicitly
 * unqualified, not guessed from arbitrary spreadsheet cells or note dates.
 * createdAt is the persisted CRM reception, never a job/deployment timestamp. */
export function receptionSummary(createdAt: string, acquisitionKind?: string, first?: FirstReceptionEvidence): ReceptionSummary {
  const observed = Date.parse(createdAt);
  const source = first?.occurredAt ? Date.parse(first.occurredAt) : Number.NaN;
  const accepted = acquisitionKind !== "BASELINE" && first?.sourceType === "WEB_FORM"
    && first.technicalSystem === "FORMINATOR_ZAPIER" && Number.isFinite(source)
    && Number.isFinite(observed) && source <= observed;
  return accepted
    ? { receivedAt: new Date(source).toISOString(), receptionOrigin: "SOURCE_CONTRACT" }
    : { receivedAt: createdAt, receptionOrigin: acquisitionKind === "BASELINE" ? "CRM_OBSERVATION_BASELINE" : "CRM_OBSERVATION" };
}

/** Consecutive elapsed hours, not working hours or calendar-day boundaries.
 * Strictly >24h: equality is not overdue. No close/call/message side effect. */
export function firstTreatmentState(
  lead: { status: string; createdAt: string; receivedAt?: string } & Partial<TreatmentSummary>, now: Date,
): FirstTreatmentIndicators {
  const pending = isToContact(lead);
  const received = Date.parse(lead.receivedAt ?? lead.createdAt);
  const known = Number.isFinite(received) && Number.isFinite(now.valueOf());
  const elapsed = known ? now.valueOf() - received : 0;
  return {
    firstTreatmentPending: pending,
    firstTreatmentOverdue: pending && known && elapsed > limitMs,
    firstTreatmentAgeMinutes: pending && known ? Math.max(0, Math.floor(elapsed / 60_000)) : null,
    firstTreatmentDeadlineAt: pending && known ? new Date(received + limitMs).toISOString() : null,
  };
}
