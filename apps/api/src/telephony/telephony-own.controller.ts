import { Body, Controller, Get, Header, Inject, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { TelephonyOwnService } from "./telephony-own.service.js";

@Controller("telephony/me")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class TelephonyOwnController {
  constructor(@Inject(TelephonyOwnService) private readonly own: TelephonyOwnService) {}
  @Get() @Header("Cache-Control", "private, no-store")
  read(@Req() request: AuthenticatedRequest): ReturnType<TelephonyOwnService["read"]> { return this.own.read(this.principal(request)); }
  @Post("pairing-codes") @Header("Cache-Control", "private, no-store")
  pairing(@Body() body: { expectedVersion?: number }, @Req() request: AuthenticatedRequest): ReturnType<TelephonyOwnService["pairing"]> { return this.own.pairing(body, this.principal(request), this.correlation(request)); }
  @Patch("workstations/:workstationId/revoke") @Header("Cache-Control", "private, no-store")
  revoke(@Param("workstationId") id: string, @Body() body: { expectedVersion?: number }, @Req() request: AuthenticatedRequest): ReturnType<TelephonyOwnService["revoke"]> { return this.own.revoke(id, body, this.principal(request), this.correlation(request)); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" }); return request.principal; }
  private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id")?.slice(0, 64) ?? "telephony-own"; }
}
