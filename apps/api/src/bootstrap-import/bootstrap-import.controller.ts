import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { BootstrapImportService } from "./bootstrap-import.service.js";
import type { BootstrapChunkInput, BootstrapConfirmInput, CreateBootstrapInput, HistoricalDecisionInput, HistoricalMappingInput } from "./bootstrap-import.contract.js";

@Controller("lead-import/bootstrap")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class BootstrapImportController {
  constructor(@Inject(BootstrapImportService) private readonly imports: BootstrapImportService) {}
  @Get("context") context(@Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.context(this.actor(request)); }
  @Post("packages") create(@Body() input: CreateBootstrapInput, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.create(input, this.actor(request)); }
  @Post("packages/:id/chunks") chunk(@Param("id") id: string, @Body() input: BootstrapChunkInput, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.chunk(id, input, this.actor(request)); }
  @Post("packages/:id/seal") seal(@Param("id") id: string, @Body() input: { sha256: string }, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.seal(id, input, this.actor(request)); }
  @Get("packages/:id") get(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.get(id, this.actor(request)); }
  @Post("packages/:id/mappings") mapping(@Param("id") id: string, @Body() input: HistoricalMappingInput, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.mapping(id, input, this.actor(request)); }
  @Get("packages/:id/rows") rows(@Param("id") id: string, @Query("after") after: string | undefined, @Query("limit") limit: string | undefined, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.rows(id, after, Number(limit ?? 25), this.actor(request)); }
  @Post("packages/:id/rows/:rowId/decision") decide(@Param("id") id: string, @Param("rowId") rowId: string, @Body() input: HistoricalDecisionInput, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.decide(id, rowId, input, this.actor(request)); }
  @Post("packages/:id/confirm") confirm(@Param("id") id: string, @Body() input: BootstrapConfirmInput, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.confirm(id, input, this.actor(request)); }
  @Get("packages/:id/report") report(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<unknown> { return this.imports.report(id, this.actor(request)); }
  private actor(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
}

@Controller("lead-import/bootstrap")
@UseGuards(RbacGuard)
@RequireRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ADMISSIONS", "AUDITOR")
export class BootstrapHistoricalNotesController {
  constructor(@Inject(BootstrapImportService) private readonly imports: BootstrapImportService) {}
  @Get("leads/:leadId/notes") notes(@Param("leadId") id: string, @Req() request: AuthenticatedRequest): Promise<unknown> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.imports.notes(id, request.principal);
  }
}
