import { BadRequestException, Body, Controller, Get, Inject, Optional, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { CampusAssignmentService, type CampusRules, type CampusAssignmentHistory } from "./campus-assignment.service.js";
import { PersistentAssignmentService } from "./persistent-assignment.service.js";
import type { SheetAssignment } from "./campus-assignment-resolver.js";
import type { RecordedAssignmentDecision } from "./recorded-assignment.js";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AssignmentService, type AssignmentContext, type AssignmentDecision, type AssignmentRule, type AssignmentRuleInput, type AssignmentSimulation } from "./assignment.service.js";

@Controller("assignment")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class AssignmentController {
  constructor(@Inject(AssignmentService) private readonly assignment: AssignmentService,
    @Optional() @Inject(CampusAssignmentService) private readonly campusAssignment?: CampusAssignmentService,
    @Optional() @Inject(PersistentAssignmentService) private readonly persistent?: PersistentAssignmentService) {}

  @Get("config")
  config(@Query("campusId") campusId?: string, @Req() request?: AuthenticatedRequest): { rules: AssignmentRule[] } | Promise<CampusRules> {
    if (this.campusAssignment) {
      if (!request) throw new BadRequestException({ code: "principal_missing" });
      return this.campusAssignment.read(this.principal(request), campusId ?? "");
    }
    return { rules: this.assignment.listRules() };
  }

  @Put("config")
  configure(@Body() body: { rules?: AssignmentRuleInput[]; campusId?: string; expectedVersion?: number }, @Req() request: AuthenticatedRequest): { rules: AssignmentRule[] } | Promise<CampusRules> {
    const principal = this.principal(request);
    if (this.campusAssignment) return this.campusAssignment.configure(principal, body.campusId ?? "", body.expectedVersion ?? -1, body.rules, request.header("x-correlation-id") ?? "missing-correlation");
    return { rules: this.assignment.configure(body.rules ?? [], principal, request.header("x-correlation-id") ?? "missing-correlation") };
  }

  @Post("simulate")
  async simulate(@Body() body: AssignmentContext, @Req() request: AuthenticatedRequest): Promise<AssignmentSimulation | (SheetAssignment & { mutated: false })> {
    if (this.persistent) return { ...await this.persistent.previewAutomatic(body.leadId, body.eventKey, this.principal(request)), mutated: false };
    return this.assignment.simulate(body, this.principal(request));
  }

  @Post("auto")
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
  assign(@Body() body: AssignmentContext, @Req() request: AuthenticatedRequest): AssignmentDecision | Promise<RecordedAssignmentDecision> {
    if (this.persistent) return this.persistent.decide(body.leadId, body.eventKey, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation");
    return this.assignment.assign(body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get("history")
  history(@Req() request: AuthenticatedRequest, @Query("campusId") campusId?: string, @Query("cursor") cursor?: string): { rules: AssignmentRule[]; decisions: AssignmentDecision[] } | Promise<CampusAssignmentHistory> {
    const principal = this.principal(request);
    if (this.campusAssignment) return this.campusAssignment.history(principal, campusId ?? "", cursor);
    return { rules: this.assignment.configurationHistory(principal), decisions: this.assignment.decisionHistory(principal) };
  }

  private principal(request: AuthenticatedRequest): Principal {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return request.principal;
  }
}
