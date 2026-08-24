import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import type { Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ImportWizardService, type ImportWizardSession, type ReconcileImportWizardInput, type StartImportWizardInput } from "./import-wizard.service.js";

@Controller("lead-import/wizards")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class ImportWizardController {
  constructor(@Inject(ImportWizardService) private readonly wizards: ImportWizardService) {}
  @Post() start(@Body() body: StartImportWizardInput, @Req() request: AuthenticatedRequest): ImportWizardSession {
    return this.wizards.start(body, this.principal(request));
  }
  @Post(":id/reconcile") reconcile(@Param("id") id: string, @Body() body: ReconcileImportWizardInput, @Req() request: AuthenticatedRequest): ImportWizardSession {
    return this.wizards.reconcile(id, body, this.principal(request));
  }
  @Post(":id/confirm") confirm(@Param("id") id: string, @Body() body: { confirmationToken: string }, @Req() request: AuthenticatedRequest): ImportWizardSession {
    return this.wizards.confirm(id, body.confirmationToken, this.principal(request));
  }
  @Get(":id") get(@Param("id") id: string, @Req() request: AuthenticatedRequest): ImportWizardSession { return this.wizards.get(id, this.principal(request)); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new BadRequestException({ code: "principal_missing" }); return request.principal; }
}
