import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService } from "../leads/lead.service.js";
import { LeadWorkflowPersistenceRepository } from "../leads/lead-workflow-persistence.repository.js";
import { NotificationService } from "../notifications/notification.service.js";

export type CollaborationAction = "ADD" | "REMOVE";
export type CollaborationRole = "ADVISER" | "ADMISSIONS_SUPPORT" | "ENROLLMENT_CONTRIBUTOR";
export type CollaborationState = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export interface CollaborationRequest { id: string; leadId: string; targetUserId: string; action: CollaborationAction; role: CollaborationRole; justification: string; requesterId: string; state: CollaborationState; version: number; createdAt: string; decidedAt?: string; decidedBy?: string; decisionReason?: string }

@Injectable()
export class LeadCollaborationService implements OnModuleInit {
  private readonly requests = new Map<string, Readonly<CollaborationRequest>>();
  constructor(
    private readonly leads: LeadService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    @Optional() @Inject(LeadWorkflowPersistenceRepository) private readonly persistence?: LeadWorkflowPersistenceRepository,
  ) {}

  async onModuleInit(): Promise<void> { await this.refreshPersistentState(); }
  persistenceEnabled(): boolean { return this.persistence?.enabled === true; }

  async requestForApi(leadId: string, input: { targetUserId?: string; action?: string; role?: string; justification?: string }, principal: Principal, correlationId: string): Promise<CollaborationRequest> {
    if (!this.persistence?.enabled) return this.request(leadId, input, principal, correlationId);
    await this.refreshPersistentState();
    const record = await this.leads.persistWorkflowMutationForApi(
      leadId, `collaboration-request:${leadId}:${correlationId}`, "COLLABORATION_REQUEST", input,
      () => this.request(leadId, input, principal, correlationId),
    );
    const stored = await this.persistence.saveCollaboration(record);
    await this.refreshPersistentState(); return stored;
  }

