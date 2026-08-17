import { Body, Controller, Delete, ForbiddenException, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth.types.js";
import { isRole } from "./auth.types.js";
import { RateLimitService } from "./rate-limit.service.js";
import { RbacGuard, RequireRoles } from "./rbac.guard.js";
import { SessionService } from "./session.service.js";
import { AuditService } from "../audit/audit.service.js";
import { LocalCredentialAdapter } from "../access-recovery/access-recovery.store.js";

@Controller("sessions")
export class SessionController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LocalCredentialAdapter) private readonly credentials: LocalCredentialAdapter,
  ) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: { userId?: string; roles?: string[] }): { token: string; sessionId: string } {
    this.rateLimit.assertAllowed(request.ip ?? "unknown");
    const userId = String(body.userId ?? "");
    const requestedRoles = body.roles ?? [];
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(userId) || requestedRoles.length === 0 || !requestedRoles.every(isRole)) {
      throw new ForbiddenException({ code: "identity_invalid" });
    }
    const created = this.sessions.create(userId, requestedRoles, [{ kind: "GLOBAL" }], 3_600_000, this.credentials.requiresChange(userId));
    this.audit.record({ eventType: "SESSION_CREATED", actorId: userId, actorRoles: requestedRoles, sessionId: created.sessionId, correlationId: request.header("x-correlation-id") ?? "generated", result: "SUCCESS", idempotencyKey: `session-created:${created.sessionId}`, ip: request.ip });
    return created;
  }

  @Delete(":sessionId")
  @UseGuards(RbacGuard)
  revoke(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string): { revoked: boolean } {
    if (request.principal?.sessionId !== sessionId && !request.principal?.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException({ code: "session_ownership_required" });
    }
    const revoked = this.sessions.revoke(sessionId);
    this.audit.record({ eventType: "SESSION_REVOKED", actorId: request.principal.userId, actorRoles: request.principal.roles, sessionId, correlationId: request.header("x-correlation-id") ?? "generated", result: revoked ? "SUCCESS" : "FAILED", idempotencyKey: `session-revoked:${sessionId}`, ip: request.ip });
    return { revoked };
  }

  @Post("users/:userId/revoke")
  @UseGuards(RbacGuard)
  @RequireRoles("SUPER_ADMIN")
  revokeUser(@Req() request: AuthenticatedRequest, @Param("userId") userId: string): { revokedSessions: number } {
    const revokedSessions = this.sessions.revokeUser(userId);
    this.audit.record({ eventType: "USER_SESSIONS_REVOKED", actorId: request.principal!.userId, actorRoles: request.principal!.roles, sessionId: request.principal!.sessionId, correlationId: request.header("x-correlation-id") ?? "generated", after: { subjectId: userId, revokedSessions }, result: "SUCCESS", idempotencyKey: `user-sessions-revoked:${request.principal!.sessionId}:${userId}:${request.header("x-correlation-id") ?? "generated"}`, ip: request.ip });
    return { revokedSessions };
  }
}
