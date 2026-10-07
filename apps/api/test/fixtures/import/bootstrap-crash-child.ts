import "reflect-metadata";
import { BootstrapImportService } from "../../../src/bootstrap-import/bootstrap-import.service.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../../../src/permissions/dynamic-repository.js";
import type { PermissionTransactionMode } from "../../../src/permissions/permission-fence.js";
import { PrismaService } from "../../../src/persistence/prisma.service.js";
import type { Principal } from "../../../src/auth/auth.types.js";
import type { BootstrapConfirmInput } from "../../../src/bootstrap-import/bootstrap-import.contract.js";

export async function crashChildEntrypoint(): Promise<void> {
const instruction = JSON.parse(process.env.CRMY61_CRASH_INSTRUCTION ?? "null") as { stage: "before_commit" | "after_commit"; packageId: string; input: BootstrapConfirmInput; actor: Principal } | null;
if (process.env.CRMY61_EPHEMERAL_TEST !== "true" || !instruction || !process.send) throw new Error("synthetic_child_not_authorized");
const database = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/crmy61_bootstrap_synthetic") throw new Error("synthetic_child_database_refused");
const prisma = new PrismaService();
const markers = await prisma.client!.$queryRaw<Array<{ nonce: string }>>`SELECT nonce FROM crmy61_test_identity.marker WHERE purpose='historical-bootstrap-synthetic-qualification'`;
if (!process.env.CRMY61_DATABASE_NONCE || !markers.some((row) => row.nonce === process.env.CRMY61_DATABASE_NONCE)) throw new Error("synthetic_child_nonce_refused");
class InterruptedRepository extends DynamicPermissionRepository {
  override transaction<T>(action: (tx: PermissionTransaction) => Promise<T>, mode: PermissionTransactionMode = "write"): Promise<T> {
    return super.transaction((tx) => action(new Proxy(tx, { get(target, property, receiver): unknown {
      if (property !== "auditEvent") return Reflect.get(target, property, receiver) as unknown;
      return new Proxy(target.auditEvent, { get(delegate, method, delegateReceiver): unknown {
        if (method !== "create") return Reflect.get(delegate, method, delegateReceiver) as unknown;
        return async (input: Parameters<typeof delegate.create>[0]): Promise<unknown> => {
          if (instruction!.stage === "before_commit" && input.data.eventType === "BOOTSTRAP_ROW_COMMITTED") {
            process.send!({ stage: "before_commit" }); await new Promise<never>(() => {});
          }
          return delegate.create(input);
        };
      } });
    } })), mode);
  }
}
const repository = instruction.stage === "before_commit" ? new InterruptedRepository(prisma) : new DynamicPermissionRepository(prisma);
await new BootstrapImportService(repository).confirm(instruction.packageId, instruction.input, instruction.actor);
// Deliberately do not return an application acknowledgement to the parent.
process.send({ stage: "after_commit" }); await new Promise<never>(() => {});
}
if (process.env.CRMY61_CRASH_CHILD === "true") void crashChildEntrypoint().catch(() => { process.stderr.write("synthetic_crash_child_failed\n"); process.exitCode = 1; });
