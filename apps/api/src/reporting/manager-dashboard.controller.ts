import { BadRequestException, Controller, Get, Header, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ManagerDashboardService, type ManagerDashboardQuery, type ManagerDashboardReport } from "./manager-dashboard.service.js";

@Controller("reports/manager-dashboard")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class ManagerDashboardController {
  constructor(@Inject(ManagerDashboardService) private readonly dashboard: ManagerDashboardService) {}
  @Get()
  read(@Query() query: ManagerDashboardQuery, @Req() request: AuthenticatedRequest): ManagerDashboardReport {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.dashboard.read(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
  @Get("export")
  @Header("content-type", "text/csv; charset=utf-8")
  export(@Query() query: ManagerDashboardQuery, @Req() request: AuthenticatedRequest): string {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.dashboard.exportAggregated(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
