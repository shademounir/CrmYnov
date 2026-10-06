import { BadRequestException, Controller, Get, Inject, Optional, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { OperationalRiskService, type OperationalRiskQuery, type OperationalRiskReport } from "./operational-risk.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";

@Controller("reports/operational-risks")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class OperationalRiskController {
  constructor(@Inject(OperationalRiskService) private readonly service: OperationalRiskService,
    @Optional() @Inject(ReportingPersistenceService) private readonly persistence?: ReportingPersistenceService) {}
  @Get()
  read(@Query() query: OperationalRiskQuery, @Req() request: AuthenticatedRequest): Promise<OperationalRiskReport> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const read = (principal: NonNullable<AuthenticatedRequest["principal"]>): Promise<OperationalRiskReport> => this.service.readForApi(query, principal, request.header("x-correlation-id") ?? "missing-correlation");
    return this.persistence ? this.persistence.withReportingScope(request.principal, async (principal) => this.service.readForApi(await this.persistence!.normalizeCampusQuery(principal, query), principal, request.header("x-correlation-id") ?? "missing-correlation"), ["reporting.pilotage.view"]) : read(request.principal);
  }
}
