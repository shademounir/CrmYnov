import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AccessRecoveryService, RECOVERY_ACCEPTED } from "./access-recovery.service.js";

@Controller("access-recovery")
export class AccessRecoveryController {
  constructor(@Inject(AccessRecoveryService) private readonly recovery: AccessRecoveryService) {}

  @Post("requests")
  @HttpCode(HttpStatus.ACCEPTED)
  request(
    @Req() request: Request,
    @Body() body: { email?: unknown; returnPath?: unknown },
  ): typeof RECOVERY_ACCEPTED {
    return this.recovery.request(body.email, body.returnPath, request.ip ?? "unknown");
  }

  @Post("completions")
  @HttpCode(HttpStatus.NO_CONTENT)
  complete(@Body() body: { token?: unknown; returnPath?: unknown; nextSecret?: unknown }): void {
    this.recovery.complete(body.token, body.returnPath, body.nextSecret);
  }
}
