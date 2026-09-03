import { ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { configurationKey, validateGrants, validateTarget, type ConfigurationInput, type ConfigurationSnapshot, type ConfigurationTarget, type Grants } from "./dynamic-contract.js";
import type { Principal } from "../auth/auth.types.js";
import { AsyncLocalStorage } from "node:async_hooks";

export type PermissionTransaction = Prisma.TransactionClient;

/** Only a fence conflict before the business handler is safe to retry. */
function retryFenceOrThrow(error: unknown, handlerStarted: boolean, attempt: number): void {
  if (error instanceof HttpException) throw error;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "P2034" && !handlerStarted && attempt < 4) return;
  if (code === "P2034" || code === "P2002" || code === "P2025") {
    throw new ConflictException({ code: "permission_version_conflict" });
  }
  throw new ServiceUnavailableException({ code: "permission_store_unavailable" });
}

@Injectable()
export class DynamicPermissionRepository {
  private readonly execution = new AsyncLocalStorage<PermissionTransaction>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async transaction<T>(action: (tx: PermissionTransaction) => Promise<T>): Promise<T> {
    const current = this.execution.getStore();
    if (current) return action(current);
    const client = this.prisma.client;
    if (!client) throw new ServiceUnavailableException({ code: "permission_store_unavailable" });
    for (let attempt = 0; ; attempt++) {
      let handlerStarted = false;
      try {
        return await client.$transaction(async (tx) => {
          // One transaction-scoped local lock serializes changes to authorization state.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(169, 1)`;
          // A stale Serializable snapshot waiting behind a revocation must conflict,
          // never execute using the old grants. Every protected unit advances this row.
          await tx.rolePermissionEpoch.upsert({ where: { id: 1 }, create: { id: 1, version: 1 }, update: { version: { increment: 1 } } });
          handlerStarted = true;
          return this.prisma.withTransaction(tx, () => this.execution.run(tx, () => action(tx)));
        }, { isolationLevel: "Serializable", timeout: 30_000, maxWait: 5_000 });
      } catch (error) {
        retryFenceOrThrow(error, handlerStarted, attempt);
      }
    }
  }
  async snapshots(tx: PermissionTransaction): Promise<ConfigurationSnapshot[]> {
    const rows = await tx.rolePermissionConfiguration.findMany({ include: { versions: { orderBy: { number: "desc" }, take: 1, include: { grants: true } } } });
    return rows.map((row) => {
      const target = { kind: row.kind, role: row.role, campus: row.campus } as ConfigurationTarget;
      validateTarget(target);
      if (configurationKey(target) !== row.id || row.version < 1) throw new Error("permission_configuration_invalid");
      const versions = row.versions.filter((version) => version.number === row.version);
      if (versions.length !== 1) throw new Error("permission_version_missing");
      const grants = Object.fromEntries(versions[0]!.grants.map((grant) => [grant.permission, grant.scope]));
      validateGrants(grants, target);
      return { ...target, id: row.id, version: row.version, grants };
    });
  }
  async append(tx: PermissionTransaction, input: ConfigurationInput, previous: Grants, actor: Principal): Promise<number> {
    const id = configurationKey(input), version = input.expectedVersion + 1;
    if (input.expectedVersion === 0) {
      await tx.rolePermissionConfiguration.create({ data: { id, kind: input.kind, role: input.role, campus: input.campus, version } });
    } else {
      await tx.rolePermissionConfiguration.update({ where: { id, version: input.expectedVersion }, data: { version } });
    }
    await tx.rolePermissionVersion.create({ data: {
      configurationId: id, number: version,
      grants: { create: Object.entries(input.grants).map(([permission, scope]) => ({ permission, scope })) },
      audits: { create: { actorId: actor.userId, actorRoles: [...actor.roles], reason: input.reason, previous, next: input.grants } },
    } });
    return version;
  }
}
