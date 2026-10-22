import { createHash } from "node:crypto";
import type { AppointmentRecord } from "./appointment.service.js";

type CreationInputs = Pick<AppointmentRecord, "leadId" | "type" | "mode" | "startsAt" | "durationMinutes" | "campus" | "adviserId" | "evaluatorId" | "participantIds" | "state">;

export function appointmentCreationSignature(record: Readonly<CreationInputs>): string {
  const canonical = JSON.stringify({
    leadId: record.leadId, type: record.type, mode: record.mode, startsAt: record.startsAt,
    duration: record.durationMinutes, campus: record.campus, adviserId: record.adviserId,
    evaluatorId: record.evaluatorId,
    participantIds: [...record.participantIds].sort((left, right) => left.localeCompare(right, "en")),
    state: record.state,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Legacy APIs can change only state/start, not creation identity/participants.
 * Recover those two inputs from the immutable creation audit, never current state.
 * Missing or inconsistent evidence fails closed without rewriting historical rows. */
export function creationSignatureFromAudit(record: Readonly<AppointmentRecord>, value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const after = value as Record<string, unknown>;
  if (after.appointmentId !== record.id || after.leadId !== record.leadId ||
      after.type !== record.type || after.mode !== record.mode ||
      after.durationMinutes !== record.durationMinutes || (after.campus ?? undefined) !== record.campus ||
      (after.state !== "BROUILLON" && after.state !== "PLANIFIE") ||
      typeof after.startsAt !== "string" || !Number.isFinite(Date.parse(after.startsAt))) return undefined;
  const signature = appointmentCreationSignature({ ...record, state: after.state, startsAt: new Date(after.startsAt).toISOString() });
  if (after.creationSignature !== undefined && after.creationSignature !== signature) return undefined;
  return signature;
}
