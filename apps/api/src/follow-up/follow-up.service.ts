import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService } from "../leads/lead.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { FollowUpPersistenceRepository } from "./follow-up-persistence.repository.js";
import { hasPilotageReportingScope } from "../reporting/reporting-authority.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { LeadActivityRecord } from "../leads/lead.service.js";
import { strictBody } from "../references/reference.contract.js";
import { assertConfirmedNextAction, assertFutureNextAction, parseNextActionIntent } from "./next-action.contract.js";

export type FollowUpState = "SCHEDULED" | "DUE" | "COMPLETED" | "CANCELLED";
export interface FollowUpRecord { id: string; leadId: string; ownerId: string; dueAt: string; state: FollowUpState; reason: string; version: number; createdAt: string; updatedAt: string }
export interface ManualInteractionInput { type: string; result: string; note?: string; nextActionAt?: string; nextAction?: unknown; idempotencyKey?: string }
type FollowUpDecisionAction = "POSTPONE" | "COMPLETE" | "CANCEL";
export type FollowUpDecisionInput = { action?: FollowUpDecisionAction; dueAt?: string; reason?: string; expectedVersion?: number; idempotencyKey?: string; nextAction?: unknown };
type ValidatedFollowUpDecision = Readonly<{ action: FollowUpDecisionAction; reason: string; due?: Date }>;
const followUpDecisionStates: Readonly<Record<FollowUpDecisionAction, FollowUpState>> = {
  POSTPONE: "SCHEDULED",
  COMPLETE: "COMPLETED",
  CANCEL: "CANCELLED",
};

