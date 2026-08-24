import { BadRequestException, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { NotificationService, type NotificationPage, type NotificationRecord } from "./notification.service.js";

@Controller("notifications") @UseGuards(RbacGuard) @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}
  @Get() list(@Req() request: AuthenticatedRequest, @Query("page") page = "1", @Query("pageSize") pageSize = "25"): NotificationPage { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return this.notifications.list(request.principal, Number(page), Number(pageSize)); }
  @Patch("read-all") markAll(@Req() request: AuthenticatedRequest): { updated: number } { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return this.notifications.markAllRead(request.principal, request.header("x-correlation-id") ?? "missing-correlation"); }
  @Patch(":id/read") markRead(@Param("id") id: string, @Req() request: AuthenticatedRequest): NotificationRecord { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return this.notifications.markRead(id, request.principal, request.header("x-correlation-id") ?? "missing-correlation"); }
}
