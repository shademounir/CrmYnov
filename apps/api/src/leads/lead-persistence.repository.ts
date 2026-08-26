import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { LeadActivity as PrismaLeadActivity, Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { LocalOutboxRepository } from "../outbox/local-outbox.repository.js";
import type { ActivityCorrection, CorrectionReasonCode, LeadActivityRecord, LeadRecord } from "./lead.service.js";

type StoredLead = LeadRecord & { version: number };
type PersistentSnapshot = Readonly<{ leads: StoredLead[]; activities: LeadActivityRecord[] }>;

@Injectable()
export class LeadPersistenceRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LocalOutboxRepository) private readonly outbox?: LocalOutboxRepository,
  ) {}

  get enabled(): boolean {
    return this.prisma.enabled && Boolean(this.prisma.client);
  }

  fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  async snapshot(): Promise<PersistentSnapshot> {
    const client = this.prisma.client;
    if (!client) return { leads: [], activities: [] };
    const [rows, activities] = await client.$transaction([
      client.lead.findMany({ include: { collaborators: { where: { active: true }, orderBy: { userId: "asc" } } } }),
      client.leadActivity.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
    ]);
    return {
      leads: rows.map((row) => ({
        id: row.id,
        leadCode: row.leadCode,
        firstName: row.firstName,
        lastName: row.lastName,
        ...(row.email ? { email: row.email } : {}),
        ...(row.phone ? { phone: row.phone } : {}),
        campus: row.campus,
        campaign: row.campaign,
        educationLevel: row.educationLevel,
        program: row.program,
        source: row.source,
        status: row.status as LeadRecord["status"],
        ...(row.assignedToId ? { assignedToId: row.assignedToId } : {}),
        collaboratorIds: row.collaborators.map((item) => item.userId),
        ...(row.assignmentMode ? { assignmentMode: row.assignmentMode } : {}),
        ...(row.importBatchId ? { importBatchId: row.importBatchId } : {}),
        ...(row.nextActionAt ? { nextActionAt: row.nextActionAt.toISOString() } : {}),
        ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt.toISOString() } : {}),
        createdAt: row.createdAt.toISOString(),
        version: row.version,
      })),
      activities: activities.map((row): LeadActivityRecord => ({
        id: row.id,
        leadId: row.leadId,
        type: row.type as LeadActivityRecord["type"],
        result: row.result,
        ...(row.note ? { note: row.note } : {}),
        authorId: row.authorId,
        ...(row.nextActionAt ? { nextActionAt: row.nextActionAt.toISOString() } : {}),
        correlationId: row.correlationId,
        occurredAt: row.occurredAt.toISOString(),
        ...(row.originalEventId && row.correctionOperation && row.correctionReasonCode && row.previousSnapshot
          ? {
              correction: {
                originalEventId: row.originalEventId,
                operation: row.correctionOperation as "CORRECT" | "CANCEL",
                reasonCode: row.correctionReasonCode as CorrectionReasonCode,
                previous: row.previousSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["previous"],
                ...(row.replacementSnapshot
                  ? { replacement: row.replacementSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["replacement"] }
                  : {}),
              } as ActivityCorrection,
            }
          : {}),
      })),
    };
  }

  async createLead(
    lead: StoredLead,
    activity: LeadActivityRecord,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<StoredLead> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const receipt = await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey } });
      if (receipt) return this.replay(receipt.fingerprint, fingerprint, receipt.result);
      await tx.lead.create({ data: this.leadCreateData(lead) });
      await tx.leadActivity.create({ data: this.activityData(activity, idempotencyKey) });
      await tx.leadMutationReceipt.create({
        data: { leadId: lead.id, idempotencyKey, fingerprint, operation: "CREATE", result: lead as unknown as Prisma.InputJsonValue },
      });
      await this.outbox?.enqueueInTransaction(tx, {
        topic: "LEAD.CREATED",
        aggregateType: "LEAD",
        aggregateId: lead.id,
        idempotencyKey: `outbox:${idempotencyKey}`,
        payload: { operation: "CREATE", status: lead.status, version: lead.version },
      });
      return lead;
    }, { isolationLevel: "Serializable" });
  }

  async findActivity(idempotencyKey: string): Promise<LeadActivityRecord | undefined> {
    const client = this.prisma.client;
    if (!client) return undefined;
    const row = await client.leadActivity.findUnique({ where: { idempotencyKey } });
    return row ? this.mapActivity(row) : undefined;
  }

  async persistMutation(
    before: StoredLead,
    after: StoredLead,
    activities: readonly LeadActivityRecord[],
    idempotencyKey: string,
    operation: string,
    fingerprint: string,
  ): Promise<StoredLead> {
    const client = this.requiredClient();
    return client.$transaction(async (tx) => {
      const receipt = await tx.leadMutationReceipt.findUnique({ where: { idempotencyKey } });
      if (receipt) return this.replay(receipt.fingerprint, fingerprint, receipt.result);
      const updated = await tx.lead.updateMany({
        where: { id: before.id, version: before.version },
        data: {
          status: after.status,
          assignedToId: after.assignedToId ?? null,
          assignmentMode: after.assignmentMode ?? null,
          nextActionAt: after.nextActionAt ? new Date(after.nextActionAt) : null,
          lastActivityAt: after.lastActivityAt ? new Date(after.lastActivityAt) : null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "lead_concurrent_mutation" });
      for (const [index, activity] of activities.entries()) await tx.leadActivity.create({ data: this.activityData(activity, activities.length === 1 ? idempotencyKey : `${idempotencyKey}:${index}`) });
      const result: StoredLead = { ...after, version: before.version + 1 };
      await tx.leadMutationReceipt.create({
        data: { leadId: after.id, idempotencyKey, fingerprint, operation, result: result as unknown as Prisma.InputJsonValue },
      });
      await this.outbox?.enqueueInTransaction(tx, {
        topic: "LEAD.MUTATED",
        aggregateType: "LEAD",
        aggregateId: after.id,
        idempotencyKey: `outbox:${idempotencyKey}`,
        payload: { operation, status: result.status, version: result.version, activityTypes: activities.map((activity) => activity.type) },
      });
      return result;
    }, { isolationLevel: "Serializable" });
  }

  async replaceCollaborators(leadId: string, userIds: readonly string[]): Promise<void> {
    const client = this.requiredClient();
    await client.$transaction(async (tx) => {
      await tx.leadCollaborator.updateMany({ where: { leadId, active: true, userId: { notIn: [...userIds] } }, data: { active: false } });
      for (const userId of userIds) {
        await tx.leadCollaborator.upsert({
          where: { leadId_userId: { leadId, userId } },
          create: { leadId, userId, active: true },
          update: { active: true },
        });
      }
    }, { isolationLevel: "Serializable" });
  }

  private requiredClient(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new Error("lead_persistence_unavailable");
    return this.prisma.client;
  }

  private replay(storedFingerprint: string, fingerprint: string, result: Prisma.JsonValue): StoredLead {
    if (storedFingerprint !== fingerprint) throw new ConflictException({ code: "lead_idempotency_conflict" });
    return structuredClone(result) as unknown as StoredLead;
  }

  private leadCreateData(lead: StoredLead): Prisma.LeadUncheckedCreateInput {
    return {
      id: lead.id,
      leadCode: lead.leadCode,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      campus: lead.campus,
      campaign: lead.campaign,
      educationLevel: lead.educationLevel,
      program: lead.program,
      source: lead.source,
      status: lead.status,
      assignedToId: lead.assignedToId ?? null,
      assignmentMode: lead.assignmentMode ?? null,
      importBatchId: lead.importBatchId ?? null,
      nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt) : null,
      lastActivityAt: lead.lastActivityAt ? new Date(lead.lastActivityAt) : null,
      createdAt: new Date(lead.createdAt),
      version: lead.version,
    };
  }

  private activityData(activity: LeadActivityRecord, idempotencyKey: string): Prisma.LeadActivityUncheckedCreateInput {
    return {
      id: activity.id,
      leadId: activity.leadId,
      type: activity.type,
      result: activity.result,
      note: activity.note ?? null,
      authorId: activity.authorId,
      nextActionAt: activity.nextActionAt ? new Date(activity.nextActionAt) : null,
      correlationId: activity.correlationId,
      idempotencyKey,
      originalEventId: activity.correction?.originalEventId ?? null,
      correctionOperation: activity.correction?.operation ?? null,
      correctionReasonCode: activity.correction?.reasonCode ?? null,
      ...(activity.correction?.previous ? { previousSnapshot: activity.correction.previous as unknown as Prisma.InputJsonValue } : {}),
      ...(activity.correction?.replacement ? { replacementSnapshot: activity.correction.replacement as unknown as Prisma.InputJsonValue } : {}),
      occurredAt: new Date(activity.occurredAt),
    };
  }

  private mapActivity(row: PrismaLeadActivity): LeadActivityRecord {
    return {
      id: row.id, leadId: row.leadId, type: row.type as LeadActivityRecord["type"], result: row.result,
      ...(row.note ? { note: row.note } : {}), authorId: row.authorId,
      ...(row.nextActionAt ? { nextActionAt: row.nextActionAt.toISOString() } : {}), correlationId: row.correlationId,
      occurredAt: row.occurredAt.toISOString(),
      ...(row.originalEventId && row.correctionOperation && row.correctionReasonCode && row.previousSnapshot ? {
        correction: { originalEventId: row.originalEventId, operation: row.correctionOperation as "CORRECT" | "CANCEL",
          reasonCode: row.correctionReasonCode as CorrectionReasonCode,
          previous: row.previousSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["previous"],
          ...(row.replacementSnapshot ? { replacement: row.replacementSnapshot as unknown as NonNullable<LeadActivityRecord["correction"]>["replacement"] } : {}) } as ActivityCorrection,
      } : {}),
    };
  }
}