@Injectable()
export class FollowUpService implements OnModuleInit {
  private readonly items = new Map<string, Readonly<FollowUpRecord>>();
  private readonly interactionReceipts = new Map<string, { fingerprint: string; result: LeadActivityRecord }>();
  private readonly interactionLocks = new Set<string>();
  private readonly completionReceipts = new Map<string, { fingerprint: string; result: FollowUpRecord }>();
  constructor(
    @Inject(LeadService) private readonly leads: LeadService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(FollowUpPersistenceRepository) private readonly persistence?: FollowUpPersistenceRepository,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  /** Only the human timeline command uses this obligation. SDK/import events
   * keep their original append path and are never discarded for missing plans. */
  async addManualActivityForApi(leadId: string, input: ManualInteractionInput, principal: Principal, correlationId: string): Promise<LeadActivityRecord> {
    strictBody(input, ["type", "result", "note", "nextAction", "nextActionAt", "idempotencyKey"]);
    if (!input.idempotencyKey || !/^[A-Za-z0-9:_-]{8,64}$/.test(input.idempotencyKey)) throw new BadRequestException({ code: "lead_action_idempotency_invalid" });
    const rawKey = input.idempotencyKey;
    const key = `commercial-interaction:${leadId}:${rawKey}`;
    const fingerprint = JSON.stringify({ actorId: principal.userId, input });
    const durable = this.persistence?.enabled === true;
    if (durable && !this.prisma?.client) throw new Error("commercial_interaction_transaction_unavailable");
    const perform = async (): Promise<LeadActivityRecord> => {
      const receipt = durable ? await this.prisma!.client!.leadMutationReceipt.findUnique({ where: { idempotencyKey: key } }) : this.interactionReceipts.get(key);
      if (receipt) {
        const expected = durable ? this.persistence.fingerprint(fingerprint) : fingerprint;
        if (receipt.fingerprint !== expected) throw new ConflictException({ code: "lead_idempotency_conflict" });
        return structuredClone(receipt.result) as unknown as LeadActivityRecord;
      }
      const lead = await this.leads.getLeadForApi(leadId, principal, correlationId);
      const open = !["ENROLLED", "CLOSED_LOST"].includes(lead.status);
      if (open && !input.nextAction) throw new BadRequestException({ code: "next_action_required" });
      if (!open && (input.nextAction || input.nextActionAt)) throw new BadRequestException({ code: "next_action_closed_lead" });
      const intent = input.nextAction ? parseNextActionIntent(input.nextAction) : undefined;
      if (input.nextActionAt && input.nextActionAt !== intent?.dueAt) throw new BadRequestException({ code: "next_action_intent_invalid" });
      await this.refreshPersistentState();
      if (intent) {
        assertFutureNextAction(intent, new Date());
        if (lead.assignedToId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
        if (intent.mode === "CONFIRM") assertConfirmedNextAction(intent, this.items.get(intent.id), leadId, new Date());
      }
      // Validate the same scheduling command before appending anything in the
      // in-memory fixture adapter. Persistent mode also rechecks inside its tx.
      const ownerId = lead.assignedToId ?? principal.userId;
      const prepared = intent?.mode === "SCHEDULE" ? this.buildSchedule(leadId, { ...intent, ownerId }, lead.assignedToId, principal) : undefined;
      const result = await this.leads.addActivityForApi(leadId, {
        type: input.type, result: input.result, ...(input.note !== undefined ? { note: input.note } : {}),
        ...(intent ? { nextActionAt: intent.dueAt } : {}), idempotencyKey: rawKey,
      }, principal, correlationId);
      if (intent?.mode === "SCHEDULE") {
        if (durable) await this.scheduleForApi(leadId, { dueAt: intent.dueAt, reason: intent.reason, ownerId, idempotencyKey: rawKey }, principal, correlationId);
        else if (prepared) {
          this.items.set(prepared.id, prepared);
          this.leads.recordFollowUp(leadId, prepared.dueAt, principal, correlationId, "FOLLOW_UP_SCHEDULED");
          this.recordAudit(prepared, principal, correlationId, "FOLLOW_UP_SCHEDULED");
        }
      }
      if (durable) await this.prisma!.client!.leadMutationReceipt.create({ data: {
        leadId, idempotencyKey: key, operation: "COMMERCIAL_INTERACTION", fingerprint: this.persistence.fingerprint(fingerprint),
        result: result as unknown as import("@prisma/client").Prisma.InputJsonValue,
      } });
      else this.interactionReceipts.set(key, { fingerprint, result: structuredClone(result) });
      return result;
    };
    if (!durable) {
      if (this.interactionLocks.has(leadId)) throw new ConflictException({ code: "lead_concurrent_mutation" });
      this.interactionLocks.add(leadId);
      try { return await perform(); } finally { this.interactionLocks.delete(leadId); }
    }
    return this.prisma!.client!.$transaction(tx => this.prisma!.withTransaction(tx, perform), { isolationLevel: "Serializable" });
  }

  async onModuleInit(): Promise<void> {
    await this.refreshPersistentState();
  }

  async refreshReportingForApi(): Promise<void> { await this.refreshPersistentState(); }

  async scheduleForApi(
    leadId: string,
    input: { dueAt?: string; reason?: string; ownerId?: string; idempotencyKey?: string },
    principal: Principal,
    correlationId: string,
  ): Promise<FollowUpRecord> {
    if (!this.persistence?.enabled) return this.schedule(leadId, input, principal, correlationId);
    await this.refreshPersistentState();
    const lead = await this.leads.getLeadForApi(leadId, principal, correlationId);
    if (["ENROLLED", "CLOSED_LOST"].includes(lead.status)) throw new BadRequestException({ code: "next_action_closed_lead" });
    const due = new Date(input.dueAt ?? ""); const reason = input.reason?.trim(); const ownerId = input.ownerId ?? lead.assignedToId;
    if (Number.isNaN(due.valueOf()) || due <= new Date() || !reason || !ownerId) throw new BadRequestException({ code: "follow_up_invalid" });
    if (lead.assignedToId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
    const idempotencyKey = this.mutationKey("schedule", leadId, input.idempotencyKey ?? (correlationId === "missing-correlation" ? randomUUID() : correlationId));
    const fingerprint = this.persistence.fingerprint({ leadId, dueAt: due.toISOString(), reason, ownerId });
    const replay = await this.persistence.findReplay(idempotencyKey, fingerprint);
    if (replay) return replay;
    const record = this.buildSchedule(leadId, { dueAt: due.toISOString(), reason, ownerId }, lead.assignedToId, principal);
    const stored = await this.persistence.schedule(record, {
      idempotencyKey, fingerprint, principal, correlationId, expectedLeadVersion: lead.version ?? 1,
    });
    // On failure, an ambient permission transaction may already be aborted.
    // Do not mask its conflict by querying it again; the next API call reloads.
    await this.leads.refreshReportingForApi();
    await this.refreshPersistentState();
    return stored;
  }

  schedule(leadId: string, input: { dueAt?: string; reason?: string; ownerId?: string }, principal: Principal, correlationId: string): FollowUpRecord {
    const lead = this.leads.getLead(leadId, principal, correlationId);
    if (["ENROLLED", "CLOSED_LOST"].includes(lead.status)) throw new BadRequestException({ code: "next_action_closed_lead" });
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
      this.notifications.create({ recipientId: item.ownerId, type: "FOLLOW_UP_DUE", priority: "HIGH", resourceType: "LEAD", resourceId: item.leadId, href: `/leads/${item.leadId}/follow-ups` }, `follow-up-due:${item.id}:v${updated.version}`); notifications += 1;
    }
    return { due, notifications };
  }

  async notifyDueForApi(now = new Date()): Promise<{ due: number; notifications: number }> {
    if (!this.persistence?.enabled) return this.notifyDue(now);
    const result = await this.persistence.markDue(now);
    if (result.due || result.notifications) await this.refreshPersistentState();
    return result;
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
    input: FollowUpDecisionInput,
    principal: Principal,
    correlationId: string,
  ): Promise<FollowUpRecord> {
    strictBody(input, ["action", "dueAt", "reason", "expectedVersion", "idempotencyKey", "nextAction"]);
    if (input.nextAction !== undefined && input.action !== "COMPLETE") throw new BadRequestException({ code: "next_action_intent_invalid" });
    this.validateDecision(input);
    if (input.action === "COMPLETE") return this.completeAndPlanForApi(id, input, principal, correlationId);
    return this.decideSingleForApi(id, input, principal, correlationId);
  }

  private async completeAndPlanForApi(id: string, input: FollowUpDecisionInput, principal: Principal, correlationId: string): Promise<FollowUpRecord> {
    if (!input.idempotencyKey || !/^[A-Za-z0-9:_-]{8,64}$/.test(input.idempotencyKey)) throw new BadRequestException({ code: "follow_up_idempotency_invalid" });
    const rawKey = input.idempotencyKey, key = this.mutationKey("decide", id, rawKey);
    const fingerprint = this.decisionFingerprint(id, input, principal);
    const durable = this.persistence?.enabled === true;
    if (durable && !this.prisma?.client) throw new Error("follow_up_completion_transaction_unavailable");
    const perform = async (): Promise<FollowUpRecord> => {
      const replay = durable ? await this.persistence.findReplay(key, fingerprint) : this.completionReceipts.get(key)?.result;
      if (replay) {
        if (!durable && this.completionReceipts.get(key)?.fingerprint !== fingerprint) throw new ConflictException({ code: "follow_up_idempotency_conflict" });
        return structuredClone(replay);
      }
      const plan = parseNextActionIntent(input.nextAction);
      if (plan.mode !== "SCHEDULE") throw new BadRequestException({ code: "next_action_required" });
      assertFutureNextAction(plan, new Date());
      await this.refreshPersistentState();
      const current = this.items.get(id); if (!current) throw new NotFoundException({ code: "follow_up_not_found" });
      this.assertDecisionAccess(current, principal);
      const lead = await this.leads.getLeadForApi(current.leadId, principal, correlationId);
      if (["ENROLLED", "CLOSED_LOST"].includes(lead.status)) throw new BadRequestException({ code: "next_action_closed_lead" });
      if (lead.assignedToId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
      const completed = await this.decideSingleForApi(id, input, principal, correlationId);
      await this.scheduleForApi(lead.id, { dueAt: plan.dueAt, reason: plan.reason, ownerId: lead.assignedToId ?? principal.userId, idempotencyKey: rawKey }, principal, correlationId);
      if (!durable) this.completionReceipts.set(key, { fingerprint, result: structuredClone(completed) });
      return completed;
    };
    if (!durable) return perform();
    return this.prisma!.client!.$transaction(tx => this.prisma!.withTransaction(tx, perform), { isolationLevel: "Serializable" });
  }

  private decisionFingerprint(id: string, input: FollowUpDecisionInput, principal: Principal): string {
    const payload = { id, action: input.action, dueAt: input.action === "POSTPONE" ? new Date(input.dueAt ?? "").toISOString() : undefined,
      reason: typeof input.reason === "string" ? input.reason.trim() : input.reason, expectedVersion: input.expectedVersion, ...(input.nextAction ? { nextAction: input.nextAction, actorId: principal.userId } : {}) };
    return this.persistence?.enabled ? this.persistence.fingerprint(payload) : JSON.stringify(payload);
  }

  private async decideSingleForApi(
    id: string, input: FollowUpDecisionInput, principal: Principal, correlationId: string,
  ): Promise<FollowUpRecord> {
    if (!this.persistence?.enabled) return this.decide(id, input, principal, correlationId);
    await this.refreshPersistentState();
    const current = this.items.get(id);
    if (!current) throw new NotFoundException({ code: "follow_up_not_found" });
    const { action, reason, due } = this.validateDecision(input);
    const idempotencyKey = this.mutationKey("decide", id, input.idempotencyKey ?? (correlationId === "missing-correlation" ? randomUUID() : correlationId));
    const fingerprint = this.decisionFingerprint(id, input, principal);
    const replay = await this.persistence.findReplay(idempotencyKey, fingerprint);
    if (replay) return replay;
    this.assertDecisionAccess(current, principal);
    const lead = await this.leads.getLeadForApi(current.leadId, principal, correlationId);
    this.assertDecisionVersion(current, input.expectedVersion);
    const updatedAt = new Date().toISOString();
    const next: FollowUpRecord = { ...current, state: followUpDecisionStates[action], ...(due ? { dueAt: due.toISOString() } : {}), reason, version: current.version + 1, updatedAt };
    const stored = await this.persistence.decide(current, next, `FOLLOW_UP_${action}`, {
      idempotencyKey, fingerprint, principal, correlationId, expectedLeadVersion: lead.version ?? 1,
    });
    await this.leads.refreshReportingForApi();
    await this.refreshPersistentState();
    return stored;
  }

  private validateDecision(input: FollowUpDecisionInput): ValidatedFollowUpDecision {
    const action = input.action;
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!action || !["POSTPONE", "COMPLETE", "CANCEL"].includes(action) || !reason || reason.length > 1000) throw new BadRequestException({ code: "follow_up_decision_invalid" });
    const due = action === "POSTPONE" ? new Date(input.dueAt ?? "") : undefined;
    if (due && (Number.isNaN(due.valueOf()) || due <= new Date())) throw new BadRequestException({ code: "follow_up_due_invalid" });
    return { action, reason, ...(due ? { due } : {}) };
  }

  private assertDecisionAccess(current: Readonly<FollowUpRecord>, principal: Principal): void {
    if (current.ownerId !== principal.userId && !this.isManager(principal)) throw new ForbiddenException({ code: "follow_up_forbidden" });
  }

  private assertDecisionVersion(current: Readonly<FollowUpRecord>, expectedVersion: number | undefined): void {
    const terminal = current.state === "COMPLETED" || current.state === "CANCELLED";
    if (expectedVersion !== current.version || terminal) throw new ConflictException({ code: "follow_up_concurrent" });
  }

  list(principal: Principal): FollowUpRecord[] {
    const visible = new Set(this.leads.reportingSnapshot(principal).map((lead) => lead.id));
    return [...this.items.values()].filter((item) => visible.has(item.leadId) && (item.ownerId === principal.userId || principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id)).map((item) => ({ ...item }));
  }
  reportingSnapshot(principal: Principal): FollowUpRecord[] {
    if (hasPilotageReportingScope(principal)) return [...this.items.values()].filter((item) => principal.permissionLeadIds!.has(item.leadId)).map((item) => ({ ...item }));
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
