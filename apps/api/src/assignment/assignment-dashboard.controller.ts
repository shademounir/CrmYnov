import { BadRequestException, Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AssignmentDashboardService, type AssignmentDashboard } from "./assignment-dashboard.service.js";

@Controller("assignment/dashboard")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class AssignmentDashboardController {
  constructor(@Inject(AssignmentDashboardService) private readonly dashboard: AssignmentDashboardService) {}
  @Get()
  read(@Req() request: AuthenticatedRequest): AssignmentDashboard { return this.dashboard.read(this.principal(request)); }
  private principal(request: AuthenticatedRequest): Principal {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return request.principal;
  }
}
