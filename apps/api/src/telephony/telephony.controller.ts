import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { TelephonyService, type CallRecord, type TelephonyConfiguration } from "./telephony.service.js";

@Controller() @UseGuards(RbacGuard) @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class TelephonyController {
  constructor(@Inject(TelephonyService) private readonly telephony: TelephonyService) {}
  @Get("telephony/configuration") configuration(): TelephonyConfiguration { return this.telephony.configuration(); }
  @Patch("telephony/configuration") @RequireRoles("SUPER_ADMIN") configure(@Body() body: Parameters<TelephonyService["configure"]>[0], @Req() request: AuthenticatedRequest): TelephonyConfiguration { return this.telephony.configure(body, this.principal(request), this.correlation(request)); }
  @Post("leads/:leadId/calls") initiate(@Param("leadId") leadId: string, @Body() body: { idempotencyKey?: string; followUpComment?: string; nextActionAt?: string }, @Req() request: AuthenticatedRequest): CallRecord { return this.telephony.initiate(leadId, body, this.principal(request), this.correlation(request)); }
  @Get("calls/:callId") detail(@Param("callId") callId: string, @Req() request: AuthenticatedRequest): CallRecord { return this.telephony.call(callId, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/events") event(@Param("callId") callId: string, @Body() body: { idempotencyKey?: string; state?: string; occurredAt?: string }, @Req() request: AuthenticatedRequest): CallRecord { return this.telephony.receiveEvent(callId, body, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/compensations") @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN") compensate(@Param("callId") callId: string, @Body() body: { idempotencyKey?: string; reasonCode?: string }, @Req() request: AuthenticatedRequest): CallRecord { return this.telephony.compensate(callId, body, this.principal(request), this.correlation(request)); }
  @Post("calls/:callId/association") @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN") associate(@Param("callId") callId: string, @Body() body: { leadId?: string }, @Req() request: AuthenticatedRequest): CallRecord { if (!body.leadId) throw new BadRequestException({ code: "lead_id_required" }); return this.telephony.confirmAssociation(callId, body.leadId, this.principal(request), this.correlation(request)); }
  @Get("telephony/queue") queue(@Req() request: AuthenticatedRequest): ReturnType<TelephonyService["queue"]> { return this.telephony.queue(this.principal(request)); }
  @Get("calls/:callId/recording") recording(@Param("callId") callId: string, @Req() request: AuthenticatedRequest): ReturnType<TelephonyService["recording"]> { return this.telephony.recording(callId, this.principal(request), this.correlation(request)); }
  @Get("integrations/telephony/webhook/status") webhookStatus(): ReturnType<TelephonyService["webhookStatus"]> { return this.telephony.webhookStatus(); }
  @Post("integrations/telephony/webhook") webhook(): never { return this.telephony.rejectRealWebhook(); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
  private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
}
