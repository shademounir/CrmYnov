import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { SourceEffectivenessService, type SourceEffectivenessQuery, type SourceEffectivenessReport } from "./source-effectiveness.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";

@Controller("reports/source-effectiveness")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class SourceEffectivenessController {
  constructor(@Inject(SourceEffectivenessService) private readonly sourceEffectiveness: SourceEffectivenessService) {}
  @Get()
  read(@Query() query: SourceEffectivenessQuery, @Req() request: AuthenticatedRequest): SourceEffectivenessReport {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.sourceEffectiveness.read(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
