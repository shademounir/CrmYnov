import { Body, Controller, Get, Inject, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard } from "../auth/rbac.guard.js";
import { DynamicPermissionService } from "./dynamic-service.js";
import { validateTarget, type ConfigurationInput, type ConfigurationTarget } from "./dynamic-contract.js";
import { validateResponsibility, type TeamResponsibilityInput } from "./dynamic-teams.js";
function principal(request: AuthenticatedRequest): Principal {
  if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" });
  return request.principal;
}
@Controller("admin/role-permissions")
@UseGuards(RbacGuard)
export class DynamicPermissionController {
  constructor(@Inject(DynamicPermissionService) private readonly permissions: DynamicPermissionService) {}
  @Get("catalogue") catalogue(@Req() request: AuthenticatedRequest, @Query("campus") campus?: string): ReturnType<DynamicPermissionService["list"]> { return this.permissions.list(principal(request), campus); }
  @Get("configuration") read(@Req() request: AuthenticatedRequest, @Query() query: ConfigurationTarget): ReturnType<DynamicPermissionService["read"]> { validateTarget(query); return this.permissions.read(principal(request), query); }
  @Post("preview") preview(@Req() request: AuthenticatedRequest, @Body() body: ConfigurationInput): ReturnType<DynamicPermissionService["preview"]> { return this.permissions.preview(principal(request), body); }
  @Post("configuration") save(@Req() request: AuthenticatedRequest, @Body() body: ConfigurationInput): ReturnType<DynamicPermissionService["save"]> { return this.permissions.save(principal(request), body); }
  @Get("history") async history(@Req() request: AuthenticatedRequest, @Query() query: ConfigurationTarget): Promise<{ versions: Awaited<ReturnType<DynamicPermissionService["history"]>> }> { validateTarget(query); return { versions: await this.permissions.history(principal(request), query) }; }
  @Post("restore") restore(@Req() request: AuthenticatedRequest, @Body() body: Omit<ConfigurationInput, "grants"> & { restoreVersion: number }): ReturnType<DynamicPermissionService["restore"]> { return this.permissions.restore(principal(request), body); }
  @Get("effective") effective(@Req() request: AuthenticatedRequest, @Query("campus") campus: string, @Query("leadId") leadId?: string): ReturnType<DynamicPermissionService["explain"]> { return this.permissions.explain(principal(request), campus, leadId); }
  @Get("team-responsibilities") teams(@Req() request: AuthenticatedRequest): ReturnType<DynamicPermissionService["teamResponsibilities"]> { return this.permissions.teamResponsibilities(principal(request)); }
  @Post("team-responsibilities") saveTeam(@Req() request: AuthenticatedRequest, @Body() body: TeamResponsibilityInput): ReturnType<DynamicPermissionService["teamResponsibilities"]> { validateResponsibility(body); return this.permissions.teamResponsibilities(principal(request), body); }
}
