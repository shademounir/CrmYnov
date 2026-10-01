import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { correlation } from "./view-sharing.contract.js";

/** Same transaction as the view write. No filter values, names or session identifiers. */
export async function persistViewAudit(tx: Prisma.TransactionClient, actor: Principal, view: { id: string; version: number }, action: string, trace: string): Promise<void> {
  const user = await tx.collaborator.findUniqueOrThrow({ where: { id: actor.userId } });
  await tx.auditEvent.create({ data: {
    actorId: actor.userId, actorRoles: [...actor.roles], campusId: user.campusId,
    resourceType: "SAVED_LEAD_VIEW", resourceId: view.id, eventType: action, result: "SUCCESS",
    correlationId: correlation(trace), idempotencyKey: `view:${action}:${view.id}:${view.version}`,
    after: { version: view.version },
  } });
}
