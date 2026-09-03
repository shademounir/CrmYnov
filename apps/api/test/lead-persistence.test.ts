/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import { LeadService, type LeadActivityRecord, type LeadRecord } from "../src/leads/lead.service.js";
import { LocalOutboxRepository } from "../src/outbox/local-outbox.repository.js";
import type { Principal } from "../src/auth/auth.types.js";

const leadId = "00000000-0000-4000-8000-000000000211";
const userId = "00000000-0000-4000-8000-000000000212";
const ownerId = "00000000-0000-4000-8000-000000000216";
const targetId = "00000000-0000-4000-8000-000000000217";
const now = "2026-08-25T12:30:00.000Z";
const auditActor: Principal = { userId, roles: ["SUPER_ADMIN"], scopes: [{ kind: "GLOBAL" }], sessionId: "synthetic-session" };
const lead = (): LeadRecord & { version: number } => ({ id: leadId, leadCode: "LD-PERSIST-001", firstName: "Alex", lastName: "Synthétique",
  email: "alex@example.invalid", phone: "+212600000211", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC",
  program: "SYNTHETIC", source: "TEST", status: "PROSPECT", createdAt: now, lastActivityAt: now, version: 1 });
const activity = (id = "00000000-0000-4000-8000-000000000213"): LeadActivityRecord => ({ id, leadId, type: "LEAD_CREATED", result: "PROSPECT", authorId: userId, correlationId: "synthetic-correlation", occurredAt: now });
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

type FakeState = { leads: Row[]; activities: Row[]; receipts: Row[]; collaborators: Row[]; outbox: Row[]; audits: Row[] };
type Row = Record<string, unknown>;
function fakeRepository(): { repository: LeadPersistenceRepository; state: FakeState } {
  const state: FakeState = { leads: [], activities: [], receipts: [], collaborators: [], outbox: [], audits: [] };
  const client = {
    auditEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return data; } },
    crmReferenceKey: { findMany: async ({ where }: { where: { kind: string; key: string } }) => where.key === "SYNTHETIC" ? [{ reference: { id: `${where.kind}-synthetic`, code: "SYNTHETIC", state: "ACTIVE" } }] : [] },
    crmProgramAvailability: { findUnique: async () => ({ active: true }) },
    lead: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = state.leads.find((item) => item.id === where.id);
        if (!row) throw new Error("synthetic_lead_missing");
        return { campus: row.campus };
      },
      findMany: async () => state.leads.map((row) => ({ ...row, collaborators: state.collaborators.filter((item) => item.leadId === row.id && item.active).map((item) => ({ userId: item.userId })) })),
      create: async ({ data }: { data: Record<string, unknown> }) => { state.leads.push({ ...data, updatedAt: new Date(now) }); return data; },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = state.leads.find((item) => item.id === where.id && item.version === where.version); if (!row) return { count: 0 };
        for (const [key, value] of Object.entries(data)) row[key] = typeof value === "object" && value !== null && "increment" in value ? Number(row[key]) + Number((value as { increment: number }).increment) : value;
        return { count: 1 };
      },
    },
    leadActivity: {
      findMany: async () => [...state.activities],
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => state.activities.find((item) => item.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { state.activities.push(data); return data; },
    },
    leadMutationReceipt: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => state.receipts.find((item) => item.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { state.receipts.push(data); return data; },
    },
    localOutboxEvent: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => state.outbox.find((item) => item.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `outbox-${state.outbox.length + 1}`, ...data }; state.outbox.push(row); return row; },
    },
    leadCollaborator: {
      updateMany: async ({ where, data }: { where: { leadId: string; userId: { notIn: string[] } }; data: { active: boolean } }) => {
        for (const item of state.collaborators) if (item.leadId === where.leadId && !where.userId.notIn.includes(String(item.userId))) item.active = data.active;
        return { count: 1 };
      },
      upsert: async ({ create, update }: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const found = state.collaborators.find((item) => item.leadId === create.leadId && item.userId === create.userId);
        if (found) Object.assign(found, update); else state.collaborators.push(create); return found ?? create;
      },
    },
    $transaction: async (value: unknown) => typeof value === "function" ? (value as (tx: unknown) => unknown)(client) : Promise.all(value as Promise<unknown>[]),
  };
  const prisma = { enabled: true, client } as unknown as PrismaService;
  return { repository: new LeadPersistenceRepository(prisma, new LocalOutboxRepository(prisma)), state };
}

