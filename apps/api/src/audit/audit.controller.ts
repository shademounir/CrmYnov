import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AuditService } from "./audit.service.js";
import type { AuditEvent } from "./audit.types.js";

@Controller("audit-events")
@UseGuards(RbacGuard)
@RequireRoles("AUDITOR", "SUPER_ADMIN")
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(@Query("limit") value?: string): { events: AuditEvent[] } {
    const limit = /^\d+$/.test(value ?? "") ? Number(value) : 100;
    return { events: this.audit.list(limit) };
  }
}
