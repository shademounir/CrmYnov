import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CommercialWorkService } from "./commercial-work.service.js";
import { workContractVersion, workResponse, type CommercialWorkResponse } from "./commercial-work.response.js";
import { ReportingPersistenceService } from "./reporting-persistence.service.js";
import { ReportingPersistenceGuard } from "./reporting-persistence.guard.js";
import { reportingScopeRequirements } from "./reporting-filter.js";
import { normalizeWorkQuery } from "./commercial-work-query.js";

@Controller("reports/commercial-work")
@UseGuards(RbacGuard, ReportingPersistenceGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class CommercialWorkController {
  constructor(@Inject(CommercialWorkService) private readonly work: CommercialWorkService, @Inject(ReportingPersistenceService) private readonly persistence: ReportingPersistenceService) {}
  @Get()
  async read(@Query() raw: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<CommercialWorkResponse> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const { contractVersion, queue, page, pageSize, adviserScope, taskOwnerId, ...filters } = raw;
    const version = workContractVersion(contractVersion);
    return this.persistence.withReportingScope(request.principal, async (principal) => {
      const canonical = await this.persistence.normalizeCampusQuery(principal, filters);
      const now = new Date(), normalized = normalizeWorkQuery(canonical, principal, now);
      return workResponse(this.work.read(normalized, { queue, page, pageSize, adviserScope, taskOwnerId }, principal, request.header("x-correlation-id") ?? "missing-correlation", now), version);
    }, (principal) => reportingScopeRequirements(filters, principal));
  }
}
