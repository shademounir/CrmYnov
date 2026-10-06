import { BadRequestException, Controller, Get, Inject, Optional, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CommercialPerformanceService, type CommercialPerformanceQuery, type CommercialPerformanceReport } from "./commercial-performance.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";
import { normalizeScopedReportingQuery, reportingScopeRequirements } from "./reporting-filter.js";

@Controller("reports/commercial-performance")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class CommercialPerformanceController {
  constructor(@Inject(CommercialPerformanceService) private readonly performance: CommercialPerformanceService,
    @Optional() @Inject(ReportingPersistenceService) private readonly persistence?: ReportingPersistenceService) {}
  @Get()
  read(@Query() query: CommercialPerformanceQuery, @Req() request: AuthenticatedRequest): CommercialPerformanceReport | Promise<CommercialPerformanceReport> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const read = (principal: NonNullable<AuthenticatedRequest["principal"]>): CommercialPerformanceReport => this.performance.read(query, principal, request.header("x-correlation-id") ?? "missing-correlation");
    return this.persistence ? this.persistence.withReportingScope(request.principal, async (principal) => {
      const { inactivityHours, ...filters } = await this.persistence!.normalizeCampusQuery(principal, query);
      const normalized = normalizeScopedReportingQuery(filters, principal);
      return this.performance.read({ ...normalized, ...(inactivityHours ? { inactivityHours } : {}) }, principal, request.header("x-correlation-id") ?? "missing-correlation");
    }, (current) => reportingScopeRequirements(query, current)) : read(request.principal);
  }
}
