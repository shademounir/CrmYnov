import { Body, Controller, ForbiddenException, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Scope } from "./auth.types.js";
import { canAccessScope, RbacGuard, RequireRoles } from "./rbac.guard.js";

@Controller("resources")
@UseGuards(RbacGuard)
export class ResourceController {
  @Patch(":resourceId")
  @RequireRoles("SUPER_ADMIN", "ADMIN", "ADMISSIONS")
  update(@Req() request: AuthenticatedRequest, @Param("resourceId") resourceId: string, @Body() body: { ownerId?: string; scope?: Scope }): { resourceId: string; updated: true } {
    const principal = request.principal!;
    if (body.ownerId !== principal.userId && !principal.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException({ code: "resource_not_found" });
    }
    if (!body.scope || !canAccessScope(principal, body.scope)) throw new ForbiddenException({ code: "resource_not_found" });
    return { resourceId, updated: true };
  }
}
