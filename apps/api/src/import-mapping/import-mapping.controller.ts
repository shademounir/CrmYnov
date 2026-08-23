import { BadRequestException, Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import {
  ImportMappingService,
  type ImportDryRunInput,
  type ImportMappingTemplate,
  type SaveImportMappingInput,
} from "./import-mapping.service.js";
import type { IngestionDryRunResult } from "../ingestion/ingestion.service.js";

@Controller("lead-import")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class ImportMappingController {
  constructor(@Inject(ImportMappingService) private readonly mappings: ImportMappingService) {}

  @Get("mappings")
  list(@Req() request: AuthenticatedRequest): ImportMappingTemplate[] {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.mappings.list(request.principal);
  }

  @Post("mappings")
  save(@Body() body: SaveImportMappingInput, @Req() request: AuthenticatedRequest): ImportMappingTemplate {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.mappings.save(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Post("dry-runs")
  dryRun(@Body() body: ImportDryRunInput, @Req() request: AuthenticatedRequest): IngestionDryRunResult & { mappingId: string; mappingVersion: number } {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.mappings.dryRun(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
