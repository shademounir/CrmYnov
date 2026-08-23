import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { LeadAssignmentService, type BatchAssignmentStrategy } from "../assignment/lead-assignment.service.js";
import { LeadService, type LeadStatus } from "../leads/lead.service.js";

export const ingestionSources = ["WEB_FORM", "PHONE_CALL", "PHYSICAL_VISIT", "WEBSITE", "EVENT", "PARTNER", "JOBINTECH", "LEGACY_IMPORT", "MANUAL_ENTRY", "OTHER_CONTROLLED"] as const;
export type IngestionSource = (typeof ingestionSources)[number];
export type IngestionProfile = "LEGACY_CRM" | "FORMINATOR_ZAPIER" | "YNOV_COM" | "JOBINTECH" | "LEGACY_RELAUNCH" | "OTHER_CAMPAIGN" | "CUSTOM";
export type IngestionOutcome = "CREATED" | "PROVENANCE_ATTACHED" | "MANUAL_REVIEW" | "INVALID";

export interface IngestionRecordInput {
  lineNumber: number;
  firstName: string;
  lastName: string;
  email?: string | undefined;
  phone?: string | undefined;
  campus?: string | undefined;
  campaign?: string | undefined;
  educationLevel?: string | undefined;
  program?: string | undefined;
  source: IngestionSource;
  technicalSystem: string;
  originalSource: string;
  recentSource?: string | undefined;
  externalId?: string | undefined;
  historicalStatus?: string | undefined;
  structuredPriorContact?: boolean | undefined;
  occurredAt?: string | undefined;
  historicalActivities?: Array<{ type: "CRM_CALL" | "EXTERNAL_CALL" | "MEETING"; result: string; occurredAt: string }> | undefined;
}

export interface IngestionBatchInput {
  idempotencyKey: string;
  profile: IngestionProfile;
  confirmed?: boolean;
  assignment: { strategy: "UNASSIGNED" | BatchAssignmentStrategy; targetUserId?: string };
  records: IngestionRecordInput[];
}

export interface IngestionLineResult { lineNumber: number; outcome: IngestionOutcome; reason?: string; leadId?: string }
export interface IngestionBatchResult {
  batchId: string;
  idempotencyKey: string;
  total: number;
  created: number;
  attached: number;
  manualReview: number;
  invalid: number;
  assigned: number;
  unassigned: number;
  lines: IngestionLineResult[];
}

interface ProvenanceRecord { leadId: string; source: IngestionSource; technicalSystem: string; originalSource: string; recentSource: string; campaign?: string; externalId?: string; rawStatus?: string; batchId: string; importedAt: string }
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9:_-]{8,128}$/;

@Injectable()
export class IngestionService {
  private readonly batches = new Map<string, Readonly<IngestionBatchResult>>();
  private readonly provenanceByExternalId = new Map<string, Readonly<ProvenanceRecord>>();
  private readonly provenances: ProvenanceRecord[] = [];

  constructor(private readonly leads: LeadService, private readonly assignments: LeadAssignmentService, private readonly audit: AuditService) {}

