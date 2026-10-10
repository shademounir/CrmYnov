import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { SheetImportAdminService } from "./sheet-import-admin.service.js";
import { sheetObject, sheetVersion } from "./sheet-import-configuration.js";

function principal(request: AuthenticatedRequest): Principal {
  if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" });
  return request.principal;
}

@Controller("scheduled-sheets")
@UseGuards(RbacGuard)
@RequireRoles("ADMIN", "SUPER_ADMIN")
export class SheetImportController {
  constructor(@Inject(SheetImportAdminService) private readonly service: SheetImportAdminService) {}
  @Get()
  list(@Req() request: AuthenticatedRequest, @Query("campus") campus: string): ReturnType<SheetImportAdminService["list"]> {
    return this.service.list(principal(request), campus);
  }
  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown): ReturnType<SheetImportAdminService["save"]> {
    return this.service.save(principal(request), body);
  }
  @Put(":id")
  update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown): ReturnType<SheetImportAdminService["save"]> {
    return this.service.save(principal(request), body, id);
  }
  @Post(":id/runs")
  run(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown): ReturnType<SheetImportAdminService["requestRun"]> {
    return this.service.requestRun(principal(request), id, sheetVersion(sheetObject(body).expectedVersion));
  }
  @Post(":id/simulations")
  simulate(@Req() request: AuthenticatedRequest, @Param("id") id: string): ReturnType<SheetImportAdminService["simulate"]> {
    return this.service.simulate(principal(request), id);
  }
  @Get(":id/runs")
  history(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Query("page") page?: string): ReturnType<SheetImportAdminService["history"]> {
    return this.service.history(principal(request), id, page === undefined ? 1 : Number(page));
  }
  @Get(":id/reconciliation")
  reconciliation(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Query("page") page?: string): ReturnType<SheetImportAdminService["reconciliation"]> {
    return this.service.reconciliation(principal(request), id, page === undefined ? 1 : Number(page));
  }
  @Post(":id/append-boundary")
  appendBoundary(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown): ReturnType<SheetImportAdminService["appendBoundary"]> {
    return this.service.appendBoundary(principal(request), id, body);
  }
  @Get(":id/append-reconciliation")
  appendReconciliation(@Req() request: AuthenticatedRequest, @Param("id") id: string): ReturnType<SheetImportAdminService["appendReconciliation"]> {
    return this.service.appendReconciliation(principal(request), id);
  }
  @Post(":id/append-qualification")
  qualifyAppend(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown): ReturnType<SheetImportAdminService["qualifyAppend"]> {
    return this.service.qualifyAppend(principal(request), id, body);
  }
  @Post(":id/append-observations")
  observeAppend(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown): ReturnType<SheetImportAdminService["observeAppend"]> {
    return this.service.observeAppend(principal(request), id, body);
  }
}
