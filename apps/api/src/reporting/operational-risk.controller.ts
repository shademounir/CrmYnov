import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { OperationalRiskService, type OperationalRiskQuery, type OperationalRiskReport } from "./operational-risk.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";

@Controller("reports/operational-risks")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class OperationalRiskController {
  constructor(@Inject(OperationalRiskService) private readonly service: OperationalRiskService) {}
  @Get()
  read(@Query() query: OperationalRiskQuery, @Req() request: AuthenticatedRequest): OperationalRiskReport {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.service.read(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
