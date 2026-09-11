import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { LeadFollowUp as PrismaLeadFollowUp, Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { FollowUpRecord, FollowUpState } from "./follow-up.service.js";

type FollowUpMutationInput = Readonly<{
  idempotencyKey: string;
  fingerprint: string;
  principal: Principal;
  correlationId: string;
  expectedLeadVersion: number;
}>;

@Injectable()
export class FollowUpPersistenceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return this.prisma.enabled && Boolean(this.prisma.client);
  }

  fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  async snapshot(): Promise<FollowUpRecord[]> {
    const client = this.prisma.client;
    if (!client) return [];
    const rows = await client.leadFollowUp.findMany({ orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
    return rows.map((row) => this.map(row));
  }

  async findReplay(idempotencyKey: string, fingerprint: string): Promise<FollowUpRecord | undefined> {
    const client = this.prisma.client;
    if (!client) return undefined;
    const receipt = await client.leadFollowUpMutationReceipt.findUnique({ where: { idempotencyKey } });
    return receipt ? this.replay(receipt.fingerprint, fingerprint, receipt.result) : undefined;
  }

  async schedule(
    record: FollowUpRecord,
    mutation: FollowUpMutationInput,
  ): Promise<FollowUpRecord> {
    this.requireAuditActor(mutation.principal);
    const client = this.requiredClient();
    try {
      return await client.$transaction(async (tx) => {
        const receipt = await tx.leadFollowUpMutationReceipt.findUnique({ where: { idempotencyKey: mutation.idempotencyKey } });
        if (receipt) return this.replay(receipt.fingerprint, mutation.fingerprint, receipt.result);
        const pending = await tx.leadFollowUp.findFirst({ where: { leadId: record.leadId, state: { in: ["SCHEDULED", "DUE"] } }, select: { id: true } });
        if (pending) throw new ConflictException({ code: "follow_up_pending" });
        const updatedLead = await tx.lead.updateMany({
          where: { id: record.leadId, version: mutation.expectedLeadVersion },
          data: { nextActionAt: new Date(record.dueAt), lastActivityAt: new Date(record.createdAt), version: { increment: 1 } },
        });
        if (updatedLead.count !== 1) throw new ConflictException({ code: "lead_concurrent_mutation" });
        const stored = await tx.leadFollowUp.create({ data: {
          id: record.id, leadId: record.leadId, ownerId: record.ownerId, dueAt: new Date(record.dueAt), state: record.state,
          reason: record.reason, version: record.version, idempotencyKey: mutation.idempotencyKey,
          fingerprint: mutation.fingerprint, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        } });
        await tx.leadActivity.create({ data: {
          id: randomUUID(), leadId: record.leadId, type: "COMMENT", result: "FOLLOW_UP_SCHEDULED", note: record.reason,
          authorId: mutation.principal.userId, nextActionAt: new Date(record.dueAt), correlationId: mutation.correlationId,
          idempotencyKey: `follow-up-activity:${mutation.idempotencyKey}`, occurredAt: new Date(record.createdAt),
        } });
        const result = this.map(stored);
        await this.audit(tx, result, mutation, "FOLLOW_UP_SCHEDULED", mutation.expectedLeadVersion + 1);
        await tx.leadFollowUpMutationReceipt.create({ data: {
          idempotencyKey: mutation.idempotencyKey, followUpId: result.id, fingerprint: mutation.fingerprint,
          result: result as unknown as Prisma.InputJsonValue,
        } });
        return result;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      this.mapConcurrency(error);
    }
  }

  async decide(
    current: FollowUpRecord,
    next: FollowUpRecord,
    eventType: string,
    mutation: FollowUpMutationInput,
  ): Promise<FollowUpRecord> {
    this.requireAuditActor(mutation.principal);
    const client = this.requiredClient();
    try {
      return await client.$transaction(async (tx) => {
        const receipt = await tx.leadFollowUpMutationReceipt.findUnique({ where: { idempotencyKey: mutation.idempotencyKey } });
        if (receipt) return this.replay(receipt.fingerprint, mutation.fingerprint, receipt.result);
        const changed = await tx.leadFollowUp.updateMany({
          where: { id: current.id, version: current.version, state: { in: ["SCHEDULED", "DUE"] } },
          data: { state: next.state, dueAt: new Date(next.dueAt), reason: next.reason, version: { increment: 1 }, updatedAt: new Date(next.updatedAt) },
        });
        if (changed.count !== 1) throw new ConflictException({ code: "follow_up_concurrent" });
        const updatedLead = await tx.lead.updateMany({
          where: { id: current.leadId, version: mutation.expectedLeadVersion },
          data: {
            nextActionAt: next.state === "SCHEDULED" || next.state === "DUE" ? new Date(next.dueAt) : null,
            lastActivityAt: new Date(next.updatedAt), version: { increment: 1 },
          },
        });
        if (updatedLead.count !== 1) throw new ConflictException({ code: "lead_concurrent_mutation" });
        await tx.leadActivity.create({ data: {
          id: randomUUID(), leadId: current.leadId, type: "COMMENT", result: eventType, note: next.reason,
          authorId: mutation.principal.userId,
          ...(next.state === "SCHEDULED" || next.state === "DUE" ? { nextActionAt: new Date(next.dueAt) } : {}),
          correlationId: mutation.correlationId, idempotencyKey: `follow-up-activity:${mutation.idempotencyKey}`,
          occurredAt: new Date(next.updatedAt),
        } });
        const result = this.map(await tx.leadFollowUp.findUniqueOrThrow({ where: { id: current.id } }));
        await this.audit(tx, result, mutation, eventType, mutation.expectedLeadVersion + 1);
        await tx.leadFollowUpMutationReceipt.create({ data: {
          idempotencyKey: mutation.idempotencyKey, followUpId: result.id, fingerprint: mutation.fingerprint,
          result: result as unknown as Prisma.InputJsonValue,
        } });
        return result;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      this.mapConcurrency(error);
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    record: FollowUpRecord,
    mutation: FollowUpMutationInput,
    eventType: string,
    leadVersion: number,
  ): Promise<void> {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: record.leadId }, select: { campus: true } });
    await tx.auditEvent.create({ data: {
      eventType, campusId: lead.campus, resourceType: "LEAD", resourceId: record.leadId,
      actorId: mutation.principal.userId, actorRoles: mutation.principal.roles, correlationId: mutation.correlationId,
      result: "SUCCESS", idempotencyKey: `follow-up-audit:${createHash("sha256").update(mutation.idempotencyKey).digest("hex")}`,
      after: { followUpId: record.id, state: record.state, dueAt: record.dueAt, version: record.version, leadVersion },
    } });
  }

  private replay(storedFingerprint: string, fingerprint: string, result: Prisma.JsonValue): FollowUpRecord {
    if (storedFingerprint !== fingerprint) throw new ConflictException({ code: "follow_up_idempotency_conflict" });
    return structuredClone(result) as unknown as FollowUpRecord;
  }

  private map(row: PrismaLeadFollowUp): FollowUpRecord {
    return {
      id: row.id, leadId: row.leadId, ownerId: row.ownerId, dueAt: row.dueAt.toISOString(),
      state: row.state as FollowUpState, reason: row.reason, version: row.version,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapConcurrency(error: unknown): never {
    if (error instanceof ConflictException) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "P2002" || code === "P2034") throw new ConflictException({ code: "follow_up_concurrent" });
    throw error;
  }

  private requireAuditActor(principal: Principal): void {
    if (!principal?.userId || !principal.sessionId || !principal.roles.length) throw new UnauthorizedException({ code: "audit_actor_required" });
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new Error("follow_up_persistence_unavailable");
    return this.prisma.client;
  }
}
