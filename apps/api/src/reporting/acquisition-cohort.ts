import type { LeadReportingRow } from "../leads/lead.service.js";

export interface AcquisitionPartition {
  definitionVersion: "acquisition-cohort-v1";
  newAcquisitionCount: number;
  baselinePortfolioCount: number;
  periodDateBasis: "STORED_CREATED_AT_NOT_HISTORICAL_RECEPTION";
}

/** The existing authorized/date-filtered cohort remains a portfolio. A baseline
 * was stored on its import date, not acquired then. Missing kind is the compatible
 * NEW projection of pre-migration/local records, never an inferred historical date. */
export function isBaseline(lead: Pick<LeadReportingRow, "acquisitionKind">): boolean {
  return lead.acquisitionKind === "BASELINE";
}

export function acquisitionPartition(rows: readonly LeadReportingRow[]): AcquisitionPartition {
  const baselinePortfolioCount = rows.filter(isBaseline).length;
  return { definitionVersion: "acquisition-cohort-v1", newAcquisitionCount: rows.length - baselinePortfolioCount,
    baselinePortfolioCount, periodDateBasis: "STORED_CREATED_AT_NOT_HISTORICAL_RECEPTION" };
}

/** A real later workflow transition on a baseline is work done now, not a new
 * acquisition. Its imported current status alone is never an enrollment event. */
export function observedEnrollment(lead: LeadReportingRow, activity: LeadReportingRow["activities"][number], from?: string, to?: string): boolean {
  return activity.type === "STATUS_CHANGED" && activity.result.split("->")[1] === "ENROLLED"
    && (!from || activity.occurredAt >= from) && (!to || activity.occurredAt < to)
    && (!isBaseline(lead) || activity.occurredAt >= lead.createdAt);
}
