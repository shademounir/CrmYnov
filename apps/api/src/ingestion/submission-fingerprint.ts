import { createHash } from "node:crypto";
import type { IngestionRecordInput } from "./ingestion.service.js";

/** Same submission across transport channels; never derived from row position or channel name. */
export function submissionFingerprint(record: IngestionRecordInput): string {
  const content = { externalId: record.externalId?.trim() ?? "", firstName: record.firstName.trim(), lastName: record.lastName.trim(),
    email: record.email?.trim().toLowerCase() ?? "", phone: record.phone?.replace(/[^+\d]/gu, "") ?? "",
    campus: record.campus?.trim() ?? "", program: record.program?.trim() ?? "", campaign: record.campaign?.trim() ?? "",
    educationLevel: record.educationLevel?.trim() ?? "", historicalStatus: record.historicalStatus?.trim() ?? "",
    occurredAt: record.occurredAt ?? "", historicalActivities: record.historicalActivities ?? [], structuredPriorContact: record.structuredPriorContact ?? false };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
