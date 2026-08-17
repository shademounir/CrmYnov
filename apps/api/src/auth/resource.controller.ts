import { Body, Controller, ForbiddenException, Inject, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Scope } from "./auth.types.js";
import { canAccessScope, RbacGuard, RequireRoles } from "./rbac.guard.js";
import { AuditService } from "../audit/audit.service.js";

@Controller("resources")
@UseGuards(RbacGuard)
export class ResourceController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Patch(":resourceId")
  @RequireRoles("SUPER_ADMIN", "ADMIN", "ADMISSIONS")
  update(@Req() request: AuthenticatedRequest, @Param("resourceId") resourceId: string, @Body() body: { ownerId?: string; scope?: Scope }): { resourceId: string; updated: true } {
    const principal = request.principal!;
    if (body.ownerId !== principal.userId && !principal.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException({ code: "resource_not_found" });
    }
    if (!body.scope || !canAccessScope(principal, body.scope)) throw new ForbiddenException({ code: "resource_not_found" });
    this.audit.record({ eventType: "RESOURCE_UPDATED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId: request.header("x-correlation-id") ?? "generated", before: { resourceId }, after: { resourceId, ownerId: body.ownerId, scope: body.scope }, result: "SUCCESS", idempotencyKey: `resource-updated:${principal.sessionId}:${resourceId}:${request.header("x-correlation-id") ?? "generated"}`, ip: request.ip });
    return { resourceId, updated: true };
  }
}
