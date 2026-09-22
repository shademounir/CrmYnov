import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { LeadQualificationService, type LeadQualificationInput, type LeadQualificationRecord } from "./lead-qualification.service.js";

@Controller("leads/:leadId/qualification")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class LeadQualificationController {
  constructor(@Inject(LeadQualificationService) private readonly qualifications: LeadQualificationService) {}

  @Get()
  read(@Param("leadId") leadId: string): Promise<{ current: LeadQualificationRecord; history: LeadQualificationRecord[] }> {
    return this.qualifications.read(leadId);
  }

  @Patch()
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
  update(@Param("leadId") leadId: string, @Body() body: LeadQualificationInput, @Req() request: AuthenticatedRequest): Promise<LeadQualificationRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.qualifications.update(leadId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
