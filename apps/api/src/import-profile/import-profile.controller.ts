import { BadRequestException, Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { ImportProfileService, type ImportProfileResult, type ProfileFileInput } from "./import-profile.service.js";

@Controller("lead-import/profiles")
@UseGuards(RbacGuard)
@RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN")
export class ImportProfileController {
  constructor(@Inject(ImportProfileService) private readonly profiles: ImportProfileService, @Inject(AuditService) private readonly audit: AuditService) {}

  @Post()
  profile(@Body() body: ProfileFileInput, @Req() request: AuthenticatedRequest): ImportProfileResult {
    if (!request.principal) throw new BadRequestException({ code: "principal_missing" });
    const result = this.profiles.profile(body);
    this.audit.record({ eventType: "LEAD_IMPORT_FILE_PROFILED", actorId: request.principal.userId, actorRoles: request.principal.roles,
      sessionId: request.principal.sessionId, correlationId: request.header("x-correlation-id") ?? "missing-correlation",
      after: { profileId: result.profileId, fileType: result.fileType, expectedProfile: result.expectedProfile,
        sheetCount: result.sheets.length, rowCount: result.sheets.reduce((total, sheet) => total + sheet.rowCount, 0),
        formulaCount: result.formulaCount, macroDetected: result.macroDetected, accepted: result.accepted, mutated: false },
      result: result.accepted ? "SUCCESS" : "FAILED", idempotencyKey: `lead-import-profile:${result.profileId}` });
    return result;
  }
}
