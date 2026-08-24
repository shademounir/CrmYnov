import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService } from "../leads/lead.service.js";
import { NotificationService } from "../notifications/notification.service.js";

export type FollowUpState = "SCHEDULED" | "DUE" | "COMPLETED" | "CANCELLED";
export interface FollowUpRecord { id: string; leadId: string; ownerId: string; dueAt: string; state: FollowUpState; reason: string; version: number; createdAt: string; updatedAt: string }

@Injectable()
export class FollowUpService {
  private readonly items = new Map<string, Readonly<FollowUpRecord>>();
  constructor(private readonly leads: LeadService, private readonly notifications: NotificationService, private readonly audit: AuditService) {}

  schedule(leadId: string, input: { dueAt?: string; reason?: string; ownerId?: string }, principal: Principal, correlationId: string): FollowUpRecord {
    const lead = this.leads.getLead(leadId, principal, correlationId);
    const due = new Date(input.dueAt ?? ""); const reason = input.reason?.trim(); const ownerId = input.ownerId ?? lead.assignedToId;
    if (Number.isNaN(due.valueOf()) || due <= new Date() || !reason || !ownerId) throw new BadRequestException({ code: "follow_up_invalid" });
    if (lead.assignedToId !== principal.userId && !principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "follow_up_forbidden" });
    const duplicate = [...this.items.values()].find((item) => item.leadId === leadId && (item.state === "SCHEDULED" || item.state === "DUE"));
    if (duplicate) throw new ConflictException({ code: "follow_up_pending" });
    const now = new Date().toISOString(); const record: Readonly<FollowUpRecord> = Object.freeze({ id: randomUUID(), leadId, ownerId, dueAt: due.toISOString(), state: "SCHEDULED", reason, version: 1, createdAt: now, updatedAt: now });
    this.items.set(record.id, record); this.leads.recordFollowUp(leadId, record.dueAt, principal, correlationId, "FOLLOW_UP_SCHEDULED"); this.recordAudit(record, principal, correlationId, "FOLLOW_UP_SCHEDULED");
    return { ...record };
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
    if (input.expectedVersion !== current.version || current.state === "COMPLETED" || current.state === "CANCELLED") throw new ConflictException({ code: "follow_up_concurrent" });
    const reason = input.reason?.trim(); if (!input.action || !reason) throw new BadRequestException({ code: "follow_up_decision_invalid" });
    const due = input.action === "POSTPONE" ? new Date(input.dueAt ?? "") : undefined;
    if (due && (Number.isNaN(due.valueOf()) || due <= new Date())) throw new BadRequestException({ code: "follow_up_due_invalid" });
    const nextState: FollowUpState = input.action === "POSTPONE" ? "SCHEDULED" : input.action === "COMPLETE" ? "COMPLETED" : "CANCELLED";
    const updated: Readonly<FollowUpRecord> = Object.freeze({ ...current, state: nextState, ...(due ? { dueAt: due.toISOString() } : {}), reason, version: current.version + 1, updatedAt: new Date().toISOString() });
    this.items.set(id, updated); this.leads.recordFollowUp(current.leadId, due?.toISOString(), principal, correlationId, `FOLLOW_UP_${input.action}`); this.recordAudit(updated, principal, correlationId, `FOLLOW_UP_${input.action}`);
    return { ...updated };
  }

  list(principal: Principal): FollowUpRecord[] { return [...this.items.values()].filter((item) => item.ownerId === principal.userId || principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id)).map((item) => ({ ...item })); }
  reportingSnapshot(principal: Principal): FollowUpRecord[] {
    const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN");
    if (!manager && !principal.roles.includes("ADMISSIONS")) throw new ForbiddenException({ code: "reporting_role_required" });
    return [...this.items.values()].filter((item) => manager || item.ownerId === principal.userId)
      .map((item) => ({ ...item }));
  }
  private recordAudit(item: Readonly<FollowUpRecord>, principal: Principal, correlationId: string, eventType: string): void { this.audit.record({ eventType, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { followUpId: item.id, leadId: item.leadId, state: item.state, dueAt: item.dueAt, version: item.version }, result: "SUCCESS", idempotencyKey: `${eventType}:${item.id}:${item.version}` }); }
}
