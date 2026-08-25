import { Body, Controller, Delete, ForbiddenException, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Scope } from "./auth.types.js";
import { RateLimitService } from "./rate-limit.service.js";
import { RbacGuard, RequireRoles } from "./rbac.guard.js";
import { SessionService } from "./session.service.js";
import { AuditService } from "../audit/audit.service.js";
import { digestRecoveryValue, LocalCredentialAdapter } from "../access-recovery/access-recovery.store.js";
import { UserService } from "../users/user.service.js";

@Controller("sessions")
export class SessionController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LocalCredentialAdapter) private readonly credentials: LocalCredentialAdapter,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  @Post()
  async create(@Req() request: AuthenticatedRequest, @Body() body: { email?: string; password?: string }): Promise<{ token: string; sessionId: string }> {
    this.rateLimit.assertAllowed(request.ip ?? "unknown");
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const verified = this.credentials.verifyIdentity(digestRecoveryValue(email), password);
    const user = verified ? this.users.findById(verified.subjectId) : undefined;
    if (!verified || !user?.active || user.professionalEmail !== email) throw new ForbiddenException({ code: "identity_invalid" });
    const scopes: Scope[] = [];
    if (user.roles.some((role) => role === "SUPER_ADMIN" || role === "ADMIN" || role === "AUDITOR")) scopes.push({ kind: "GLOBAL" });
    else {
      if (user.campusId) scopes.push({ kind: "CAMPUS", id: user.campusId });
      if (user.teamId) scopes.push({ kind: "TEAM", id: user.teamId });
    }
    if (scopes.length === 0) throw new ForbiddenException({ code: "identity_scope_missing" });
    const created = this.sessions.create(user.id, user.roles, scopes, 3_600_000, verified.mustChange, user.authenticationVersion);
    await this.sessions.flush();
    this.audit.record({ eventType: "SESSION_CREATED", actorId: user.id, actorRoles: user.roles, sessionId: created.sessionId, correlationId: request.header("x-correlation-id") ?? "generated", result: "SUCCESS", idempotencyKey: `session-created:${created.sessionId}`, ip: request.ip });
    return created;
  }

  @Delete(":sessionId")
  @UseGuards(RbacGuard)
  async revoke(@Req() request: AuthenticatedRequest, @Param("sessionId") sessionId: string): Promise<{ revoked: boolean }> {
    if (request.principal?.sessionId !== sessionId && !request.principal?.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException({ code: "session_ownership_required" });
    }
    const revoked = this.sessions.revoke(sessionId);
    await this.sessions.flush();
    this.audit.record({ eventType: "SESSION_REVOKED", actorId: request.principal.userId, actorRoles: request.principal.roles, sessionId, correlationId: request.header("x-correlation-id") ?? "generated", result: revoked ? "SUCCESS" : "FAILED", idempotencyKey: `session-revoked:${sessionId}`, ip: request.ip });
    return { revoked };
  }

  @Post("users/:userId/revoke")
  @UseGuards(RbacGuard)
  @RequireRoles("SUPER_ADMIN")
  async revokeUser(@Req() request: AuthenticatedRequest, @Param("userId") userId: string): Promise<{ revokedSessions: number }> {
    const revokedSessions = this.sessions.revokeUser(userId);
    await this.sessions.flush();
    this.audit.record({ eventType: "USER_SESSIONS_REVOKED", actorId: request.principal!.userId, actorRoles: request.principal!.roles, sessionId: request.principal!.sessionId, correlationId: request.header("x-correlation-id") ?? "generated", after: { subjectId: userId, revokedSessions }, result: "SUCCESS", idempotencyKey: `user-sessions-revoked:${request.principal!.sessionId}:${userId}:${request.header("x-correlation-id") ?? "generated"}`, ip: request.ip });
    return { revokedSessions };
  }
}
