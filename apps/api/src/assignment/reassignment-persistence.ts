import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Lead, Prisma, ReassignmentRequest as StoredRequest } from "@prisma/client";
import type { Principal, Scope } from "../auth/auth.types.js";
import type { CreateReassignmentInput, DecideReassignmentInput, ReassignmentRequest } from "./reassignment.service.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";
import { assignmentNotification } from "./assignment-notifications.js";

export const reassignmentQueueScanLimit = 1_000;
export const reassignmentQueueResultLimit = 100;

/** At most 1,000 in-scope rows are checked, plus one lookahead. Authorization
 * precedes the 100-result cap. A scan limit never becomes a false empty queue.
 */
export async function boundedReassignmentResults<Row, Result>(rows: readonly Row[], project: (row: Row) => Promise<Result | undefined>): Promise<Result[]> {
  const results: Result[] = [];
  for (const row of rows.slice(0, reassignmentQueueScanLimit)) {
    const result = await project(row);
    if (result !== undefined) results.push(result);
    if (results.length === reassignmentQueueResultLimit) return results;
  }
  if (rows.length > reassignmentQueueScanLimit) throw new ServiceUnavailableException({ code: "reassignment_queue_scan_limit",
    message: "La file autorisée ne peut pas être déterminée dans la limite de lecture. Affinez le périmètre ou consultez la fiche Lead." });
  return results;
}

/** Expand only the current persisted actor's campus scopes. Aliases select the
 * same canonical campus, never a second campus or a role-derived widening.
 */
export async function reassignmentCampusKeys(tx: Prisma.TransactionClient, scopes: readonly Scope[]): Promise<string[]> {
  const keys = new Set<string>();
  for (const scope of scopes) {
    // currentPrincipal also exposes the code and label of the already
    // validated UUID. A display label need not be a declared lookup key.
    if (scope.kind !== "CAMPUS" || keys.has(scope.id)) continue;
    const campus = await canonicalCampus(tx, scope.id);
    for (const key of campus.keys) keys.add(key);
  }
  return [...keys];
}

export function reassignmentRecord(row: StoredRequest): ReassignmentRequest {
  return { id: row.id, leadId: row.leadId, currentOwnerId: row.currentOwnerId, targetUserId: row.targetUserId,
    reason: row.reason, moveOpenTasks: row.moveOpenTasks, requestedBy: row.requestedBy, status: row.status as ReassignmentRequest["status"],
    requestedAt: row.requestedAt.toISOString(), version: row.version,
    ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}), ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
    ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}) };
}

export function assertReassignmentIntent(row: ReassignmentRequest, leadId: string, input: CreateReassignmentInput, actorId: string): void {
  if (row.leadId !== leadId || row.requestedBy !== actorId || row.targetUserId !== input.targetUserId
    || row.reason !== input.reason.trim() || row.moveOpenTasks !== input.moveOpenTasks) throw new ConflictException({ code: "reassignment_idempotency_conflict" });
}

export function decisionFingerprint(id: string, input: DecideReassignmentInput, actorId: string): string {
  return createHash("sha256").update(JSON.stringify({ id, actorId, approved: input.approved, reason: input.reason.trim(),
    expectedVersion: input.expectedVersion ?? 1, idempotencyKey: input.idempotencyKey ?? null })).digest("hex");
}

/** Single caller-owned fenced transaction: owner, request, timeline, audit, receipt
 * and outbox commit together. The original request key and historical authors stay unchanged.
 */
