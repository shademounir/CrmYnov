import { Body, Controller, Headers, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AuditService } from "../audit/audit.service.js";
import { ForminatorWebhookService, type ForminatorLeadWebhook, type ForminatorWebhookResult } from "./forminator-webhook.service.js";

@Controller("integrations/forminator/v1")
export class ForminatorWebhookController {
  constructor(@Inject(ForminatorWebhookService) private readonly webhooks: ForminatorWebhookService, @Inject(AuditService) private readonly audit: AuditService) {}

  @Post("leads")
  receive(@Body() body: ForminatorLeadWebhook, @Headers("x-forminator-timestamp") timestamp = "", @Headers("x-forminator-signature") signature = "",
    @Headers("x-idempotency-key") idempotencyKey = "", @Req() request: Request): ForminatorWebhookResult {
    const result = this.webhooks.receive({ timestamp, signature, idempotencyKey }, body);
    this.audit.record({ eventType: "FORMINATOR_WEBHOOK_ACCEPTED", actorId: "forminator-zapier", actorRoles: [], ip: request.ip,
      correlationId: request.header("x-correlation-id") ?? "missing-correlation", after: { eventDigest: result.eventDigest, replayed: result.replayed, mutated: false },
      result: "SUCCESS", idempotencyKey: `forminator-webhook:${idempotencyKey}` });
    return result;
  }
}
