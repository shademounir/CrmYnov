import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { IngestionController } from "../src/ingestion/ingestion.controller.js";
import { IngestionService, type IngestionRecordInput } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const adviser = "00000000-0000-4000-8000-000000000010";
const record = (lineNumber: number, overrides: Partial<IngestionRecordInput> = {}): IngestionRecordInput => ({
  lineNumber, firstName: "Prénom", lastName: "Synthétique", email: `lead-${lineNumber}@example.invalid`, phone: `+21260000${String(lineNumber).padStart(4, "0")}`,
  campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique",
  source: "LEGACY_IMPORT", technicalSystem: "LEGACY_CRM", originalSource: "LEGACY_CRM", externalId: `LEGACY-${lineNumber}`, historicalStatus: "À contacter", ...overrides,
});

function setup(): { audit: AuditService; leads: LeadService; service: IngestionService } {
  const audit = new AuditService(); const leads = new LeadService(audit); const engine = new AssignmentService(audit);
  engine.configure([{ id: "global", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true,
    candidates: [{ userId: adviser, active: true, capacity: 50, activeLeadCount: 0 }] }], manager, "synthetic-config");
  return { audit, leads, service: new IngestionService(leads, new LeadAssignmentService(leads, engine, audit), audit) };
}

test("creates once, maps historical status and replays a batch idempotently", () => {
  const { leads, service } = setup();
  const input = { idempotencyKey: "legacy-batch-001", profile: "LEGACY_CRM" as const, confirmed: true,
    assignment: { strategy: "UNASSIGNED" as const }, records: [record(1, { historicalStatus: "RDV effectué" })] };
  const first = service.ingest(input, manager, "corr-first"); const replay = service.ingest(input, manager, "corr-replay");
  assert.equal(first.created, 1); assert.equal(first.unassigned, 1); assert.equal(replay.batchId, first.batchId);
  assert.equal(leads.findLocalLead(first.lines[0]!.leadId!)?.status, "QUALIFIED");
  assert.equal(service.listProvenance(first.lines[0]!.leadId!, manager)[0]?.rawStatus, "RDV effectué");
});

test("attaches a new occurrence without changing status or owner", () => {
  const { leads, service } = setup();
  const first = service.ingest({ idempotencyKey: "legacy-batch-002", profile: "LEGACY_CRM", confirmed: true,
    assignment: { strategy: "FIXED", targetUserId: adviser }, records: [record(2, { historicalStatus: "Contacté" })] }, manager, "corr-create");
  const leadId = first.lines[0]!.leadId!; assert.equal(leads.findLocalLead(leadId)?.assignedToId, adviser);
  const second = service.ingest({ idempotencyKey: "form-batch-002", profile: "FORMINATOR_ZAPIER", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [record(3, { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER",
      originalSource: "FORMINATOR", externalId: "SUBMISSION-003", email: "lead-2@example.invalid", phone: undefined, historicalStatus: undefined })] }, manager, "corr-attach");
  assert.equal(second.attached, 1); assert.equal(second.lines[0]?.leadId, leadId);
  assert.equal(leads.findLocalLead(leadId)?.status, "CONTACTED"); assert.equal(leads.findLocalLead(leadId)?.assignedToId, adviser);
});

test("maps all approved historic statuses conservatively", () => {
  const { leads, service } = setup();
  const cases: Array<[string, boolean, string]> = [["À qualifier", false, "PROSPECT"], ["RDV planifié", false, "CONTACTED"],
    ["Dossier ouvert", false, "QUALIFIED"], ["Inscrit", false, "ENROLLED"], ["Sans suite", false, "CLOSED_LOST"],
    ["Injoignable / à relancer", false, "PROSPECT"], ["À relancer", false, "PROSPECT"], ["À relancer", true, "CONTACTED"]];
  const result = service.ingest({ idempotencyKey: "status-batch-003", profile: "LEGACY_CRM", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: cases.map(([historicalStatus, structuredPriorContact], index) =>
      record(index + 10, { historicalStatus, structuredPriorContact })) }, manager, "corr-status");
  assert.deepEqual(result.lines.map((line) => leads.findLocalLead(line.leadId!)?.status), cases.map((item) => item[2]));
});

test("preserves only explicitly structured historical activities", () => {
  const { leads, service } = setup();
  const result = service.ingest({ idempotencyKey: "activity-batch-006", profile: "LEGACY_CRM", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [record(60, { historicalActivities: [
      { type: "EXTERNAL_CALL", result: "ATTEMPTED", occurredAt: "2026-01-15T10:00:00.000Z" },
      { type: "MEETING", result: "COMPLETED", occurredAt: "2026-01-16T14:00:00.000Z" },
    ] })] }, manager, "corr-activities");
  const timeline = leads.timeline(result.lines[0]!.leadId!, manager);
  assert.deepEqual(timeline.filter((item) => item.type === "EXTERNAL_CALL" || item.type === "MEETING").map((item) => item.occurredAt),
    ["2026-01-16T14:00:00.000Z", "2026-01-15T10:00:00.000Z"]);
});

test("fails closed for collision, unknown status, duplicate without match and missing mapping", () => {
  const { leads, service } = setup();
  const seed = (leadCode: string, email: string, phone: string): void => { leads.registerLocalLead({ leadCode, firstName: "Lead", lastName: "Synthétique",
    email, phone, campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "WEB_FORM" }); };
  seed("LD-SYNTH-030", "first@example.invalid", "+212600000030");
  seed("LD-SYNTH-031", "second@example.invalid", "+212600000031");
  const result = service.ingest({ idempotencyKey: "review-batch-004", profile: "CUSTOM", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [
      record(40, { email: "first@example.invalid", phone: "+212600000031" }), record(41, { historicalStatus: "Statut inconnu" }),
      record(42, { historicalStatus: "Doublon" }), record(43, { campus: undefined }),
    ] }, manager, "corr-review");
  assert.deepEqual(result.lines.map((line) => line.reason), ["identity_collision", "historical_status_unknown", "duplicate_without_reliable_match", "required_mapping_missing"]);
  assert.equal(result.manualReview, 4); assert.equal(result.created, 0);
});

test("rejects malformed batches and exposes only sanitized provenance", () => {
  const { audit, service } = setup(); const controller = new IngestionController(service);
  const request = { principal: manager, header: () => "corr-controller" } as never;
  assert.throws(() => controller.ingest({ idempotencyKey: "short", profile: "CUSTOM", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [record(50)] }, request));
  const result = controller.ingest({ idempotencyKey: "valid-batch-005", profile: "CUSTOM", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [record(51)] }, request);
  const provenance = controller.provenance(result.lines[0]!.leadId!, request) as { items: Array<Record<string, unknown>> };
  const firstProvenance = provenance.items[0]; assert.ok(firstProvenance);
  assert.equal(firstProvenance.hasExternalId, true); assert.equal("externalId" in firstProvenance, false);
  assert.equal(JSON.stringify(audit.list()).includes("lead-51@example.invalid"), false);
});

test("rejects adversarial email input with deterministic bounded validation", () => {
  const { service } = setup();
  const adversarial = `${"!.".repeat(20_000)}!@!.${"!.".repeat(20_000)}!`;
  const startedAt = performance.now();
  const result = service.ingest({ idempotencyKey: "email-batch-007", profile: "CUSTOM", confirmed: true,
    assignment: { strategy: "UNASSIGNED" }, records: [record(70, { email: adversarial, phone: undefined })] }, manager, "corr-email");
  assert.equal(result.lines[0]?.reason, "email_invalid");
  assert.ok(performance.now() - startedAt < 100);
});
