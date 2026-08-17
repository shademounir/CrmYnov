import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { UserService, type Collaborator, type CreateCollaborator } from "./user.service.js";

@Controller("users")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN")
export class UserController {
  constructor(@Inject(UserService) private readonly users: UserService) {}
  @Post() create(@Req() request: AuthenticatedRequest, @Body() body: CreateCollaborator): Collaborator { return this.users.create(body, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); }
  @Get() list(@Query("active") active?: string, @Query("campusId") campusId?: string, @Query("teamId") teamId?: string): { users: Collaborator[] } { return { users: this.users.list({ active: active === undefined ? undefined : active === "true", campusId, teamId }) }; }
  @Patch(":id/status") setStatus(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: { active?: boolean }): Collaborator { return this.users.setActive(id, body.active === true, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); }
}
