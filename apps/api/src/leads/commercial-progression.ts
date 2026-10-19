import { BadRequestException } from "@nestjs/common";

/** New business actions only. Imports, reads, appointments being planned and
 * call dispatch lifecycle markers are not commercial contact evidence. */
export function isCommercialContact(activity: { type: string; result: string; note?: string }): boolean {
  const result = activity.result.trim().toUpperCase();
  if (["WHATSAPP", "MANUAL_EMAIL", "PHYSICAL_VISIT"].includes(activity.type)) return Boolean(result);
  if (activity.type === "COMMENT") return Boolean(activity.note?.trim());
  if (activity.type === "MEETING") return ["CONNECTED", "COMPLETED", "INFORMATION_RECORDED"].includes(result) || result.startsWith("INTERVIEW_");
  return ["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL"].includes(activity.type)
    && ["CONNECTED", "ANSWERED", "NO_ANSWER", "COMPLETED", "FOLLOW_UP_REQUIRED", "INFORMATION_RECORDED", "CALL_RINGING", "CALL_CONNECTED", "CALL_ENDED"].includes(result);
}

export interface PositiveQualification {
  interestConfirmed: boolean;
  eligibilityConfirmed: boolean;
}
export interface CommercialStatusInput { status: string; reason?: string; qualification?: PositiveQualification; idempotencyKey?: string }

/** Human observations + the existing dossier fields, never inferred from heat,
 * imported status, date, or technical activity. Evidence is appended immutably. */
export function positiveQualificationEvidence(
  lead: { program: string; educationLevel: string },
  qualification: PositiveQualification | undefined,
  reason: string | undefined,
): string {
  if (!qualification || typeof qualification !== "object" || Array.isArray(qualification)
    || Object.keys(qualification).some((key) => !["interestConfirmed", "eligibilityConfirmed"].includes(key))
    || qualification.interestConfirmed !== true || qualification.eligibilityConfirmed !== true
    || !lead.program.trim() || !lead.educationLevel.trim() || typeof reason !== "string" || reason.trim().length < 8 || reason.trim().length > 1000) {
    throw new BadRequestException({ code: "commercial_positive_qualification_required" });
  }
  return `Qualification commerciale v1 — intérêt confirmé ; éligibilité vérifiée ; formation : ${lead.program}; niveau : ${lead.educationLevel}. ${reason.trim()}`;
}
