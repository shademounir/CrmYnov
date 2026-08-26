/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { PersistentIngestionService, type ConfirmPersistentImportInput } from "../src/ingestion/persistent-ingestion.service.js";

type Row = Record<string, unknown>;
type State = { batches: Row[]; reports: Row[]; leads: Row[]; provenances: Row[]; activities: Row[]; reviews: Row[]; rejections: Row[] };
const principal = { userId: "00000000-0000-4000-8000-000000000401", roles: ["MANAGER" as const], scopes: [{ kind: "CAMPUS" as const, id: "SYNTHETIC" }], sessionId: "synthetic-import-session" };
const base = (): ConfirmPersistentImportInput => ({ idempotencyKey: "synthetic-import-001", confirmed: true, profile: "FORMINATOR_ZAPIER",
  mappingId: "mapping-1234567890abcdef12345678", mappingVersion: 1, sourceFileSha256: "a".repeat(64), assignment: { strategy: "UNASSIGNED" },
  allowedPrograms: ["SYNTHETIC_PROGRAM"], records: [{ lineNumber: 1, firstName: "Aya", lastName: "Synthétique", email: "aya@example.invalid",
    phone: "+212600000401", campus: "SYNTHETIC", campaign: "SYNTHETIC_CAMPAIGN", educationLevel: "BAC", program: "SYNTHETIC_PROGRAM",
    source: "WEB_FORM", technicalSystem: "SYNTHETIC_FORM", originalSource: "SYNTHETIC", externalId: "synthetic-401", historicalStatus: "À contacter" }] });

function setup() {
  const state: State = { batches: [], reports: [], leads: [], provenances: [], activities: [], reviews: [], rejections: [] };
  const client = {
    ingestionBatch: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => { const row = state.batches.find((item) => item.idempotencyKey === where.idempotencyKey); return row ? { ...row, report: state.reports.find((report) => report.batchId === row.id) ?? null } : null; },
      create: async ({ data }: { data: Row }) => { state.batches.push({ ...data }); return data; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const row = state.batches.find((item) => item.id === where.id)!; Object.assign(row, data); return row; },
    },
    importReport: { create: async ({ data }: { data: Row & { rejections?: { create?: Row[] } } }) => { state.reports.push({ ...data, rejections: undefined }); state.rejections.push(...(data.rejections?.create ?? [])); return data; } },
    lead: {
      findMany: async ({ where }: { where: { OR: Array<{ email?: string; phone?: string }> } }) => state.leads.filter((lead) => where.OR.some((item) => item.email === lead.email || item.phone === lead.phone)).map((lead) => ({ id: lead.id })),
      create: async ({ data }: { data: Row }) => { state.leads.push({ ...data, createdAt: new Date(), updatedAt: new Date(), version: 1 }); return data; },
    },
    leadProvenance: {
      findUnique: async ({ where }: { where: { technicalSystem_externalId: { technicalSystem: string; externalId: string } } }) => state.provenances.find((row) => row.technicalSystem === where.technicalSystem_externalId.technicalSystem && row.externalId === where.technicalSystem_externalId.externalId) ?? null,
      create: async ({ data }: { data: Row }) => { state.provenances.push(data); return data; },
    },
    leadActivity: { create: async ({ data }: { data: Row }) => { state.activities.push(data); return data; } },
    ingestionReviewItem: { create: async ({ data }: { data: Row }) => { state.reviews.push(data); return data; } },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(client),
  };
  const service = new PersistentIngestionService({ enabled: true, client } as unknown as PrismaService, new AuditService());
  return { service, state };
}

const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

test("persists a confirmed synthetic import and replays the same payload idempotently", async () => {
  const { service, state } = setup(); const input = base();
  const created = await service.confirm(input, principal, "synthetic-import-create");
  assert.deepEqual({ created: created.created, attached: created.attached, manualReview: created.manualReview, invalid: created.invalid }, { created: 1, attached: 0, manualReview: 0, invalid: 0 });
  assert.equal(state.batches.length, 1); assert.equal(state.leads.length, 1); assert.equal(state.provenances.length, 1); assert.equal(state.reports.length, 1);
  assert.equal(state.activities.some((activity) => activity.type === "LEAD_CREATED"), true);
  assert.equal((await service.confirm(input, principal, "synthetic-import-replay")).replayed, true);
  await assert.rejects(() => service.confirm({ ...input, records: [{ ...input.records[0]!, firstName: "Changed" }] }, principal, "synthetic-import-conflict"), hasCode("persistent_import_idempotency_conflict"));
});

