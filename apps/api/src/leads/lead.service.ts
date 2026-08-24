import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";

export const activityTypes = ["CRM_CALL", "EXTERNAL_CALL", "PHONE_CALL", "PHYSICAL_VISIT", "WHATSAPP", "MANUAL_EMAIL", "MEETING", "COMMENT", "CORRECTION", "STATUS_CHANGED", "LEAD_CREATED", "ASSIGNMENT_CHANGED", "REASSIGNMENT_REQUESTED", "REASSIGNMENT_REJECTED", "LEGACY_IMPORT", "PROVENANCE_ATTACHED"] as const;
export type ActivityType = (typeof activityTypes)[number];
export const correctionReasonCodes = ["WRONG_CHANNEL", "WRONG_RESULT", "WRONG_NEXT_ACTION", "DUPLICATE_ENTRY", "OTHER_CONTROLLED"] as const;
export type CorrectionReasonCode = (typeof correctionReasonCodes)[number];
export interface ExpurgatedActivitySnapshot { type: ActivityType; result: string; noteState: "ABSENT" | "REDACTED"; nextActionAt?: string }
export interface ActivityCorrection {
  originalEventId: string; operation: "CORRECT" | "CANCEL"; reasonCode: CorrectionReasonCode;
  previous: ExpurgatedActivitySnapshot; replacement?: ExpurgatedActivitySnapshot;
}
export interface InteractionCorrectionInput {
  idempotencyKey: string; expectedCorrectionCount: number; operation: "CORRECT" | "CANCEL"; reasonCode: string;
  replacement?: { type: string; result: string; nextActionAt?: string };
}
export type LeadStatus = "PROSPECT" | "CONTACTED" | "QUALIFIED" | "ENROLLED" | "CLOSED_LOST";
export const leadStatuses: readonly LeadStatus[] = ["PROSPECT", "CONTACTED", "QUALIFIED", "ENROLLED", "CLOSED_LOST"];
const allowedTransitions: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  PROSPECT: ["CONTACTED"],
  CONTACTED: ["QUALIFIED", "CLOSED_LOST"],
  QUALIFIED: ["ENROLLED", "CLOSED_LOST"],
  ENROLLED: [],
  CLOSED_LOST: [],
};

export interface LeadRecord {
  id: string; leadCode: string; firstName: string; lastName: string; email?: string; phone?: string;
  campus: string; campaign: string; educationLevel: string; program: string; source: string;
  status: LeadStatus; assignedToId?: string; collaboratorIds?: string[]; assignmentMode?: string; importBatchId?: string;
  nextActionAt?: string; lastActivityAt?: string; createdAt: string;
}

export interface LeadActivityRecord {
  id: string; leadId: string; type: ActivityType; result: string; note?: string; authorId: string;
  nextActionAt?: string; correlationId: string; occurredAt: string; correction?: ActivityCorrection;
}

export type CreateLeadInput = Omit<LeadRecord, "id" | "leadCode" | "createdAt" | "status">;
export interface CreateLeadResult { lead: LeadRecord; duplicateCandidates: string[] }
export interface LeadPage { items: LeadRecord[]; page: number; pageSize: number; total: number }
export interface LeadAssignmentSnapshot {
  total: number; assigned: number; unassigned: number; followUpDue: number;
  byAdviser: Array<{ userId: string; leadCount: number }>;
}
export interface LeadReportingRow {
  id: string; status: LeadStatus; campus: string; campaign: string; program: string; source: string; createdAt: string;
}
export type LeadSortField = "createdAt" | "leadCode" | "lastName" | "status";
export interface LeadListQuery {
  page: number; pageSize: number; search?: string; assignedToId?: string; status?: string; source?: string;
  program?: string; campaign?: string; campus?: string; createdFrom?: string; createdTo?: string;
  assignmentMode?: string; importBatchId?: string; view?: string; sortBy?: string; sortDirection?: string;
  savedView?: string;
}
export type LeadWorkView = "ALL" | "MINE" | "FOLLOW_UP" | "UNASSIGNED" | "NO_ACTIVITY" | "CLOSED";
export const leadSavedViews = ["FORMINATOR_ZAPIER", "YNOV_MA_LEGACY", "YNOV_COM", "PHONE_CALLS", "PHYSICAL_VISITS", "JOBINTECH", "LEGACY_RELAUNCH", "UNCLASSIFIED_SOURCES", "INCOMPLETE", "IMPORT_ERRORS"] as const;
export type LeadSavedView = typeof leadSavedViews[number];

