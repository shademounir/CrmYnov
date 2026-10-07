import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { LeadFollowUp as PrismaLeadFollowUp, Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { createNotificationInTransaction } from "../notifications/notification-persistence.repository.js";
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

  /**
   * The state, audit and notification commit together. Locked, bounded selection
   * also recovers legacy DUE rows whose committed audit proves their occurrence.
   */
  async markDue(now: Date, limit = 50): Promise<{ due: number; notifications: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("follow_up_due_limit_invalid");
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      // Exclude delivered DUE rows before applying the limit: an old delivered
      // batch must not starve pending repairs. The unique notification index is
      // also the delivery receipt; no new schema or in-memory queue is involved.
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT f.id FROM lead_follow_ups f
        WHERE (f.state = 'SCHEDULED' AND f.due_at <= ${now})
          OR (f.state = 'DUE' AND f.due_at <= ${now} AND NOT EXISTS (
            SELECT 1 FROM internal_notifications n
            WHERE n.deduplication_key IN ('follow-up-due:' || f.id::text || ':v' || f.version::text, 'follow-up-due:' || f.id::text)
              AND n.recipient_id = f.owner_id::text AND n.type = 'FOLLOW_UP_DUE' AND n.priority = 'HIGH'
              AND n.resource_type = 'LEAD' AND n.resource_id = f.lead_id::text
              AND n.href = '/leads/' || f.lead_id::text || '/follow-ups'
              AND n.fingerprint = encode(sha256(convert_to(
                '{"recipientId":"' || f.owner_id::text || '","type":"FOLLOW_UP_DUE","priority":"HIGH","resourceType":"LEAD","resourceId":"'
                || f.lead_id::text || '","href":"/leads/' || f.lead_id::text || '/follow-ups"}', 'UTF8')), 'hex')
              AND EXISTS (
                SELECT 1 FROM audit_events a
                WHERE a.idempotency_key = n.deduplication_key
                  AND a.event_type = 'FOLLOW_UP_DUE' AND a.result = 'SUCCESS'
                  AND a.resource_type = 'LEAD' AND a.resource_id = f.lead_id::text
                  AND a.after->>'followUpId' = f.id::text AND a.after->>'state' = 'DUE'
                  AND a.after->'version' = to_jsonb(f.version)
                  AND a.after->>'dueAt' = to_char(f.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  AND (n.deduplication_key = 'follow-up-due:' || f.id::text OR a.after->>'ownerId' = f.owner_id::text)
              )
          ))
        ORDER BY f.due_at, f.id LIMIT ${limit}
        FOR UPDATE OF f SKIP LOCKED
      `;
      let due = 0; let notifications = 0;
      for (const candidate of candidates) {
        const previous = this.map(await tx.leadFollowUp.findUniqueOrThrow({ where: { id: candidate.id } }));
        const notificationKey = await this.dueNotificationKey(tx, previous);
        let current = previous;
        if (previous.state === "SCHEDULED") {
          const changed = await tx.leadFollowUp.updateMany({
            where: { id: previous.id, state: "SCHEDULED", version: previous.version },
            data: { state: "DUE", version: { increment: 1 }, updatedAt: now },
          });
          if (changed.count !== 1) continue;
          current = this.map(await tx.leadFollowUp.findUniqueOrThrow({ where: { id: previous.id } }));
          await tx.auditEvent.create({ data: {
            eventType: "FOLLOW_UP_DUE", resourceType: "LEAD", resourceId: current.leadId,
            actorId: "system:follow-up-scheduler", actorRoles: [], correlationId: `follow-up-due:${current.id}`,
            result: "SUCCESS", idempotencyKey: notificationKey,
            after: { followUpId: current.id, ownerId: current.ownerId, state: current.state, dueAt: current.dueAt, version: current.version },
          } });
          due += 1;
        }
        const result = await createNotificationInTransaction(tx, {
          id: randomUUID(), recipientId: current.ownerId, type: "FOLLOW_UP_DUE", priority: "HIGH",
          resourceType: "LEAD", resourceId: current.leadId, href: `/leads/${current.leadId}/follow-ups`,
          createdAt: current.updatedAt,
        }, notificationKey);
        if (result.created) notifications += 1;
      }
      return { due, notifications };
    // Row locks serialize decisions/cancellation and claims. SKIP LOCKED lets
    // another worker process a disjoint batch rather than fail serialization.
    }, { isolationLevel: "ReadCommitted" });
  }

  private async dueNotificationKey(tx: Prisma.TransactionClient, item: FollowUpRecord): Promise<string> {
    const legacyKey = `follow-up-due:${item.id}`;
    const occurrenceKey = `${legacyKey}:v${item.version + (item.state === "SCHEDULED" ? 1 : 0)}`;
    const legacyAudit = await tx.auditEvent.findUnique({ where: { idempotencyKey: legacyKey } });
    const legacyNotification = await tx.internalNotification.findUnique({ where: { deduplicationKey: legacyKey } });
    const legacyAfter = legacyAudit?.after as Prisma.JsonObject | undefined;
    const legacyVersion = legacyAfter?.version;
    const validLegacy = legacyAudit?.eventType === "FOLLOW_UP_DUE" && legacyAudit.result === "SUCCESS"
      && legacyAudit.resourceType === "LEAD" && legacyAudit.resourceId === item.leadId
      && legacyAfter?.followUpId === item.id && legacyAfter?.state === "DUE"
      && typeof legacyAfter?.dueAt === "string" && !Number.isNaN(Date.parse(legacyAfter.dueAt))
      && typeof legacyVersion === "number" && Number.isInteger(legacyVersion) && legacyVersion > 0 && legacyVersion <= item.version;
    if (legacyNotification && !validLegacy) throw new Error("follow_up_due_legacy_inconsistent");
    if (item.state === "SCHEDULED") return occurrenceKey;
    if (validLegacy && legacyVersion === item.version && legacyAfter?.dueAt === item.dueAt) return legacyKey;
    const occurrenceAudit = await tx.auditEvent.findUnique({ where: { idempotencyKey: occurrenceKey } });
    const after = occurrenceAudit?.after as Prisma.JsonObject | undefined;
    if (occurrenceAudit?.eventType !== "FOLLOW_UP_DUE" || occurrenceAudit.result !== "SUCCESS"
      || occurrenceAudit.resourceType !== "LEAD" || occurrenceAudit.resourceId !== item.leadId || after?.followUpId !== item.id || after?.state !== "DUE"
      || after?.version !== item.version || after?.dueAt !== item.dueAt || after?.ownerId !== item.ownerId) {
      throw new Error("follow_up_due_audit_inconsistent");
    }
    return occurrenceKey;
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