test("preserves canonical Lead fields and appends provenance for a reliable duplicate", async () => {
  const { service, state } = setup(); state.leads.push({ id: "00000000-0000-4000-8000-000000000402", firstName: "Canonical", email: "aya@example.invalid", phone: null });
  const result = await service.confirm(base(), principal, "synthetic-import-attach");
  assert.equal(result.attached, 1); assert.equal(result.created, 0); assert.equal(state.leads[0]?.firstName, "Canonical");
  assert.equal(state.provenances.length, 1); assert.equal(state.activities[0]?.type, "PROVENANCE_ATTACHED");
});

test("deduplicates independently by phone and by external identity plus source", async () => {
  const phoneCase = setup(); phoneCase.state.leads.push({ id: "00000000-0000-4000-8000-000000000403", firstName: "Canonical", email: null, phone: "+212600000401" });
  assert.equal((await phoneCase.service.confirm({ ...base(), records: [{ ...base().records[0]!, email: undefined }] }, principal, "synthetic-phone-match")).attached, 1);
  const externalCase = setup(); externalCase.state.leads.push({ id: "00000000-0000-4000-8000-000000000404", firstName: "Canonical", email: null, phone: null });
  externalCase.state.provenances.push({ id: "00000000-0000-4000-8000-000000000405", leadId: "00000000-0000-4000-8000-000000000404", technicalSystem: "SYNTHETIC_FORM", externalId: "synthetic-401" });
  const replay = base(); replay.records = [{ ...replay.records[0]!, email: "different@example.invalid", phone: "+212600000499" }];
  assert.equal((await externalCase.service.confirm(replay, principal, "synthetic-external-match")).attached, 1);
  assert.equal(externalCase.state.provenances.length, 1);
});

test("queues unknown statuses and rejects invalid identities without persisting personal values in reports", async () => {
  const { service, state } = setup(); const input = base(); input.records = [
    { ...input.records[0]!, historicalStatus: "STATUT_INCONNU" },
    { ...input.records[0]!, lineNumber: 2, externalId: "synthetic-402", email: "invalid" },
  ];
  const result = await service.confirm(input, principal, "synthetic-import-review");
  assert.equal(result.manualReview, 1); assert.equal(result.invalid, 1); assert.equal(state.reviews[0]?.reasonCode, "STATUS_UNKNOWN");
  assert.deepEqual(state.rejections.map((item) => item.reasonCode), ["status_unknown", "email_invalid"]);
  assert.equal(JSON.stringify(state.reports).includes("aya@example.invalid"), false);
});

test("fails closed without explicit confirmation, persistence or campus scope", async () => {
  const { service } = setup();
  await assert.rejects(() => service.confirm({ ...base(), confirmed: false as true }, principal, "not-confirmed"), hasCode("persistent_import_confirmation_required"));
  await assert.rejects(() => service.confirm(base(), { ...principal, scopes: [{ kind: "CAMPUS", id: "OTHER" }] }, "wrong-campus"), hasCode("persistent_import_scope_forbidden"));
  const unavailable = new PersistentIngestionService({ enabled: false, client: undefined } as unknown as PrismaService, new AuditService());
  await assert.rejects(() => unavailable.confirm(base(), principal, "unavailable"), hasCode("persistent_import_database_unavailable"));
});

test("persists every approved historical status and only structured historical activities", async () => {
  const { service, state } = setup(); const input = base();
  const statuses = ["Contacté", "RDV effectué", "Inscrit", "Sans suite", "À relancer"];
  input.records = statuses.map((historicalStatus, index) => ({ ...input.records[0]!, lineNumber: index + 1,
    email: `status-${index}@example.invalid`, phone: `+2126000004${10 + index}`, externalId: `status-${index}`, historicalStatus,
    ...(index === 0 ? { historicalActivities: [{ type: "CRM_CALL" as const, result: "SYNTHETIC_CONTACT", occurredAt: "2026-08-25T12:00:00.000Z" }] } : {}) }));
  const result = await service.confirm(input, principal, "synthetic-statuses");
  assert.equal(result.created, 5);
  assert.deepEqual(state.leads.map((lead) => lead.status), ["CONTACTED", "QUALIFIED", "ENROLLED", "CLOSED_LOST", "PROSPECT"]);
  assert.equal(state.activities.filter((activity) => activity.authorId === "LEGACY_IMPORT").length, 1);
});

