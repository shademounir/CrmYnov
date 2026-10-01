import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest, Principal } from "../auth/auth.types.js";
import { RbacGuard, RequireRoles } from "../auth/rbac.guard.js";
import { CandidateDocumentService, type ChecklistItem, type DocumentMetadata } from "./candidate-document.service.js";

type DocumentRequest = AuthenticatedRequest;

@Controller("leads/:leadId/documents")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class CandidateDocumentController {
  constructor(@Inject(CandidateDocumentService) private readonly documents: CandidateDocumentService) {}
  @Post("checklist") @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN") generate(@Param("leadId") leadId: string, @Body() body: { admissionLevel?: string; program?: string; applicationType?: string; situation?: string; scholarship?: boolean }, @Req() request: DocumentRequest): ChecklistItem[] { const principal = this.principal(request); return this.documents.generateChecklist(leadId, body, principal, this.correlationId(request)); }
  @Get("checklist") checklist(@Param("leadId") leadId: string, @Req() request: DocumentRequest): { items: ChecklistItem[] } { return { items: this.documents.checklist(leadId, this.principal(request)) }; }
  @Post() @RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN") upload(@Param("leadId") leadId: string, @Body() body: { checklistItemId?: string; documentType?: string; originalName?: string; declaredMime?: string; contentBase64?: string; replacesDocumentId?: string }, @Req() request: DocumentRequest): Promise<DocumentMetadata> { const principal = this.principal(request); return this.documents.upload(leadId, body, principal, this.correlationId(request)); }
  private principal(request: DocumentRequest): Principal {
    if (!request.principal) {
      throw new BadRequestException({ code: "principal_missing" });
    }
    return request.principal;
  }
  private correlationId(request: DocumentRequest): string { return request.header("x-correlation-id") ?? "missing-correlation"; }
}

@Controller("candidate-documents")
@UseGuards(RbacGuard)
@RequireRoles("ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN", "AUDITOR")
export class DocumentVerificationController {
  constructor(@Inject(CandidateDocumentService) private readonly documents: CandidateDocumentService) {}
  @Get("dashboard") dashboard(@Query() query: Record<string, string | undefined>, @Req() request: DocumentRequest): ReturnType<CandidateDocumentService["dashboard"]> { return this.documents.dashboard({ page: Number(query.page ?? 1), pageSize: Number(query.pageSize ?? 25), ...(query.state ? { state: query.state } : {}), ...(query.documentType ? { documentType: query.documentType } : {}), ...(query.campus ? { campus: query.campus } : {}), ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}), ...(query.program ? { program: query.program } : {}), ...(query.educationLevel ? { educationLevel: query.educationLevel } : {}), ...(query.view ? { view: query.view } : {}) }, this.principal(request)); }
  @Get(":id") detail(@Param("id") id: string, @Req() request: DocumentRequest): ReturnType<CandidateDocumentService["detail"]> { return this.documents.detail(id, this.principal(request)); }
  @Patch(":id/verification") @RequireRoles("MANAGER", "ADMIN", "SUPER_ADMIN") verify(@Param("id") id: string, @Body() body: { decision?: string; reasonCode?: string }, @Req() request: DocumentRequest): DocumentMetadata { const principal = this.principal(request); return this.documents.verify(id, body, principal, request.header("x-correlation-id") ?? "missing-correlation"); }
  private principal(request: DocumentRequest): Principal {
    if (!request.principal) {
      throw new BadRequestException({ code: "principal_missing" });
    }
    return request.principal;
  }
}
