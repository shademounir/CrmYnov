import { Prisma } from "@prisma/client";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { resolveReference } from "../references/reference.repository.js";
import { lockAppointmentParticipants } from "../appointments/appointment-locks.js";
import { receptionSummary } from "../leads/first-treatment.js";
import { isToContact, treatmentSummary } from "../leads/lead-treatment.js";
import { mapPersistedLeadActivity } from "../leads/lead-persistence.repository.js";
import type { BusinessMailFacts, BusinessMailType } from "./business-mail-policy.js";
import type { BusinessMailSettings } from "./business-mail-settings.js";

export interface MailCandidate { type: BusinessMailType; resourceId: string; leadId: string }
const maximumCandidates = 10000;
function boundedRows<T>(rows: T[]): T[] { if (rows.length > maximumCandidates) throw new Error("business_mail_scan_limit_reached"); return rows; }
export async function estimateHeldMailBacklog(tx: Prisma.TransactionClient, settings: BusinessMailSettings, activatedAt: Date): Promise<Record<string, number>> {
  const campus = await canonicalCampus(tx, settings.campusId);
  const campaigns = await tx.crmReference.findMany({ where: { id: { in: settings.campaignIds }, kind: "CAMPAIGN", state: "ACTIVE" }, include: { keys: true } });
  const keys = campaigns.flatMap(row => [row.id, row.code, row.label, ...row.keys.map(key => key.key)]);
  const leads = boundedRows(await tx.lead.findMany({ where: { campus: { in: campus.keys }, campaign: { in: keys }, status: { notIn: ["ENROLLED", "CLOSED_LOST"] } }, select: { id: true }, take: maximumCandidates + 1 }));
  const leadIds = leads.map(row => row.id);
  const tasks = await tx.leadFollowUp.count({ where: { leadId: { in: leadIds }, state: { in: ["SCHEDULED", "DUE"] }, dueAt: { lt: activatedAt } } });
  const pending = await tx.admissionsBooking.count({ where: { state: "PENDING", appointment: { leadId: { in: leadIds } } } });
  const historical = !leadIds.length ? [{ count: 0 }] : await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT count(*)::integer AS count FROM appointments a JOIN admissions_bookings b ON b.appointment_id=a.id
    WHERE a.lead_id IN (${Prisma.join(leadIds.map(id => Prisma.sql`${id}::uuid`))}) AND a.state='CONFIRME' AND b.state='ACCEPTED'
      AND a.starts_at + a.duration_minutes * INTERVAL '1 minute' < ${activatedAt}
      AND NOT EXISTS (SELECT 1 FROM interview_reports r WHERE r.appointment_id=a.id)`);
  return { HISTORICAL_FOLLOW_UPS_HELD: tasks, HISTORICAL_RETURNS_HELD: historical[0]!.count, CONFIRMATION_NO_PERSISTED_DEADLINE: pending };
}
/** Bounded discovery only, never emission authority. Every candidate is re-read
 * under fences. Exceeding the bound fails visibly, not silently starving a queue. */
export async function discoverMailCandidates(tx: Prisma.TransactionClient, settings: BusinessMailSettings, activatedAt: Date, now: Date): Promise<MailCandidate[]> {
  const campus = await canonicalCampus(tx, settings.campusId);
  const leads = boundedRows(await tx.lead.findMany({ where: { campus: { in: campus.keys }, status: { notIn: ["ENROLLED", "CLOSED_LOST"] } }, select: { id: true }, take: maximumCandidates + 1 }));
  const leadIds = leads.map(row => row.id);
  const tasks = boundedRows(await tx.leadFollowUp.findMany({ where: { leadId: { in: leadIds }, state: { in: ["SCHEDULED", "DUE"] }, dueAt: { gte: activatedAt, lte: now } }, select: { id: true, leadId: true }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: maximumCandidates + 1 }));
  const first = boundedRows(await tx.lead.findMany({ where: { id: { in: leadIds }, status: "PROSPECT", acquisitionKind: "NEW", createdAt: { gte: new Date(activatedAt.valueOf() - 86400000), lte: now } }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: maximumCandidates + 1 }));
  // Pending confirmation has no deadline in the present booking contract: it is
  // inspected/held as such, never assigned an invented timeout.
  const appointments = !leadIds.length ? [] : boundedRows(await tx.$queryRaw<Array<{ id: string; leadId: string }>>(Prisma.sql`
    SELECT a.id,a.lead_id AS "leadId" FROM appointments a JOIN admissions_bookings b ON b.appointment_id=a.id
    WHERE a.lead_id IN (${Prisma.join(leadIds.map(id => Prisma.sql`${id}::uuid`))}) AND a.state='CONFIRME' AND b.state='ACCEPTED'
      AND a.starts_at + a.duration_minutes * INTERVAL '1 minute' BETWEEN ${activatedAt} AND ${now}
      AND NOT EXISTS (SELECT 1 FROM interview_reports r WHERE r.appointment_id=a.id)
    ORDER BY a.starts_at,a.id LIMIT ${maximumCandidates + 1}`));
  return [...tasks.flatMap(row => [{ type: "FOLLOW_UP_DUE" as const, resourceId: row.id, leadId: row.leadId }, { type: "FOLLOW_UP_OVERDUE" as const, resourceId: row.id, leadId: row.leadId }]),
    ...first.map(row => ({ type: "FIRST_TREATMENT_OVERDUE" as const, resourceId: row.id, leadId: row.id })),
    ...appointments.map(row => ({ type: "RETURN_EXPECTED" as const, resourceId: row.id, leadId: row.leadId }))];
}

async function actionFacts(tx: Prisma.TransactionClient, candidate: MailCandidate): Promise<(Pick<BusinessMailFacts, "state" | "actionOwnerId" | "deadline" | "reportPresent" | "bookingState"> & { responsibilityCampus?: string }) | null> {
  if (candidate.type.startsWith("FOLLOW_UP_")) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM lead_follow_ups WHERE id=${candidate.resourceId}::uuid AND lead_id=${candidate.leadId}::uuid FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return null;
    const row = await tx.leadFollowUp.findUniqueOrThrow({ where: { id: candidate.resourceId } });
    return { state: row.state, actionOwnerId: row.ownerId, deadline: row.dueAt, reportPresent: false, bookingState: null };
  }
  if (candidate.type === "FIRST_TREATMENT_OVERDUE") return { state: "PENDING", actionOwnerId: "", deadline: null, reportPresent: false, bookingState: null };
  const previous = await tx.appointment.findUnique({ where: { id: candidate.resourceId }, include: { admissionsBooking: { include: { responsibility: true } }, participants: true } });
  if (!previous || previous.leadId !== candidate.leadId || !previous.admissionsBooking) return null;
  await lockAppointmentParticipants(tx, [previous.adviserId, previous.organizerId, ...(previous.evaluatorId ? [previous.evaluatorId] : []), ...previous.participants.map(row => row.userId)]);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointments WHERE id=${candidate.resourceId}::uuid FOR UPDATE SKIP LOCKED`;
  if (!locked.length) return null;
  const row = await tx.appointment.findUniqueOrThrow({ where: { id: candidate.resourceId }, include: { admissionsBooking: { include: { responsibility: true } }, interviewReports: true } });
  const booking = row.admissionsBooking;
  return { state: booking?.state === "PENDING" ? "PENDING" : row.state, actionOwnerId: booking?.responsibility.active ? booking.responsibility.userId : "",
    deadline: candidate.type === "CONFIRMATION_EXPECTED" ? null : new Date(row.startsAt.valueOf() + row.durationMinutes * 60000),
    reportPresent: row.interviewReports.length > 0, bookingState: booking?.state ?? null, ...(booking ? { responsibilityCampus: booking.responsibility.campus } : {}) };
}

