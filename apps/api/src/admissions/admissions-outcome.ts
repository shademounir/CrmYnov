export type AdmissionsOutcomeStatus = "DECISION_PENDING" | "UPCOMING" | "RETURN_EXPECTED" | "REPORT_EXPECTED" | "REPORTED" | "HELD" | "ABSENT" | "CANCELLED" | "RESCHEDULED" | "REFUSED" | "UNAVAILABLE";

/** Read-only observation; absence and attendance always require an explicit persisted outcome. */
export function admissionsOutcomeStatus(bookingState: string, appointmentState: string, endsAt: Date, hasReport: boolean, generatedAt: Date, reportRequired = false): AdmissionsOutcomeStatus {
  if (bookingState === "CANCELLED" || appointmentState === "ANNULE") return "CANCELLED";
  if (bookingState === "REFUSED") return "REFUSED";
  if (appointmentState === "REPORTE") return "RESCHEDULED";
  if (appointmentState === "ABSENT") return "ABSENT";
  if (appointmentState === "REALISE") return hasReport ? "REPORTED" : reportRequired ? "REPORT_EXPECTED" : "HELD";
  if (bookingState === "PENDING") return "DECISION_PENDING";
  if (bookingState !== "ACCEPTED" || appointmentState !== "CONFIRME" || !Number.isFinite(endsAt.valueOf()) || !Number.isFinite(generatedAt.valueOf())) return "UNAVAILABLE";
  return generatedAt < endsAt ? "UPCOMING" : "RETURN_EXPECTED";
}
