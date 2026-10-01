import assert from "node:assert/strict";
import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { IngestionService, type IngestionBatchInput } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";
import { SourceEffectivenessController } from "../src/reporting/source-effectiveness.controller.js";
import { SourceEffectivenessService } from "../src/reporting/source-effectiveness.service.js";

const manager: Principal = { userId: "manager-synthetic", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-manager" };
const adviser: Principal = { userId: "adviser-synthetic", roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: "session-adviser" };
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify(error).includes(code);
function setup(): { audit: AuditService; leads: LeadService; ingestion: IngestionService; service: SourceEffectivenessService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  const assignments = new LeadAssignmentService(leads, engine, audit); const ingestion = new IngestionService(leads, assignments, audit);
  return { audit, leads, ingestion, service: new SourceEffectivenessService(leads, ingestion, audit) };
}
function batch(idempotencyKey: string, externalId: string, campus = "Campus synthétique"): IngestionBatchInput {
  return { idempotencyKey, profile: "FORMINATOR_ZAPIER", confirmed: true, assignment: { strategy: "UNASSIGNED" }, records: [{
    lineNumber: 1, firstName: "Prénom", lastName: "Synthétique", email: `${externalId}@example.invalid`, campus,
    campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "WEB_FORM",
    technicalSystem: "FORMINATOR_SYNTHETIQUE", originalSource: "FORMULAIRE_SYNTHETIQUE", externalId,
  }] };
}

test("computes source evidence from synthetic ingestion without inventing financial metrics", () => {
  const { audit, leads, ingestion, service } = setup();
  const created = ingestion.ingest(batch("source_batch_1", "external-1"), manager, "corr-first");
  ingestion.ingest(batch("source_batch_2", "external-1"), manager, "corr-duplicate");
  ingestion.ingest(batch("source_batch_3", "external-2", ""), manager, "corr-incomplete");
  const leadId = created.lines[0]!.leadId!; leads.addActivity(leadId, { type: "PHONE_CALL", result: "ANSWERED" }, manager, "corr-contact");
  leads.changeStatus(leadId, { status: "CONTACTED" }, manager, "corr-status");
  const report = service.read({ source: "WEB_FORM", campaign: "Campagne synthétique" }, manager, "corr-report");
  const source = report.breakdowns.source.find((item) => item.value === "WEB_FORM")!;
  assert.equal(source.volumeReceived, 3); assert.equal(source.uniqueLeadCount, 1); assert.equal(source.rates.duplicate, 0.3333);
  assert.equal(source.rates.incomplete, 0.3333); assert.equal(source.rates.contact, 1); assert.equal(source.unassigned, 1); assert.equal(source.toVerify, 1);
  assert.deepEqual(report.financialMetrics, { calculated: false, reason: "validated financial inputs are not available" });
  assert.equal(report.breakdowns.channel[0]?.value, "DIGITAL"); assert.equal(report.breakdowns.provenanceMode[0]?.value, "AUTOMATIC");
  const serialized = JSON.stringify(report); assert.equal(serialized.includes("Prénom"), false); assert.equal(serialized.includes("synthetic@example"), false);
  const event = audit.list().find((item) => item.eventType === "SOURCE_EFFECTIVENESS_VIEWED");
  assert.deepEqual(event?.after?.activeFilterNames, ["campaign", "source"]); assert.equal(JSON.stringify(event).includes("Campagne synthétique"), false);
});

test("returns unavailable evidence honestly and fails closed for roles and dates", () => {
  const { leads, service } = setup();
  leads.registerLocalLead({ leadCode: "LD-DIRECT", firstName: "Lead", lastName: "Synthétique", campus: "Campus synthétique",
    campaign: "Campagne", educationLevel: "BAC", program: "Programme", source: "PHONE_CALL", assignedToId: "adviser-a" });
  const source = service.read({}, manager, "corr-direct").breakdowns.source[0]!;
  assert.equal(source.evidence, "lead-cohort"); assert.equal(source.rates.duplicate, null); assert.equal(source.rates.incomplete, null);
  assert.throws(() => service.read({}, adviser, "corr-forbidden"), hasCode("ingestion_role_forbidden"));
  assert.throws(() => service.read({ from: "invalid" }, manager, "corr-invalid"), hasCode("source_report_from_invalid"));
});

test("controller refuses a missing principal", () => {
  const { service } = setup(); const controller = new SourceEffectivenessController(service);
  assert.throws(() => controller.read({}, {} as never), hasCode("principal_missing"));
});
