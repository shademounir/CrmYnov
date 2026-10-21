import { ConflictException } from "@nestjs/common";
import { createHash, randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AssignmentCandidate } from "./assignment.service.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";

export interface NewEntrantReservation {
  campusId: string; version: number; ruleId: string; userId: string; previousCount: number; eventHash: string;
}

/** Choose randomly among the least-served currently eligible peers, not the old portfolio. */
export function balancedNewEntrant(candidates: readonly AssignmentCandidate[], counts: ReadonlyMap<string, number>, pick: (upper: number) => number = randomInt): { userId: string; previousCount: number } | undefined {
  const eligible = candidates.filter(c => c.active && !c.suspended && !c.excluded && c.activeLeadCount < c.capacity).sort((a, b) => a.userId.localeCompare(b.userId));
  if (!eligible.length) return undefined;
  for (const count of counts.values()) if (!Number.isSafeInteger(count) || count < 0 || count >= 2_147_483_647) throw new ConflictException({ code: "assignment_balance_capacity" });
  const minimum = Math.min(...eligible.map(c => counts.get(c.userId) ?? 0));
  const peers = eligible.filter(c => (counts.get(c.userId) ?? 0) === minimum);
  const index = pick(peers.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= peers.length) throw new ConflictException({ code: "assignment_balance_random_invalid" });
  return { userId: peers[index]!.userId, previousCount: minimum };
}

/** Caller holds the same canonical campus lock as configuration and lead creation. */
export async function reserveNewEntrant(tx: Prisma.TransactionClient, campusId: string, version: number, ruleId: string, eventKey: string, candidates: readonly AssignmentCandidate[]): Promise<NewEntrantReservation | undefined> {
  const rows = await tx.campusNewAssignmentCounter.findMany({ where: { campusId, version, ruleId }, take: 101 });
  if (rows.length > 100) throw new ConflictException({ code: "assignment_balance_capacity" });
  const selected = balancedNewEntrant(candidates, new Map(rows.map(r => [r.userId, r.assignedCount])));
  return selected ? { campusId, version, ruleId, userId: selected.userId, previousCount: selected.previousCount,
    eventHash: createHash("sha256").update(JSON.stringify(["new-entrant-balance-v1", campusId, eventKey])).digest("hex") } : undefined;
}

/** Lead, unique receipt, fairness counter, original creation receipt and audit share one transaction. */
export async function commitNewEntrant(tx: Prisma.TransactionClient, reservation: NewEntrantReservation, leadId: string): Promise<void> {
  const { campusId, version, ruleId, userId, previousCount, eventHash } = reservation;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(171, hashtext(${campusId}))`;
  const previous = await tx.campusNewAssignmentReceipt.findUnique({ where: { eventHash } });
  if (previous) {
    if (previous.leadId !== leadId || previous.campusId !== campusId || previous.version !== version || previous.ruleId !== ruleId || previous.userId !== userId) throw new ConflictException({ code: "assignment_balance_replay_conflict" });
    return;
  }
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { acquisitionKind: true, assignedToId: true, campus: true } });
  if (lead?.acquisitionKind !== "NEW" || lead.assignedToId !== userId || (await canonicalCampus(tx, lead.campus)).id !== campusId) throw new ConflictException({ code: "assignment_balance_new_lead_required" });
  const key = { campusId, version, ruleId, userId };
  const counter = await tx.campusNewAssignmentCounter.findUnique({ where: { campusId_version_ruleId_userId: key } });
  if ((counter?.assignedCount ?? 0) !== previousCount) throw new ConflictException({ code: "assignment_balance_reservation_stale" });
  await tx.campusNewAssignmentCounter.upsert({ where: { campusId_version_ruleId_userId: key }, create: { ...key, assignedCount: 1 }, update: { assignedCount: { increment: 1 } } });
  await tx.campusNewAssignmentReceipt.create({ data: { ...key, eventHash, leadId, countAfter: previousCount + 1 } });
}
