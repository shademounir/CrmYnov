import { BadRequestException, Body, Controller, Get, Header, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ImportReportService, type CreateImportReportInput, type ImportReport } from "./import-report.service.js";

@Controller("lead-import/reports")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class ImportReportController {
  constructor(@Inject(ImportReportService) private readonly reports: ImportReportService) {}
  @Post()
  create(@Body() body: CreateImportReportInput, @Req() request: AuthenticatedRequest): ImportReport {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.reports.create(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
  @Get(":jobId")
  get(@Param("jobId") jobId: string, @Req() request: AuthenticatedRequest): ImportReport {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.reports.get(jobId, request.principal);
  }
  @Get(":jobId/rejections")
  @Header("content-type", "text/csv; charset=utf-8")
  export(@Param("jobId") jobId: string, @Req() request: AuthenticatedRequest): string {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.reports.exportRejections(jobId, request.principal);
  }
}
