import { ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service.js";
import { configurationKey, historicalGrants, validateTarget, type ConfigurationInput, type ConfigurationSnapshot, type ConfigurationTarget, type Grants, type PermissionScope } from "./dynamic-contract.js";
import type { Principal } from "../auth/auth.types.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { acquirePermissionFence, type PermissionTransactionMode } from "./permission-fence.js";

export type PermissionTransaction = Prisma.TransactionClient;

/** Only a fence conflict before the business handler is safe to retry. */
function retryFenceOrThrow(error: unknown, handlerStarted: boolean, attempt: number): void {
  if (error instanceof HttpException) throw error;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "P2034" && !handlerStarted && attempt < 4) return;
  if (handlerStarted && (code === "P2034" || code === "P2002" || code === "P2025")) {
    throw new ConflictException({ code: "permission_version_conflict" });
  }
  throw new ServiceUnavailableException({ code: "permission_store_unavailable" });
}

@Injectable()
export class DynamicPermissionRepository {
  private readonly execution = new AsyncLocalStorage<{ tx: PermissionTransaction; mode: PermissionTransactionMode }>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  get enabled(): boolean { return this.prisma.enabled; }
  readTransaction<T>(action: (tx: PermissionTransaction) => Promise<T>): Promise<T> {
    return this.transaction(action, "read");
  }
  async transaction<T>(action: (tx: PermissionTransaction) => Promise<T>, mode: PermissionTransactionMode = "write"): Promise<T> {
    const current = this.execution.getStore();
    if (current) {
      if (current.mode !== "write" && mode !== "read" && current.mode !== mode) throw new ServiceUnavailableException({ code: "permission_store_unavailable" });
      return action(current.tx);
    }
    const client = this.prisma.client;
    if (!client) throw new ServiceUnavailableException({ code: "permission_store_unavailable" });
    for (let attempt = 0; ; attempt++) {
      let handlerStarted = false;
      try {
        return await client.$transaction(async (tx) => {
          await acquirePermissionFence(tx, mode);
          handlerStarted = true;
          return this.prisma.withTransaction(tx, () => this.execution.run({ tx, mode }, () => action(tx)));
        }, { isolationLevel: mode === "write" ? "Serializable" : "ReadCommitted", timeout: 30_000, maxWait: 5_000 });
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
      const grants = historicalGrants(Object.fromEntries(versions[0]!.grants.map((grant) => [grant.permission, grant.scope])), target);
      return { ...target, id: row.id, version: row.version, grants };
    });
  }
  /**
   * Append-only catalogue v2 adoption. The global write fence serializes startup
   * across instances; a second instance observes the new grant and performs no write.
   */
  async upgradeQualificationCatalogue(): Promise<number> {
    return this.transaction(async (tx) => {
      const rows = await tx.rolePermissionConfiguration.findMany({
        include: { versions: { orderBy: { number: "desc" }, take: 1, include: { grants: true } } },
      });
      let upgraded = 0;
      for (const row of rows) {
        const latest = row.versions.find((version) => version.number === row.version);
        if (!latest || latest.grants.some((grant) => grant.permission === "lead.qualification.update")) continue;
        const target = { kind: row.kind, role: row.role, campus: row.campus } as ConfigurationTarget;
        validateTarget(target);
        const previous = historicalGrants(Object.fromEntries(latest.grants.map((grant) => [grant.permission, grant.scope])), target);
        let scope: PermissionScope = "NONE";
        if (target.kind === "CEILING" || target.role === "SUPER_ADMIN") scope = target.campus === "GLOBAL" ? "GLOBAL" : "CAMPUS";
        else if (target.role === "ADMIN") scope = "CAMPUS";
        const next = { ...previous, "lead.qualification.update": scope };
        const version = row.version + 1;
        await tx.rolePermissionConfiguration.update({ where: { id: row.id, version: row.version }, data: { version } });
        await tx.rolePermissionVersion.create({ data: {
          configurationId: row.id,
          number: version,
          grants: { create: Object.entries(next).map(([permission, grantScope]) => ({ permission, scope: grantScope })) },
          audits: { create: {
            actorId: "00000000-0000-4000-8000-000000000171",
            actorRoles: ["SYSTEM"],
            reason: "CATALOGUE_UPGRADE",
            previous,
            next,
          } },
        } });
        upgraded += 1;
      }
      return upgraded;
    });
  }
  /** Catalogue v3: free calls default to Super Admin globally and Admin in
   * campus scope. Every other role stays denied until explicitly delegated. */
  async upgradeFreeCallCatalogue(): Promise<number> {
    return this.transaction(async (tx) => {
      const rows = await tx.rolePermissionConfiguration.findMany({ include: { versions: { orderBy: { number: "desc" }, take: 1, include: { grants: true } } } });
      let upgraded = 0;
      for (const row of rows) {
        const latest = row.versions.find((version) => version.number === row.version);
        if (!latest || latest.grants.some((grant) => grant.permission === "telephony.free-call.create")) continue;
        const target = { kind: row.kind, role: row.role, campus: row.campus } as ConfigurationTarget;
        validateTarget(target);
        const previous = historicalGrants(Object.fromEntries(latest.grants.map((grant) => [grant.permission, grant.scope])), target);
        let scope: PermissionScope = "NONE";
        if (target.kind === "CEILING" || target.role === "SUPER_ADMIN") scope = target.campus === "GLOBAL" ? "GLOBAL" : "CAMPUS";
        else if (target.role === "ADMIN") scope = "CAMPUS";
        const next = { ...previous, "telephony.free-call.create": scope };
        const version = row.version + 1;
        await tx.rolePermissionConfiguration.update({ where: { id: row.id, version: row.version }, data: { version } });
        await tx.rolePermissionVersion.create({ data: {
          configurationId: row.id, number: version,
          grants: { create: Object.entries(next).map(([permission, grantScope]) => ({ permission, scope: grantScope })) },
          audits: { create: { actorId: "00000000-0000-4000-8000-000000000165", actorRoles: ["SYSTEM"], reason: "CATALOGUE_UPGRADE", previous, next } },
        } });
        upgraded += 1;
      }
      return upgraded;
    });
  }
  async upgradeCurrentCatalogue(): Promise<number> {
    return this.transaction(async (tx) => {
      const rows = await tx.rolePermissionConfiguration.findMany({ include: { versions: { orderBy: { number: "desc" }, take: 1, include: { grants: true } } } });
      let upgraded = 0;
      for (const row of rows) {
        const latest = row.versions.find((version) => version.number === row.version);
        if (!latest) continue;
        const existing = new Set(latest.grants.map((grant) => grant.permission));
        const missingQualification = !existing.has("lead.qualification.update");
        const missingFreeCall = !existing.has("telephony.free-call.create");
        if (!missingQualification && !missingFreeCall) continue;
        const target = { kind: row.kind, role: row.role, campus: row.campus } as ConfigurationTarget;
        validateTarget(target);
        const previous = historicalGrants(Object.fromEntries(latest.grants.map((grant) => [grant.permission, grant.scope])), target);
        const defaultScope = (): PermissionScope => target.kind === "CEILING" || target.role === "SUPER_ADMIN"
          ? target.campus === "GLOBAL" ? "GLOBAL" : "CAMPUS"
          : target.role === "ADMIN" ? "CAMPUS" : "NONE";
        const next = { ...previous };
        if (missingQualification) next["lead.qualification.update"] = defaultScope();
        if (missingFreeCall) next["telephony.free-call.create"] = defaultScope();
        const version = row.version + 1;
        await tx.rolePermissionConfiguration.update({ where: { id: row.id, version: row.version }, data: { version } });
        await tx.rolePermissionVersion.create({ data: {
          configurationId: row.id, number: version,
          grants: { create: Object.entries(next).map(([permission, grantScope]) => ({ permission, scope: grantScope })) },
          audits: { create: { actorId: "00000000-0000-4000-8000-000000000165", actorRoles: ["SYSTEM"], reason: "CATALOGUE_UPGRADE", previous, next } },
        } });
        upgraded += 1;
      }
      return upgraded;
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
