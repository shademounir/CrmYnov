import { ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import type { FollowUpRecord } from "./follow-up.service.js";

export interface FollowUpMutationInput {
  idempotencyKey: string;
  fingerprint: string;
  principal: Principal;
  correlationId: string;
  expectedLeadVersion: number;
}

/** Both human entry points must call this writer in their existing serializable
 * permission transaction. No independent connection, network call or commit. */
export async function scheduleNextActionInTransaction(
  tx: Prisma.TransactionClient,
  record: FollowUpRecord,
  mutation: FollowUpMutationInput,
  projectionAlreadyWritten = false,
): Promise<FollowUpRecord> {
  const receipt = await tx.leadFollowUpMutationReceipt.findUnique({ where: { idempotencyKey: mutation.idempotencyKey } });
  if (receipt) {
    if (receipt.fingerprint !== mutation.fingerprint) throw new ConflictException({ code: "follow_up_idempotency_conflict" });
    return structuredClone(receipt.result) as unknown as FollowUpRecord;
  }
  const pending = await tx.leadFollowUp.findFirst({ where: { leadId: record.leadId, state: { in: ["SCHEDULED", "DUE"] } }, select: { id: true } });
  if (pending) throw new ConflictException({ code: "follow_up_pending" });
  if (!projectionAlreadyWritten) {
    const updatedLead = await tx.lead.updateMany({
      where: { id: record.leadId, version: mutation.expectedLeadVersion },
      data: { nextActionAt: new Date(record.dueAt), lastActivityAt: new Date(record.createdAt), version: { increment: 1 } },
    });
    if (updatedLead.count !== 1) throw new ConflictException({ code: "lead_concurrent_mutation" });
  }
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
  const result: FollowUpRecord = {
    id: stored.id, leadId: stored.leadId, ownerId: stored.ownerId, dueAt: stored.dueAt.toISOString(),
    state: stored.state as FollowUpRecord["state"], reason: stored.reason, version: stored.version,
    createdAt: stored.createdAt.toISOString(), updatedAt: stored.updatedAt.toISOString(),
  };
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: record.leadId }, select: { campus: true } });
  await tx.auditEvent.create({ data: {
    eventType: "FOLLOW_UP_SCHEDULED", campusId: lead.campus, resourceType: "LEAD", resourceId: record.leadId,
    actorId: mutation.principal.userId, actorRoles: mutation.principal.roles, correlationId: mutation.correlationId,
    result: "SUCCESS", idempotencyKey: `follow-up-audit:${createHash("sha256").update(mutation.idempotencyKey).digest("hex")}`,
    after: { followUpId: result.id, state: result.state, dueAt: result.dueAt, version: result.version, leadVersion: mutation.expectedLeadVersion + 1 },
  } });
  await tx.leadFollowUpMutationReceipt.create({ data: {
    idempotencyKey: mutation.idempotencyKey, followUpId: result.id, fingerprint: mutation.fingerprint,
    result: result as unknown as Prisma.InputJsonValue,
  } });
  return result;
}
