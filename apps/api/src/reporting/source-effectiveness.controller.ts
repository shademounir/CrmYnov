import { BadRequestException, Controller, Get, Inject, Optional, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { SourceEffectivenessService, type SourceEffectivenessQuery, type SourceEffectivenessReport } from "./source-effectiveness.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";

@Controller("reports/source-effectiveness")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class SourceEffectivenessController {
  constructor(@Inject(SourceEffectivenessService) private readonly sourceEffectiveness: SourceEffectivenessService,
    @Optional() @Inject(ReportingPersistenceService) private readonly persistence?: ReportingPersistenceService) {}
  @Get()
  read(@Query() query: SourceEffectivenessQuery, @Req() request: AuthenticatedRequest): SourceEffectivenessReport | Promise<SourceEffectivenessReport> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const read = (principal: NonNullable<AuthenticatedRequest["principal"]>): SourceEffectivenessReport => this.sourceEffectiveness.read(query, principal, request.header("x-correlation-id") ?? "missing-correlation");
    return this.persistence ? this.persistence.withReportingScope(request.principal, async (principal) => this.sourceEffectiveness.read(await this.persistence!.normalizeCampusQuery(principal, query), principal, request.header("x-correlation-id") ?? "missing-correlation")) : read(request.principal);
  }
}
