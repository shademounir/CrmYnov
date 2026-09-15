import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js"; import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js"; import { AppointmentService, type AppointmentEvent, type AppointmentKpis, type AppointmentPage, type AppointmentRecord, type InterviewReport } from "./appointment.service.js";
@Controller() @UseGuards(RbacGuard) @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class AppointmentController { constructor(@Inject(AppointmentService) private readonly appointments: AppointmentService) {} private principal(request: AuthenticatedRequest): Principal {
    if (!request.principal) {
      throw new BadRequestException({ code: "principal_missing" });
    }
    return request.principal;
  } private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
  @Post("leads/:leadId/appointments") create(@Param("leadId") leadId: string, @Body() body: Parameters<AppointmentService["create"]>[1], @Req() request: AuthenticatedRequest): Promise<AppointmentRecord> { return this.appointments.createForApi(leadId, body, this.principal(request), this.correlation(request)); }
  @Get("appointments") list(@Query() query: Record<string,string|undefined>, @Req() request: AuthenticatedRequest): Promise<AppointmentPage> { return this.appointments.listForApi({ ...query, page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 25) }, this.principal(request)); }
  @Get("appointments/availability") async availability(@Query("userIds") userIds: string, @Query("from") from: string, @Query("to") to: string, @Req() request: AuthenticatedRequest): Promise<{ items: ReturnType<AppointmentService["availability"]>; redacted: true }> { return { items: await this.appointments.availabilityForApi((userIds ?? "").split(",").filter(Boolean), from, to, this.principal(request)), redacted: true }; }
  @Get("appointments/kpis") kpis(@Req() request: AuthenticatedRequest): Promise<AppointmentKpis> { return this.appointments.kpisForApi(this.principal(request)); }
  @Get("appointments/:id") detail(@Param("id") id: string, @Req() request: AuthenticatedRequest): ReturnType<AppointmentService["detailForApi"]> { return this.appointments.detailForApi(id, this.principal(request), this.correlation(request)); }
  @Patch("appointments/:id/state") transition(@Param("id") id: string, @Body() body: Parameters<AppointmentService["transition"]>[1], @Req() request: AuthenticatedRequest): Promise<AppointmentRecord> { return this.appointments.transitionForApi(id, body, this.principal(request), this.correlation(request)); }
  @Post("appointments/:id/compensations") compensate(@Param("id") id: string, @Body() body: Parameters<AppointmentService["compensate"]>[1], @Req() request: AuthenticatedRequest): Promise<AppointmentEvent> { return this.appointments.compensateForApi(id, body, this.principal(request), this.correlation(request)); }
  @Post("appointments/:id/interview-report") report(@Param("id") id: string, @Body() body: Parameters<AppointmentService["validateReport"]>[1], @Req() request: AuthenticatedRequest): Promise<InterviewReport> { return this.appointments.validateReportForApi(id, body, this.principal(request), this.correlation(request)); }
}
