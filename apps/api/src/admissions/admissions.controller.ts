import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AdmissionsService } from "./admissions.service.js";
import type { AdmissionsReportInput, BookingDecisionInput, BookingInput, ResponsibilityInput, WindowInput, WithdrawWindowInput } from "./admissions.contract.js";

@Controller()
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class AdmissionsController {
  constructor(@Inject(AdmissionsService) private readonly admissions: AdmissionsService) {}
  private actor(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
  private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
  @Get("admissions/context") context(@Query("campus") campus: string | undefined, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["context"]> { return this.admissions.context(this.actor(request), campus); }
  @Get("admissions/responsibles") responsibles(@Query("leadId") leadId: string | undefined, @Query("campus") campus: string | undefined, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["responsibles"]> { return this.admissions.responsibles(this.actor(request), leadId, campus); }
  @Post("admissions/responsibles") configureResponsibility(@Body() body: ResponsibilityInput, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["configureResponsibility"]> { return this.admissions.configureResponsibility(body, this.actor(request), this.correlation(request)); }
  @Get("admissions/windows") windows(@Query("campus") campus: string | undefined, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["windows"]> { return this.admissions.windows(this.actor(request), campus); }
  @Post("admissions/windows") createWindow(@Body() body: WindowInput, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["createWindow"]> { return this.admissions.createWindow(body, this.actor(request), this.correlation(request)); }
  @Patch("admissions/windows/:id") withdrawWindow(@Param("id") id: string, @Body() body: WithdrawWindowInput, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["withdrawWindow"]> { return this.admissions.withdrawWindow(id, body, this.actor(request), this.correlation(request)); }
  @Get("admissions/slots") slots(@Query() query: Record<string, string>, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["slots"]> { return this.admissions.slots(query.leadId ?? "", query.responsibilityId ?? "", query.from ?? "", query.to ?? "", Number(query.durationMinutes), this.actor(request), query.bookingId); }
  @Post("leads/:leadId/admissions-bookings") createBooking(@Param("leadId") leadId: string, @Body() body: BookingInput, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["createBooking"]> { return this.admissions.createBooking(leadId, body, this.actor(request), this.correlation(request)); }
  @Get("admissions/bookings") bookings(@Query("leadId") leadId: string | undefined, @Query("campus") campus: string | undefined, @Req() request: AuthenticatedRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string): ReturnType<AdmissionsService["bookings"]> { return this.admissions.bookings(this.actor(request), leadId, campus, cursor, limit === undefined ? 50 : Number(limit)); }
  @Get("admissions/bookings/:id") booking(@Param("id") id: string, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["booking"]> { return this.admissions.booking(id, this.actor(request)); }
  @Get("admissions/bookings/:id/slots") bookingSlots(@Param("id") id: string, @Query("from") from: string, @Query("to") to: string, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["bookingSlots"]> { return this.admissions.bookingSlots(id, from, to, this.actor(request)); }
  @Patch("admissions/bookings/:id") decide(@Param("id") id: string, @Body() body: BookingDecisionInput, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["decide"]> { return this.admissions.decide(id, body, this.actor(request), this.correlation(request)); }
  @Post("admissions/bookings/:id/report") report(@Param("id") id: string, @Body() body: AdmissionsReportInput, @Req() request: AuthenticatedRequest): ReturnType<AdmissionsService["report"]> { return this.admissions.report(id, body, this.actor(request), this.correlation(request)); }
}