@Injectable()
export class LeadService {
  private readonly leads = new Map<string, Readonly<LeadRecord>>();
  private activities: Readonly<LeadActivityRecord>[] = [];
  private readonly correctionReceipts = new Map<string, Readonly<LeadActivityRecord>>();
  constructor(private readonly audit: AuditService) {}

  registerLocalLead(input: Omit<LeadRecord, "id" | "createdAt" | "status"> & { id?: string; status?: LeadStatus }): LeadRecord {
    const lead: LeadRecord = Object.freeze({ ...input, id: input.id ?? randomUUID(), status: input.status ?? "PROSPECT", createdAt: new Date().toISOString() });
    this.leads.set(lead.id, lead);
    return { ...lead };
  }

  createLead(input: CreateLeadInput, principal: Principal, correlationId: string): CreateLeadResult {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "role_forbidden" });
    const required = [input.firstName, input.lastName, input.campus, input.campaign, input.educationLevel, input.program, input.source];
    if (required.some((value) => !value?.trim())) throw new BadRequestException({ code: "lead_required_field_missing" });
    const email = input.email?.trim().toLowerCase();
    const atIndex = email?.indexOf("@") ?? -1;
    const lastAtIndex = email?.lastIndexOf("@") ?? -1;
    const dotIndex = email?.lastIndexOf(".") ?? -1;
    if (email && (email.includes(" ") || atIndex < 1 || atIndex !== lastAtIndex || dotIndex < atIndex + 2 || dotIndex === email.length - 1)) throw new BadRequestException({ code: "lead_email_invalid" });
    const phone = input.phone?.replace(/[^+\d]/g, "");
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new BadRequestException({ code: "lead_phone_invalid" });
    const duplicateCandidates = [...this.leads.values()].filter((lead) =>
      Boolean((email && lead.email === email) || (phone && lead.phone === phone)),
    ).map((lead) => lead.leadCode).sort((left, right) => left.localeCompare(right));
    const leadCode = `LD-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const lead = this.registerLocalLead({ ...input, leadCode, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
      campus: input.campus.trim(), campaign: input.campaign.trim(), educationLevel: input.educationLevel.trim(),
      program: input.program.trim(), source: input.source.trim(), ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId: lead.id, type: "LEAD_CREATED",
      result: "PROSPECT", authorId: principal.userId, correlationId, occurredAt: lead.createdAt });
    this.activities = [...this.activities, activity];
    const createdLead: Readonly<LeadRecord> = Object.freeze({ ...lead, lastActivityAt: activity.occurredAt });
    this.leads.set(lead.id, createdLead);
    this.audit.record({ eventType: "LEAD_CREATED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { leadId: lead.id, leadCode, duplicateCandidateCount: duplicateCandidates.length }, result: "SUCCESS",
      idempotencyKey: `lead-created:${lead.id}` });
    return { lead: { ...createdLead }, duplicateCandidates };
  }

  listLeads(query: LeadListQuery, principal: Principal, correlationId: string): LeadPage {
    this.assertReadRole(principal);
    const { page, pageSize } = query;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException({ code: "lead_pagination_invalid" });
    const status = query.status?.toUpperCase();
    if (status && !leadStatuses.includes(status as LeadStatus)) throw new BadRequestException({ code: "lead_status_filter_invalid" });
    const sortBy = (query.sortBy ?? "createdAt") as LeadSortField;
    if (!["createdAt", "leadCode", "lastName", "status"].includes(sortBy)) throw new BadRequestException({ code: "lead_sort_invalid" });
    const sortDirection = query.sortDirection ?? "desc";
    if (sortDirection !== "asc" && sortDirection !== "desc") throw new BadRequestException({ code: "lead_sort_direction_invalid" });
    const createdFrom = this.parseBoundary(query.createdFrom, "lead_created_from_invalid");
    const createdTo = this.parseBoundary(query.createdTo, "lead_created_to_invalid");
    if (createdFrom && createdTo && createdFrom > createdTo) throw new BadRequestException({ code: "lead_date_range_invalid" });
    const search = query.search?.trim().toLocaleLowerCase("fr");
    const view = (query.view ?? "ALL").toUpperCase() as LeadWorkView;
    if (!["ALL", "MINE", "FOLLOW_UP", "UNASSIGNED", "NO_ACTIVITY", "CLOSED"].includes(view)) throw new BadRequestException({ code: "lead_view_invalid" });
    const savedView = query.savedView?.toUpperCase() as LeadSavedView | undefined;
    if (savedView && !leadSavedViews.includes(savedView)) throw new BadRequestException({ code: "lead_saved_view_invalid" });
    const now = new Date().toISOString();
    const matches = (value: string | undefined, expected: string | undefined): boolean => !expected || value?.toLocaleLowerCase("fr") === expected.trim().toLocaleLowerCase("fr");
    const filtered = [...this.leads.values()].filter((lead) => {
      const searchable = [lead.leadCode, lead.firstName, lead.lastName, lead.email, lead.phone]
        .filter((value): value is string => Boolean(value)).map((value) => value.toLocaleLowerCase("fr"));
      return (!search || searchable.some((value) => value.includes(search)))
        && this.matchesView(lead, view, principal, now)
        && this.matchesSavedView(lead, savedView)
        && (!query.assignedToId || lead.assignedToId === query.assignedToId)
        && (!status || lead.status === status)
        && matches(lead.source, query.source) && matches(lead.program, query.program)
        && matches(lead.campaign, query.campaign) && matches(lead.campus, query.campus)
        && matches(lead.assignmentMode, query.assignmentMode) && matches(lead.importBatchId, query.importBatchId)
        && (!createdFrom || lead.createdAt >= createdFrom) && (!createdTo || lead.createdAt <= createdTo);
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    const ordered = filtered.sort((left, right) => view === "FOLLOW_UP"
      ? (left.nextActionAt ?? "").localeCompare(right.nextActionAt ?? "") || left.leadCode.localeCompare(right.leadCode, "fr")
      : direction * left[sortBy].localeCompare(right[sortBy], "fr") || left.leadCode.localeCompare(right.leadCode, "fr"));
    const items = ordered.slice((page - 1) * pageSize, page * pageSize).map((lead) => this.visibleLead(lead, principal));
    this.audit.record({ eventType: "LEADS_LISTED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { page, pageSize, resultCount: items.length, filterCount: Object.values(query).filter((value) => value !== undefined).length - 2,
        sortBy, sortDirection }, result: "SUCCESS", idempotencyKey: `leads-listed:${randomUUID()}` });
    return { items, page, pageSize, total: ordered.length };
  }

  private matchesView(lead: Readonly<LeadRecord>, view: LeadWorkView, principal: Principal, now: string): boolean {
    if (view === "MINE") return lead.assignedToId === principal.userId || Boolean(lead.collaboratorIds?.includes(principal.userId));
    if (view === "FOLLOW_UP") return Boolean(lead.nextActionAt && lead.nextActionAt <= now && lead.status !== "ENROLLED" && lead.status !== "CLOSED_LOST");
    if (view === "UNASSIGNED") return !lead.assignedToId;
    if (view === "NO_ACTIVITY") return !lead.lastActivityAt;
    if (view === "CLOSED") return lead.status === "ENROLLED" || lead.status === "CLOSED_LOST";
    return true;
  }

  private matchesSavedView(lead: Readonly<LeadRecord>, savedView: LeadSavedView | undefined): boolean {
    if (!savedView) return true;
    if (savedView === "IMPORT_ERRORS") return false;
    if (savedView === "INCOMPLETE") return [lead.campus, lead.campaign, lead.educationLevel, lead.program]
      .some((value) => value.toLocaleLowerCase("fr").includes("compléter"));
    if (savedView === "UNCLASSIFIED_SOURCES") return lead.source.trim().length === 0 || lead.source === "UNKNOWN";
    const sources: Readonly<Record<Exclude<LeadSavedView, "IMPORT_ERRORS" | "INCOMPLETE" | "UNCLASSIFIED_SOURCES">, string>> = {
      FORMINATOR_ZAPIER: "FORMINATOR_ZAPIER", YNOV_MA_LEGACY: "LEGACY_IMPORT", YNOV_COM: "YNOV_COM",
      PHONE_CALLS: "PHONE_CALL", PHYSICAL_VISITS: "PHYSICAL_VISIT", JOBINTECH: "JOBINTECH", LEGACY_RELAUNCH: "LEGACY_RELAUNCH",
    };
    return lead.source === sources[savedView];
  }

  private parseBoundary(value: string | undefined, errorCode: string): string | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) throw new BadRequestException({ code: errorCode });
    return parsed.toISOString();
  }

  getLead(leadId: string, principal: Principal, correlationId: string): LeadRecord {
    this.assertReadRole(principal);
    const lead = this.leads.get(leadId);
    if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    this.audit.record({ eventType: "LEAD_VIEWED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { leadId }, result: "SUCCESS", idempotencyKey: `lead-viewed:${randomUUID()}` });
    return this.visibleLead(lead, principal);
  }

  findLocalLead(leadId: string): LeadRecord | undefined {
    const lead = this.leads.get(leadId);
    return lead ? { ...lead } : undefined;
  }

  findIdentityMatches(email?: string, phone?: string): { emailLeadId?: string; phoneLeadId?: string } {
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone?.replace(/[^+\d]/g, "");
    const emailLeadId = normalizedEmail ? [...this.leads.values()].find((lead) => lead.email === normalizedEmail)?.id : undefined;
    const phoneLeadId = normalizedPhone ? [...this.leads.values()].find((lead) => lead.phone === normalizedPhone)?.id : undefined;
    return { ...(emailLeadId ? { emailLeadId } : {}), ...(phoneLeadId ? { phoneLeadId } : {}) };
  }

  findIdentityCandidates(email?: string, phone?: string): Array<{ leadId: string; leadCode: string; matchedBy: Array<"EMAIL" | "PHONE"> }> {
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone?.replace(/[^+\d]/g, "");
    return [...this.leads.values()].flatMap((lead) => {
      const matchedBy: Array<"EMAIL" | "PHONE"> = [];
      if (normalizedEmail && lead.email === normalizedEmail) matchedBy.push("EMAIL");
      if (normalizedPhone && lead.phone === normalizedPhone) matchedBy.push("PHONE");
      return matchedBy.length ? [{ leadId: lead.id, leadCode: lead.leadCode, matchedBy }] : [];
    }).sort((left, right) => left.leadCode.localeCompare(right.leadCode, "fr"));
  }

  appendIngestionActivity(leadId: string, input: { type: "LEGACY_IMPORT" | "PROVENANCE_ATTACHED" | "CRM_CALL" | "EXTERNAL_CALL" | "MEETING"; result: string; occurredAt?: string }, principal: Principal, correlationId: string): LeadActivityRecord {
    const lead = this.leads.get(leadId);
    if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.valueOf())) throw new BadRequestException({ code: "ingestion_activity_date_invalid" });
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId, type: input.type,
      result: input.result, authorId: principal.userId, correlationId, occurredAt: occurredAt.toISOString() });
    this.activities = [...this.activities, activity];
    this.leads.set(leadId, Object.freeze({ ...lead, lastActivityAt: activity.occurredAt }));
    this.audit.record({ eventType: input.type, actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { leadId, activityId: activity.id, historical: true, type: input.type },
      result: "SUCCESS", idempotencyKey: `ingestion-activity:${activity.id}` });
    return { ...activity };
  }

  assignmentSnapshot(principal: Principal, now = new Date()): LeadAssignmentSnapshot {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "assignment_manager_required" });
    const leads = [...this.leads.values()];
    const counts = new Map<string, number>();
    for (const lead of leads) if (lead.assignedToId) counts.set(lead.assignedToId, (counts.get(lead.assignedToId) ?? 0) + 1);
    return {
      total: leads.length,
      assigned: leads.filter((lead) => Boolean(lead.assignedToId)).length,
      unassigned: leads.filter((lead) => !lead.assignedToId).length,
      followUpDue: leads.filter((lead) => lead.nextActionAt && lead.nextActionAt <= now.toISOString()).length,
      byAdviser: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([userId, leadCount]) => ({ userId, leadCount })),
    };
  }

  reportingSnapshot(principal: Principal): LeadReportingRow[] {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) {
      throw new ForbiddenException({ code: "reporting_manager_required" });
    }
    const global = principal.scopes.some((scope) => scope.kind === "GLOBAL");
    const campuses = new Set(principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []));
    return [...this.leads.values()]
      .filter((lead) => global || campuses.has(lead.campus))
      .map(({ id, status, campus, campaign, program, source, createdAt }) => ({ id, status, campus, campaign, program, source, createdAt }));
  }

  assignLocalLead(leadId: string, assignedToId: string, principal: Principal, correlationId: string, reason: string, assignmentMode = "MANUAL_FIXED"): LeadRecord {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "assignment_role_forbidden" });
    const current = this.leads.get(leadId);
    if (!current) throw new NotFoundException({ code: "lead_not_found" });
    if (current.assignedToId) throw new ConflictException({ code: "lead_already_assigned", nextAction: "CRMY-94" });
    const occurredAt = new Date().toISOString();
    const updated: Readonly<LeadRecord> = Object.freeze({ ...current, assignedToId, assignmentMode, lastActivityAt: occurredAt });
    this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({
      id: randomUUID(), leadId, type: "ASSIGNMENT_CHANGED", result: assignedToId,
      note: reason, authorId: principal.userId, correlationId, occurredAt,
    });
    this.activities = [...this.activities, activity];
    this.audit.record({ eventType: "LEAD_ASSIGNED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, before: { leadId, assignedToId: current.assignedToId },
      after: { leadId, assignedToId, reason }, result: "SUCCESS", idempotencyKey: `lead-assigned:${leadId}:${correlationId}` });
    return { ...updated };
  }

  reassignLocalLead(leadId: string, expectedOwnerId: string, targetUserId: string, principal: Principal, correlationId: string, reason: string): LeadRecord {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "reassignment_approval_role_required" });
    const current = this.leads.get(leadId);
    if (!current) throw new NotFoundException({ code: "lead_not_found" });
    if (current.assignedToId !== expectedOwnerId) throw new ConflictException({ code: "reassignment_owner_changed" });
    if (targetUserId === expectedOwnerId) throw new BadRequestException({ code: "reassignment_target_unchanged" });
    const occurredAt = new Date().toISOString();
    const updated: Readonly<LeadRecord> = Object.freeze({ ...current, assignedToId: targetUserId, assignmentMode: "REASSIGNMENT", lastActivityAt: occurredAt });
    this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId, type: "ASSIGNMENT_CHANGED",
      result: `${expectedOwnerId}->${targetUserId}`, note: reason, authorId: principal.userId, correlationId, occurredAt });
    this.activities = [...this.activities, activity];
    this.audit.record({ eventType: "LEAD_REASSIGNED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, before: { leadId, assignedToId: expectedOwnerId }, after: { leadId, assignedToId: targetUserId, reason },
      result: "SUCCESS", idempotencyKey: `lead-reassigned:${leadId}:${correlationId}` });
    return { ...updated };
  }

  private assertReadRole(principal: Principal): void {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN" || role === "AUDITOR")) throw new ForbiddenException({ code: "role_forbidden" });
  }

  private visibleLead(lead: Readonly<LeadRecord>, principal: Principal): LeadRecord {
    if (!principal.roles.includes("AUDITOR") || principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN" || role === "ADMISSIONS")) return { ...lead };
    return { ...lead, email: "***", phone: "***" };
  }

  addActivity(leadId: string, input: { type: string; result: string; note?: string; nextActionAt?: string }, principal: Principal, correlationId: string): LeadActivityRecord {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "role_forbidden" });
    const lead = this.leads.get(leadId);
    if (!lead) throw new NotFoundException({ code: "lead_not_found" });
    if (!activityTypes.includes(input.type as ActivityType) || !input.result?.trim()) throw new BadRequestException({ code: "activity_invalid" });
    const nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : undefined;
    if (nextActionAt && Number.isNaN(nextActionAt.valueOf())) throw new BadRequestException({ code: "next_action_invalid" });
    const activity: LeadActivityRecord = Object.freeze({
      id: randomUUID(), leadId, type: input.type as ActivityType, result: input.result.trim(),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}), authorId: principal.userId,
      ...(nextActionAt ? { nextActionAt: nextActionAt.toISOString() } : {}), correlationId, occurredAt: new Date().toISOString(),
    });
    this.activities = [...this.activities, activity];
    this.leads.set(leadId, Object.freeze({ ...lead, lastActivityAt: activity.occurredAt, ...(activity.nextActionAt ? { nextActionAt: activity.nextActionAt } : {}) }));
    this.audit.record({ eventType: "LEAD_ACTIVITY_ADDED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { leadId, activityId: activity.id, type: activity.type }, result: "SUCCESS",
      idempotencyKey: `lead-activity:${activity.id}` });
    return { ...activity };
  }

  correctActivity(leadId: string, originalEventId: string, input: InteractionCorrectionInput, principal: Principal, correlationId: string): LeadActivityRecord {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "interaction_correction_forbidden" });
    const lead = this.leads.get(leadId);
    if (!lead || !principal.scopes.some((scope) => scope.kind === "GLOBAL" || (scope.kind === "CAMPUS" && scope.id === lead.campus))) throw new NotFoundException({ code: "lead_not_found" });
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new BadRequestException({ code: "interaction_correction_idempotency_invalid" });
    const receipt = this.correctionReceipts.get(input.idempotencyKey);
    if (receipt) {
      if (receipt.correction?.originalEventId !== originalEventId || receipt.leadId !== leadId) throw new ConflictException({ code: "interaction_correction_idempotency_conflict" });
      return structuredClone(receipt);
    }
    const original = this.activities.find((activity) => activity.id === originalEventId && activity.leadId === leadId);
    if (!original || original.type === "CORRECTION") throw new NotFoundException({ code: "interaction_not_found" });
    const existing = this.activities.filter((activity) => activity.correction?.originalEventId === originalEventId);
    if (input.expectedCorrectionCount !== existing.length || existing.some((activity) => activity.correction?.operation === "CANCEL")) throw new ConflictException({ code: "interaction_correction_concurrent" });
    if (existing.length > 0) throw new ConflictException({ code: "interaction_already_corrected" });
    if (!correctionReasonCodes.includes(input.reasonCode as CorrectionReasonCode)) throw new BadRequestException({ code: "interaction_correction_reason_invalid" });
    if (input.operation !== "CORRECT" && input.operation !== "CANCEL") throw new BadRequestException({ code: "interaction_correction_operation_invalid" });
    if ((input.operation === "CORRECT") !== Boolean(input.replacement)) throw new BadRequestException({ code: "interaction_correction_replacement_invalid" });

    const previous = this.expurgatedSnapshot(original);
    const replacement = input.replacement ? this.validateCorrectionReplacement(input.replacement) : undefined;
    const occurredAt = new Date().toISOString();
    const correction: ActivityCorrection = Object.freeze({
      originalEventId, operation: input.operation, reasonCode: input.reasonCode as CorrectionReasonCode,
      previous, ...(replacement ? { replacement } : {}),
    });
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId, type: "CORRECTION",
      result: input.operation, authorId: principal.userId, correlationId, occurredAt, correction });
    this.activities = [...this.activities, activity];
    this.correctionReceipts.set(input.idempotencyKey, activity);
    this.audit.record({ eventType: "LEAD_ACTIVITY_COMPENSATED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, before: { leadId, activityId: originalEventId, type: previous.type },
      after: { leadId, correctionId: activity.id, operation: input.operation, reasonCode: input.reasonCode, replacementType: replacement?.type },
      result: "SUCCESS", idempotencyKey: `lead-activity-correction:${input.idempotencyKey}` });
    return structuredClone(activity);
  }

  private expurgatedSnapshot(activity: Readonly<LeadActivityRecord>): ExpurgatedActivitySnapshot {
    const result = /^[A-Z][A-Z0-9_]{1,63}$/.test(activity.result) ? activity.result : "[redacted]";
    return Object.freeze({ type: activity.type, result, noteState: activity.note ? "REDACTED" : "ABSENT", ...(activity.nextActionAt ? { nextActionAt: activity.nextActionAt } : {}) });
  }

  private validateCorrectionReplacement(input: { type: string; result: string; nextActionAt?: string }): ExpurgatedActivitySnapshot {
    if (!activityTypes.includes(input.type as ActivityType) || input.type === "CORRECTION" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(input.result)) throw new BadRequestException({ code: "interaction_correction_value_invalid" });
    const nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : undefined;
    if (nextActionAt && Number.isNaN(nextActionAt.valueOf())) throw new BadRequestException({ code: "interaction_correction_next_action_invalid" });
    return Object.freeze({ type: input.type as ActivityType, result: input.result, noteState: "ABSENT", ...(nextActionAt ? { nextActionAt: nextActionAt.toISOString() } : {}) });
  }

  changeStatus(leadId: string, input: { status: string; reason?: string }, principal: Principal, correlationId: string): LeadRecord {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "role_forbidden" });
    const current = this.leads.get(leadId);
    if (!current) throw new NotFoundException({ code: "lead_not_found" });
    if (!leadStatuses.includes(input.status as LeadStatus)) throw new BadRequestException({ code: "lead_status_invalid" });
    const status = input.status as LeadStatus;
    if (!allowedTransitions[current.status].includes(status)) throw new BadRequestException({ code: "lead_status_transition_forbidden" });
    const terminal = status === "ENROLLED" || status === "CLOSED_LOST";
    if (terminal && !principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "lead_closure_approval_required" });
    const reason = input.reason?.trim();
    if (terminal && !reason) throw new BadRequestException({ code: "lead_closure_reason_required" });
    const occurredAt = new Date().toISOString();
    const updated: Readonly<LeadRecord> = Object.freeze({ ...current, status, lastActivityAt: occurredAt });
    this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({
      id: randomUUID(), leadId, type: "STATUS_CHANGED", result: `${current.status}->${status}`,
      ...(reason ? { note: reason } : {}), authorId: principal.userId, correlationId, occurredAt,
    });
    this.activities = [...this.activities, activity];
    this.audit.record({ eventType: "LEAD_STATUS_CHANGED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, before: { leadId, status: current.status }, after: { leadId, status },
      result: "SUCCESS", idempotencyKey: `lead-status:${activity.id}` });
    return { ...updated };
  }

  recordFollowUp(leadId: string, nextActionAt: string | undefined, principal: Principal, correlationId: string, result: string): LeadRecord {
    const current = this.leads.get(leadId); if (!current) throw new NotFoundException({ code: "lead_not_found" });
    const withoutNextAction: LeadRecord = { ...current }; delete withoutNextAction.nextActionAt; const occurredAt = new Date().toISOString();
    const updated: Readonly<LeadRecord> = Object.freeze(nextActionAt ? { ...current, nextActionAt, lastActivityAt: occurredAt } : { ...withoutNextAction, lastActivityAt: occurredAt }); this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId, type: "COMMENT", result, authorId: principal.userId, correlationId, occurredAt, ...(nextActionAt ? { nextActionAt } : {}) }); this.activities = [...this.activities, activity];
    return { ...updated };
  }

  applyCollaborator(leadId: string, targetUserId: string, action: "ADD" | "REMOVE", role: string, principal: Principal, correlationId: string): LeadRecord {
    if (!principal.roles.some((item) => item === "MANAGER" || item === "ADMIN" || item === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "collaboration_approval_forbidden" }); }
    const current = this.leads.get(leadId); if (!current) { throw new NotFoundException({ code: "lead_not_found" }); }
    if (current.assignedToId === targetUserId) { throw new BadRequestException({ code: "primary_assignee_protected" }); }
    const collaborators = new Set(current.collaboratorIds ?? []); const present = collaborators.has(targetUserId);
    if ((action === "ADD" && present) || (action === "REMOVE" && !present)) { throw new ConflictException({ code: "collaboration_state_conflict" }); }
    if (action === "ADD") collaborators.add(targetUserId); else collaborators.delete(targetUserId);
    const occurredAt = new Date().toISOString(); const updated: Readonly<LeadRecord> = Object.freeze({ ...current, collaboratorIds: [...collaborators].sort((a, b) => a.localeCompare(b)), lastActivityAt: occurredAt }); this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId, type: "COMMENT", result: `COLLABORATOR_${action}:${role}`, authorId: principal.userId, correlationId, occurredAt }); this.activities = [...this.activities, activity];
    return { ...updated, collaboratorIds: [...(updated.collaboratorIds ?? [])] };
  }

  timeline(leadId: string, principal: Principal): LeadActivityRecord[] {
    if (!this.leads.has(leadId)) throw new NotFoundException({ code: "lead_not_found" });
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN" || role === "AUDITOR")) throw new ForbiddenException({ code: "role_forbidden" });
    return this.activities.filter((item) => item.leadId === leadId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)).map((item) => structuredClone(item));
  }
}
