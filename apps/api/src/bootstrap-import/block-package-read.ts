import type { BootstrapImportPackage } from "@prisma/client";
import type { PermissionTransaction } from "../permissions/dynamic-repository.js";
import type { BlockReadMemo } from "./block-read-memo.js";

/** Re-read mutable package metadata every time. Only a sealed snapshot may be
 * shared by nested operations in this SAME permission-fenced block. No cache
 * survives the transaction, and the upload/seal path keeps its original read. */
export async function readBlockPackage(tx: PermissionTransaction, id: string, memo: BlockReadMemo<PermissionTransaction>): Promise<BootstrapImportPackage | null> {
  if (!memo.active(tx)) return tx.bootstrapImportPackage.findUnique({ where: { id } });
  const current = await tx.bootstrapImportPackage.findUnique({ where: { id }, omit: { snapshot: true } });
  if (!current) return null;
  if (!current.sealedAt) return tx.bootstrapImportPackage.findUnique({ where: { id } });
  const source = await memo.read(tx, `sealed-package:${id}:${current.sha256}:${current.sealedAt.toISOString()}`, () =>
    tx.bootstrapImportPackage.findUnique({ where: { id }, select: { snapshot: true } }));
  return source ? { ...current, snapshot: source.snapshot } : null;
}
