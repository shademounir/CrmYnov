import { BadRequestException, Controller, Get, Inject, Optional, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CommercialFunnelService, type CommercialFunnel, type CommercialFunnelQuery } from "./commercial-funnel.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";

@Controller("reports/commercial-funnel")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class CommercialFunnelController {
  constructor(@Inject(CommercialFunnelService) private readonly funnel: CommercialFunnelService,
    @Optional() @Inject(ReportingPersistenceService) private readonly persistence?: ReportingPersistenceService) {}
  @Get()
  read(@Query() query: CommercialFunnelQuery, @Req() request: AuthenticatedRequest): CommercialFunnel | Promise<CommercialFunnel> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const read = (principal: NonNullable<AuthenticatedRequest["principal"]>): CommercialFunnel => this.funnel.read(query, principal, request.header("x-correlation-id") ?? "missing-correlation");
    return this.persistence ? this.persistence.withReportingScope(request.principal, async (principal) => this.funnel.read(await this.persistence!.normalizeCampusQuery(principal, query), principal, request.header("x-correlation-id") ?? "missing-correlation")) : read(request.principal);
  }
}