  ingest(input: IngestionBatchInput, principal: Principal, correlationId: string): IngestionBatchResult {
    this.assertRole(principal);
    this.validateBatch(input);
    const previous = this.batches.get(input.idempotencyKey);
    if (previous) return this.copy(previous);
    const batchId = randomUUID();
    const lines: IngestionLineResult[] = [];
    let assigned = 0;
    for (const record of input.records) {
      const result = this.ingestOne(record, input, batchId, principal, `${correlationId}:${record.lineNumber}`);
      lines.push(result);
      if (result.outcome === "CREATED" && result.leadId && input.assignment.strategy !== "UNASSIGNED") {
        const assignment = this.assignCreated(result.leadId, record, input, principal, `${correlationId}:assignment:${record.lineNumber}`);
        if (assignment) assigned += 1;
      }
    }
    const created = lines.filter((line) => line.outcome === "CREATED").length;
    const result: Readonly<IngestionBatchResult> = Object.freeze({ batchId, idempotencyKey: input.idempotencyKey,
      total: lines.length, created, attached: lines.filter((line) => line.outcome === "PROVENANCE_ATTACHED").length,
      manualReview: lines.filter((line) => line.outcome === "MANUAL_REVIEW").length,
      invalid: lines.filter((line) => line.outcome === "INVALID").length, assigned, unassigned: created - assigned,
      lines: lines.map((line) => Object.freeze({ ...line })) });
    this.batches.set(input.idempotencyKey, result);
    this.audit.record({ eventType: "LEAD_INGESTION_COMPLETED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { batchId, profile: input.profile, total: result.total,
        created: result.created, attached: result.attached, manualReview: result.manualReview, invalid: result.invalid,
        assigned: result.assigned }, result: result.invalid || result.manualReview ? "FAILED" : "SUCCESS",
      idempotencyKey: `lead-ingestion:${input.idempotencyKey}` });
    return this.copy(result);
  }

  listProvenance(leadId: string, principal: Principal): Array<Omit<ProvenanceRecord, "externalId"> & { hasExternalId: boolean }> {
    this.assertRole(principal);
    return this.provenances.filter((item) => item.leadId === leadId).map((item) => ({ leadId: item.leadId, source: item.source,
      technicalSystem: item.technicalSystem, originalSource: item.originalSource, recentSource: item.recentSource,
      ...(item.campaign ? { campaign: item.campaign } : {}), batchId: item.batchId, importedAt: item.importedAt,
      ...(item.rawStatus ? { rawStatus: item.rawStatus } : {}), hasExternalId: Boolean(item.externalId) }));
  }

  private ingestOne(record: IngestionRecordInput, batch: IngestionBatchInput, batchId: string, principal: Principal, correlationId: string): IngestionLineResult {
    const normalized = this.normalize(record);
    if (normalized.reason) return { lineNumber: record.lineNumber, outcome: "INVALID", reason: normalized.reason };
    const status = this.mapHistoricalStatus(record.historicalStatus, record.structuredPriorContact === true);
    if (status.kind === "UNKNOWN") return { lineNumber: record.lineNumber, outcome: "MANUAL_REVIEW", reason: "historical_status_unknown" };
    const externalKey = record.externalId?.trim() ? `${record.technicalSystem.trim()}:${record.externalId.trim()}` : undefined;
    const externalMatch = externalKey ? this.provenanceByExternalId.get(externalKey)?.leadId : undefined;
    const identity = this.leads.findIdentityMatches(normalized.email, normalized.phone);
    const matches = new Set([externalMatch, identity.emailLeadId, identity.phoneLeadId].filter((value): value is string => Boolean(value)));
    if (matches.size > 1) return { lineNumber: record.lineNumber, outcome: "MANUAL_REVIEW", reason: "identity_collision" };
    const matchedLeadId = [...matches][0];
    if (status.kind === "DUPLICATE" && !matchedLeadId) return { lineNumber: record.lineNumber, outcome: "MANUAL_REVIEW", reason: "duplicate_without_reliable_match" };
    if (matchedLeadId) {
      this.attachProvenance(matchedLeadId, record, batchId, externalKey, principal, correlationId);
      return { lineNumber: record.lineNumber, outcome: "PROVENANCE_ATTACHED", leadId: matchedLeadId };
    }
    if (!record.campus?.trim() || !record.campaign?.trim() || !record.educationLevel?.trim() || !record.program?.trim()) {
      return { lineNumber: record.lineNumber, outcome: "MANUAL_REVIEW", reason: "required_mapping_missing" };
    }
    const lead = this.leads.registerLocalLead({ leadCode: `LD-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      firstName: record.firstName.trim(), lastName: record.lastName.trim(), ...(normalized.email ? { email: normalized.email } : {}),
      ...(normalized.phone ? { phone: normalized.phone } : {}), campus: record.campus.trim(), campaign: record.campaign.trim(),
      educationLevel: record.educationLevel.trim(), program: record.program.trim(), source: record.source,
      importBatchId: batchId, status: status.kind === "KNOWN" ? status.status : "PROSPECT" });
    this.attachProvenance(lead.id, record, batchId, externalKey, principal, correlationId);
    return { lineNumber: record.lineNumber, outcome: "CREATED", leadId: lead.id };
  }

  private attachProvenance(leadId: string, record: IngestionRecordInput, batchId: string, externalKey: string | undefined, principal: Principal, correlationId: string): void {
    if (externalKey && this.provenanceByExternalId.has(externalKey)) return;
    const provenance: Readonly<ProvenanceRecord> = Object.freeze({ leadId, source: record.source,
      technicalSystem: record.technicalSystem.trim(), originalSource: record.originalSource.trim(),
      recentSource: record.recentSource?.trim() || record.originalSource.trim(), ...(record.campaign?.trim() ? { campaign: record.campaign.trim() } : {}),
      ...(record.externalId?.trim() ? { externalId: record.externalId.trim() } : {}),
      ...(record.historicalStatus?.trim() ? { rawStatus: record.historicalStatus.trim() } : {}), batchId, importedAt: new Date().toISOString() });
    if (externalKey) this.provenanceByExternalId.set(externalKey, provenance);
    this.provenances.push(provenance);
    this.leads.appendIngestionActivity(leadId, { type: record.source === "LEGACY_IMPORT" ? "LEGACY_IMPORT" : "PROVENANCE_ATTACHED",
      result: record.source, ...(record.occurredAt ? { occurredAt: record.occurredAt } : {}) }, principal, correlationId);
    for (const [index, activity] of (record.historicalActivities ?? []).entries()) {
      this.leads.appendIngestionActivity(leadId, activity, principal, `${correlationId}:historical:${index}`);
    }
  }

  private assignCreated(leadId: string, record: IngestionRecordInput, input: IngestionBatchInput, principal: Principal, correlationId: string): boolean {
    const strategy = input.assignment.strategy as BatchAssignmentStrategy;
    try {
      const result = this.assignments.assignBatch({ idempotencyKey: `${input.idempotencyKey}:${record.lineNumber}`,
        strategy, ...(strategy === "FIXED" && input.assignment.targetUserId ? { targetUserId: input.assignment.targetUserId } : {}),
        confirmed: true, items: [{ leadId, source: record.source, campaign: record.campaign ?? "UNMAPPED" }] }, principal, correlationId);
      return result.assigned.length === 1;
    } catch { return false; }
  }

  private normalize(record: IngestionRecordInput): { email?: string; phone?: string; reason?: string } {
    if (!Number.isInteger(record.lineNumber) || record.lineNumber < 1 || !record.firstName?.trim() || !record.lastName?.trim()) return { reason: "identity_required" };
    if (!ingestionSources.includes(record.source) || !record.technicalSystem?.trim() || !record.originalSource?.trim()) return { reason: "source_invalid" };
    const email = record.email?.trim().toLowerCase();
    if (email && !this.validEmail(email)) return { reason: "email_invalid" };
    const phone = record.phone?.replace(/[^+\d]/g, "");
    if (phone && !/^\+?\d{8,15}$/.test(phone)) return { reason: "phone_invalid" };
    if (!email && !phone && !record.externalId?.trim()) return { reason: "stable_identity_missing" };
    if (record.occurredAt && Number.isNaN(new Date(record.occurredAt).valueOf())) return { reason: "occurred_at_invalid" };
    for (const activity of record.historicalActivities ?? []) {
      if (!activity.result?.trim() || Number.isNaN(new Date(activity.occurredAt).valueOf())) return { reason: "historical_activity_invalid" };
    }
    return { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
  }

  private validEmail(email: string): boolean {
    if (email.length > 254 || email.includes(" ") || email.includes("\t") || email.includes("\r") || email.includes("\n")) return false;
    const at = email.indexOf("@");
    if (at < 1 || at !== email.lastIndexOf("@")) return false;
    const domain = email.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    return dot > 0 && dot < domain.length - 1 && !domain.startsWith(".") && !domain.endsWith(".");
  }

  private mapHistoricalStatus(raw: string | undefined, priorContact: boolean): { kind: "KNOWN"; status: LeadStatus } | { kind: "DUPLICATE" } | { kind: "UNKNOWN" } {
    if (!raw?.trim()) return { kind: "KNOWN", status: "PROSPECT" };
    const value = raw.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const mapping: Record<string, LeadStatus> = { "A CONTACTER": "PROSPECT", "A QUALIFIER": "PROSPECT", "CONTACTE": "CONTACTED",
      "RDV PLANIFIE": "CONTACTED", "RDV EFFECTUE": "QUALIFIED", "DOSSIER OUVERT": "QUALIFIED", "INSCRIT": "ENROLLED",
      "SANS SUITE": "CLOSED_LOST", "INJOIGNABLE": "PROSPECT", "INJOIGNABLE / A RELANCER": "PROSPECT" };
    if (value === "DOUBLON") return { kind: "DUPLICATE" };
    if (value === "A RELANCER") return { kind: "KNOWN", status: priorContact ? "CONTACTED" : "PROSPECT" };
    return mapping[value] ? { kind: "KNOWN", status: mapping[value] } : { kind: "UNKNOWN" };
  }

  private validateBatch(input: IngestionBatchInput): void {
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) || input.confirmed !== true || input.records.length < 1 || input.records.length > 100) throw new BadRequestException({ code: "ingestion_batch_invalid" });
    if (!input.profile || !["UNASSIGNED", "FIXED", "ROUND_ROBIN", "CONTROLLED_RANDOM"].includes(input.assignment.strategy)) throw new BadRequestException({ code: "ingestion_strategy_invalid" });
    if ((input.assignment.strategy === "FIXED") !== Boolean(input.assignment.targetUserId)) throw new BadRequestException({ code: "ingestion_assignment_target_invalid" });
    if (new Set(input.records.map((record) => record.lineNumber)).size !== input.records.length) throw new BadRequestException({ code: "ingestion_line_duplicate" });
  }

  private assertRole(principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "ingestion_role_forbidden" });
  }
  private copy(result: Readonly<IngestionBatchResult>): IngestionBatchResult { return { ...result, lines: result.lines.map((line) => ({ ...line })) }; }
}
