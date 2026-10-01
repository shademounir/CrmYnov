import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { LocalOutboxEvent, Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";

export const outboxStatuses = ["PENDING", "PROCESSING", "DELIVERED", "FAILED"] as const;
export type OutboxStatus = typeof outboxStatuses[number];
export const outboxTopics = [
  "LEAD.CREATED",
  "LEAD.MUTATED",
  "FOLLOW_UP.CHANGED",
  "NOTIFICATION.CREATED",
  "APPOINTMENT.CHANGED",
  "CHAT.MESSAGE",
  "CHAT.MENTION",
  "BROADCAST.CONFIRMED",
] as const;
export type OutboxTopic = typeof outboxTopics[number];
export type OutboxInput = Readonly<{ topic: string; aggregateType: string; aggregateId: string; idempotencyKey: string; payload: Record<string, unknown>; maxAttempts?: number }>;

@Injectable()
export class LocalOutboxRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  get enabled(): boolean { return this.prisma.enabled && Boolean(this.prisma.client); }

  async enqueue(input: OutboxInput): Promise<LocalOutboxEvent> {
    const client = this.requiredClient();
    return client.$transaction((tx) => this.enqueueInTransaction(tx, input), { isolationLevel: "Serializable" });
  }

  async enqueueInTransaction(tx: Prisma.TransactionClient, input: OutboxInput): Promise<LocalOutboxEvent> {
    this.validate(input); const payload = this.safePayload(input.payload);
    const existing = await tx.localOutboxEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.topic !== input.topic || existing.aggregateType !== input.aggregateType || existing.aggregateId !== input.aggregateId || JSON.stringify(existing.payload) !== JSON.stringify(payload)) throw new ConflictException({ code: "outbox_idempotency_conflict" });
      return existing;
    }
    return tx.localOutboxEvent.create({ data: { topic: input.topic, aggregateType: input.aggregateType, aggregateId: input.aggregateId, idempotencyKey: input.idempotencyKey, payload, maxAttempts: input.maxAttempts ?? 5 } });
  }

  async claim(workerId: string, limit = 10, now = new Date(), leaseMs = 30_000): Promise<LocalOutboxEvent[]> {
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(workerId) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("outbox_claim_invalid");
    const client = this.requiredClient(); const staleBefore = new Date(now.valueOf() - leaseMs);
    const candidates = await client.localOutboxEvent.findMany({ where: { OR: [
      { status: { in: ["PENDING", "FAILED"] }, availableAt: { lte: now } },
      { status: "PROCESSING", lockedAt: { lt: staleBefore } },
    ] }, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: limit * 2 });
    const claimed: LocalOutboxEvent[] = [];
    for (const item of candidates) {
      if (claimed.length >= limit) break;
      if (item.attempts >= item.maxAttempts) continue;
      const updated = await client.localOutboxEvent.updateMany({ where: { id: item.id, status: item.status, attempts: item.attempts, ...(item.lockedAt ? { lockedAt: item.lockedAt } : {}) }, data: { status: "PROCESSING", attempts: { increment: 1 }, lockedAt: now, lockedBy: workerId, lastErrorCode: null } });
      if (updated.count === 1) claimed.push((await client.localOutboxEvent.findUnique({ where: { id: item.id } }))!);
    }
    return claimed;
  }

  async delivered(id: string, workerId: string, now = new Date()): Promise<boolean> {
    const result = await this.requiredClient().localOutboxEvent.updateMany({ where: { id, status: "PROCESSING", lockedBy: workerId }, data: { status: "DELIVERED", deliveredAt: now, lockedAt: null, lockedBy: null, lastErrorCode: null } }); return result.count === 1;
  }

  async failed(id: string, workerId: string, errorCode: string, now = new Date()): Promise<boolean> {
    if (!/^[a-z][a-z0-9_]{2,79}$/.test(errorCode)) throw new Error("outbox_error_code_invalid");
    const client = this.requiredClient(); const current = await client.localOutboxEvent.findUnique({ where: { id } });
    if (!current || current.status !== "PROCESSING" || current.lockedBy !== workerId) return false;
    const exhausted = current.attempts >= current.maxAttempts; const backoffSeconds = Math.min(300, 2 ** Math.min(current.attempts, 8));
    const result = await client.localOutboxEvent.updateMany({ where: { id, status: "PROCESSING", lockedBy: workerId, attempts: current.attempts }, data: { status: exhausted ? "FAILED" : "PENDING", availableAt: new Date(now.valueOf() + backoffSeconds * 1_000), lockedAt: null, lockedBy: null, lastErrorCode: errorCode } }); return result.count === 1;
  }

  private validate(input: OutboxInput): void {
    if (!/^[A-Z][A-Z0-9_.-]{2,79}$/.test(input.topic) || !/^[A-Z][A-Z0-9_]{2,47}$/.test(input.aggregateType) || !/^[A-Za-z0-9._:-]{1,80}$/.test(input.aggregateId) || !/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey) || (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10))) throw new Error("outbox_input_invalid");
  }
  private safePayload(value: Record<string, unknown>): Prisma.InputJsonObject {
    const encoded = JSON.stringify(value); if (encoded.length > 8_000 || /"(?:email|phone|name|content|comment|password|token|secret|authorization)"\s*:/i.test(encoded)) throw new Error("outbox_payload_not_minimized");
    return JSON.parse(encoded) as Prisma.InputJsonObject;
  }
  private requiredClient(): NonNullable<PrismaService["client"]> { if (!this.prisma.client) throw new Error("outbox_persistence_unavailable"); return this.prisma.client; }
}
