import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentService } from "../src/assignment/assignment.service.js";
import { LeadAssignmentService } from "../src/assignment/lead-assignment.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { ImportMappingService, type ImportDryRunInput, type SaveImportMappingInput } from "../src/import-mapping/import-mapping.service.js";
import { IngestionService } from "../src/ingestion/ingestion.service.js";
import { LeadService } from "../src/leads/lead.service.js";

const manager = { userId: "synthetic-manager", roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "00000000-0000-4000-8000-000000000001" };
const formColumns = ["Submission ID", "Submission Time", "Nom - Prénom", "Nom - Nom", "Adresse éléctronique", "Numéro de téléphone", "Niveau d'étude", "Formation choisie", "Webhook Info"];

function setup(): { mappings: ImportMappingService; leads: LeadService; audit: AuditService } {
  const audit = new AuditService();
  const leads = new LeadService(audit);
  const assignments = new AssignmentService(audit);
  assignments.configure([{ id: "global", scope: "GLOBAL", strategy: "ROUND_ROBIN", enabled: true, candidates: [
    { userId: "adviser-a", active: true, capacity: 10, activeLeadCount: 0 },
    { userId: "adviser-b", active: true, capacity: 10, activeLeadCount: 0 },
  ] }], manager, "synthetic-assignment-config");
  const leadAssignments = new LeadAssignmentService(leads, assignments, audit);
  return { mappings: new ImportMappingService(new IngestionService(leads, leadAssignments, audit), audit), leads, audit };
}

function row(id: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Submission ID": id,
    "Submission Time": "2026-08-23T09:00:00.000Z",
    "Nom - Prénom": "Prénom",
    "Nom - Nom": "Synthétique",
    "Adresse éléctronique": `${id.toLowerCase()}@example.invalid`,
    "Numéro de téléphone": `+212600${id.slice(-6).padStart(6, "0")}`,
    "Niveau d'étude": "BAC",
    "Formation choisie": "Programme synthétique",
    "Webhook Info": "synthetic-only",
    ...overrides,
  };
}

function dryRun(rows: Array<Record<string, string>>, overrides: Partial<ImportDryRunInput> = {}): ImportDryRunInput {
  return {
    idempotencyKey: "dry-run-synthetic-001",
    mappingKey: "forminator-zapier-v1",
    mappingVersion: 1,
    sourceColumns: formColumns,
    rows,
    context: { source: "WEB_FORM", technicalSystem: "FORMINATOR_ZAPIER", originalSource: "FORMINATOR", campus: "Campus synthétique", campaign: "Campagne synthétique" },
    assignment: { strategy: "ROUND_ROBIN" },
    ...overrides,
  };
}

