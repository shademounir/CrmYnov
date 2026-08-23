import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";

export const activityTypes = ["CRM_CALL", "EXTERNAL_CALL", "WHATSAPP", "MANUAL_EMAIL", "MEETING", "COMMENT", "STATUS_CHANGED", "LEAD_CREATED", "ASSIGNMENT_CHANGED", "REASSIGNMENT_REQUESTED", "REASSIGNMENT_REJECTED"] as const;
export type ActivityType = (typeof activityTypes)[number];
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
  status: LeadStatus; assignedToId?: string; nextActionAt?: string; createdAt: string;
}

export interface LeadActivityRecord {
  id: string; leadId: string; type: ActivityType; result: string; note?: string; authorId: string;
  nextActionAt?: string; correlationId: string; occurredAt: string;
}

export type CreateLeadInput = Omit<LeadRecord, "id" | "leadCode" | "createdAt" | "status">;
export interface CreateLeadResult { lead: LeadRecord; duplicateCandidates: string[] }
export interface LeadPage { items: LeadRecord[]; page: number; pageSize: number; total: number }
export type LeadSortField = "createdAt" | "leadCode" | "lastName" | "status";
export interface LeadListQuery {
  page: number; pageSize: number; search?: string; assignedToId?: string; status?: string; source?: string;
  program?: string; campaign?: string; campus?: string; createdFrom?: string; createdTo?: string;
  sortBy?: string; sortDirection?: string;
}

@Injectable()
export class LeadService {
  private readonly leads = new Map<string, Readonly<LeadRecord>>();
  private activities: Readonly<LeadActivityRecord>[] = [];
  constructor(private readonly audit: AuditService) {}

  registerLocalLead(input: Omit<LeadRecord, "id" | "createdAt" | "status"> & { id?: string; status?: LeadStatus }): LeadRecord {
    const lead: LeadRecord = Object.freeze({ ...input, id: input.id ?? randomUUID(), status: input.status ?? "PROSPECT", createdAt: new Date().toISOString() });
    this.leads.set(lead.id, lead);
    return { ...lead };
  }

  createLead(input: CreateLeadInput, principal: Principal, correlationId: string): CreateLeadResult {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "role_forbidden" });
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
    this.audit.record({ eventType: "LEAD_CREATED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { leadId: lead.id, leadCode, duplicateCandidateCount: duplicateCandidates.length }, result: "SUCCESS",
      idempotencyKey: `lead-created:${lead.id}` });
    return { lead, duplicateCandidates };
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
    const matches = (value: string | undefined, expected: string | undefined): boolean => !expected || value?.toLocaleLowerCase("fr") === expected.trim().toLocaleLowerCase("fr");
    const filtered = [...this.leads.values()].filter((lead) => {
      const searchable = [lead.leadCode, lead.firstName, lead.lastName, lead.email, lead.phone]
        .filter((value): value is string => Boolean(value)).map((value) => value.toLocaleLowerCase("fr"));
      return (!search || searchable.some((value) => value.includes(search)))
        && (!query.assignedToId || lead.assignedToId === query.assignedToId)
        && (!status || lead.status === status)
        && matches(lead.source, query.source) && matches(lead.program, query.program)
        && matches(lead.campaign, query.campaign) && matches(lead.campus, query.campus)
        && (!createdFrom || lead.createdAt >= createdFrom) && (!createdTo || lead.createdAt <= createdTo);
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    const ordered = filtered.sort((left, right) => direction * left[sortBy].localeCompare(right[sortBy], "fr") || left.leadCode.localeCompare(right.leadCode, "fr"));
    const items = ordered.slice((page - 1) * pageSize, page * pageSize).map((lead) => this.visibleLead(lead, principal));
    this.audit.record({ eventType: "LEADS_LISTED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { page, pageSize, resultCount: items.length, filterCount: Object.values(query).filter((value) => value !== undefined).length - 2,
        sortBy, sortDirection }, result: "SUCCESS", idempotencyKey: `leads-listed:${randomUUID()}` });
    return { items, page, pageSize, total: ordered.length };
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

  assignLocalLead(leadId: string, assignedToId: string, principal: Principal, correlationId: string, reason: string): LeadRecord {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "assignment_role_forbidden" });
    const current = this.leads.get(leadId);
    if (!current) throw new NotFoundException({ code: "lead_not_found" });
    if (current.assignedToId) throw new ConflictException({ code: "lead_already_assigned", nextAction: "CRMY-94" });
    const updated: Readonly<LeadRecord> = Object.freeze({ ...current, assignedToId });
    this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({
      id: randomUUID(), leadId, type: "ASSIGNMENT_CHANGED", result: assignedToId,
      note: reason, authorId: principal.userId, correlationId, occurredAt: new Date().toISOString(),
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
    const updated: Readonly<LeadRecord> = Object.freeze({ ...current, assignedToId: targetUserId });
    this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({ id: randomUUID(), leadId, type: "ASSIGNMENT_CHANGED",
      result: `${expectedOwnerId}->${targetUserId}`, note: reason, authorId: principal.userId, correlationId, occurredAt: new Date().toISOString() });
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
    if (activity.nextActionAt) this.leads.set(leadId, Object.freeze({ ...lead, nextActionAt: activity.nextActionAt }));
    this.audit.record({ eventType: "LEAD_ACTIVITY_ADDED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { leadId, activityId: activity.id, type: activity.type }, result: "SUCCESS",
      idempotencyKey: `lead-activity:${activity.id}` });
    return { ...activity };
  }

  changeStatus(leadId: string, input: { status: string; reason?: string }, principal: Principal, correlationId: string): LeadRecord {
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "role_forbidden" });
    const current = this.leads.get(leadId);
    if (!current) throw new NotFoundException({ code: "lead_not_found" });
    if (!leadStatuses.includes(input.status as LeadStatus)) throw new BadRequestException({ code: "lead_status_invalid" });
    const status = input.status as LeadStatus;
    if (!allowedTransitions[current.status].includes(status)) throw new BadRequestException({ code: "lead_status_transition_forbidden" });
    const terminal = status === "ENROLLED" || status === "CLOSED_LOST";
    if (terminal && !principal.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "lead_closure_approval_required" });
    const reason = input.reason?.trim();
    if (terminal && !reason) throw new BadRequestException({ code: "lead_closure_reason_required" });
    const updated: Readonly<LeadRecord> = Object.freeze({ ...current, status });
    this.leads.set(leadId, updated);
    const activity: Readonly<LeadActivityRecord> = Object.freeze({
      id: randomUUID(), leadId, type: "STATUS_CHANGED", result: `${current.status}->${status}`,
      ...(reason ? { note: reason } : {}), authorId: principal.userId, correlationId, occurredAt: new Date().toISOString(),
    });
    this.activities = [...this.activities, activity];
    this.audit.record({ eventType: "LEAD_STATUS_CHANGED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, before: { leadId, status: current.status }, after: { leadId, status },
      result: "SUCCESS", idempotencyKey: `lead-status:${activity.id}` });
    return { ...updated };
  }

  timeline(leadId: string, principal: Principal): LeadActivityRecord[] {
    if (!this.leads.has(leadId)) throw new NotFoundException({ code: "lead_not_found" });
    if (!principal.roles.some((role) => role === "ADMISSIONS" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN" || role === "AUDITOR")) throw new ForbiddenException({ code: "role_forbidden" });
    return this.activities.filter((item) => item.leadId === leadId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)).map((item) => ({ ...item }));
  }
}
