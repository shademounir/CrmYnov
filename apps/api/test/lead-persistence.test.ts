/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { LeadPersistenceRepository } from "../src/leads/lead-persistence.repository.js";
import type { LeadActivityRecord, LeadRecord } from "../src/leads/lead.service.js";

const leadId = "00000000-0000-4000-8000-000000000211";
const userId = "00000000-0000-4000-8000-000000000212";
const now = "2026-08-25T12:30:00.000Z";
const lead = (): LeadRecord & { version: number } => ({ id: leadId, leadCode: "LD-PERSIST-001", firstName: "Alex", lastName: "Synthétique",
  email: "alex@example.invalid", phone: "+212600000211", campus: "SYNTHETIC", campaign: "SYNTHETIC", educationLevel: "BAC",
  program: "SYNTHETIC", source: "TEST", status: "PROSPECT", createdAt: now, lastActivityAt: now, version: 1 });
const activity = (id = "00000000-0000-4000-8000-000000000213"): LeadActivityRecord => ({ id, leadId, type: "LEAD_CREATED", result: "PROSPECT", authorId: userId, correlationId: "synthetic-correlation", occurredAt: now });
const hasCode = (code: string) => (error: unknown): boolean => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code);

type FakeState = { leads: Row[]; activities: Row[]; receipts: Row[]; collaborators: Row[] };
type Row = Record<string, unknown>;
function fakeRepository(): { repository: LeadPersistenceRepository; state: FakeState } {
  const state: FakeState = { leads: [], activities: [], receipts: [], collaborators: [] };
  const client = {
    lead: {
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
  return { repository: new LeadPersistenceRepository({ enabled: true, client } as unknown as PrismaService), state };
}

test("creates and replays a lead mutation with a stable fingerprint", async () => {
  const { repository, state } = fakeRepository();
  const fingerprint = repository.fingerprint({ operation: "create", leadId });
  const created = await repository.createLead(lead(), activity(), "lead-create-synthetic", fingerprint);
  assert.equal(created.leadCode, "LD-PERSIST-001");
  assert.equal(state.leads.length, 1); assert.equal(state.activities.length, 1);
  assert.equal((await repository.findActivity("lead-create-synthetic"))?.id, activity().id);
  assert.deepEqual(await repository.createLead(lead(), activity(), "lead-create-synthetic", fingerprint), created);
  await assert.rejects(() => repository.createLead(lead(), activity(), "lead-create-synthetic", repository.fingerprint({ different: true })), hasCode("lead_idempotency_conflict"));
});

test("persists append-only activities with optimistic lead concurrency", async () => {
  const { repository, state } = fakeRepository();
  await repository.createLead(lead(), activity(), "lead-create-concurrency", repository.fingerprint("create"));
  const before = lead();
  const after = { ...before, status: "CONTACTED" as const, lastActivityAt: "2026-08-25T12:31:00.000Z" };
  const next = activity("00000000-0000-4000-8000-000000000214"); next.type = "STATUS_CHANGED"; next.result = "CONTACTED";
  const stored = await repository.persistMutation(before, after, [next], "lead-status-synthetic", "CHANGE_STATUS", repository.fingerprint(after));
  assert.equal(stored.version, 2); assert.equal(stored.status, "CONTACTED"); assert.equal(state.activities.length, 2);
  await assert.rejects(() => repository.persistMutation(before, after, [], "lead-stale-synthetic", "CHANGE_STATUS", repository.fingerprint("stale")), hasCode("lead_concurrent_mutation"));
});

test("hydrates correction metadata and replaces collaborator membership", async () => {
  const { repository, state } = fakeRepository();
  await repository.createLead(lead(), activity(), "lead-create-hydrate", repository.fingerprint("hydrate"));
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
  await assert.rejects(() => repository.createLead(lead(), activity(), "missing-client", "fingerprint"), /lead_persistence_unavailable/);
});
