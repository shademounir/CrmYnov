import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadService, type LeadRecord } from "../leads/lead.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { LocalTemporaryDocumentStorageAdapter } from "./document-storage.adapter.js";

export const documentTypes = ["BACCALAUREAT", "DIPLOME", "RELEVE_NOTES", "PIECE_IDENTITE", "SITUATION_PROFESSIONNELLE", "BOURSE_ELIGIBILITE", "AUTRE_CONTROLE"] as const;
export type DocumentType = typeof documentTypes[number];
export const documentStates = ["MANQUANT", "ATTENDU", "REÇU", "À_VÉRIFIER", "VALIDÉ", "REFUSÉ", "EXPIRÉ", "REMPLACÉ"] as const;
export type DocumentState = typeof documentStates[number];
export interface ChecklistItem { id: string; leadId: string; documentType: DocumentType; requirementCode: string; state: DocumentState; version: number; createdAt: string; updatedAt: string }
export interface DocumentMetadata { id: string; leadId: string; checklistItemId: string; documentType: DocumentType; sanitizedFileName: string; extension: string; declaredMime: string; detectedMime: string; byteSize: number; sha256: string; storageReference: string; uploadedBy: string; receivedAt: string; verificationStatus: DocumentState; verifiedBy?: string; verifiedAt?: string; refusalReasonCode?: string; version: number; replacedDocumentId?: string }
export interface DocumentEvent { id: string; documentId: string; eventType: string; actorId: string; reasonCode?: string; correlationId: string; occurredAt: string }
export interface DocumentDashboardQuery { page: number; pageSize: number; state?: string; documentType?: string; campus?: string; assignedToId?: string; program?: string; educationLevel?: string; view?: string }
export interface DocumentDashboardRow { leadId: string; campus: string; program: string; educationLevel: string; assignedToId?: string; complete: boolean; missing: number; toVerify: number; refused: number; expired: number }

const transitionRules: Readonly<Record<DocumentState, readonly DocumentState[]>> = {
  MANQUANT: ["ATTENDU", "REÇU"], ATTENDU: ["REÇU"], REÇU: ["À_VÉRIFIER"], "À_VÉRIFIER": ["VALIDÉ", "REFUSÉ", "EXPIRÉ"], VALIDÉ: ["EXPIRÉ", "REMPLACÉ"], REFUSÉ: ["REMPLACÉ"], EXPIRÉ: ["REMPLACÉ"], REMPLACÉ: ["REÇU"],
};
const refusalReasons = new Set(["ILLISIBLE", "INCOMPLET", "NON_CONFORME", "EXPIRÉ", "TYPE_INCORRECT"]);

@Injectable()
export class CandidateDocumentService {
  private readonly checklists = new Map<string, Readonly<ChecklistItem>[]>();
  private readonly documents = new Map<string, Readonly<DocumentMetadata>>();
  private events: Readonly<DocumentEvent>[] = [];
  constructor(@Inject(AuditService) private readonly audit: AuditService, @Inject(LeadService) private readonly leads: LeadService, @Inject(NotificationService) private readonly notifications: NotificationService, @Inject(LocalTemporaryDocumentStorageAdapter) private readonly storage: LocalTemporaryDocumentStorageAdapter) {}

