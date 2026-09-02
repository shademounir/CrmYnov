import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { strictBody, type ReferenceInput, type ReferenceKind, type ReferenceUpdate, type TagAssignment } from "./reference.contract.js";
import { ReferenceService } from "./reference.service.js";

function principal(request: AuthenticatedRequest): Principal {
  if (!request.principal) throw new UnauthorizedException({ code: "principal_missing" }); return request.principal;
}
function correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "reference-request"; }

@Controller("references")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR")
export class ReferenceController {
  constructor(@Inject(ReferenceService) private readonly references: ReferenceService) {}
  @Get()
  async list(@Query() query: { kind: ReferenceKind; campusId?: string; includeArchived?: string; leadId?: string }, @Req() request: AuthenticatedRequest): Promise<unknown> {
    strictBody(query, ["kind", "campusId", "includeArchived", "leadId"]);
    return { items: await this.references.list(query.kind, principal(request), { ...(query.campusId ? { campusId: query.campusId } : {}), ...(query.leadId ? { leadId: query.leadId } : {}), includeArchived: query.includeArchived === "true" }) };
  }
  @Post()
  create(@Body() body: ReferenceInput, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.references.create(body, principal(request), correlation(request)); }
  @Post("legacy-inventory")
  legacy(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { strictBody(body, []); return this.references.captureLegacy(principal(request), correlation(request)); }
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: ReferenceUpdate, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.references.update(id, body, principal(request), correlation(request)); }
  @Post(":id/availability/:campusId")
  availability(@Param("id") id: string, @Param("campusId") campusId: string, @Body() body: { active: boolean; expectedVersion: number }, @Req() request: AuthenticatedRequest): Promise<unknown> {
    strictBody(body, ["active", "expectedVersion"]); return this.references.availability(id, campusId, body.active, body.expectedVersion, principal(request), correlation(request));
  }
  @Get(":id/availability/:campusId")
  readAvailability(@Param("id") id: string, @Param("campusId") campusId: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.references.readAvailability(id, campusId, principal(request)); }
}

@Controller("leads/:leadId/tags")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR")
export class LeadTagController {
  constructor(@Inject(ReferenceService) private readonly references: ReferenceService) {}
  @Get()
  list(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.references.leadTags(leadId, principal(request)); }
  @Patch()
  assign(@Param("leadId") leadId: string, @Body() body: TagAssignment, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.references.assignTags(leadId, body, principal(request), correlation(request)); }
}
