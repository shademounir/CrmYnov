import { Body, Controller, Delete, ForbiddenException, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth.types.js";
import { isRole } from "./auth.types.js";
import { RateLimitService } from "./rate-limit.service.js";
import { RbacGuard, RequireRoles } from "./rbac.guard.js";
import { SessionService } from "./session.service.js";

@Controller("sessions")
export class SessionController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: { userId?: string; roles?: string[] }): { token: string; sessionId: string } {
    this.rateLimit.assertAllowed(request.ip ?? "unknown");
    const userId = String(body.userId ?? "");
    const requestedRoles = body.roles ?? [];
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(userId) || requestedRoles.length === 0 || !requestedRoles.every(isRole)) {
      throw new ForbiddenException({ code: "identity_invalid" });
    }
    return this.sessions.create(userId, requestedRoles, [{ kind: "GLOBAL" }]);
  }

  @Delete(":sessionId")
  @UseGuards(RbacGuard)
  revoke(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string): { revoked: boolean } {
    if (request.principal?.sessionId !== sessionId && !request.principal?.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException({ code: "session_ownership_required" });
    }
    return { revoked: this.sessions.revoke(sessionId) };
  }

  @Post("users/:userId/revoke")
  @UseGuards(RbacGuard)
  @RequireRoles("SUPER_ADMIN")
  revokeUser(@Param("userId") userId: string): { revokedSessions: number } {
    return { revokedSessions: this.sessions.revokeUser(userId) };
  }
}
