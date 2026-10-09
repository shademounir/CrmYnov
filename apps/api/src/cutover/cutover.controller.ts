import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CutoverService } from "./cutover.service.js";

@Controller("lead-import/cutover")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN", "ADMIN", "MANAGER")
export class CutoverController {
  constructor(@Inject(CutoverService) private readonly cutover: CutoverService) {}
  @Post("manifests") create(@Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.create(input, this.actor(request)); }
  @Get("manifests/:id") get(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.get(id, this.actor(request)); }
  @Post("manifests/:id/observe") observe(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.observe(id, input, this.actor(request)); }
  @Post("manifests/:id/decisions") decide(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.decide(id, input, this.actor(request)); }
  @Post("manifests/:id/reconcile") reconcile(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.reconcile(id, input, this.actor(request)); }
  @Post("manifests/:id/suspend") suspend(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.suspend(id, input, this.actor(request)); }
  @Post("manifests/:id/resume") resume(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.suspend(id, input, this.actor(request), true); }
  private actor(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
}
