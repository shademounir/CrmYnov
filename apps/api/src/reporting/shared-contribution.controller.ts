import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { SharedContributionService, type SharedContributionQuery, type SharedContributionReport } from "./shared-contribution.service.js";
@Controller("reports/shared-contributions") @UseGuards(RbacGuard) @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class SharedContributionController {
  constructor(@Inject(SharedContributionService) private readonly service: SharedContributionService) {}
  @Get() read(@Query() query: SharedContributionQuery, @Req() request: AuthenticatedRequest): SharedContributionReport { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return this.service.read(query, request.principal, request.header("x-correlation-id") ?? "missing-correlation"); }
}
