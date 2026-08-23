import { BadRequestException, Body, Controller, Get, Inject, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AssignmentService, type AssignmentContext, type AssignmentDecision, type AssignmentRule, type AssignmentRuleInput, type AssignmentSimulation } from "./assignment.service.js";

@Controller("assignment")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class AssignmentController {
  constructor(@Inject(AssignmentService) private readonly assignment: AssignmentService) {}

  @Get("config")
  config(): { rules: AssignmentRule[] } { return { rules: this.assignment.listRules() }; }

  @Put("config")
  configure(@Body() body: { rules?: AssignmentRuleInput[] }, @Req() request: AuthenticatedRequest): { rules: AssignmentRule[] } {
    const principal = this.principal(request);
    return { rules: this.assignment.configure(body.rules ?? [], principal, request.header("x-correlation-id") ?? "missing-correlation") };
  }

  @Post("simulate")
  simulate(@Body() body: AssignmentContext, @Req() request: AuthenticatedRequest): AssignmentSimulation {
    return this.assignment.simulate(body, this.principal(request));
  }

  @Post("auto")
  @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
  assign(@Body() body: AssignmentContext, @Req() request: AuthenticatedRequest): AssignmentDecision {
    return this.assignment.assign(body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation");
  }

  @Get("history")
  history(@Req() request: AuthenticatedRequest): { rules: AssignmentRule[]; decisions: AssignmentDecision[] } {
    const principal = this.principal(request);
    return { rules: this.assignment.configurationHistory(principal), decisions: this.assignment.decisionHistory(principal) };
  }

  private principal(request: AuthenticatedRequest): Principal {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return request.principal;
  }
}
