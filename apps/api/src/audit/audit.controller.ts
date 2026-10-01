import { Controller, Get, Inject, Param, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AuditReader, type AuditPage } from "./audit-reader.js";
import type { AuditView } from "./audit-view.js";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";

@Controller("audit-events")
@UseGuards(RbacGuard)
@RequireRoles("AUDITOR", "SUPER_ADMIN", "ADMIN")
export class AuditController {
  constructor(@Inject(AuditReader) private readonly audit: AuditReader) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest): Promise<AuditPage> { return this.audit.list(query, this.principal(request)); }
  @Get(":id")
  detail(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<AuditView> { return this.audit.detail(id, this.principal(request)); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) throw new UnauthorizedException({ code: "session_invalid" }); return request.principal; }
}
