import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { LeadService, type CreateLeadInput, type CreateLeadResult, type InteractionCorrectionInput, type LeadActivityRecord, type LeadListQuery, type LeadPage, type LeadRecord } from "./lead.service.js";

@Controller("leads/:leadId/timeline")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class LeadTimelineController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Get()
  async list(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): Promise<{ events: LeadActivityRecord[] }> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return { events: await this.leads.timelineForApi(leadId, request.principal) };
  }

  @Post()
  @RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN")
  async create(@Param("leadId") leadId: string, @Body() body: { type: string; result: string; note?: string; nextActionAt?: string }, @Req() request: AuthenticatedRequest): Promise<LeadActivityRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.addActivityForApi(leadId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Post(":eventId/corrections")
  @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
  async correct(@Param("leadId") leadId: string, @Param("eventId") eventId: string, @Body() body: InteractionCorrectionInput, @Req() request: AuthenticatedRequest): Promise<LeadActivityRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.correctActivityForApi(leadId, eventId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}

@Controller("leads/:leadId/status")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class LeadStatusController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Patch()
  async update(@Param("leadId") leadId: string, @Body() body: { status: string; reason?: string }, @Req() request: AuthenticatedRequest): Promise<LeadRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.changeStatusForApi(leadId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}

@Controller("leads")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN")
export class LeadController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Post()
  async create(@Body() body: CreateLeadInput, @Req() request: AuthenticatedRequest): Promise<CreateLeadResult> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.createLeadForApi(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get()
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  async list(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<LeadPage> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const normalized: LeadListQuery = { page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 25) };
    for (const key of ["search", "assignedToId", "collaboratorId", "status", "source", "channel", "program", "campaign", "campus", "createdFrom", "createdTo", "assignmentMode", "importBatchId", "view", "savedView", "sortBy", "sortDirection"] as const) {
      if (query[key] !== undefined) normalized[key] = query[key];
    }
    return this.leads.listLeadsForApi(normalized, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get(":leadId")
  @RequireRoles("ADMISSIONS", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  async detail(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): Promise<LeadRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.getLeadForApi(leadId, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