  generateChecklist(leadId: string, criteria: { admissionLevel?: string; program?: string; applicationType?: string; situation?: string; scholarship?: boolean }, principal: Principal, correlationId: string): ChecklistItem[] {
    const lead = this.scopedLead(leadId, principal, correlationId); this.assertContributor(principal);
    if (!criteria.admissionLevel?.trim() || !criteria.program?.trim() || !criteria.applicationType?.trim() || !criteria.situation?.trim()) throw new BadRequestException({ code: "document_criteria_invalid" });
    const required = new Set<DocumentType>(["BACCALAUREAT", "RELEVE_NOTES", "PIECE_IDENTITE"]);
    if (/master|bac\+[2-5]|dipl/i.test(criteria.admissionLevel)) required.add("DIPLOME");
    if (/salari|emploi|altern/i.test(criteria.situation)) required.add("SITUATION_PROFESSIONNELLE");
    if (criteria.scholarship) required.add("BOURSE_ELIGIBILITE");
    const existing = this.checklists.get(leadId); if (existing) return existing.map((item) => ({ ...item }));
    const now = new Date().toISOString(); const items = [...required].sort((a, b) => a.localeCompare(b)).map((documentType) => Object.freeze({ id: randomUUID(), leadId, documentType, requirementCode: `${criteria.admissionLevel}:${criteria.program}:${criteria.applicationType}:${criteria.situation}`, state: "MANQUANT" as const, version: 1, createdAt: now, updatedAt: now }));
    this.checklists.set(leadId, items); this.audit.record({ eventType: "DOCUMENT_CHECKLIST_GENERATED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { leadId: lead.id, requiredCount: items.length }, result: "SUCCESS", idempotencyKey: `document-checklist:${leadId}` }); return items.map((item) => ({ ...item }));
  }

  checklist(leadId: string, principal: Principal): ChecklistItem[] { this.scopedLead(leadId, principal, "document-checklist-read"); return (this.checklists.get(leadId) ?? []).map((item) => ({ ...item })); }

  async upload(leadId: string, input: { checklistItemId?: string; documentType?: string; originalName?: string; declaredMime?: string; contentBase64?: string; replacesDocumentId?: string }, principal: Principal, correlationId: string): Promise<DocumentMetadata> {
    this.scopedLead(leadId, principal, correlationId); this.assertContributor(principal);
    if (!documentTypes.includes(input.documentType as DocumentType) || !input.originalName || !input.declaredMime || !input.contentBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.contentBase64)) throw new BadRequestException({ code: "document_upload_invalid" });
    const item = (this.checklists.get(leadId) ?? []).find((candidate) => candidate.id === input.checklistItemId && candidate.documentType === input.documentType); if (!item) throw new NotFoundException({ code: "document_checklist_item_not_found" });
    const replaced = this.documents.get(input.replacesDocumentId ?? "");
    if (input.replacesDocumentId && (!replaced || replaced.leadId !== leadId || replaced.documentType !== input.documentType)) {
      throw new NotFoundException({ code: "document_not_found" });
    }
    const stored = await this.storage.store({ originalName: input.originalName, declaredMime: input.declaredMime, content: Buffer.from(input.contentBase64, "base64") });
    const versions = [...this.documents.values()].filter((document) => document.leadId === leadId && document.documentType === input.documentType); const now = new Date().toISOString();
    const record: Readonly<DocumentMetadata> = Object.freeze({ id: randomUUID(), leadId, checklistItemId: item.id, documentType: input.documentType as DocumentType, ...stored, uploadedBy: principal.userId, receivedAt: now, verificationStatus: "À_VÉRIFIER", version: versions.length + 1, ...(replaced ? { replacedDocumentId: replaced.id } : {}) });
    this.documents.set(record.id, record);
    if (replaced) { this.updateChecklist(item.id, leadId, "REMPLACÉ"); this.documents.set(replaced.id, Object.freeze({ ...replaced, verificationStatus: "REMPLACÉ" })); this.appendEvent(replaced.id, "DOCUMENT_REPLACED", principal, correlationId); }
    this.updateChecklist(item.id, leadId, "REÇU"); this.updateChecklist(item.id, leadId, "À_VÉRIFIER"); this.appendEvent(record.id, replaced ? "DOCUMENT_REPLACEMENT_RECEIVED" : "DOCUMENT_RECEIVED", principal, correlationId);
    this.notifications.create({ recipientId: principal.userId, type: "DOCUMENT_RECEIVED", priority: "NORMAL", resourceType: "DOCUMENT", resourceId: record.id, href: `/leads/${leadId}/documents/${record.id}` }, `document-received:${record.id}:${principal.userId}`);
    this.audit.record({ eventType: "DOCUMENT_METADATA_RECEIVED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { documentId: record.id, leadId, documentType: record.documentType, byteSize: record.byteSize, version: record.version }, result: "SUCCESS", idempotencyKey: `document-received:${record.id}` }); return { ...record };
  }

  verify(documentId: string, input: { decision?: string; reasonCode?: string }, principal: Principal, correlationId: string): DocumentMetadata {
    if (!principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) {
      throw new ForbiddenException({ code: "document_verification_forbidden" });
    }
    const current = this.documents.get(documentId);
    if (!current) {
      throw new NotFoundException({ code: "document_not_found" });
    }
    this.scopedLead(current.leadId, principal, correlationId);
    if (current.verificationStatus !== "À_VÉRIFIER") {
      throw new ConflictException({ code: "document_transition_invalid" });
    }
    let decision: "VALIDÉ" | "REFUSÉ" | undefined;
    if (input.decision === "VALIDER") decision = "VALIDÉ";
    if (input.decision === "REFUSER") decision = "REFUSÉ";
    if (!decision || (decision === "REFUSÉ" && !refusalReasons.has(input.reasonCode ?? "")) || (decision === "VALIDÉ" && input.reasonCode)) {
      throw new BadRequestException({ code: "document_decision_invalid" });
    }
    const updated: Readonly<DocumentMetadata> = Object.freeze({ ...current, verificationStatus: decision, verifiedBy: principal.userId, verifiedAt: new Date().toISOString(), ...(decision === "REFUSÉ" ? { refusalReasonCode: input.reasonCode } : {}) }); this.documents.set(documentId, updated); this.updateChecklist(current.checklistItemId, current.leadId, decision); this.appendEvent(documentId, `DOCUMENT_${decision}`, principal, correlationId, input.reasonCode);
    this.notifications.create({ recipientId: current.uploadedBy, type: decision === "VALIDÉ" ? "DOCUMENT_VALIDATED" : "DOCUMENT_REFUSED", priority: decision === "REFUSÉ" ? "HIGH" : "NORMAL", resourceType: "DOCUMENT", resourceId: documentId, href: `/leads/${current.leadId}/documents/${documentId}` }, `document-${decision}:${documentId}:${current.uploadedBy}`);
    this.audit.record({ eventType: `DOCUMENT_${decision}`, actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId, correlationId, after: { documentId, leadId: current.leadId, reasonCode: input.reasonCode ?? "NONE" }, result: "SUCCESS", idempotencyKey: `document-${decision}:${documentId}` }); return { ...updated };
  }

  detail(documentId: string, principal: Principal): { document: DocumentMetadata; events: DocumentEvent[] } {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new NotFoundException({ code: "document_not_found" });
    }
    this.scopedLead(document.leadId, principal, "document-read");
    return { document: { ...document }, events: this.events.filter((event) => event.documentId === documentId).map((event) => ({ ...event })) };
  }

  dashboard(query: DocumentDashboardQuery, principal: Principal): { items: DocumentDashboardRow[]; page: number; pageSize: number; total: number; counters: Record<string, number>; aggregateExport: { complete: number; incomplete: number; toVerify: number } } {
    if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
      throw new BadRequestException({ code: "document_pagination_invalid" });
    }
    const global = principal.roles.some((role) => ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role));
    if (!global && query.view !== "MINE") {
      throw new ForbiddenException({ code: "document_dashboard_forbidden" });
    }
    if (query.documentType && !documentTypes.includes(query.documentType as DocumentType)) {
      throw new BadRequestException({ code: "document_type_filter_invalid" });
    }
    if (query.view && !["MINE", "GLOBAL"].includes(query.view)) {
      throw new BadRequestException({ code: "document_view_invalid" });
    }
    const rows = [...this.checklists.entries()].flatMap(([leadId, checklist]) => {
      let lead: LeadRecord;
      try { lead = this.scopedLead(leadId, principal, "document-dashboard"); } catch { return []; }
      if (query.view === "MINE" && lead.assignedToId !== principal.userId && !lead.collaboratorIds?.includes(principal.userId)) return [];
      if (!this.sameValue(lead.campus, query.campus) || !this.sameValue(lead.assignedToId, query.assignedToId)
        || !this.sameValue(lead.program, query.program) || !this.sameValue(lead.educationLevel, query.educationLevel)) return [];
      const items = query.documentType ? checklist.filter((item) => item.documentType === query.documentType) : checklist;
      if (items.length === 0) return [];
      const states = items.map((item) => item.state);
      const row: DocumentDashboardRow = { leadId, campus: lead.campus, program: lead.program, educationLevel: lead.educationLevel,
        ...(lead.assignedToId ? { assignedToId: lead.assignedToId } : {}), complete: states.every((state) => state === "VALIDÉ"),
        missing: states.filter((state) => state === "MANQUANT" || state === "ATTENDU").length,
        toVerify: states.filter((state) => state === "REÇU" || state === "À_VÉRIFIER").length,
        refused: states.filter((state) => state === "REFUSÉ").length, expired: states.filter((state) => state === "EXPIRÉ").length };
      return this.matchesDashboardState(row, query.state) ? [row] : [];
    }).sort((left, right) => left.leadId.localeCompare(right.leadId));
    const counters = { complete: rows.filter((row) => row.complete).length, incomplete: rows.filter((row) => !row.complete).length, toVerify: rows.reduce((sum, row) => sum + row.toVerify, 0), refused: rows.reduce((sum, row) => sum + row.refused, 0), expired: rows.reduce((sum, row) => sum + row.expired, 0) }; return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), page: query.page, pageSize: query.pageSize, total: rows.length, counters, aggregateExport: { complete: counters.complete, incomplete: counters.incomplete, toVerify: counters.toVerify } };
  }

  async cleanup(): Promise<void> { await this.storage.cleanup(); }
  private scopedLead(leadId: string, principal: Principal, correlationId: string): LeadRecord {
    const lead = this.leads.getLead(leadId, principal, correlationId);
    if (!principal.scopes.some((scope) => scope.kind === "GLOBAL") && !principal.scopes.some((scope) => scope.kind === "CAMPUS" && scope.id === lead.campus)) {
      throw new NotFoundException({ code: "lead_not_found" });
    }
    return lead;
  }
  private sameValue(actual: string | undefined, expected: string | undefined): boolean { return !expected || actual?.toLocaleLowerCase("fr") === expected.trim().toLocaleLowerCase("fr"); }
  private matchesDashboardState(row: DocumentDashboardRow, state: string | undefined): boolean {
    if (!state) return true;
    if (state === "COMPLET") return row.complete;
    if (state === "INCOMPLET") return !row.complete;
    if (state === "À_VÉRIFIER") return row.toVerify > 0;
    if (state === "REFUSÉ") return row.refused > 0;
    if (state === "EXPIRÉ") return row.expired > 0;
    throw new BadRequestException({ code: "document_state_filter_invalid" });
  }
  private assertContributor(principal: Principal): void {
    if (!principal.roles.some((role) => ["ADMISSIONS", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(role))) {
      throw new ForbiddenException({ code: "document_role_forbidden" });
    }
  }
  private updateChecklist(itemId: string, leadId: string, next: DocumentState): void {
    const items = this.checklists.get(leadId) ?? [];
    const current = items.find((item) => item.id === itemId);
    if (!current || !transitionRules[current.state].includes(next)) {
      throw new ConflictException({ code: "document_transition_invalid" });
    }
    const now = new Date().toISOString();
    this.checklists.set(leadId, items.map((item) => item.id === itemId ? Object.freeze({ ...item, state: next, version: item.version + 1, updatedAt: now }) : item));
  }
  private appendEvent(documentId: string, eventType: string, principal: Principal, correlationId: string, reasonCode?: string): void { const event: Readonly<DocumentEvent> = Object.freeze({ id: randomUUID(), documentId, eventType, actorId: principal.userId, correlationId, occurredAt: new Date().toISOString(), ...(reasonCode ? { reasonCode } : {}) }); this.events = [...this.events, event]; }
}
