import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AccessRecoveryService, RECOVERY_ACCEPTED } from "./access-recovery.service.js";
import { AccessRecoveryRateLimitGuard } from "./access-recovery-rate-limit.guard.js";

@Controller("access-recovery")
@UseGuards(AccessRecoveryRateLimitGuard)
export class AccessRecoveryController {
  constructor(@Inject(AccessRecoveryService) private readonly recovery: AccessRecoveryService) {}

  @Post("requests")
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Req() request: Request,
    @Body() body: { email?: unknown; returnPath?: unknown } = {},
  ): Promise<typeof RECOVERY_ACCEPTED> {
    void request; // Client quota is committed by the guard, before the business transaction.
    return this.recovery.requestForApi(body.email, body.returnPath);
  }

  @Post("completions")
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(@Body() body: { token?: unknown; returnPath?: unknown; nextSecret?: unknown } = {}): Promise<void> {
    await this.recovery.completeForApi(body.token, body.returnPath, body.nextSecret);
  }
}
