import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { LeadService, type LeadActivityRecord } from "./lead.service.js";

@Controller("leads/:leadId/timeline")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class LeadTimelineController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Get()
  list(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): { events: LeadActivityRecord[] } {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return { events: this.leads.timeline(leadId, request.principal) };
  }

  @Post()
  @RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN")
  create(@Param("leadId") leadId: string, @Body() body: { type: string; result: string; note?: string; nextActionAt?: string }, @Req() request: AuthenticatedRequest): LeadActivityRecord {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.addActivity(leadId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
