import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ReassignmentService, type CreateReassignmentInput, type DecideReassignmentInput, type ReassignmentRequest } from "./reassignment.service.js";

@Controller()
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class ReassignmentController {
  constructor(@Inject(ReassignmentService) private readonly reassignments: ReassignmentService) {}
  @Post("leads/:leadId/reassignment-requests")
  create(@Param("leadId") leadId: string, @Body() body: CreateReassignmentInput, @Req() request: AuthenticatedRequest): ReassignmentRequest | Promise<ReassignmentRequest> { return this.reassignments.persistenceEnabled() ? this.reassignments.requestForApi(leadId, body, this.principal(request), this.correlation(request)) : this.reassignments.request(leadId, body, this.principal(request), this.correlation(request)); }
  @Get("leads/:leadId/reassignment-requests")
  list(@Param("leadId") leadId: string, @Req() request: AuthenticatedRequest): { requests: ReassignmentRequest[] } | Promise<{ requests: ReassignmentRequest[] }> { return this.reassignments.persistenceEnabled() ? this.reassignments.listForLeadForApi(leadId, this.principal(request)).then((requests) => ({ requests })) : { requests: this.reassignments.listForLead(leadId, this.principal(request)) }; }
  @Patch("reassignment-requests/:requestId/decision")
  @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
  decide(@Param("requestId") requestId: string, @Body() body: DecideReassignmentInput, @Req() request: AuthenticatedRequest): ReturnType<ReassignmentService["decide"]> | ReturnType<ReassignmentService["decideForApi"]> { return this.reassignments.persistenceEnabled() ? this.reassignments.decideForApi(requestId, body, this.principal(request), this.correlation(request)) : this.reassignments.decide(requestId, body, this.principal(request), this.correlation(request)); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
  private correlation(request: AuthenticatedRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
}
