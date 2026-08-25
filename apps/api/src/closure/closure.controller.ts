import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { ClosureService, type ClosureRequest } from "./closure.service.js";

@Controller()
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN")
export class ClosureController {
  constructor(@Inject(ClosureService) private readonly closures: ClosureService) {}
  @Post("leads/:leadId/closure-requests") request(@Param("leadId") leadId: string, @Body() body: { target?: string; reason?: string; comment?: string; evidence?: string[] }, @Req() request: AuthenticatedRequest): ClosureRequest | Promise<ClosureRequest> { return this.closures.persistenceEnabled() ? this.closures.requestForApi(leadId, body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation") : this.closures.request(leadId, body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation"); }
  @Get("closure-requests") list(@Req() request: AuthenticatedRequest): { items: ClosureRequest[] } | Promise<{ items: ClosureRequest[] }> { return this.closures.persistenceEnabled() ? this.closures.listForApi(this.principal(request)).then((items) => ({ items })) : { items: this.closures.list(this.principal(request)) }; }
  @Patch("closure-requests/:id/decision") decide(@Param("id") id: string, @Body() body: { decision?: "APPROVE" | "REJECT"; reason?: string; expectedVersion?: number }, @Req() request: AuthenticatedRequest): ClosureRequest | Promise<ClosureRequest> { return this.closures.persistenceEnabled() ? this.closures.decideForApi(id, body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation") : this.closures.decide(id, body, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation"); }
  @Patch("closure-requests/:id/cancel") cancel(@Param("id") id: string, @Req() request: AuthenticatedRequest): ClosureRequest | Promise<ClosureRequest> { return this.closures.persistenceEnabled() ? this.closures.cancelForApi(id, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation") : this.closures.cancel(id, this.principal(request), request.header("x-correlation-id") ?? "missing-correlation"); }
  private principal(request: AuthenticatedRequest): Principal { if (!request.principal) { throw new BadRequestException({ code: "principal_missing" }); } return request.principal; }
}
