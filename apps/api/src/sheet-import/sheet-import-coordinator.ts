import { randomUUID } from "node:crypto";
import type { Prisma, SheetImportConnector, SheetImportRun } from "@prisma/client";
import type { PrismaService } from "../persistence/prisma.service.js";

export interface SheetLease { connectorId: string; runId: string; epoch: number; version: number }
export type SheetClaim = { lease: SheetLease; connector: SheetImportConnector; run: SheetImportRun } | undefined;

/** Short database transactions only. Callers perform remote reads and retry waits outside this coordinator. */
export class SheetImportCoordinator {
  constructor(private readonly prisma: PrismaService, private readonly clock: () => Date = () => new Date()) {}

  async claim(connectorId: string, trigger: "MANUAL" | "SCHEDULED"): Promise<SheetClaim> {
    const now = this.clock();
    return this.client.$transaction(async (tx): Promise<SheetClaim> => {
      const claimed = await tx.sheetImportConnector.updateMany({
        where: { id: connectorId, enabled: true, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
          AND: [{ OR: [{ activeRunId: null }, { nextRunAt: { lte: now } }] }],
          ...(trigger === "SCHEDULED" ? { nextRunAt: { lte: now } } : {}) },
        data: { epoch: { increment: 1 }, leaseUntil: new Date(now.valueOf() + 30_000) },
      });
      if (claimed.count !== 1) return undefined;
      const connector = await tx.sheetImportConnector.findUniqueOrThrow({ where: { id: connectorId } });
      const run = await this.execution(tx, connector, connector.manualRequested ? "MANUAL" : trigger, now);
      if (connector.manualRequested) await tx.sheetImportConnector.update({ where: { id: connectorId }, data: { manualRequested: false } });
      return { connector, run, lease: { connectorId, runId: run.id, epoch: connector.epoch, version: connector.version } };
    });
  }

  private async execution(tx: Prisma.TransactionClient, connector: SheetImportConnector, trigger: "MANUAL" | "SCHEDULED", now: Date): Promise<SheetImportRun> {
    if (connector.activeRunId) {
      const previous = await tx.sheetImportRun.findUniqueOrThrow({ where: { id: connector.activeRunId } });
      if (previous.configurationVersion === connector.version && previous.configurationSnapshot !== null && previous.status === "RUNNING") return previous;
      // Never resume an old or changed configuration under a different mapping.
      await tx.sheetImportRun.update({ where: { id: previous.id }, data: { status: "CANCELLED", errorCode: "sheet_configuration_changed", completedAt: now } });
    }
    const run = await tx.sheetImportRun.create({ data: {
      id: randomUUID(), connectorId: connector.id, status: "RUNNING", trigger, startedAt: now,
      configurationVersion: connector.version,
      configurationSnapshot: { configuration: connector.configuration, workbookId: connector.workbookId, tab: connector.tab, campusId: connector.campusId, authorizedBy: connector.updatedBy },
    } });
    await tx.sheetImportConnector.update({ where: { id: connector.id }, data: { activeRunId: run.id } });
    return run;
  }

  async renew(lease: SheetLease): Promise<void> {
    await this.transaction(lease, async (tx): Promise<void> => {
      await tx.sheetImportConnector.update({ where: { id: lease.connectorId }, data: { leaseUntil: new Date(this.clock().valueOf() + 30_000) } });
    });
  }

  async defer(lease: SheetLease, delayMs: number, errorCode: string): Promise<void> {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 900_000 || !/^[a-z_]{1,80}$/u.test(errorCode)) throw new Error("sheet_retry_context_invalid");
    await this.transaction(lease, async (tx): Promise<void> => {
      await tx.sheetImportRun.update({ where: { id: lease.runId }, data: { sourceFailures: { increment: 1 }, errorCode } });
      await tx.sheetImportConnector.update({ where: { id: lease.connectorId }, data: { nextRunAt: new Date(this.clock().valueOf() + delayMs) } });
    });
    // Separate guarded release: a takeover between these transactions cannot be released by the old worker.
    await this.client.sheetImportConnector.updateMany({ where: { id: lease.connectorId, epoch: lease.epoch, version: lease.version, activeRunId: lease.runId }, data: { leaseUntil: null } });
  }

  async transaction<T>(lease: SheetLease, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (tx): Promise<T> => {
      await this.fence(tx, lease);
      const result = await this.prisma.withTransaction(tx, () => action(tx));
      await this.fence(tx, lease);
      return result;
    }, { timeout: 10_000, maxWait: 5_000 });
  }

  async finish(lease: SheetLease, errorCode?: string): Promise<void> {
    if (errorCode && !/^[a-z_]{1,80}$/u.test(errorCode)) throw new Error("sheet_error_code_invalid");
    await this.client.$transaction(async (tx): Promise<void> => {
      await this.fence(tx, lease);
      const connector = await tx.sheetImportConnector.findUniqueOrThrow({ where: { id: lease.connectorId } });
      const now = this.clock();
      await tx.sheetImportRun.update({ where: { id: lease.runId }, data: { status: errorCode ? "FAILED" : "COMPLETED", errorCode: errorCode ?? null, completedAt: now } });
      await tx.sheetImportConnector.update({ where: { id: lease.connectorId }, data: {
        activeRunId: null, leaseUntil: null, nextRunAt: new Date(now.valueOf() + connector.intervalMinutes * 60_000),
      } });
    });
  }

  private async fence(tx: Prisma.TransactionClient, lease: SheetLease): Promise<void> {
    // UPDATE locks this row until commit; a takeover, edit or disable cannot race a business commit.
    const guarded = await tx.sheetImportConnector.updateMany({
      where: { id: lease.connectorId, enabled: true, epoch: lease.epoch, version: lease.version, activeRunId: lease.runId, leaseUntil: { gt: this.clock() } },
      data: { epoch: { increment: 0 } },
    });
    if (guarded.count !== 1) throw new Error("sheet_lease_lost");
  }

  private get client(): NonNullable<PrismaService["client"]> {
    if (!this.prisma.client) throw new Error("sheet_database_unavailable");
    return this.prisma.client;
  }
}
