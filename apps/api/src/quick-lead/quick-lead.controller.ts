import { BadRequestException, Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { QuickLeadService, type QuickLeadInput, type QuickLeadResult } from "./quick-lead.service.js";
import { ReferenceService } from "../references/reference.service.js";

@Controller("leads/quick-entry")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class QuickLeadController {
  constructor(@Inject(QuickLeadService) private readonly quickLeads: QuickLeadService, @Inject(ReferenceService) private readonly references: ReferenceService) {}
  @Post("matches")
  matches(@Body() body: { email?: string; phone?: string }, @Req() request: AuthenticatedRequest): unknown {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    return this.quickLeads.preview(body.email, body.phone, request.principal);
  }
  @Post()
  async submit(@Body() body: QuickLeadInput, @Req() request: AuthenticatedRequest): Promise<QuickLeadResult> {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    await this.references.validateForLead(body, request.principal);
    return this.quickLeads.submit(body, request.principal, request.header("x-correlation-id") ?? "missing-correlation");
  }
}
