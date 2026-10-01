import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { InternalNotification, Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { NotificationPage, NotificationRecord } from "./notification.service.js";

@Injectable()
export class NotificationPersistenceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return this.prisma.enabled && Boolean(this.prisma.client);
  }

  fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  async snapshot(): Promise<Array<{ record: NotificationRecord; deduplicationKey: string }>> {
    const rows = await this.requiredClient().internalNotification.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map((row) => ({ record: this.map(row), deduplicationKey: row.deduplicationKey }));
  }

  async create(record: NotificationRecord, deduplicationKey: string): Promise<NotificationRecord> {
    const client = this.requiredClient();
    const fingerprint = this.fingerprint({ recipientId: record.recipientId, type: record.type, priority: record.priority, resourceType: record.resourceType, resourceId: record.resourceId, href: record.href });
    try {
      return await client.$transaction(async (tx) => {
        const existing = await tx.internalNotification.findUnique({ where: { deduplicationKey } });
        if (existing) return this.replay(existing, fingerprint);
        return this.map(await tx.internalNotification.create({ data: {
          id: record.id, recipientId: record.recipientId, type: record.type, priority: record.priority,
          resourceType: record.resourceType, resourceId: record.resourceId, href: record.href,
          deduplicationKey, fingerprint, createdAt: new Date(record.createdAt), readAt: record.readAt ? new Date(record.readAt) : null,
        } }));
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.prismaCode(error) === "P2002") {
        const existing = await client.internalNotification.findUnique({ where: { deduplicationKey } });
        if (existing) return this.replay(existing, fingerprint);
      }
      throw error;
    }
  }

  async page(principal: Principal, page: number, pageSize: number): Promise<NotificationPage> {
    const client = this.requiredClient();
    const where = { recipientId: principal.userId };
    const [rows, total, unread] = await client.$transaction([
      client.internalNotification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      client.internalNotification.count({ where }),
      client.internalNotification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items: rows.map((row) => this.map(row)), page, pageSize, total, unread };
  }

  async markRead(id: string, principal: Principal, correlationId: string): Promise<NotificationRecord> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const current = await tx.internalNotification.findFirst({ where: { id, recipientId: principal.userId } });
      if (!current) throw new NotFoundException({ code: "notification_not_found" });
      if (current.readAt) return this.map(current);
      const readAt = new Date();
      const changed = await tx.internalNotification.updateMany({ where: { id, recipientId: principal.userId, readAt: null }, data: { readAt } });
      const stored = await tx.internalNotification.findFirst({ where: { id, recipientId: principal.userId } });
      if (!stored) throw new NotFoundException({ code: "notification_not_found" });
      if (changed.count === 1) await this.audit(tx, principal, correlationId, "NOTIFICATION_READ", id, { notificationId: id, type: current.type });
      return this.map(stored);
    }, { isolationLevel: "Serializable" });
  }

  async markAllRead(principal: Principal, correlationId: string): Promise<{ updated: number }> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const readAt = new Date();
      const changed = await tx.internalNotification.updateMany({ where: { recipientId: principal.userId, readAt: null }, data: { readAt } });
      await this.audit(tx, principal, correlationId, "NOTIFICATIONS_READ_ALL", principal.userId, { updated: changed.count });
      return { updated: changed.count };
    }, { isolationLevel: "Serializable" });
  }

  async findOwned(id: string, principal: Principal): Promise<NotificationRecord> {
    const row = await this.requiredClient().internalNotification.findFirst({ where: { id, recipientId: principal.userId } });
    if (!row) throw new NotFoundException({ code: "notification_not_found" });
    return this.map(row);
  }

  private replay(existing: InternalNotification, fingerprint: string): NotificationRecord {
    if (existing.fingerprint !== fingerprint) throw new ConflictException({ code: "notification_idempotency_conflict" });
    return this.map(existing);
  }

  private map(row: InternalNotification): NotificationRecord {
    return {
      id: row.id, recipientId: row.recipientId, type: row.type as NotificationRecord["type"], priority: row.priority as NotificationRecord["priority"],
      resourceType: row.resourceType as NotificationRecord["resourceType"], resourceId: row.resourceId, href: row.href,
      createdAt: row.createdAt.toISOString(), ...(row.readAt ? { readAt: row.readAt.toISOString() } : {}),
    };
  }

  private async audit(tx: Prisma.TransactionClient, principal: Principal, correlationId: string, eventType: string, resourceId: string, after: Prisma.InputJsonObject): Promise<void> {
    const key = `notification-audit:${createHash("sha256").update(`${eventType}:${resourceId}:${correlationId}`).digest("hex")}`;
    await tx.auditEvent.upsert({ where: { idempotencyKey: key }, update: {}, create: {
      eventType, resourceType: "NOTIFICATION", resourceId, actorId: principal.userId, actorRoles: principal.roles,
      ...(this.uuid(principal.sessionId) ? { sessionId: principal.sessionId } : {}), correlationId, after, result: "SUCCESS", idempotencyKey: key,
    } });
  }

  private uuid(value: string | undefined): boolean { return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)); }
  private prismaCode(error: unknown): string { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""; }
  private requiredClient(): NonNullable<PrismaService["client"]> { if (!this.prisma.client) throw new Error("notification_persistence_unavailable"); return this.prisma.client; }
}