test("creates and replays a lead mutation with a stable fingerprint", async () => {
  const { repository, state } = fakeRepository();
  const fingerprint = repository.fingerprint({ operation: "create", leadId });
  const created = await repository.createLead(lead(), activity(), "lead-create-synthetic", fingerprint, auditActor, "synthetic-create");
  assert.equal(created.leadCode, "LD-PERSIST-001");
  assert.equal(state.leads.length, 1); assert.equal(state.activities.length, 1); assert.equal(state.outbox.length, 1);
  assert.deepEqual(state.outbox[0]?.payload, { operation: "CREATE", status: "PROSPECT", version: 1 });
  assert.equal((await repository.findActivity("lead-create-synthetic"))?.id, activity().id);
  assert.deepEqual(await repository.createLead(lead(), activity(), "lead-create-synthetic", fingerprint, auditActor, "synthetic-replay"), created);
  assert.equal(state.audits.length, 1); assert.equal(state.audits[0]?.correlationId, "synthetic-create");
  await assert.rejects(() => repository.createLead(lead(), activity(), "lead-create-synthetic", repository.fingerprint({ different: true }), auditActor, "synthetic-conflict"), hasCode("lead_idempotency_conflict"));
});

test("persists append-only activities with optimistic lead concurrency", async () => {
  const { repository, state } = fakeRepository();
  await repository.createLead(lead(), activity(), "lead-create-concurrency", repository.fingerprint("create"), auditActor, "synthetic-create");
  const before = lead();
  const after = { ...before, firstName: "Alice", email: "alice@example.invalid", phone: "+212600000212", status: "CONTACTED" as const, lastActivityAt: "2026-08-25T12:31:00.000Z" };
  const next = activity("00000000-0000-4000-8000-000000000214"); next.type = "STATUS_CHANGED"; next.result = "CONTACTED";
  const stored = await repository.persistMutation(before, after, [next], "lead-status-synthetic", "CHANGE_STATUS", repository.fingerprint(after), auditActor, "synthetic-status");
  assert.equal(stored.version, 2); assert.equal(stored.status, "CONTACTED"); assert.equal(state.leads[0]?.firstName, "Alice"); assert.equal(state.leads[0]?.email, "alice@example.invalid"); assert.equal(state.leads[0]?.phone, "+212600000212"); assert.equal(state.activities.length, 2); assert.equal(state.outbox.length, 2);
  await assert.rejects(() => repository.persistMutation(before, after, [], "lead-stale-synthetic", "CHANGE_STATUS", repository.fingerprint("stale"), auditActor, "synthetic-stale"), hasCode("lead_concurrent_mutation"));
  assert.deepEqual(state.audits.map((event) => event.eventType), ["LEAD_CREATED", "LEAD_STATUS_CHANGED"]);
});

test("hydrates correction metadata and replaces collaborator membership", async () => {
  const { repository, state } = fakeRepository();
  await repository.createLead(lead(), activity(), "lead-create-hydrate", repository.fingerprint("hydrate"), auditActor, "synthetic-create");
  state.activities.push({ id: "00000000-0000-4000-8000-000000000215", leadId, type: "CORRECTION", result: "CORRECTED", note: null,
    authorId: userId, nextActionAt: null, correlationId: "synthetic", occurredAt: new Date(now), originalEventId: activity().id,
    correctionOperation: "CORRECT", correctionReasonCode: "WRONG_RESULT", previousSnapshot: { type: "COMMENT", result: "OLD", noteState: "ABSENT" }, replacementSnapshot: { type: "COMMENT", result: "NEW", noteState: "ABSENT" } });
  await repository.replaceCollaborators(leadId, [userId]);
  await repository.replaceCollaborators(leadId, []);
  const snapshot = await repository.snapshot();
  assert.equal(snapshot.leads[0]?.collaboratorIds?.length, 0);
  assert.equal(snapshot.activities[1]?.correction?.reasonCode, "WRONG_RESULT");
});

