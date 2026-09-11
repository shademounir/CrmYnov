import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService } from "../leads/lead.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { FollowUpPersistenceRepository } from "./follow-up-persistence.repository.js";

export type FollowUpState = "SCHEDULED" | "DUE" | "COMPLETED" | "CANCELLED";
export interface FollowUpRecord { id: string; leadId: string; ownerId: string; dueAt: string; state: FollowUpState; reason: string; version: number; createdAt: string; updatedAt: string }

@Injectable()
export class FollowUpService implements OnModuleInit {
  private readonly items = new Map<string, Readonly<FollowUpRecord>>();
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(FollowUpPersistenceRepository) private readonly persistence?: FollowUpPersistenceRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshPersistentState();
  }

  async scheduleForApi(
    leadId: string,
    input: { dueAt?: string; reason?: string; ownerId?: string; idempotencyKey?: string },
    principal: Principal,
    correlationId: string,
  ): Promise<FollowUpRecord> {
    if (!this.persistence?.enabled) return this.schedule(leadId, input, principal, correlationId);
    await this.refreshPersistentState();
    const lead = await this.leads.getLeadForApi(leadId, principal, correlationId);
    const due = new Date(input.dueAt ?? ""); const reason = input.reason?.trim(); const ownerId = input.ownerId ?? lead.assignedToId;
    if (Number.isNaN(due.valueOf()) || due <= new Date() || !reason || !ownerId) throw new BadRequestException({ code: "follow_up_invalid" });
    if (lead.assignedToId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
    const idempotencyKey = this.mutationKey("schedule", leadId, input.idempotencyKey ?? (correlationId === "missing-correlation" ? randomUUID() : correlationId));
    const fingerprint = this.persistence.fingerprint({ leadId, dueAt: due.toISOString(), reason, ownerId });
    const replay = await this.persistence.findReplay(idempotencyKey, fingerprint);
    if (replay) return replay;
    const record = this.buildSchedule(leadId, { dueAt: due.toISOString(), reason, ownerId }, lead.assignedToId, principal);
    try {
      const stored = await this.persistence.schedule(record, {
        idempotencyKey, fingerprint, principal, correlationId, expectedLeadVersion: lead.version ?? 1,
      });
      await this.leads.refreshReportingForApi();
      await this.refreshPersistentState();
      return stored;
    } catch (error) {
      await this.leads.refreshReportingForApi();
      await this.refreshPersistentState();
      throw error;
    }
  }

  schedule(leadId: string, input: { dueAt?: string; reason?: string; ownerId?: string }, principal: Principal, correlationId: string): FollowUpRecord {
    const lead = this.leads.getLead(leadId, principal, correlationId);
    const record = this.buildSchedule(leadId, input, lead.assignedToId, principal);
    this.items.set(record.id, record); this.leads.recordFollowUp(leadId, record.dueAt, principal, correlationId, "FOLLOW_UP_SCHEDULED"); this.recordAudit(record, principal, correlationId, "FOLLOW_UP_SCHEDULED");
    return { ...record };
  }

  /** Internal locator, followed by authorization on the current persisted lead. */
  permissionLeadId(id: string): string {
    const item = this.items.get(id);
    if (!item) throw new NotFoundException({ code: "follow_up_not_found" });
    return item.leadId;
  }

  async permissionLeadIdForApi(id: string): Promise<string> {
    await this.refreshPersistentState();
    return this.permissionLeadId(id);
  }

  async listForApi(principal: Principal): Promise<FollowUpRecord[]> {
    await this.leads.refreshReportingForApi();
    await this.refreshPersistentState();
    return this.list(principal);
  }

  notifyDue(now = new Date()): { due: number; notifications: number } {
    let due = 0; let notifications = 0;
    for (const item of this.items.values()) if (item.state === "SCHEDULED" && item.dueAt <= now.toISOString()) {
      const updated: Readonly<FollowUpRecord> = Object.freeze({ ...item, state: "DUE", version: item.version + 1, updatedAt: now.toISOString() }); this.items.set(item.id, updated); due += 1;
      this.notifications.create({ recipientId: item.ownerId, type: "FOLLOW_UP_DUE", priority: "HIGH", resourceType: "LEAD", resourceId: item.leadId, href: `/leads/${item.leadId}` }, `follow-up-due:${item.id}`); notifications += 1;
    }
    return { due, notifications };
  }

  decide(id: string, input: { action?: "POSTPONE" | "COMPLETE" | "CANCEL"; dueAt?: string; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): FollowUpRecord {
    const current = this.items.get(id); if (!current) throw new NotFoundException({ code: "follow_up_not_found" });
    if (current.ownerId !== principal.userId && !principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "follow_up_forbidden" });
    if (!this.leads.reportingSnapshot(principal).some((lead) => lead.id === current.leadId)) throw new ForbiddenException({ code: "follow_up_forbidden" });
    if (input.expectedVersion !== current.version || current.state === "COMPLETED" || current.state === "CANCELLED") throw new ConflictException({ code: "follow_up_concurrent" });
    const reason = input.reason?.trim(); if (!input.action || !reason) throw new BadRequestException({ code: "follow_up_decision_invalid" });
    const due = input.action === "POSTPONE" ? new Date(input.dueAt ?? "") : undefined;
    if (due && (Number.isNaN(due.valueOf()) || due <= new Date())) throw new BadRequestException({ code: "follow_up_due_invalid" });
    const nextState: FollowUpState = input.action === "POSTPONE" ? "SCHEDULED" : input.action === "COMPLETE" ? "COMPLETED" : "CANCELLED";
    const updated: Readonly<FollowUpRecord> = Object.freeze({ ...current, state: nextState, ...(due ? { dueAt: due.toISOString() } : {}), reason, version: current.version + 1, updatedAt: new Date().toISOString() });
    this.items.set(id, updated); this.leads.recordFollowUp(current.leadId, due?.toISOString(), principal, correlationId, `FOLLOW_UP_${input.action}`); this.recordAudit(updated, principal, correlationId, `FOLLOW_UP_${input.action}`);
    return { ...updated };
  }

  async decideForApi(
    id: string,
    input: { action?: "POSTPONE" | "COMPLETE" | "CANCEL"; dueAt?: string; reason?: string; expectedVersion?: number; idempotencyKey?: string },
    principal: Principal,
    correlationId: string,
  ): Promise<FollowUpRecord> {
    if (!this.persistence?.enabled) return this.decide(id, input, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.items.get(id);
    if (!current) throw new NotFoundException({ code: "follow_up_not_found" });
    const action = input.action;
    const reason = input.reason?.trim();
    const due = action === "POSTPONE" ? new Date(input.dueAt ?? "") : undefined;
    if (!action || !reason) throw new BadRequestException({ code: "follow_up_decision_invalid" });
    if (due && (Number.isNaN(due.valueOf()) || due <= new Date())) throw new BadRequestException({ code: "follow_up_due_invalid" });
    const idempotencyKey = this.mutationKey("decide", id, input.idempotencyKey ?? (correlationId === "missing-correlation" ? randomUUID() : correlationId));
    const fingerprint = this.persistence.fingerprint({ id, action, dueAt: due?.toISOString(), reason, expectedVersion: input.expectedVersion });
    const replay = await this.persistence.findReplay(idempotencyKey, fingerprint);
    if (replay) return replay;
    if (current.ownerId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
    const lead = await this.leads.getLeadForApi(current.leadId, principal, correlationId);
    if (input.expectedVersion !== current.version || current.state === "COMPLETED" || current.state === "CANCELLED") throw new ConflictException({ code: "follow_up_concurrent" });
    const nextState: FollowUpState = action === "POSTPONE" ? "SCHEDULED" : action === "COMPLETE" ? "COMPLETED" : "CANCELLED";
    const updatedAt = new Date().toISOString();
    const next: FollowUpRecord = { ...current, state: nextState, ...(due ? { dueAt: due.toISOString() } : {}), reason, version: current.version + 1, updatedAt };
    try {
      const stored = await this.persistence.decide(current, next, `FOLLOW_UP_${action}`, {
        idempotencyKey, fingerprint, principal, correlationId, expectedLeadVersion: lead.version ?? 1,
      });
      await this.leads.refreshReportingForApi();
      await this.refreshPersistentState();
      return stored;
    } catch (error) {
      await this.leads.refreshReportingForApi();
      await this.refreshPersistentState();
      throw error;
    }
  }

  list(principal: Principal): FollowUpRecord[] {
    const visible = new Set(this.leads.reportingSnapshot(principal).map((lead) => lead.id));
    return [...this.items.values()].filter((item) => visible.has(item.leadId) && (item.ownerId === principal.userId || principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id)).map((item) => ({ ...item }));
  }
  reportingSnapshot(principal: Principal): FollowUpRecord[] {
    const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
    if (!manager && !principal.roles.includes("ADMISSIONS")) throw new ForbiddenException({ code: "reporting_role_required" });
    return [...this.items.values()].filter((item) => manager || item.ownerId === principal.userId)
      .map((item) => ({ ...item }));
  }
  private buildSchedule(
    leadId: string,
    input: { dueAt?: string; reason?: string; ownerId?: string },
    assignedToId: string | undefined,
    principal: Principal,
  ): Readonly<FollowUpRecord> {
    const due = new Date(input.dueAt ?? ""); const reason = input.reason?.trim(); const ownerId = input.ownerId ?? assignedToId;
    if (Number.isNaN(due.valueOf()) || due <= new Date() || !reason || !ownerId) throw new BadRequestException({ code: "follow_up_invalid" });
    if (assignedToId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
    const duplicate = [...this.items.values()].find((item) => item.leadId === leadId && (item.state === "SCHEDULED" || item.state === "DUE"));
    if (duplicate) throw new ConflictException({ code: "follow_up_pending" });
    const now = new Date().toISOString();
    return Object.freeze({ id: randomUUID(), leadId, ownerId, dueAt: due.toISOString(), state: "SCHEDULED", reason, version: 1, createdAt: now, updatedAt: now });
  }
  private isManager(principal: Principal): boolean {
    return principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
  }
  private mutationKey(operation: "schedule" | "decide", targetId: string, raw: string): string {
    if (!/^[A-Za-z0-9:_-]{8,96}$/.test(raw)) throw new BadRequestException({ code: "follow_up_idempotency_invalid" });
    return `follow-up:${operation}:${targetId}:${raw}`;
  }
  private async refreshPersistentState(): Promise<void> {
    if (!this.persistence?.enabled) return;
    const rows = await this.persistence.snapshot();
    this.items.clear();
    for (const item of rows) this.items.set(item.id, Object.freeze({ ...item }));
  }
  private recordAudit(item: Readonly<FollowUpRecord>, principal: Principal, correlationId: string, eventType: string): void { this.audit.record({ eventType, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { followUpId: item.id, leadId: item.leadId, state: item.state, dueAt: item.dueAt, version: item.version }, result: "SUCCESS", idempotencyKey: `${eventType}:${item.id}:${item.version}` }); }
}
