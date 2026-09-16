import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service.js";
import { FollowUpService } from "./follow-up.service.js";

/** PostgreSQL is the authority for elapsed reminders; browsers never trigger them. */
@Injectable()
export class FollowUpDueScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FollowUpService) private readonly followUps: FollowUpService,
  ) {}

  onModuleInit(): void {
    if (this.prisma.enabled) this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.stopped) return;
    await this.followUps.notifyDueForApi(now);
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
