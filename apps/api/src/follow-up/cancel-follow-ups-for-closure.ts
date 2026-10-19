import { ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";

/** Called only inside the distinct, authorized final closure transaction.
 * Original objectives and all previous task versions remain in their history.
 * Cancellation is never represented as performance or a completed call. */
export async function cancelFollowUpsForClosure(tx: Prisma.TransactionClient, closure: { id: string; leadId: string; target: string; decisionReason?: string }, principal: Principal, correlationId: string): Promise<void> {
  const rows = await tx.leadFollowUp.findMany({ where: { leadId: closure.leadId, state: { in: ["SCHEDULED", "DUE"] } } });
  if (!rows.length) return;
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: closure.leadId }, select: { campus: true } });
  for (const row of rows) {
    const key = `closure-follow-up:${createHash("sha256").update(`${closure.id}:${row.id}`).digest("hex")}`;
    const occurredAt = new Date();
    const changed = await tx.leadFollowUp.updateMany({ where: { id: row.id, version: row.version, state: { in: ["SCHEDULED", "DUE"] } }, data: { state: "CANCELLED", updatedAt: occurredAt, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ConflictException({ code: "follow_up_concurrent" });
    await tx.leadActivity.create({ data: { id: randomUUID(), leadId: closure.leadId, authorId: principal.userId, type: "COMMENT",
      result: "FOLLOW_UP_CANCELLED_FOR_CLOSURE", note: `Action annulée après décision finale ${closure.target}. ${closure.decisionReason ?? "Décision de clôture validée"}`,
      correlationId, occurredAt, idempotencyKey: key } });
    await tx.auditEvent.create({ data: { eventType: "FOLLOW_UP_CANCELLED_FOR_CLOSURE", campusId: lead.campus, resourceType: "LEAD", resourceId: closure.leadId,
      actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, result: "SUCCESS", idempotencyKey: key,
      before: { followUpId: row.id, state: row.state, version: row.version, reason: row.reason },
      after: { followUpId: row.id, state: "CANCELLED", version: row.version + 1, closureId: closure.id, target: closure.target, countsAsCompleted: false } } });
  }
}
