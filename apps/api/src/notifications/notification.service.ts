import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationPersistenceRepository } from "./notification-persistence.repository.js";

export const notificationTypes = ["ASSIGNMENT", "REASSIGNMENT_DECISION", "CLOSURE_REQUEST", "COLLABORATOR_REQUEST", "FOLLOW_UP_DUE", "IMPORT_REVIEW", "CHAT_MENTION", "BROADCAST", "BROADCAST_CORRECTION", "DOCUMENT_RECEIVED", "DOCUMENT_VALIDATED", "DOCUMENT_REFUSED", "APPOINTMENT"] as const;
export type NotificationType = typeof notificationTypes[number];
export type NotificationPriority = "LOW" | "NORMAL" | "HIGH";
export interface NotificationRecord { id: string; recipientId: string; type: NotificationType; priority: NotificationPriority; resourceType: "LEAD" | "IMPORT" | "CHAT" | "BROADCAST" | "DOCUMENT" | "APPOINTMENT"; resourceId: string; href: string; createdAt: string; readAt?: string }
export interface NotificationPage { items: NotificationRecord[]; page: number; pageSize: number; total: number; unread: number }

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly notifications = new Map<string, Readonly<NotificationRecord>>();
  private readonly deduplication = new Map<string, string>();
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistenceFailure: unknown;

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(NotificationPersistenceRepository) private readonly persistence?: NotificationPersistenceRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.persistence?.enabled) return;
    const snapshot = await this.persistence.snapshot();
    this.notifications.clear(); this.deduplication.clear();
    for (const item of snapshot) { this.notifications.set(item.record.id, Object.freeze({ ...item.record })); this.deduplication.set(item.deduplicationKey, item.record.id); }
  }

  async onModuleDestroy(): Promise<void> { await this.flush(); }

  create(input: Omit<NotificationRecord, "id" | "createdAt" | "readAt">, deduplicationKey: string): NotificationRecord {
    this.validate(input, deduplicationKey);
    const known = this.deduplication.get(deduplicationKey);
    if (known) return { ...this.notifications.get(known)! };
    const record: Readonly<NotificationRecord> = Object.freeze({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
    this.notifications.set(record.id, record); this.deduplication.set(deduplicationKey, record.id);
    if (this.persistence?.enabled) {
      this.persistenceQueue = this.persistenceQueue.then(async () => {
        const stored = await this.persistence!.create({ ...record }, deduplicationKey);
        this.notifications.set(stored.id, Object.freeze({ ...stored }));
        this.deduplication.set(deduplicationKey, stored.id);
      }).catch((error: unknown) => { this.persistenceFailure = error; });
    }
    return { ...record };
  }

  async flush(): Promise<void> {
    await this.persistenceQueue;
    if (this.persistenceFailure) { const failure = this.persistenceFailure; this.persistenceFailure = undefined; throw failure; }
  }

  list(principal: Principal, page: number, pageSize: number): NotificationPage {
    this.validatePagination(page, pageSize);
    const all = [...this.notifications.values()].filter((item) => item.recipientId === principal.userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return { items: all.slice((page - 1) * pageSize, page * pageSize).map((item) => ({ ...item })), page, pageSize, total: all.length, unread: all.filter((item) => !item.readAt).length };
  }

  async listForApi(principal: Principal, page: number, pageSize: number): Promise<NotificationPage> {
    this.validatePagination(page, pageSize); await this.flush();
    return this.persistence?.enabled ? this.persistence.page(principal, page, pageSize) : this.list(principal, page, pageSize);
  }

  markRead(id: string, principal: Principal, correlationId: string): NotificationRecord {
    const current = this.notifications.get(id);
    if (!current || current.recipientId !== principal.userId) throw new NotFoundException({ code: "notification_not_found" });
    if (current.readAt) return { ...current };
    const updated: Readonly<NotificationRecord> = Object.freeze({ ...current, readAt: new Date().toISOString() }); this.notifications.set(id, updated);
    this.audit.record({ eventType: "NOTIFICATION_READ", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { notificationId: id, type: current.type }, result: "SUCCESS", idempotencyKey: `notification-read:${id}` });
    return { ...updated };
  }

  async markReadForApi(id: string, principal: Principal, correlationId: string): Promise<NotificationRecord> {
    await this.flush();
    if (!this.persistence?.enabled) return this.markRead(id, principal, correlationId);
    const stored = await this.persistence.markRead(id, principal, correlationId); this.notifications.set(id, Object.freeze({ ...stored })); return stored;
  }

  markAllRead(principal: Principal, correlationId: string): { updated: number } {
    let updated = 0; const occurredAt = new Date().toISOString();
    for (const item of this.notifications.values()) if (item.recipientId === principal.userId && !item.readAt) { this.notifications.set(item.id, Object.freeze({ ...item, readAt: occurredAt })); updated += 1; }
    this.audit.record({ eventType: "NOTIFICATIONS_READ_ALL", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { updated }, result: "SUCCESS", idempotencyKey: `notifications-read-all:${principal.userId}:${correlationId}` });
    return { updated };
  }

  async markAllReadForApi(principal: Principal, correlationId: string): Promise<{ updated: number }> {
    await this.flush();
    if (!this.persistence?.enabled) return this.markAllRead(principal, correlationId);
    const result = await this.persistence.markAllRead(principal, correlationId);
    const readAt = new Date().toISOString();
    for (const [id, item] of this.notifications) if (item.recipientId === principal.userId && !item.readAt) this.notifications.set(id, Object.freeze({ ...item, readAt }));
    return result;
  }

  assertResourceAccess(notificationId: string, principal: Principal, allowedLeadIds: readonly string[]): string {
    const item = this.notifications.get(notificationId);
    if (!item || item.recipientId !== principal.userId) throw new NotFoundException({ code: "notification_not_found" });
    if (item.resourceType === "LEAD" && !allowedLeadIds.includes(item.resourceId)) throw new ForbiddenException({ code: "notification_resource_forbidden" });
    return item.href;
  }

  async assertResourceAccessForApi(notificationId: string, principal: Principal, allowedLeadIds: readonly string[]): Promise<string> {
    await this.flush();
    if (!this.persistence?.enabled) return this.assertResourceAccess(notificationId, principal, allowedLeadIds);
    const item = await this.persistence.findOwned(notificationId, principal);
    if (item.resourceType === "LEAD" && !allowedLeadIds.includes(item.resourceId)) throw new ForbiddenException({ code: "notification_resource_forbidden" });
    return item.href;
  }

  private validate(input: Omit<NotificationRecord, "id" | "createdAt" | "readAt">, deduplicationKey: string): void {
    if (!notificationTypes.includes(input.type) || !input.recipientId || !input.resourceId || !/^[\p{L}\p{N}:._-]{3,160}$/u.test(deduplicationKey) || !/^\/(leads|imports|chat|broadcasts|appointments)\/[a-zA-Z0-9-]+(?:\/[^?#\s]*)?$/.test(input.href)) throw new BadRequestException({ code: "notification_invalid" });
  }
  private validatePagination(page: number, pageSize: number): void { if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException({ code: "notification_pagination_invalid" }); }
}
