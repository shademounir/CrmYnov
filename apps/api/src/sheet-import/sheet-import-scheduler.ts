import { Injectable, Inject, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service.js";

export abstract class ScheduledSheetExecutor {
  abstract execute(connectorId: string, trigger: "MANUAL" | "SCHEDULED"): Promise<void>;
}

/** Polling is independent of browsers. PostgreSQL remains the authority for due times and leases. */
@Injectable()
export class SheetImportScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private pending: Promise<void> | undefined;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScheduledSheetExecutor) private readonly executor: ScheduledSheetExecutor) {}

  onModuleInit(): void {
    if (this.prisma.enabled && process.env.CRM_BACKGROUND_WORKERS !== "external") this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
  }

  async tick(): Promise<void> {
    const client = this.prisma.client;
    if (!client || this.stopped) return;
    const connectors = await client.sheetImportConnector.findMany({
      where: { OR: [{ enabled: true }, { manualRequested: true }, { activeRunId: { not: null }, runs: { some: { trigger: "MANUAL", status: "RUNNING" } } }], nextRunAt: { lte: new Date() } },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }], take: 20, select: { id: true },
    });
    for (const connector of connectors) {
      if (this.stopped) return;
      // One unavailable connector must not stop other campuses. Executor persists its own minimized failure.
      await this.executor.execute(connector.id, "SCHEDULED").catch(() => undefined);
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.pending = this.tick().catch(() => undefined).finally(() => {
        this.pending = undefined;
        if (!this.stopped) this.schedule();
      });
    }, 1_000);
    this.timer.unref();
  }
}