  async decideForApi(id: string, input: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): Promise<CollaborationRequest> {
    if (!this.persistence?.enabled) return this.decide(id, input, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.requests.get(id); if (!current) throw new NotFoundException({ code: "collaboration_request_not_found" });
    const leadBefore = await this.leads.findLocalLeadForApi(current.leadId);
    const updated = await this.leads.persistWorkflowMutationForApi(
      current.leadId, `collaboration-decision:${id}:${input.expectedVersion ?? "missing"}`, "COLLABORATION_DECISION", input,
      () => this.decide(id, input, principal, correlationId),
    );
    const stored = await this.persistence.saveCollaboration(updated, current.version);
    if (updated.state === "APPROVED" && leadBefore) {
      const collaborators = new Set(leadBefore.collaboratorIds ?? []);
      if (updated.action === "ADD") collaborators.add(updated.targetUserId); else collaborators.delete(updated.targetUserId);
      await this.leads.persistCollaboratorSnapshotForApi(updated.leadId, [...collaborators].sort());
    }
    await this.refreshPersistentState(); return stored;
  }

  async listForApi(principal: Principal): Promise<CollaborationRequest[]> { await this.refreshPersistentState(); return this.list(principal); }

  request(leadId: string, input: { targetUserId?: string; action?: string; role?: string; justification?: string }, principal: Principal, correlationId: string): CollaborationRequest {
    const lead = this.leads.getLead(leadId, principal, correlationId);
    if (lead.assignedToId !== principal.userId && !principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "collaboration_request_forbidden" }); }
    const action = input.action as CollaborationAction; const role = input.role as CollaborationRole; const targetUserId = input.targetUserId?.trim(); const justification = input.justification?.trim();
    if (!["ADD", "REMOVE"].includes(action) || !["ADVISER", "ADMISSIONS_SUPPORT", "ENROLLMENT_CONTRIBUTOR"].includes(role) || !targetUserId || !justification || justification.length > 500) { throw new BadRequestException({ code: "collaboration_request_invalid" }); }
    if (targetUserId === lead.assignedToId) { throw new BadRequestException({ code: "primary_assignee_protected" }); }
    const present = lead.collaboratorIds?.includes(targetUserId) ?? false;
    if ((action === "ADD" && present) || (action === "REMOVE" && !present)) { throw new ConflictException({ code: "collaboration_state_conflict" }); }
    if ([...this.requests.values()].some((item) => item.leadId === leadId && item.targetUserId === targetUserId && item.state === "PENDING")) { throw new ConflictException({ code: "collaboration_pending" }); }
    const record: Readonly<CollaborationRequest> = Object.freeze({ id: randomUUID(), leadId, targetUserId, action, role, justification, requesterId: principal.userId, state: "PENDING", version: 1, createdAt: new Date().toISOString() });
    this.requests.set(record.id, record); this.notifications.create({ recipientId: "manager-queue", type: "COLLABORATOR_REQUEST", priority: "NORMAL", resourceType: "LEAD", resourceId: leadId, href: `/leads/${leadId}/collaborators` }, `collaboration-request:${record.id}`); this.record(record, principal, correlationId, "COLLABORATION_REQUESTED"); return { ...record };
  }

  decide(id: string, input: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, principal: Principal, correlationId: string): CollaborationRequest {
    const current = this.requests.get(id);
    if (!current) { throw new NotFoundException({ code: "collaboration_request_not_found" }); }
    if (current.requesterId === principal.userId) { throw new ForbiddenException({ code: "collaboration_self_approval_forbidden" }); }
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) { throw new ForbiddenException({ code: "collaboration_approval_forbidden" }); }
    if (current.state !== "PENDING" || current.version !== input.expectedVersion) { throw new ConflictException({ code: "collaboration_concurrent_decision" }); }
    const reason = input.reason?.trim(); if (!input.decision || !reason) { throw new BadRequestException({ code: "collaboration_decision_invalid" }); }
    if (input.decision === "APPROVE") { this.leads.applyCollaborator(current.leadId, current.targetUserId, current.action, current.role, principal, correlationId); }
    const updated: Readonly<CollaborationRequest> = Object.freeze({ ...current, state: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", version: current.version + 1, decidedAt: new Date().toISOString(), decidedBy: principal.userId, decisionReason: reason });
    this.requests.set(id, updated); this.notifications.create({ recipientId: current.requesterId, type: "COLLABORATOR_REQUEST", priority: "NORMAL", resourceType: "LEAD", resourceId: current.leadId, href: `/leads/${current.leadId}/collaborators` }, `collaboration-decision:${id}:requester`); if (updated.state === "APPROVED") { this.notifications.create({ recipientId: current.targetUserId, type: "COLLABORATOR_REQUEST", priority: "NORMAL", resourceType: "LEAD", resourceId: current.leadId, href: `/leads/${current.leadId}` }, `collaboration-decision:${id}:target`); } this.record(updated, principal, correlationId, `COLLABORATION_${updated.state}`); return { ...updated };
  }

  list(principal: Principal): CollaborationRequest[] { const manager = principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN"); return [...this.requests.values()].filter((item) => manager || item.requesterId === principal.userId || item.targetUserId === principal.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((item) => ({ ...item })); }
  private record(item: Readonly<CollaborationRequest>, principal: Principal, correlationId: string, eventType: string): void { this.audit.record({ eventType, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { requestId: item.id, leadId: item.leadId, targetUserId: item.targetUserId, action: item.action, role: item.role, state: item.state, version: item.version }, result: "SUCCESS", idempotencyKey: `${eventType}:${item.id}:${item.version}` }); }
  private async refreshPersistentState(): Promise<void> { if (!this.persistence?.enabled) return; const snapshot = await this.persistence.snapshot(); this.requests.clear(); for (const item of snapshot.collaborations) this.requests.set(item.id, Object.freeze({ ...item })); }
}