function code(action: () => unknown): string {
  try { action(); return "missing_error"; }
  catch (error) { return ((error as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined)?.code ?? "unknown"; }
}

test("lists immutable built-in mappings without business data", () => {
  const { mappings } = setup();
  const templates = mappings.list(manager);
  assert.deepEqual(templates.map((item) => item.mappingKey), ["forminator-zapier-v1", "legacy-crm-canonical-v1"]);
  assert.equal(templates.every((item) => item.builtIn && item.version === 1), true);
  assert.equal(JSON.stringify(templates).includes("@example.invalid"), false);
});

test("creates and reuses an optimistic immutable custom mapping version", () => {
  const { mappings } = setup();
  const input: SaveImportMappingInput = { mappingKey: "custom-campaign", name: "Campagne synthétique", profile: "CUSTOM", expectedVersion: 0, columns: [
    { sourceColumn: "Prénom", targetField: "firstName", action: "TRIM", required: true },
    { sourceColumn: "Nom", targetField: "lastName", action: "TRIM", required: true },
    { sourceColumn: "Courriel", targetField: "email", action: "LOWERCASE" },
    { sourceColumn: "Colonne ignorée", action: "IGNORE", reason: "not_required_by_crm" },
  ] };
  const first = mappings.save(input, manager, "corr-mapping-v1");
  const second = mappings.save({ ...input, expectedVersion: 1, name: "Campagne synthétique v2" }, manager, "corr-mapping-v2");
  assert.equal(first.version, 1); assert.equal(second.version, 2); assert.notEqual(first.id, second.id);
  assert.equal(code(() => mappings.save(input, manager, "corr-conflict")), "mapping_version_conflict");
  assert.equal(code(() => mappings.save({ ...input, mappingKey: "forminator-zapier-v1", expectedVersion: 1 }, manager, "corr-builtin")), "mapping_builtin_immutable");
});

test("dry-run reconciles valid, duplicate, invalid and review rows without mutation", () => {
  const { mappings, leads, audit } = setup();
  leads.registerLocalLead({ leadCode: "LD-SYNTH-EXISTING-A", firstName: "Existant", lastName: "Alpha", email: "existing-a@example.invalid", phone: "+212600000101",
    campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "WEB_FORM" });
  leads.registerLocalLead({ leadCode: "LD-SYNTH-EXISTING-B", firstName: "Existant", lastName: "Beta", email: "existing-b@example.invalid", phone: "+212600000102",
    campus: "Campus synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "WEB_FORM" });
  const rows = [
    row("SYN-000001"),
    row("SYN-000002", { "Adresse éléctronique": "syn-000001@example.invalid", "Numéro de téléphone": "+212600000001" }),
    row("SYN-000003", { "Adresse éléctronique": "invalid", "Numéro de téléphone": "" }),
    row("SYN-000004", { "Formation choisie": "" }),
    row("SYN-000005", { "Adresse éléctronique": "existing-a@example.invalid", "Numéro de téléphone": "+212600000102" }),
    row("SYN-000006"),
  ];
  const before = leads.findIdentityMatches("syn-000001@example.invalid", "+212600000001");
  const result = mappings.dryRun(dryRun(rows), manager, "corr-dry-run");
  const after = leads.findIdentityMatches("syn-000001@example.invalid", "+212600000001");
  assert.deepEqual(before, {}); assert.deepEqual(after, {});
  assert.deepEqual({ total: result.total, valid: result.valid, duplicates: result.duplicates, invalid: result.invalid, manualReview: result.manualReview },
    { total: 6, valid: 2, duplicates: 1, invalid: 1, manualReview: 2 });
  assert.equal(result.mutated, false); assert.equal(result.assigned, 2); assert.equal(result.unassigned, 0);
  assert.deepEqual(result.assignmentDistribution, [{ userId: "adviser-a", count: 1 }, { userId: "adviser-b", count: 1 }]);
  assert.equal(JSON.stringify(result).includes("@example.invalid"), false);
  assert.equal(JSON.stringify(audit.list()).includes("@example.invalid"), false);
});

test("dry-run refuses unknown columns, formula-like cells and unknown mapping versions", () => {
  const { mappings } = setup();
  assert.equal(code(() => mappings.dryRun(dryRun([row("SYN-000010")], { sourceColumns: [...formColumns, "Unexpected"] }), manager, "corr-columns")), "dry_run_columns_mismatch");
  assert.equal(code(() => mappings.dryRun(dryRun([row("SYN-000011", { "Nom - Prénom": "=1+1" })]), manager, "corr-formula")), "dry_run_cell_refused");
  assert.equal(code(() => mappings.dryRun(dryRun([row("SYN-000012")], { mappingVersion: 99 }), manager, "corr-version")), "mapping_version_not_found");
});

test("dry-run is idempotent at the audit boundary and never advances assignment state", () => {
  const { mappings, audit } = setup();
  const input = dryRun([row("SYN-000020"), row("SYN-000021")], { idempotencyKey: "dry-run-replay-020" });
  const first = mappings.dryRun(input, manager, "corr-first");
  const replay = mappings.dryRun(input, manager, "corr-replay");
  assert.deepEqual(replay.assignmentDistribution, first.assignmentDistribution);
  assert.equal(audit.list().filter((event) => event.eventType === "LEAD_IMPORT_DRY_RUN_COMPLETED").length, 1);
  assert.equal(first.lines.every((line) => line.outcome === "VALID"), true);
});
