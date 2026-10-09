import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CutoverService } from "./cutover.service.js";
import { CutoverRuntimeService } from "./cutover-runtime.service.js";

@Controller("lead-import/cutover")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN", "ADMIN", "MANAGER")
export class CutoverController {
  constructor(@Inject(CutoverService) private readonly cutover: CutoverService, @Inject(CutoverRuntimeService) private readonly runtime: CutoverRuntimeService) {}
  @Get("manifests/:id/runtime") @RequireRoles("SUPER_ADMIN", "ADMIN") runtimeGet(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.runtime.get(id, this.actor(request)); }
  @Post("manifests/:id/runtime/qualify") @RequireRoles("SUPER_ADMIN", "ADMIN") runtimeQualify(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.runtime.qualify(id, input, this.actor(request)); }
  @Post("manifests/:id/runtime/arm") @RequireRoles("SUPER_ADMIN", "ADMIN") runtimeArm(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.runtime.arm(id, input, this.actor(request)); }
  @Post("manifests/:id/runtime/disarm") @RequireRoles("SUPER_ADMIN", "ADMIN") runtimeDisarm(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.runtime.arm(id, input, this.actor(request), true); }
  @Get("context") context(@Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.context(this.actor(request)); }
  @Post("manifests") create(@Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.create(input, this.actor(request)); }
  @Get("manifests/:id") get(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.get(id, this.actor(request)); }
  @Post("manifests/:id/observe") observe(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.observe(id, input, this.actor(request)); }
  @Post("manifests/:id/decisions") decide(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.decide(id, input, this.actor(request)); }
  @Post("manifests/:id/reconcile") reconcile(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.reconcile(id, input, this.actor(request)); }
  @Post("manifests/:id/suspend") suspend(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.suspend(id, input, this.actor(request)); }
  @Post("manifests/:id/resume") resume(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.suspend(id, input, this.actor(request), true); }
  @Post("manifests/:id/consume") consume(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.consume(id, input, this.actor(request)); }
  @Post("manifests/:id/compensate") compensate(@Param("id") id: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.cutover.compensate(id, input, this.actor(request)); }
  private actor(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
}
