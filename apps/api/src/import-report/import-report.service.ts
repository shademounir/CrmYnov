import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Principal } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { ImportMappingService } from "../import-mapping/import-mapping.service.js";
import { IngestionService } from "../ingestion/ingestion.service.js";

export interface CreateImportReportInput {
  jobId: string;
  batchId: string;
  mappingId: string;
  mappingVersion: number;
  sourceFileSha256: string;
}

export interface ImportRejectionRecord { lineNumber: number; category: "MANUAL_REVIEW" | "INVALID"; reasonCode: string }
export interface ImportReport {
  id: string; jobId: string; batchId: string; mappingId: string; mappingVersion: number; sourceFileSha256: string;
  total: number; created: number; updated: number; ignored: number; duplicates: number; errors: number;
  manualReview: number; invalid: number; reconciled: true; rejectionCount: number; createdAt: string;
}

const ID = /^[a-zA-Z0-9:_-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

@Injectable()
export class ImportReportService {
  private readonly reports = new Map<string, Readonly<ImportReport>>();
  private readonly rejections = new Map<string, ReadonlyArray<Readonly<ImportRejectionRecord>>>();
  private readonly fingerprints = new Map<string, string>();

  constructor(
    private readonly ingestion: IngestionService,
    private readonly mappings: ImportMappingService,
    private readonly audit: AuditService,
  ) {}

  create(input: CreateImportReportInput, principal: Principal, correlationId: string): ImportReport {
    this.assertWriter(principal); this.validate(input);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = this.reports.get(input.jobId);
    if (previous) {
      if (this.fingerprints.get(input.jobId) !== fingerprint) throw new ConflictException({ code: "import_report_replay_conflict" });
      return { ...previous };
    }
    const batch = this.ingestion.getBatch(input.batchId);
    if (!batch) throw new NotFoundException({ code: "import_report_batch_not_found" });
    if (!this.mappings.describeVersion(input.mappingId, input.mappingVersion)) throw new NotFoundException({ code: "import_report_mapping_not_found" });
    const rejected = batch.lines.flatMap((line): ImportRejectionRecord[] =>
      line.outcome === "MANUAL_REVIEW" || line.outcome === "INVALID"
        ? [{ lineNumber: line.lineNumber, category: line.outcome, reasonCode: line.reason ?? "reason_unavailable" }]
        : []);
    const errors = batch.manualReview + batch.invalid;
    const report: Readonly<ImportReport> = Object.freeze({
      id: this.reportId(input), jobId: input.jobId, batchId: input.batchId, mappingId: input.mappingId,
      mappingVersion: input.mappingVersion, sourceFileSha256: input.sourceFileSha256,
      total: batch.total, created: batch.created, updated: 0, ignored: 0, duplicates: batch.attached, errors,
      manualReview: batch.manualReview, invalid: batch.invalid, reconciled: true,
      rejectionCount: rejected.length, createdAt: new Date().toISOString(),
    });
    if (report.created + report.updated + report.ignored + report.duplicates + report.errors !== report.total) {
      throw new ConflictException({ code: "import_report_not_reconciled" });
    }
    this.reports.set(input.jobId, report); this.rejections.set(input.jobId, rejected.map((item) => Object.freeze({ ...item })));
    this.fingerprints.set(input.jobId, fingerprint);
    this.audit.record({ eventType: "LEAD_IMPORT_REPORT_CREATED", actorId: principal.userId, actorRoles: principal.roles,
      sessionId: principal.sessionId, correlationId, after: { reportId: report.id, jobId: report.jobId,
        mappingId: report.mappingId, mappingVersion: report.mappingVersion, total: report.total, created: report.created,
        duplicates: report.duplicates, errors: report.errors, reconciled: true }, result: "SUCCESS",
      idempotencyKey: `lead-import-report:${report.jobId}` });
    return { ...report };
  }

  get(jobId: string, principal: Principal): ImportReport {
    this.assertReader(principal); const report = this.reports.get(jobId);
    if (!report) throw new NotFoundException({ code: "import_report_not_found" });
    return { ...report };
  }

  exportRejections(jobId: string, principal: Principal): string {
    this.get(jobId, principal);
    const rows = this.rejections.get(jobId) ?? [];
    return ["line_number,category,reason_code", ...rows.map((item) => `${item.lineNumber},${item.category},${item.reasonCode}`)].join("\n") + "\n";
  }

  private validate(input: CreateImportReportInput): void {
    if (!ID.test(input.jobId) || !UUID.test(input.batchId) || !/^mapping-[0-9a-f]{24}$/.test(input.mappingId)
      || !Number.isInteger(input.mappingVersion) || input.mappingVersion < 1 || !SHA256.test(input.sourceFileSha256)) {
      throw new BadRequestException({ code: "import_report_identity_invalid" });
    }
  }
  private reportId(input: CreateImportReportInput): string {
    const hex = createHash("sha256").update(`${input.jobId}:${input.batchId}:${input.mappingId}:${input.mappingVersion}:${input.sourceFileSha256}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  private assertWriter(principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN")) throw new ForbiddenException({ code: "import_report_write_forbidden" });
  }
  private assertReader(principal: Principal): void {
    if (!principal.roles.some((role) => role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN" || role === "AUDITOR")) throw new ForbiddenException({ code: "import_report_read_forbidden" });
  }
}
