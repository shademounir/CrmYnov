import { Body, Controller, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { FirstLoginService } from "./first-login.service.js";

@Controller("first-login")
export class FirstLoginController {
  constructor(@Inject(FirstLoginService) private readonly firstLogin: FirstLoginService) {}

  @Post("change-secret")
  async change(@Req() request: AuthenticatedRequest, @Body() body: { currentSecret?: string; nextSecret?: string }): Promise<{ revokedSessions: number }> {
    if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" });
    const result = this.firstLogin.change(request.principal.userId, String(body.currentSecret ?? ""), String(body.nextSecret ?? ""), request.header("x-correlation-id") ?? "generated");
    await this.firstLogin.flush();
    return result;
  }
}
