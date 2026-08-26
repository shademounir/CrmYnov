import { Inject, Injectable } from "@nestjs/common";
import type { LocalOutboxEvent } from "@prisma/client";
import { LocalOutboxRepository } from "./local-outbox.repository.js";

export type LocalOutboxHandler = (event: Readonly<LocalOutboxEvent>) => Promise<void>;

@Injectable()
export class LocalOutboxWorker {
  private readonly handlers = new Map<string, LocalOutboxHandler>();
  constructor(@Inject(LocalOutboxRepository) private readonly outbox: LocalOutboxRepository) {}
  register(topic: string, handler: LocalOutboxHandler): void { if (this.handlers.has(topic)) throw new Error("outbox_handler_duplicate"); this.handlers.set(topic, handler); }
  async drainOnce(workerId: string, limit = 10): Promise<{ claimed: number; delivered: number; failed: number }> {
    const events = await this.outbox.claim(workerId, limit); let delivered = 0; let failed = 0;
    for (const event of events) {
      const handler = this.handlers.get(event.topic);
      try { if (!handler) throw new Error("handler_missing"); await handler(event); if (await this.outbox.delivered(event.id, workerId)) delivered += 1; }
      catch (error) { const code = error instanceof Error && /^[a-z][a-z0-9_]{2,79}$/.test(error.message) ? error.message : "handler_failed"; if (await this.outbox.failed(event.id, workerId, code)) failed += 1; }
    }
    return { claimed: events.length, delivered, failed };
  }
}
