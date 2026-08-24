import { BadRequestException, Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { QuickLeadService, type QuickLeadInput, type QuickLeadResult } from "./quick-lead.service.js";

@Controller("leads/quick-entry")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class QuickLeadController {
  constructor(@Inject(QuickLeadService) private readonly quickLeads: QuickLeadService) {}
  @Post("matches")
  matches(@Body() body: { email?: string; phone?: string }, @Req() request: AuthenticatedRequest): unknown {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.quickLeads.preview(body.email, body.phone, request.principal);
  }
  @Post()
  submit(@Body() body: QuickLeadInput, @Req() request: AuthenticatedRequest): QuickLeadResult {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.quickLeads.submit(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
