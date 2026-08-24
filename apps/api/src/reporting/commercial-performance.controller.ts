import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CommercialPerformanceService, type CommercialPerformanceQuery, type CommercialPerformanceReport } from "./commercial-performance.service.js";

@Controller("reports/commercial-performance")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class CommercialPerformanceController {
  constructor(@Inject(CommercialPerformanceService) private readonly performance: CommercialPerformanceService) {}
  @Get()
  read(@Query() query: CommercialPerformanceQuery, @Req() request: AuthenticatedRequest): CommercialPerformanceReport {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.performance.read(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