export async function appendReassignmentEffect(tx: Prisma.TransactionClient, lead: Lead, request: ReassignmentRequest,
  principal: Principal, correlationId: string, key: string, fingerprint: string, operation: "REASSIGNMENT_REQUEST" | "REASSIGNMENT_DECISION", transferred = 0): Promise<void> {
  const campus = await canonicalCampus(tx, lead.campus);
  const approved = request.status === "APPROVED";
  const activityType = operation === "REASSIGNMENT_REQUEST" ? "REASSIGNMENT_REQUESTED" : approved ? "ASSIGNMENT_CHANGED" : "REASSIGNMENT_REJECTED";
  const changed = await tx.lead.updateMany({ where: { id: lead.id, version: lead.version,
    ...(operation === "REASSIGNMENT_DECISION" ? { assignedToId: request.currentOwnerId } : {}) }, data: {
    ...(approved ? { assignedToId: request.targetUserId, assignmentMode: "REASSIGNMENT" } : {}),
    version: { increment: 1 }, lastActivityAt: new Date(),
  } });
  if (changed.count !== 1) throw new ConflictException({ code: "reassignment_owner_changed" });
  await tx.leadActivity.create({ data: { id: randomUUID(), leadId: lead.id, type: activityType,
    result: approved ? `${request.currentOwnerId}->${request.targetUserId}` : request.id,
    note: operation === "REASSIGNMENT_REQUEST" ? request.reason : request.decisionReason ?? null,
    authorId: principal.userId, correlationId, idempotencyKey: key, occurredAt: new Date() } });
  const eventType = operation === "REASSIGNMENT_REQUEST" ? "LEAD_REASSIGNMENT_REQUESTED" : approved ? "LEAD_REASSIGNMENT_APPROVED" : "LEAD_REASSIGNMENT_REJECTED";
  await tx.auditEvent.create({ data: { eventType, resourceType: "LEAD", resourceId: lead.id, campusId: campus.id,
    actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, result: "SUCCESS",
    idempotencyKey: `reassignment-audit:${createHash("sha256").update(key).digest("hex")}`,
    after: { requestId: request.id, status: request.status, version: request.version ?? 1, moveOpenTasks: request.moveOpenTasks,
      transferredScheduledFollowUps: transferred, retainedDueFollowUps: true } } });
  await tx.leadMutationReceipt.create({ data: { leadId: lead.id, idempotencyKey: key, fingerprint, operation,
    result: request as unknown as Prisma.InputJsonValue } });
  await tx.localOutboxEvent.create({ data: { topic: "LEAD.MUTATED", aggregateType: "LEAD", aggregateId: lead.id,
    idempotencyKey: `outbox:${key}`, payload: { operation, version: lead.version + 1, status: lead.status, activityTypes: [activityType] } } });
  if (operation === "REASSIGNMENT_DECISION") {
    for (const recipientId of new Set([request.requestedBy, ...(approved ? [request.targetUserId] : [])])) {
      await assignmentNotification(tx, recipientId, lead.id, "REASSIGNMENT_DECISION", key, "/collaborators");
    }
  }
}

export async function transferScheduledFollowUps(tx: Prisma.TransactionClient, request: ReassignmentRequest, principal: Principal, correlationId: string): Promise<number> {
  if (!request.moveOpenTasks) return 0;
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: request.leadId }, select: { campus: true } });
  const campus = await canonicalCampus(tx, lead.campus);
  const scheduled = await tx.leadFollowUp.findMany({ where: { leadId: request.leadId, ownerId: request.currentOwnerId, state: "SCHEDULED" }, orderBy: { id: "asc" } });
  for (const row of scheduled) {
    const changed = await tx.leadFollowUp.updateMany({ where: { id: row.id, ownerId: request.currentOwnerId, state: "SCHEDULED", version: row.version },
      data: { ownerId: request.targetUserId, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ConflictException({ code: "reassignment_follow_up_concurrent" });
    await tx.auditEvent.create({ data: { eventType: "FOLLOW_UP_REASSIGNED", resourceType: "LEAD", resourceId: request.leadId, campusId: campus.id,
      actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, result: "SUCCESS",
      idempotencyKey: `reassignment-follow-up:${request.id}:${row.id}`, before: { ownerId: row.ownerId, version: row.version },
      after: { ownerId: request.targetUserId, version: row.version + 1, state: "SCHEDULED", requestId: request.id } } });
  }
  return scheduled.length;
}
