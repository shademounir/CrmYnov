import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { BroadcastService, type BroadcastView, type CreateBroadcast } from "./broadcast.service.js";

type BroadcastRequest = AuthenticatedRequest & { header(name: string): string | undefined };

@Controller("broadcasts")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class BroadcastController {
  constructor(@Inject(BroadcastService) private readonly broadcasts: BroadcastService) {}
  @Post() create(@Req() request: BroadcastRequest, @Body() body: CreateBroadcast): BroadcastView { return this.broadcasts.create(this.principal(request), body, this.correlationId(request)); }
  @Post(":id/preview") preview(@Param("id") id: string, @Req() request: BroadcastRequest): { broadcastId: string; version: number; recipientCount: number; mutated: false } { return this.broadcasts.preview(id, this.principal(request)); }
  @Post(":id/confirm") confirm(@Param("id") id: string, @Req() request: BroadcastRequest, @Body() body: { confirmed?: boolean; expectedVersion?: number; expectedRecipientCount?: number; idempotencyKey?: string }): BroadcastView { return this.broadcasts.confirm(id, this.principal(request), body, this.correlationId(request)); }
  @Patch(":id/cancel") cancel(@Param("id") id: string, @Req() request: BroadcastRequest, @Body() body: { reason?: string; expectedVersion?: number }): BroadcastView { return this.broadcasts.cancel(id, this.principal(request), body, this.correlationId(request)); }
  @Post(":id/corrections") correct(@Param("id") id: string, @Req() request: BroadcastRequest, @Body() body: { title?: string; content?: string; reason?: string; clientRequestId?: string }): BroadcastView { return this.broadcasts.correct(id, this.principal(request), body, this.correlationId(request)); }
  @Get() list(@Req() request: BroadcastRequest, @Query("page") page = "1", @Query("pageSize") pageSize = "25"): { items: BroadcastView[]; page: number; pageSize: number; total: number } { return this.broadcasts.list(this.principal(request), Number(page), Number(pageSize)); }
  @Get(":id/recipients") recipients(@Param("id") id: string, @Req() request: BroadcastRequest): { broadcastId: string; recipientIds: string[] } { return this.broadcasts.recipientSnapshot(id, this.principal(request)); }
  private principal(request: BroadcastRequest): Principal {
    if (!request.principal) {
      throw new BadRequestException({ code: "principal_missing" });
    }
    return request.principal;
  }
  private correlationId(request: BroadcastRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
}
