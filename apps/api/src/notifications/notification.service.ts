import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";

export const notificationTypes = ["ASSIGNMENT", "REASSIGNMENT_DECISION", "CLOSURE_REQUEST", "COLLABORATOR_REQUEST", "FOLLOW_UP_DUE", "IMPORT_REVIEW"] as const;
export type NotificationType = typeof notificationTypes[number];
export type NotificationPriority = "LOW" | "NORMAL" | "HIGH";
export interface NotificationRecord { id: string; recipientId: string; type: NotificationType; priority: NotificationPriority; resourceType: "LEAD" | "IMPORT"; resourceId: string; href: string; createdAt: string; readAt?: string }
export interface NotificationPage { items: NotificationRecord[]; page: number; pageSize: number; total: number; unread: number }

@Injectable()
export class NotificationService {
  private readonly notifications = new Map<string, Readonly<NotificationRecord>>();
  private readonly deduplication = new Map<string, string>();
  constructor(private readonly audit: AuditService) {}

  create(input: Omit<NotificationRecord, "id" | "createdAt" | "readAt">, deduplicationKey: string): NotificationRecord {
    if (!notificationTypes.includes(input.type) || !input.recipientId || !input.resourceId || !/^\/(leads|imports)\/[a-zA-Z0-9-]+(?:\/[^?#\s]*)?$/.test(input.href)) throw new BadRequestException({ code: "notification_invalid" });
    const known = this.deduplication.get(deduplicationKey);
    if (known) return { ...this.notifications.get(known)! };
    const record: Readonly<NotificationRecord> = Object.freeze({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
    this.notifications.set(record.id, record); this.deduplication.set(deduplicationKey, record.id);
    return { ...record };
  }

  list(principal: Principal, page: number, pageSize: number): NotificationPage {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException({ code: "notification_pagination_invalid" });
    const all = [...this.notifications.values()].filter((item) => item.recipientId === principal.userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return { items: all.slice((page - 1) * pageSize, page * pageSize).map((item) => ({ ...item })), page, pageSize, total: all.length, unread: all.filter((item) => !item.readAt).length };
  }

  markRead(id: string, principal: Principal, correlationId: string): NotificationRecord {
    const current = this.notifications.get(id);
    if (!current || current.recipientId !== principal.userId) throw new NotFoundException({ code: "notification_not_found" });
    if (current.readAt) return { ...current };
    const updated: Readonly<NotificationRecord> = Object.freeze({ ...current, readAt: new Date().toISOString() }); this.notifications.set(id, updated);
    this.audit.record({ eventType: "NOTIFICATION_READ", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { notificationId: id, type: current.type }, result: "SUCCESS", idempotencyKey: `notification-read:${id}` });
    return { ...updated };
  }

  markAllRead(principal: Principal, correlationId: string): { updated: number } {
    let updated = 0; const occurredAt = new Date().toISOString();
    for (const item of this.notifications.values()) if (item.recipientId === principal.userId && !item.readAt) { this.notifications.set(item.id, Object.freeze({ ...item, readAt: occurredAt })); updated += 1; }
    this.audit.record({ eventType: "NOTIFICATIONS_READ_ALL", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { updated }, result: "SUCCESS", idempotencyKey: `notifications-read-all:${principal.userId}:${correlationId}` });
    return { updated };
  }

  assertResourceAccess(notificationId: string, principal: Principal, allowedLeadIds: readonly string[]): string {
    const item = this.notifications.get(notificationId);
    if (!item || item.recipientId !== principal.userId) throw new NotFoundException({ code: "notification_not_found" });
    if (item.resourceType === "LEAD" && !allowedLeadIds.includes(item.resourceId)) throw new ForbiddenException({ code: "notification_resource_forbidden" });
    return item.href;
  }
}
