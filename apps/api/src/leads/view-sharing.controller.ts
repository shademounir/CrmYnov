import { Body, Controller, Get, Header, Inject, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ViewSharingService } from "./view-sharing.service.js";
import type { Audience, DuplicateViewInput, SharingInput, ShareSummary, ViewCommand, ViewSummary, ViewDetails } from "./view-sharing.contract.js";

@Controller("view-sharing")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class ViewSharingController {
  constructor(@Inject(ViewSharingService) private readonly views: ViewSharingService) {}
  @Get("audiences") @Header("Cache-Control", "no-store")
  audiences(@Req() request: AuthenticatedRequest): Promise<Audience[]> { return this.views.availableAudiences(this.actor(request)); }
  @Get("received") @Header("Cache-Control", "no-store")
  received(@Req() request: AuthenticatedRequest): Promise<ViewDetails[]> { return this.views.list(this.actor(request)); }
  @Get("history") @Header("Cache-Control", "no-store")
  history(@Req() request: AuthenticatedRequest): Promise<ShareSummary[]> { return this.views.history(this.actor(request)); }
  @Get("views/:id") @Header("Cache-Control", "no-store")
  read(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<ViewDetails> { return this.views.read(id, this.actor(request)); }
  @Post("views/:id/shares")
  share(@Param("id") id: string, @Body() input: SharingInput, @Req() request: AuthenticatedRequest): Promise<ViewSummary> { return this.views.share(id, input, this.actor(request), this.trace(request)); }
  @Post("shares/:id/revoke")
  revoke(@Param("id") id: string, @Body() input: ViewCommand, @Req() request: AuthenticatedRequest): Promise<ViewSummary> { return this.views.revoke(id, input, this.actor(request), this.trace(request)); }
  @Post("views/:id/duplicate")
  duplicate(@Param("id") id: string, @Body() input: DuplicateViewInput, @Req() request: AuthenticatedRequest): Promise<ViewSummary> { return this.views.duplicate(id, input, this.actor(request), this.trace(request)); }
  @Post("views/:id/archive")
  archive(@Param("id") id: string, @Body() input: ViewCommand, @Req() request: AuthenticatedRequest): Promise<ViewSummary> { return this.views.archive(id, input, this.actor(request), this.trace(request)); }
  private actor(request: AuthenticatedRequest): Principal { if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" }); return request.principal; }
  private trace(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "view-sharing-request"; }
}
