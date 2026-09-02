import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { validateLeadReferences } from "../references/reference.repository.js";
import type { IngestionBatchInput, IngestionRecordInput } from "./ingestion.service.js";

export interface ConfirmPersistentImportInput extends IngestionBatchInput {
  confirmed: true;
  mappingId: string;
  mappingVersion: number;
  sourceFileSha256: string;
  allowedPrograms?: string[];
  resolvedAssignments?: Record<string, string>;
}

export interface PersistentImportResult {
  batchId: string;
  reportId: string;
  idempotencyKey: string;
  total: number;
  created: number;
  attached: number;
  manualReview: number;
  invalid: number;
  replayed: boolean;
}

type LineOutcome = "CREATED" | "ATTACHED" | "MANUAL_REVIEW" | "INVALID" | "IGNORED";
type Line = { lineNumber: number; outcome: LineOutcome; reason?: string; leadId?: string };
const SAFE_KEY = /^[A-Za-z0-9:_-]{8,128}$/;
const SAFE_MAPPING = /^mapping-[0-9a-f]{24}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PersistentIngestionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async confirm(input: ConfirmPersistentImportInput, principal: Principal, correlationId: string): Promise<PersistentImportResult> {
    this.assertAllowed(input, principal);
    const client = this.prisma.client;
    if (!client) throw new ConflictException({ code: "persistent_import_database_unavailable" });
    const fingerprint = this.fingerprint(input);
    const existing = await client.ingestionBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { report: true } });
    if (existing) return this.replay(existing, fingerprint);

    const execute = async (): Promise<PersistentImportResult> => client.$transaction(async (tx) => {
      const concurrent = await tx.ingestionBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { report: true } });
      if (concurrent) return this.replay(concurrent, fingerprint);
      const batchId = randomUUID();
      const reportId = randomUUID();
      const lines: Line[] = [];
      await tx.ingestionBatch.create({ data: {
        id: batchId, idempotencyKey: input.idempotencyKey, fingerprint, profile: input.profile,
        assignmentMode: input.assignment.strategy, actorId: principal.userId, totalCount: input.records.length,
        createdCount: 0, attachedCount: 0, reviewCount: 0, invalidCount: 0,
      } });
      for (const record of [...input.records].sort((a, b) => a.lineNumber - b.lineNumber)) {
        lines.push(await this.persistLine(tx, batchId, record, input, principal, correlationId));
      }
      const created = this.count(lines, "CREATED");
      const attached = this.count(lines, "ATTACHED");
      const manualReview = this.count(lines, "MANUAL_REVIEW");
      const invalid = this.count(lines, "INVALID");
      const ignored = this.count(lines, "IGNORED");
      await tx.ingestionBatch.update({ where: { id: batchId }, data: { createdCount: created, attachedCount: attached, reviewCount: manualReview, invalidCount: invalid } });
      await tx.importReport.create({ data: {
        id: reportId, jobId: input.idempotencyKey, batchId, mappingId: input.mappingId, mappingVersion: input.mappingVersion,
        sourceFileSha256: input.sourceFileSha256, totalCount: lines.length, createdCount: created, updatedCount: 0,
        ignoredCount: ignored, duplicateCount: attached, errorCount: manualReview + invalid,
        rejections: { create: lines.filter((line) => line.outcome === "MANUAL_REVIEW" || line.outcome === "INVALID")
          .map((line) => ({ id: randomUUID(), lineNumber: line.lineNumber, category: line.outcome, reasonCode: line.reason ?? "reason_unavailable" })) },
      } });
      return { batchId, reportId, idempotencyKey: input.idempotencyKey, total: lines.length, created, attached, manualReview, invalid, replayed: false };
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });

    try {
      const result = await execute();
      this.recordAudit(result, input, principal, correlationId);
      return result;
    } catch (error) {
      const replay = await client.ingestionBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { report: true } });
      if (replay) return this.replay(replay, fingerprint);
      throw error;
    }
  }

  private async persistLine(tx: Prisma.TransactionClient, batchId: string, record: IngestionRecordInput, input: ConfirmPersistentImportInput, principal: Principal, correlationId: string): Promise<Line> {
    const invalid = this.validateRecord(record);
    if (invalid) return { lineNumber: record.lineNumber, outcome: "INVALID", reason: invalid };
    const mappedStatus = this.mapStatus(record.historicalStatus, record.structuredPriorContact === true);
    const email = record.email?.trim().toLowerCase() || undefined;
    const phone = record.phone?.replace(/[^+\d]/g, "") || undefined;
    const externalId = record.externalId?.trim() || undefined;
    const { external, matches } = await this.findMatches(tx, record.technicalSystem.trim(), externalId, email, phone);
    if (matches.size > 1) return this.review(tx, batchId, record.lineNumber, "IDENTITY_COLLISION");
    const matchedLeadId = [...matches][0];
    if (mappedStatus === "DUPLICATE" && !matchedLeadId) return this.review(tx, batchId, record.lineNumber, "DUPLICATE_WITHOUT_RELIABLE_MATCH");
    if (mappedStatus === "UNKNOWN") return this.review(tx, batchId, record.lineNumber, "STATUS_UNKNOWN", matchedLeadId);
    if (record.program && input.allowedPrograms?.length && !input.allowedPrograms.includes(record.program.trim())) return this.review(tx, batchId, record.lineNumber, "PROGRAM_UNKNOWN", matchedLeadId);
    if (matchedLeadId) return this.attachMatch(tx, batchId, matchedLeadId, record, mappedStatus === "DUPLICATE", Boolean(external), principal.userId, correlationId);
    if (mappedStatus === "DUPLICATE") return this.review(tx, batchId, record.lineNumber, "DUPLICATE_WITHOUT_RELIABLE_MATCH");
    if (!record.campus?.trim() || !record.campaign?.trim() || !record.educationLevel?.trim() || !record.program?.trim()) return this.review(tx, batchId, record.lineNumber, "REQUIRED_MAPPING_MISSING");
    try {
      const references = await validateLeadReferences(tx, { campus: record.campus, campaign: record.campaign, program: record.program });
      return await this.createLead(tx, batchId, { ...record, ...references }, input, mappedStatus, email, phone, principal.userId, correlationId);
    } catch (error) {
      if (!(error instanceof UnprocessableEntityException)) throw error;
      return this.review(tx, batchId, record.lineNumber, "REFERENCE_VALUE_UNKNOWN");
    }
  }

  private async findMatches(tx: Prisma.TransactionClient, technicalSystem: string, externalId: string | undefined, email: string | undefined, phone: string | undefined): Promise<{ external: { leadId: string } | null; matches: Set<string> }> {
    const external = externalId ? await tx.leadProvenance.findUnique({ where: { technicalSystem_externalId: { technicalSystem, externalId } } }) : null;
    const identities = [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])];
    const identityMatches = identities.length ? await tx.lead.findMany({ where: { OR: identities }, select: { id: true }, take: 3 }) : [];
    return { external, matches: new Set([...(external ? [external.leadId] : []), ...identityMatches.map((lead) => lead.id)]) };
  }

  private async attachMatch(tx: Prisma.TransactionClient, batchId: string, leadId: string, record: IngestionRecordInput, ignored: boolean, provenanceExists: boolean, actorId: string, correlationId: string): Promise<Line> {
    if (!provenanceExists) await this.provenance(tx, batchId, leadId, record);
    await this.activity(tx, leadId, "PROVENANCE_ATTACHED", record.source, actorId, `${correlationId}:${record.lineNumber}:provenance`);
    return { lineNumber: record.lineNumber, outcome: ignored ? "IGNORED" : "ATTACHED", leadId };
  }

  private async createLead(tx: Prisma.TransactionClient, batchId: string, record: IngestionRecordInput, input: ConfirmPersistentImportInput, mappedStatus: "PROSPECT" | "CONTACTED" | "QUALIFIED" | "ENROLLED" | "CLOSED_LOST", email: string | undefined, phone: string | undefined, actorId: string, correlationId: string): Promise<Line> {
    const leadId = randomUUID();
    const assignedToId = input.resolvedAssignments?.[String(record.lineNumber)];
    if (input.assignment.strategy !== "UNASSIGNED" && !assignedToId) return this.review(tx, batchId, record.lineNumber, "ASSIGNMENT_UNRESOLVED");
    if (assignedToId && !UUID.test(assignedToId)) return { lineNumber: record.lineNumber, outcome: "INVALID", reason: "assignment_target_invalid" };
    await tx.lead.create({ data: {
      id: leadId, leadCode: `LD-${new Date().getUTCFullYear()}-${leadId.slice(0, 8).toUpperCase()}`,
      firstName: record.firstName.trim(), lastName: record.lastName.trim(), email: email ?? null, phone: phone ?? null,
      campus: record.campus!.trim(), campaign: record.campaign!.trim(), educationLevel: record.educationLevel!.trim(), program: record.program!.trim(),
      source: record.source, status: mappedStatus, assignedToId: assignedToId ?? null, assignmentMode: assignedToId ? input.assignment.strategy : null,
      importBatchId: batchId,
    } });
    await this.activity(tx, leadId, "LEAD_CREATED", mappedStatus, actorId, `${correlationId}:${record.lineNumber}:created`);
    await this.provenance(tx, batchId, leadId, record);
    for (const [index, historical] of (record.historicalActivities ?? []).entries()) {
      await tx.leadActivity.create({ data: { id: randomUUID(), leadId, type: historical.type, result: historical.result.slice(0, 240), authorId: "LEGACY_IMPORT", correlationId: `${correlationId}:${record.lineNumber}:historical:${index}`, occurredAt: new Date(historical.occurredAt) } });
    }
    return { lineNumber: record.lineNumber, outcome: "CREATED", leadId };
  }

  private async provenance(tx: Prisma.TransactionClient, batchId: string, leadId: string, record: IngestionRecordInput): Promise<void> {
    await tx.leadProvenance.create({ data: { id: randomUUID(), leadId, batchId, sourceType: record.source,
      technicalSystem: record.technicalSystem.trim(), originalSource: record.originalSource.trim(), recentSource: record.recentSource?.trim() || record.originalSource.trim(),
      campaign: record.campaign?.trim() || null, externalId: record.externalId?.trim() || null, rawStatus: record.historicalStatus?.trim() || null,
      occurredAt: record.occurredAt ? new Date(record.occurredAt) : null } });
  }

  private async activity(tx: Prisma.TransactionClient, leadId: string, type: "LEAD_CREATED" | "PROVENANCE_ATTACHED", result: string, actorId: string, correlationId: string): Promise<void> {
    await tx.leadActivity.create({ data: { id: randomUUID(), leadId, type, result: result.slice(0, 240), authorId: actorId, correlationId, occurredAt: new Date() } });
  }

  private async review(tx: Prisma.TransactionClient, batchId: string, lineNumber: number, reasonCode: string, leadId?: string): Promise<Line> {
    await tx.ingestionReviewItem.create({ data: { id: randomUUID(), batchId, lineNumber, reasonCode, leadId: leadId ?? null } });
    return { lineNumber, outcome: "MANUAL_REVIEW", reason: reasonCode.toLowerCase(), ...(leadId ? { leadId } : {}) };
  }

  private assertAllowed(input: ConfirmPersistentImportInput, principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "persistent_import_role_forbidden" });
    if (input.confirmed !== true) throw new ConflictException({ code: "persistent_import_confirmation_required" });
    if (!SAFE_KEY.test(input.idempotencyKey) || !SAFE_MAPPING.test(input.mappingId) || !Number.isInteger(input.mappingVersion) || input.mappingVersion < 1 || !SHA256.test(input.sourceFileSha256) || !input.records.length || input.records.length > 10_000) throw new BadRequestException({ code: "persistent_import_contract_invalid" });
    const lines = input.records.map((record) => record.lineNumber);
    if (lines.some((line) => !Number.isInteger(line) || line < 1) || new Set(lines).size !== lines.length) throw new BadRequestException({ code: "persistent_import_line_invalid" });
    const global = principal.scopes.some((scope) => scope.kind === "GLOBAL");
    const allowedCampuses = new Set(principal.scopes.flatMap((scope) => scope.kind === "CAMPUS" ? [scope.id] : []));
    if (!global && input.records.some((record) => !record.campus || !allowedCampuses.has(record.campus.trim()))) throw new ForbiddenException({ code: "persistent_import_scope_forbidden" });
  }

  private validateRecord(record: IngestionRecordInput): string | undefined {
    if (!record.firstName?.trim() || !record.lastName?.trim()) return "identity_name_missing";
    if (!record.email?.trim() && !record.phone?.trim() && !record.externalId?.trim()) return "identity_key_missing";
    if (record.email && !this.validEmail(record.email.trim())) return "email_invalid";
    if (record.phone && !/^\+?\d{8,15}$/.test(record.phone.replace(/[^+\d]/g, ""))) return "phone_invalid";
    if (!record.technicalSystem?.trim() || !record.originalSource?.trim()) return "provenance_missing";
    if (record.occurredAt && Number.isNaN(new Date(record.occurredAt).valueOf())) return "occurred_at_invalid";
    if (record.historicalActivities?.some((activity) => !activity.result?.trim() || Number.isNaN(new Date(activity.occurredAt).valueOf()))) return "historical_activity_invalid";
    return undefined;
  }

  private mapStatus(raw: string | undefined, contacted: boolean): "PROSPECT" | "CONTACTED" | "QUALIFIED" | "ENROLLED" | "CLOSED_LOST" | "DUPLICATE" | "UNKNOWN" {
    if (!raw?.trim()) return "PROSPECT";
    const value = raw.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["a contacter", "a qualifier", "injoignable", "injoignable / a relancer"].includes(value)) return "PROSPECT";
    if (value === "a relancer") return contacted ? "CONTACTED" : "PROSPECT";
    if (["contacte", "rdv planifie"].includes(value)) return "CONTACTED";
    if (["rdv effectue", "dossier ouvert"].includes(value)) return "QUALIFIED";
    if (value === "inscrit") return "ENROLLED";
    if (value === "sans suite") return "CLOSED_LOST";
    if (value === "doublon") return "DUPLICATE";
    return "UNKNOWN";
  }

  private fingerprint(input: ConfirmPersistentImportInput): string {
    const canonical = { ...input, confirmed: true, allowedPrograms: [...(input.allowedPrograms ?? [])].sort((left, right) => left.localeCompare(right)), records: [...input.records].sort((a, b) => a.lineNumber - b.lineNumber) };
    return createHash("sha256").update(JSON.stringify(this.canonical(canonical))).digest("hex");
  }

  private canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.canonical(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, this.canonical(item)]));
    return value;
  }

  private validEmail(value: string): boolean {
    if (value.length > 254 || value.includes(" ") || value.includes("\t") || value.includes("\r") || value.includes("\n")) return false;
    const at = value.indexOf("@");
    if (at < 1 || at !== value.lastIndexOf("@") || at > 64) return false;
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    return dot > 0 && dot < domain.length - 1;
  }

  private replay(batch: { id: string; idempotencyKey: string; fingerprint: string; totalCount: number; createdCount: number; attachedCount: number; reviewCount: number; invalidCount: number; report: { id: string } | null }, fingerprint: string): PersistentImportResult {
    if (batch.fingerprint !== fingerprint) throw new ConflictException({ code: "persistent_import_idempotency_conflict" });
    if (!batch.report) throw new ConflictException({ code: "persistent_import_incomplete_batch" });
    return { batchId: batch.id, reportId: batch.report.id, idempotencyKey: batch.idempotencyKey, total: batch.totalCount, created: batch.createdCount, attached: batch.attachedCount, manualReview: batch.reviewCount, invalid: batch.invalidCount, replayed: true };
  }

  private count(lines: readonly Line[], outcome: LineOutcome): number { return lines.filter((line) => line.outcome === outcome).length; }

  private recordAudit(result: PersistentImportResult, input: ConfirmPersistentImportInput, principal: Principal, correlationId: string): void {
    this.audit.record({ eventType: "LEAD_IMPORT_PERSISTED", actorId: principal.userId, actorRoles: principal.roles, sessionId: principal.sessionId,
      correlationId, after: { batchId: result.batchId, reportId: result.reportId, profile: input.profile, total: result.total,
        created: result.created, attached: result.attached, manualReview: result.manualReview, invalid: result.invalid },
      result: result.invalid || result.manualReview ? "FAILED" : "SUCCESS", idempotencyKey: `persistent-import:${input.idempotencyKey}` });
  }
}
