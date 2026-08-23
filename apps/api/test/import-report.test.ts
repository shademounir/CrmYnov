import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { ImportMappingService } from "../src/import-mapping/import-mapping.service.js";
import { ImportReportService } from "../src/import-report/import-report.service.js";
import { ImportReportController } from "../src/import-report/import-report.controller.js";
import { IngestionService, type IngestionRecordInput } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const auditor = { ...manager, userId: "synthetic-auditor", roles: ["AUDITOR" as const] };
const adviser = { ...manager, userId: "synthetic-adviser", roles: ["ADMISSIONS" as const] };
function setup(): { reports: ImportReportService; ingestion: IngestionService; mappingId: string; audit: AuditService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  const ingestion = new IngestionService(leads, new LeadAssignmentService(leads, engine, audit), audit);
  const mappings = new ImportMappingService(ingestion, audit);
  return { reports: new ImportReportService(ingestion, mappings, audit), ingestion, mappingId: mappings.list(manager)[0]!.id, audit };
}
const record = (lineNumber: number, overrides: Partial<IngestionRecordInput> = {}): IngestionRecordInput => ({ lineNumber,
  firstName: "Prénom", lastName: "Synthétique", email: `lead-${lineNumber}@example.invalid`, campus: "Campus synthétique",
  campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "WEB_FORM",
  technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", externalId: `SYN-${lineNumber}`, ...overrides });

test("creates an idempotent reconciled report and PII-free rejection export", () => {
  const { reports, ingestion, mappingId, audit } = setup();
  const batch = ingestion.ingest({ idempotencyKey: "synthetic-batch-0001", profile: "FORMINATOR_ZAPIER", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [record(1), record(2, { email: "invalid", phone: undefined })] }, manager, "corr-ingest");
  const input = { jobId: "synthetic-job-0001", batchId: batch.batchId, mappingId, mappingVersion: 1, sourceFileSha256: "a".repeat(64) };
  const first = reports.create(input, manager, "corr-report"); const replay = reports.create(input, manager, "corr-replay");
  assert.deepEqual(replay, first); assert.equal(first.reconciled, true);
  assert.equal(first.created + first.updated + first.ignored + first.duplicates + first.errors, first.total);
  const csv = reports.exportRejections(input.jobId, manager);
  assert.equal(csv, "line_number,category,reason_code\n2,INVALID,email_invalid\n");
  assert.equal(csv.includes("@example.invalid"), false); assert.equal(JSON.stringify(audit.list()).includes("@example.invalid"), false);
});

test("refuses an invalid hash, unknown batch and conflicting replay", () => {
  const { reports, ingestion, mappingId } = setup();
  const actionCode = (action: () => unknown): string => { try { action(); return "missing_error"; } catch (error) { return ((error as { getResponse?: () => unknown }).getResponse?.() as { code?: string })?.code ?? "unknown"; } };
  assert.equal(actionCode(() => reports.create({ jobId: "synthetic-job-0002", batchId: "00000000-0000-4000-8000-000000000099", mappingId, mappingVersion: 1, sourceFileSha256: "bad" }, manager, "corr-invalid")), "import_report_identity_invalid");
  assert.equal(actionCode(() => reports.create({ jobId: "synthetic-job-0002", batchId: "00000000-0000-4000-8000-000000000099", mappingId, mappingVersion: 1, sourceFileSha256: "b".repeat(64) }, manager, "corr-missing")), "import_report_batch_not_found");
  const batch = ingestion.ingest({ idempotencyKey: "synthetic-batch-0002", profile: "FORMINATOR_ZAPIER", confirmed: true, assignment: { strategy: "UNASSIGNED" }, records: [record(1)] }, manager, "corr-ingest");
  const base = { jobId: "synthetic-job-0003", batchId: batch.batchId, mappingId, mappingVersion: 1, sourceFileSha256: "c".repeat(64) };
  reports.create(base, manager, "corr-first");
  assert.equal(actionCode(() => reports.create({ ...base, sourceFileSha256: "d".repeat(64) }, manager, "corr-conflict")), "import_report_replay_conflict");
});

test("enforces read/write roles and fails closed for unknown reports or mappings", () => {
  const { reports, ingestion, mappingId } = setup();
  const actionCode = (action: () => unknown): string => { try { action(); return "missing_error"; } catch (error) { return ((error as { getResponse?: () => unknown }).getResponse?.() as { code?: string })?.code ?? "unknown"; } };
  const batch = ingestion.ingest({ idempotencyKey: "synthetic-batch-0004", profile: "FORMINATOR_ZAPIER", confirmed: true, assignment: { strategy: "UNASSIGNED" }, records: [record(1)] }, manager, "corr-ingest");
  const input = { jobId: "synthetic-job-0004", batchId: batch.batchId, mappingId, mappingVersion: 1, sourceFileSha256: "e".repeat(64) };
  assert.equal(actionCode(() => reports.create(input, auditor, "corr-auditor")), "import_report_write_forbidden");
  assert.equal(actionCode(() => reports.create({ ...input, mappingId: "mapping-000000000000000000000000" }, manager, "corr-mapping")), "import_report_mapping_not_found");
  const report = reports.create(input, manager, "corr-create");
  assert.equal(reports.get(input.jobId, auditor).id, report.id);
  assert.equal(actionCode(() => reports.get(input.jobId, adviser)), "import_report_read_forbidden");
  assert.equal(actionCode(() => reports.get("synthetic-job-unknown", manager)), "import_report_not_found");
  assert.equal(reports.exportRejections(input.jobId, auditor), "line_number,category,reason_code\n");
});

test("controller requires authentication and delegates report reads and exports", () => {
  const { reports, ingestion, mappingId } = setup(); const controller = new ImportReportController(reports);
  const batch = ingestion.ingest({ idempotencyKey: "synthetic-batch-0005", profile: "FORMINATOR_ZAPIER", confirmed: true, assignment: { strategy: "UNASSIGNED" }, records: [record(1)] }, manager, "corr-ingest");
  const input = { jobId: "synthetic-job-0005", batchId: batch.batchId, mappingId, mappingVersion: 1, sourceFileSha256: "f".repeat(64) };
  const request = { principal: manager, header: () => "synthetic-correlation" } as never;
  const created = controller.create(input, request);
  assert.equal(controller.get(input.jobId, request).id, created.id);
  assert.equal(controller.export(input.jobId, request), "line_number,category,reason_code\n");
  let missingCode = "missing_error";
  try { controller.get(input.jobId, { header: () => undefined } as never); }
  catch (error) { missingCode = ((error as { getResponse?: () => unknown }).getResponse?.() as { code?: string })?.code ?? "unknown"; }
  assert.equal(missingCode, "principal_missing");
});
