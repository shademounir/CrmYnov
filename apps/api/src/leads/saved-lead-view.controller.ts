import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { SavedLeadViewService, type SavedLeadView, type SavedLeadViewInput } from "./saved-lead-view.service.js";

@Controller("lead-views") @UseGuards(RbacGuard) @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class SavedLeadViewController {
  constructor(@Inject(SavedLeadViewService) private readonly views: SavedLeadViewService) {}
  @Get() async list(@Req() request: AuthenticatedRequest): Promise<SavedLeadView[]> { return this.views.list(this.principal(request)); }
  @Post() async create(@Body() body: SavedLeadViewInput, @Req() request: AuthenticatedRequest): Promise<SavedLeadView> { return this.views.create(body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation"); }
  @Patch(":id") async update(@Param("id") id: string, @Body() body: SavedLeadViewInput, @Req() request: AuthenticatedRequest): Promise<SavedLeadView> { return this.views.update(id, body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation"); }
  @Delete(":id") async remove(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<void> { await this.views.remove(id, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation"); }
  private principal(request: AuthenticatedRequest): NonNullable<AuthenticatedRequest["principal"]> { if (!request.principal) throw new Error("principal_missing"); return request.principal; }
}
