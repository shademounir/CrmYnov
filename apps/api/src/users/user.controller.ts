import { Body, Controller, ForbiddenException, Get, Inject, Optional, Param, Patch, Post, Query, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { UserService, type Collaborator, type CreateCollaborator, type IssueTemporarySecret, type TemporarySecretResult, type UpdateAuthorization } from "./user.service.js";
import { InvitationService } from "../invitations/invitation.service.js";

@Controller("users")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN")
export class UserController {
  constructor(@Inject(UserService) private readonly users: UserService, @Optional() @Inject(InvitationService) private readonly invitations?: InvitationService) {}
  @Post() async create(@Req() request: AuthenticatedRequest, @Body() body: CreateCollaborator): Promise<Collaborator> { const user = this.users.create(body, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return user; }
  @Get() list(@Query("active") active?: string, @Query("campusId") campusId?: string, @Query("teamId") teamId?: string): { users: Collaborator[] } { return { users: this.users.list({ active: active === undefined ? undefined : active === "true", campusId, teamId }) }; }
  @Patch(":id/status") async setStatus(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: { active?: boolean }): Promise<Collaborator> { const user = this.users.setActive(id, body.active === true, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return user; }
  @Patch(":id/authorization") async updateAuthorization(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: UpdateAuthorization): Promise<Collaborator> { const user = this.users.updateAuthorization(id, body, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return user; }
  @Post(":id/temporary-secret") async issueTemporarySecret(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: IssueTemporarySecret): Promise<TemporarySecretResult> { const result = this.users.issueTemporarySecret(id, body, request.principal!.userId, request.header("x-correlation-id") ?? "generated"); await this.users.flush(); return result; }
  @Post(":id/invitations") async issueInvitation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: { confirmed?: boolean }): Promise<{ state: "ACCEPTED_BY_GMAIL" }> { if (body.confirmed !== true) throw new ForbiddenException({ code: "invitation_confirmation_required" }); if (!this.invitations) throw new ServiceUnavailableException({ code: "invitation_unavailable" }); return this.invitations.issue(id, request.principal!); }
}
