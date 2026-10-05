import { BadRequestException, Controller, Get, Header, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ManagerDashboardService, type ManagerDashboardReport, type PersonalDashboardReport } from "./manager-dashboard.service.js";
import { ReportingPersistenceService, type RecentDashboardLeads } from "./reporting-persistence.service.js";

@Controller("reports/manager-dashboard")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class ManagerDashboardController {
  constructor(@Inject(ManagerDashboardService) private readonly dashboard: ManagerDashboardService) {}
  @Get()
  read(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<ManagerDashboardReport> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.dashboard.readForApi(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
  @Get("export")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", "attachment; filename=crm-manager-dashboard-v1.csv")
  export(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<string> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.dashboard.exportAggregatedForApi(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}

@Controller("reports/personal-dashboard")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class PersonalDashboardController {
  constructor(@Inject(ManagerDashboardService) private readonly dashboard: ManagerDashboardService) {}
  @Get()
  read(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<PersonalDashboardReport> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.dashboard.readPersonalForApi(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}

@Controller("reports/dashboard/recent-leads")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class DashboardRecentLeadsController {
  constructor(@Inject(ReportingPersistenceService) private readonly persistence: ReportingPersistenceService) {}
  @Get()
  read(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<RecentDashboardLeads> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const { limit, ...filters } = query;
    return this.persistence.recentLeads(request.principal, filters, limit === undefined ? 5 : Number(limit));
  }
}
