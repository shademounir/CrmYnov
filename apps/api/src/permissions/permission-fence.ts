import type { Prisma } from "@prisma/client";

export type PermissionTransactionMode = "read" | "read-audited" | "write";

/** One PostgreSQL lock namespace covers every persisted authorization determinant. */
export async function acquirePermissionFence(tx: Prisma.TransactionClient, mode: PermissionTransactionMode): Promise<void> {
  if (mode === "read") await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  await tx.$executeRaw`SET LOCAL lock_timeout = '5000ms'`;
  if (mode !== "write") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(169, 1)`;
    return;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(169, 1)`;
  // A writer with a Serializable snapshot established before its wait must retry
  // before authorization, never execute with the previous writer's identity/grants.
  await tx.rolePermissionEpoch.upsert({ where: { id: 1 }, create: { id: 1, version: 1 }, update: { version: { increment: 1 } } });
}