test("routes unknown programs, incomplete mappings, collisions and unresolved assignment to review", async () => {
  const program = setup(); const unknownProgram = base(); unknownProgram.records = [{ ...unknownProgram.records[0]!, program: "UNKNOWN" }];
  assert.equal((await program.service.confirm(unknownProgram, principal, "unknown-program")).manualReview, 1);
  assert.equal(program.state.reviews[0]?.reasonCode, "PROGRAM_UNKNOWN");

  const mapping = setup(); const incomplete = base(); incomplete.records = [{ ...incomplete.records[0]!, campaign: undefined }];
  assert.equal((await mapping.service.confirm(incomplete, principal, "missing-mapping")).manualReview, 1);
  assert.equal(mapping.state.reviews[0]?.reasonCode, "REQUIRED_MAPPING_MISSING");

  const collision = setup(); collision.state.leads.push(
    { id: "00000000-0000-4000-8000-000000000406", email: "aya@example.invalid", phone: null },
    { id: "00000000-0000-4000-8000-000000000407", email: null, phone: "+212600000401" },
  );
  assert.equal((await collision.service.confirm(base(), principal, "identity-collision")).manualReview, 1);
  assert.equal(collision.state.reviews[0]?.reasonCode, "IDENTITY_COLLISION");

  const assignment = setup(); const unresolved = base(); unresolved.assignment = { strategy: "FIXED", targetUserId: "00000000-0000-4000-8000-000000000408" };
  assert.equal((await assignment.service.confirm(unresolved, principal, "assignment-unresolved")).manualReview, 1);
  assert.equal(assignment.state.reviews[0]?.reasonCode, "ASSIGNMENT_UNRESOLVED");
});

test("persists a resolved fixed assignment and rejects malformed contracts before mutation", async () => {
  const { service, state } = setup(); const assigned = base(); const target = "00000000-0000-4000-8000-000000000409";
  assigned.assignment = { strategy: "FIXED", targetUserId: target }; assigned.resolvedAssignments = { "1": target };
  assert.equal((await service.confirm(assigned, principal, "fixed-assignment")).created, 1);
  assert.equal(state.leads[0]?.assignedToId, target);

  const invalidRole = { ...principal, roles: ["ADMISSIONS" as const] };
  await assert.rejects(() => setup().service.confirm(base(), invalidRole, "role-refused"), hasCode("persistent_import_role_forbidden"));
  await assert.rejects(() => setup().service.confirm({ ...base(), mappingId: "unsafe" }, principal, "contract-refused"), hasCode("persistent_import_contract_invalid"));
  const duplicateLines = base(); duplicateLines.records = [duplicateLines.records[0]!, { ...duplicateLines.records[0]! }];
  await assert.rejects(() => setup().service.confirm(duplicateLines, principal, "line-refused"), hasCode("persistent_import_line_invalid"));
});

test("rejects malformed dates, activities and bounded email variants without leaking values", async () => {
  const variants = [
    { email: "missing-at.example.invalid" },
    { email: "two@@example.invalid" },
    { email: "space @example.invalid" },
    { email: `a@${"x".repeat(250)}.invalid` },
    { occurredAt: "not-a-date" },
    { historicalActivities: [{ type: "MEETING" as const, result: "", occurredAt: "not-a-date" }] },
  ];
  for (const [index, variant] of variants.entries()) {
    const current = setup(); const input = base(); input.idempotencyKey = `synthetic-invalid-${index}`; input.records = [{ ...input.records[0]!, ...variant }];
    assert.equal((await current.service.confirm(input, principal, `invalid-${index}`)).invalid, 1);
    assert.equal(JSON.stringify(current.state.reports).includes(String(variant.email ?? "not-a-date")), false);
  }
});