test("returns an empty snapshot and fails closed when persistence is unavailable", async () => {
  const repository = new LeadPersistenceRepository({ enabled: false, client: undefined } as unknown as PrismaService);
  assert.equal(repository.enabled, false); assert.deepEqual(await repository.snapshot(), { leads: [], activities: [] });
  assert.equal(await repository.findActivity("missing"), undefined);
  await assert.rejects(() => repository.createLead(lead(), activity(), "missing-client", "fingerprint", auditActor, "synthetic-create"), /lead_persistence_unavailable/);
});

test("routes the complete Lead API lifecycle through the persistent adapter", async () => {
  const { repository, state } = fakeRepository();
  const service = new LeadService(new AuditService(), repository);
  const principal = { userId, roles: ["MANAGER" as const], scopes: [{ kind: "GLOBAL" as const }], sessionId: "synthetic-persistent-session" };
  await service.onModuleInit();
  assert.equal(service.persistenceEnabled(), true);

  const created = await service.createLeadForApi({ firstName: "Nora", lastName: "Synthétique", email: "nora@example.invalid",
    phone: "+212600000299", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC",
    program: "SYNTHETIC", source: "TEST" }, principal, "persistent-create");
  const id = created.lead.id;
  assert.equal((await service.listLeadsForApi({ page: 1, pageSize: 20 }, principal, "persistent-list")).total, 1);
  assert.equal((await service.getLeadForApi(id, principal, "persistent-get")).id, id);
  assert.equal((await service.findLocalLeadForApi(id))?.id, id);
  assert.equal((await service.timelineForApi(id, principal)).length, 1);

  const interaction = await service.addActivityForApi(id, { type: "COMMENT", result: "SYNTHETIC_NOTE" }, principal, "persistent-activity");
  assert.equal((await service.addActivityForApi(id, { type: "COMMENT", result: "SYNTHETIC_NOTE" }, principal, "persistent-activity")).id, interaction.id);
  const correction = await service.correctActivityForApi(id, interaction.id, { idempotencyKey: "persistent-correction", expectedCorrectionCount: 0,
    operation: "CANCEL", reasonCode: "DUPLICATE_ENTRY" }, principal, "persistent-correction");
  assert.equal(correction.correction?.operation, "CANCEL");
  assert.equal((await service.changeStatusForApi(id, { status: "CONTACTED", reason: "Contact synthétique" }, principal, "persistent-status")).status, "CONTACTED");
  assert.equal((await service.assignLocalLeadForApi(id, ownerId, principal, "persistent-assignment", "Affectation synthétique")).assignedToId, ownerId);
  assert.equal((await service.reassignLocalLeadForApi(id, ownerId, targetId, principal, "persistent-reassignment", "Réaffectation synthétique")).assignedToId, targetId);
  assert.deepEqual((await service.applyCollaboratorForApi(id, userId, "ADD", "ADVISER", principal, "persistent-collaboration")).collaboratorIds, [userId]);
  await service.persistCollaboratorSnapshotForApi(id, [userId]);
  assert.equal(state.receipts.length, 7);
  assert.equal(state.audits.length, 7);
  assert.deepEqual(state.audits.map((event) => event.eventType), ["LEAD_CREATED", "LEAD_ACTIVITY_ADDED", "LEAD_ACTIVITY_COMPENSATED", "LEAD_STATUS_CHANGED", "LEAD_ASSIGNED", "LEAD_REASSIGNED", "LEAD_COLLABORATOR_CHANGED"]);
  assert.deepEqual(state.audits.map((event) => event.correlationId), ["persistent-create", "persistent-activity", "persistent-correction", "persistent-status", "persistent-assignment", "persistent-reassignment", "persistent-collaboration"]);
  for (const event of state.audits) {
    assert.equal(event.campusId, "SYNTHETIC"); assert.equal(event.resourceId, id);
    assert.equal(event.resourceType, "LEAD"); assert.equal(event.actorId, userId);
    assert.equal(event.result, "SUCCESS");
    assert.equal(JSON.stringify(event).includes("nora@example.invalid"), false);
  }
});

test("CRMY-54 refuses an absent audit actor rather than fabricating SYSTEM", async () => {
  const { repository, state } = fakeRepository();
  await assert.rejects(() => repository.createLead(lead(), activity(), "actor-required", "fingerprint", { ...auditActor, userId: "" }, "synthetic"), hasCode("audit_actor_required"));
  assert.equal(state.leads.length, 0); assert.equal(state.audits.length, 0);
});
