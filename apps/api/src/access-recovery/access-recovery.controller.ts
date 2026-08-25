import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AccessRecoveryService, RECOVERY_ACCEPTED } from "./access-recovery.service.js";

@Controller("access-recovery")
export class AccessRecoveryController {
  constructor(@Inject(AccessRecoveryService) private readonly recovery: AccessRecoveryService) {}

  @Post("requests")
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Req() request: Request,
    @Body() body: { email?: unknown; returnPath?: unknown },
  ): Promise<typeof RECOVERY_ACCEPTED> {
    const result = this.recovery.request(body.email, body.returnPath, request.ip ?? "unknown");
    await this.recovery.flush();
    return result;
  }

  @Post("completions")
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(@Body() body: { token?: unknown; returnPath?: unknown; nextSecret?: unknown }): Promise<void> {
    this.recovery.complete(body.token, body.returnPath, body.nextSecret);
    await this.recovery.flush();
  }
}
