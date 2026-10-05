import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Role } from "../auth/auth.types.js";
import type { ConfigurationSnapshot } from "../permissions/dynamic-contract.js";
import { assignmentManagerCapability } from "../permissions/dynamic-evaluator.js";
import { canonicalCampus } from "../permissions/dynamic-resources.js";

export async function assignmentManagerRecipients(tx: Prisma.TransactionClient, campusValue: string, permissions: readonly ConfigurationSnapshot[], permission: "lead.assign" | "lead.reassign.approve", excludeId?: string): Promise<string[]> {
  const campus = await canonicalCampus(tx, campusValue);
  const rows = await tx.collaborator.findMany({ where: { active: true, firstLoginRequired: false, roles: { hasSome: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    OR: [{ campusId: { in: campus.keys } }, { roles: { has: "SUPER_ADMIN" } }] }, select: { id: true, roles: true, campusId: true }, orderBy: { id: "asc" } });
  return rows.filter((row) => row.id !== excludeId && assignmentManagerCapability(row.roles as Role[], permission, permissions,
    { campus: campus.id, active: true, own: false, team: false, campusAllowed: row.roles.includes("SUPER_ADMIN") || Boolean(row.campusId && campus.keys.includes(row.campusId)), globalAllowed: row.roles.includes("SUPER_ADMIN") })).map((row) => row.id);
}

/** Same transaction as the assignment. No asynchronous queue can commit a
 * notification for a business decision which later rolled back.
 */
export async function assignmentNotification(tx: Prisma.TransactionClient, recipientId: string, leadId: string, type: "ASSIGNMENT" | "REASSIGNMENT_DECISION", key: string, suffix: "" | "/collaborators" = ""): Promise<void> {
  const data = { recipientId, type, priority: "NORMAL", resourceType: "LEAD", resourceId: leadId, href: `/leads/${leadId}${suffix}` };
  await tx.internalNotification.create({ data: { ...data, deduplicationKey: `assignment:${createHash("sha256").update(`${key}:${recipientId}`).digest("hex")}`,
    fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex") } });
}
