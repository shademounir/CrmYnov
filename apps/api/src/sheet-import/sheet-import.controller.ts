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
}
