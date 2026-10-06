import { BadRequestException, Controller, Get, Inject, Optional, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { SharedContributionService, type SharedContributionQuery, type SharedContributionReport } from "./shared-contribution.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";
import { normalizeScopedReportingQuery, reportingScopeRequirements } from "./reporting-filter.js";
@Controller("reports/shared-contributions")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class SharedContributionController {
  constructor(@Inject(SharedContributionService) private readonly service: SharedContributionService,
    @Optional() @Inject(ReportingPersistenceService) private readonly persistence?: ReportingPersistenceService) {}
  @Get()
  read(@Query() query: SharedContributionQuery, @Req() request: AuthenticatedRequest): SharedContributionReport | Promise<SharedContributionReport> {
    if (!request.principal) {
      throw new BadRequestException({ code: "principal_missing" });
    }
    const read = (principal: NonNullable<AuthenticatedRequest["principal"]>): SharedContributionReport => this.service.read(query, principal, request.header("x-correlation-id") ?? "missing-correlation");
    return this.persistence ? this.persistence.withReportingScope(request.principal, async (principal) => this.service.read(normalizeScopedReportingQuery({ ...await this.persistence!.normalizeCampusQuery(principal, query) }, principal), principal, request.header("x-correlation-id") ?? "missing-correlation"), (current) => reportingScopeRequirements(query, current)) : read(request.principal);
  }
}
