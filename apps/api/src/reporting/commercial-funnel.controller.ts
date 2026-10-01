import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CommercialFunnelService, type CommercialFunnel, type CommercialFunnelQuery } from "./commercial-funnel.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";

@Controller("reports/commercial-funnel")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class CommercialFunnelController {
  constructor(@Inject(CommercialFunnelService) private readonly funnel: CommercialFunnelService) {}
  @Get()
  read(@Query() query: CommercialFunnelQuery, @Req() request: AuthenticatedRequest): CommercialFunnel {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.funnel.read(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