export async function currentMailFacts(tx: Prisma.TransactionClient, candidate: MailCandidate, settings: BusinessMailSettings): Promise<BusinessMailFacts | null> {
  const action = await actionFacts(tx, candidate); if (!action) return null;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM leads WHERE id=${candidate.leadId}::uuid FOR SHARE SKIP LOCKED`;
  if (!locked.length) return null;
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: candidate.leadId }, include: { provenances: { orderBy: [{ importedAt: "asc" }, { id: "asc" }], take: 1 } } });
  const campus = await canonicalCampus(tx, lead.campus);
  if (action.responsibilityCampus && (await canonicalCampus(tx, action.responsibilityCampus)).id !== campus.id) return null;
  const campaign = await resolveReference(tx, "CAMPAIGN", lead.campaign, campus.id);
  if (campus.id !== settings.campusId || !campaign || campaign.state !== "ACTIVE" || !settings.campaignIds.includes(campaign.id)) return null;
  if (campaign.scope !== "GLOBAL" && campaign.campusId !== campus.id) return null;
  let receivedAt: Date | null = null, lastTreatmentAt: Date | null = null;
  if (candidate.type === "FIRST_TREATMENT_OVERDUE") {
    const activities = await tx.leadActivity.findMany({ where: { leadId: lead.id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    const history = await tx.importedHistoricalNote.findMany({ where: { leadId: lead.id }, select: { occurredAt: true } });
    const treatment = treatmentSummary(activities.map(mapPersistedLeadActivity), history.map(row => ({ occurredAt: row.occurredAt?.toISOString() ?? null })));
    if (!isToContact({ status: lead.status, ...treatment })) return null;
    const first = lead.provenances[0];
    const reception = receptionSummary(lead.createdAt.toISOString(), lead.acquisitionKind, first ? { ...first, occurredAt: first.occurredAt?.toISOString() ?? null } : undefined, lead.importBatchId ?? undefined);
    receivedAt = new Date(reception.receivedAt); lastTreatmentAt = treatment.lastTreatmentAt ? new Date(treatment.lastTreatmentAt) : null;
    action.actionOwnerId = lead.assignedToId ?? "";
  }
  return { type: candidate.type, resourceId: candidate.resourceId, leadReference: lead.leadCode, scope: { campusId: campus.id, campaignId: campaign.id },
    leadState: ["ENROLLED", "CLOSED_LOST"].includes(lead.status) ? lead.status : "OPEN", acquisition: lead.acquisitionKind === "NEW" ? "NEW" : "BASELINE", receivedAt, lastTreatmentAt,
    state: action.state, actionOwnerId: action.actionOwnerId, deadline: action.deadline, reportPresent: action.reportPresent, bookingState: action.bookingState };
}
