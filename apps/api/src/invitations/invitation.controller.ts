import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { InvitationService } from "./invitation.service.js";
import { RateLimitService } from "../auth/rate-limit.service.js";

@Controller("invitations")
export class InvitationController {
  constructor(@Inject(InvitationService) private readonly invitations: InvitationService, @Inject(RateLimitService) private readonly rateLimit: RateLimitService) {}

  @Post("completions")
  async complete(@Req() request: Request, @Body() body: { code?: unknown; nextSecret?: unknown }): Promise<{ completed: true }> {
    this.rateLimit.assertAllowed(`invitation:${request.ip ?? "unknown"}`, Date.now(), 5, 60_000);
    return this.invitations.complete(typeof body.code === "string" ? body.code : "", typeof body.nextSecret === "string" ? body.nextSecret : "");
  }
}
