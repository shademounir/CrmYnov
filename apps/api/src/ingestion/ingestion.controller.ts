import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { IngestionService, type IngestionBatchInput, type IngestionBatchResult } from "./ingestion.service.js";

@Controller("lead-ingestion")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class IngestionController {
  constructor(@Inject(IngestionService) private readonly ingestion: IngestionService) {}
  @Post("batches")
  ingest(@Body() body: IngestionBatchInput, @Req() request: AuthenticatedRequest): IngestionBatchResult {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.ingestion.ingest(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
  @Get("leads/:leadId/provenance")
  provenance(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): unknown {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return { items: this.ingestion.listProvenance(leadId, request.principal) };
  }
}
