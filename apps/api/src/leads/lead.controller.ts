import { BadRequestException, Body, Controller, Get, Inject, Optional, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ViewSharingService } from "./view-sharing.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { LeadService, type CreateLeadInput, type CreateLeadResult, type InteractionCorrectionInput, type LeadActivityRecord, type LeadListQuery, type LeadPage, type LeadRecord, type UpdateLeadInput } from "./lead.service.js";

@Controller("leads/:leadId/timeline")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
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
  constructor(@Inject(LeadService) private readonly leads: LeadService,
    @Optional() @Inject(ViewSharingService) private readonly sharedViews?: ViewSharingService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  @Get("filter-options")
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  async filterOptions(@Req() request: AuthenticatedRequest): Promise<{ advisers: Array<{ id: string; label: string }>; collaborators: Array<{ id: string; label: string }> }> {
    const principal = request.principal;
    if (!principal?.permissionLeadIds || !this.prisma?.client) throw new BadRequestException({ code: "lead_filter_context_unavailable" });
    const leads = await this.prisma.client.lead.findMany({ where: { id: { in: [...principal.permissionLeadIds] } }, select: { assignedToId: true, collaborators: { where: { active: true }, select: { userId: true } } } });
    const ids = [...new Set(leads.flatMap((lead) => [...(lead.assignedToId ? [lead.assignedToId] : []), ...lead.collaborators.map((item) => item.userId)]))];
    const users = await this.prisma.client.collaborator.findMany({ where: { id: { in: ids } }, select: { id: true, professionalDisplayName: true } });
    const advisers = users.map((user) => ({ id: user.id, label: user.professionalDisplayName?.trim() || "Conseiller — nom non renseigné" })).sort((a, b) => a.label.localeCompare(b.label, "fr") || a.id.localeCompare(b.id));
    return { advisers, collaborators: advisers };
  }

  @Post()
  async create(@Body() body: CreateLeadInput, @Req() request: AuthenticatedRequest): Promise<CreateLeadResult> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.createLeadForApi(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get()
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  async list(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest): Promise<LeadPage> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    if (query.sharedViewId !== undefined) {
      if (!this.sharedViews || typeof query.sharedViewId !== "string") throw new BadRequestException({ code: "saved_view_input_invalid" });
      const view = await this.sharedViews.read(query.sharedViewId, request.principal);
      // Definition is resolved anew, never cached in a URL; reader's permissionLeadIds stay intact.
      query = { ...view.filters, page: query.page ?? "1" };
    }
    const normalized: LeadListQuery = { page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 25) };
    for (const key of ["search", "assignedToId", "collaboratorId", "adviserId", "status", "temperature", "source", "channel", "program", "campaign", "campus", "createdFrom", "createdTo", "createdBefore", "assignmentMode", "importBatchId", "view", "savedView", "sortBy", "sortDirection"] as const) {
      if (query[key] !== undefined) normalized[key] = query[key];
    }
    return this.leads.listLeadsForApi(normalized, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get(":leadId")
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
  async detail(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): Promise<LeadRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.getLeadForApi(leadId, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Patch(":leadId")
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
  async update(@Param("leadId") leadId: string, @Body() body: UpdateLeadInput, @Req() request: AuthenticatedRequest): Promise<LeadRecord> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.leads.updateLeadForApi(leadId, body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
