import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { UserService, type Collaborator, type CreateCollaborator, type UpdateAuthorization } from "./user.service.js";

@Controller("users")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN")
export class UserController {
  constructor(@Inject(UserService) private readonly users: UserService) {}
  @Post() async create(@Req() request: AuthenticatedRequest, @Body() body: CreateCollaborator): Promise<Collaborator> { const user = this.users.create(body, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return user; }
  @Get() list(@Query("active") active?: string, @Query("campusId") campusId?: string, @Query("teamId") teamId?: string): { users: Collaborator[] } { return { users: this.users.list({ active: active === undefined ? undefined : active === "true", campusId, teamId }) }; }
  @Patch(":id/status") async setStatus(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: { active?: boolean }): Promise<Collaborator> { const user = this.users.setActive(id, body.active === true, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return user; }
  @Patch(":id/authorization") async updateAuthorization(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: UpdateAuthorization): Promise<Collaborator> { const user = this.users.updateAuthorization(id, body, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return user; }
}
