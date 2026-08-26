import { BadRequestException, Body, Controller, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import type { LeadRecord } from "../leads/lead.service.js";
import { LeadAssignmentService, type AssignmentBatchResult, type AssignmentPreviewItem, type BatchAssignmentInput } from "./lead-assignment.service.js";

@Controller()
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class LeadAssignmentController {
  constructor(@Inject(LeadAssignmentService) private readonly assignments: LeadAssignmentService) {}

  @Post("leads/:leadId/assignment")
  async assignOne(@Param("leadId") leadId: string, @Body() body: { targetUserId: string; confirmed?: boolean; idempotencyKey: string }, @Req() request: AuthenticatedRequest): Promise<LeadRecord> {
    return this.assignments.assignOneForApi(leadId, body.targetUserId, body.confirmed === true, body.idempotencyKey, this.principal(request), this.correlation(request));
  }
  @Post("lead-assignments/preview")
  preview(@Body() body: BatchAssignmentInput, @Req() request: AuthenticatedRequest): { items: AssignmentPreviewItem[]; mutated: false } {
    return { items: this.assignments.preview(body, this.principal(request)), mutated: false };
  }
  @Post("lead-assignments")
  async assignBatch(@Body() body: BatchAssignmentInput, @Req() request: AuthenticatedRequest): Promise<AssignmentBatchResult> {
    return this.assignments.assignBatchForApi(body, this.principal(request), this.correlation(request));
  }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
  private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
}
