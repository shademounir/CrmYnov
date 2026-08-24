import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { LeadService, type CreateLeadInput, type CreateLeadResult, type LeadActivityRecord, type LeadListQuery, type LeadPage, type LeadRecord } from "./lead.service.js";

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

@Controller("leads/:leadId/status")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN")
export class LeadStatusController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Patch()
  update(@Param("leadId") leadId: string, @Body() body: { status: string; reason?: string }, @Req() request: AuthenticatedRequest): LeadRecord {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.changeStatus(leadId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}

@Controller("leads")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN")
export class LeadController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Post()
  create(@Body() body: CreateLeadInput, @Req() request: AuthenticatedRequest): CreateLeadResult {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.createLead(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get()
  @RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  list(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): LeadPage {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const normalized: LeadListQuery = { page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 25) };
    for (const key of ["search", "assignedToId", "status", "source", "program", "campaign", "campus", "createdFrom", "createdTo", "assignmentMode", "importBatchId", "view", "savedView", "sortBy", "sortDirection"] as const) {
      if (query[key] !== undefined) normalized[key] = query[key];
    }
    return this.leads.listLeads(normalized, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get(":leadId")
  @RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  detail(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): LeadRecord {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.getLead(leadId, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
