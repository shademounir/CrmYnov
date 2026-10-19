import assert from "node:assert/strict";
import test from "node:test";
import { assertConfirmedNextAction, assertFutureNextAction, needsNextAction, parseNextActionIntent } from "../src/follow-up/next-action.contract.js";
import { scheduleNextActionInTransaction } from "../src/follow-up/schedule-next-action.js";
import type { FollowUpRecord } from "../src/follow-up/follow-up.service.js";
import type { FollowUpMutationInput } from "../src/follow-up/schedule-next-action.js";

const now = new Date("2026-10-19T18:00:00Z");
const id = "00000000-0000-4000-8000-000000000001";
const dueAt = "2026-10-20T09:00:00.000Z";
const hasCode = (code: string) => (error: unknown): boolean => Boolean(error && typeof error === "object" && "getResponse" in error
  && JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes(code));

test("next-action intention has one bounded explicit due date and meaningful action", () => {
  assert.deepEqual(parseNextActionIntent({ mode: "SCHEDULE", dueAt: "2026-10-20T10:00:00+01:00", reason: "  Rappeler pour les pièces  " }),
    { mode: "SCHEDULE", dueAt, reason: "Rappeler pour les pièces" });
  for (const value of [null, [], {}, { mode: "SCHEDULE", dueAt, reason: "  " }, { mode: "SCHEDULE", dueAt: "2026-02-30T10:00:00Z", reason: "Test" },
    { mode: "SCHEDULE", dueAt: "2026-10-20T09:00", reason: "Test" }, { mode: "SCHEDULE", dueAt, reason: "x".repeat(1001) },
    { mode: "SCHEDULE", dueAt, reason: "Test", ownerId: "forged-owner" }]) {
    assert.throws(() => parseNextActionIntent(value), hasCode("next_action_intent_invalid"));
  }
});

test("confirmation binds lead, exact task, expected version and unchanged deadline", () => {
  const intent = parseNextActionIntent({ mode: "CONFIRM", id, expectedVersion: 2, dueAt });
  assert.equal(intent.mode, "CONFIRM"); if (intent.mode !== "CONFIRM") return;
  const record = { id, leadId: "lead-one", version: 2, state: "SCHEDULED", dueAt };
  assert.doesNotThrow(() => assertConfirmedNextAction(intent, record, "lead-one", now));
  for (const altered of [undefined, { ...record, id: "other-task" }, { ...record, leadId: "lead-two" }, { ...record, version: 3 },
    { ...record, state: "COMPLETED" }, { ...record, state: "CANCELLED" }, { ...record, dueAt: "2026-10-21T09:00:00Z" }]) {
    assert.throws(() => assertConfirmedNextAction(intent, altered, "lead-one", now), hasCode("next_action_confirmation_stale"));
  }
});

test("a human confirmation cannot keep an already due action as the next future step", () => {
  const intent = parseNextActionIntent({ mode: "SCHEDULE", dueAt: now.toISOString(), reason: "Appel de suivi" });
  assert.throws(() => assertFutureNextAction(intent, now), hasCode("next_action_chronology_invalid"));
  assert.doesNotThrow(() => assertFutureNextAction({ ...intent, dueAt: new Date(now.valueOf() + 1).toISOString() }, now));
});

test("missing next-action queue preserves known history and never invents dates", () => {
  assert.equal(needsNextAction({ status: "CONTACTED", hasActiveNextAction: false }), true);
  assert.equal(needsNextAction({ status: "PROSPECT", hasUndatedHistory: true, hasActiveNextAction: false }), true);
  assert.equal(needsNextAction({ status: "PROSPECT", treatmentState: "NONE", hasActiveNextAction: false }), false);
  assert.equal(needsNextAction({ status: "CONTACTED", nextActionAt: dueAt, hasActiveNextAction: false }), true, "a legacy datetime is not proof of a persistent task");
  assert.equal(needsNextAction({ status: "QUALIFIED", hasActiveNextAction: true }), false);
  assert.equal(needsNextAction({ status: "ENROLLED", hasActiveNextAction: false }), false);
  assert.equal(needsNextAction({ status: "CLOSED_LOST", hasActiveNextAction: false }), false);
});

const record: FollowUpRecord = { id, leadId: "lead-one", ownerId: "adviser-one", dueAt, state: "SCHEDULED", reason: "Rappeler pour les pièces",
  version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const mutation: FollowUpMutationInput = { idempotencyKey: "synthetic-next-action", fingerprint: "synthetic-fingerprint", expectedLeadVersion: 4,
  correlationId: "synthetic-correlation", principal: { userId: "adviser-one", roles: ["ADMISSIONS"], sessionId: id, scopes: [{ kind: "GLOBAL" }] } };

function fixture(): { tx: Parameters<typeof scheduleNextActionInTransaction>[0]; events: string[]; receipt: { fingerprint: string; result: unknown } | undefined; pending: boolean; updateCount: number } {
  const f = { events: [] as string[], receipt: undefined as { fingerprint: string; result: unknown } | undefined, pending: false, updateCount: 1 };
  const tx = {
    leadFollowUpMutationReceipt: { findUnique: (): Promise<typeof f.receipt> => Promise.resolve(f.receipt), create: (): Promise<void> => { f.events.push("receipt"); return Promise.resolve(); } },
    leadFollowUp: { findFirst: (): Promise<{ id: string } | null> => Promise.resolve(f.pending ? { id } : null), create: ({ data }: { data: Record<string, unknown> }): Promise<Record<string, unknown>> => { f.events.push("task"); return Promise.resolve(data); } },
    lead: { updateMany: (): Promise<{ count: number }> => { f.events.push("projection"); return Promise.resolve({ count: f.updateCount }); }, findUniqueOrThrow: (): Promise<{ campus: string }> => Promise.resolve({ campus: "Synthetic Campus" }) },
    leadActivity: { create: (): Promise<void> => { f.events.push("timeline"); return Promise.resolve(); } },
    auditEvent: { create: (): Promise<void> => { f.events.push("audit"); return Promise.resolve(); } },
  };
  return Object.assign(f, { tx: tx as unknown as Parameters<typeof scheduleNextActionInTransaction>[0] });
}

test("one shared transactional writer creates task, projection, timeline, audit and receipt", async () => {
  const f = fixture();
  assert.deepEqual(await scheduleNextActionInTransaction(f.tx, record, mutation), record);
  assert.deepEqual(f.events, ["projection", "task", "timeline", "audit", "receipt"]);
});

test("the interaction transaction can own the projection without incrementing it twice", async () => {
  const f = fixture();
  await scheduleNextActionInTransaction(f.tx, record, mutation, true);
  assert.deepEqual(f.events, ["task", "timeline", "audit", "receipt"]);
});

test("durable replay does not create another task or audit; changed intention conflicts", async () => {
  const f = fixture(); f.receipt = { fingerprint: mutation.fingerprint, result: record };
  assert.deepEqual(await scheduleNextActionInTransaction(f.tx, record, mutation), record);
  assert.deepEqual(f.events, []);
  await assert.rejects(scheduleNextActionInTransaction(f.tx, record, { ...mutation, fingerprint: "other-content" }), hasCode("follow_up_idempotency_conflict"));
});

test("an active follow-up or stale lead prevents a second task before any append", async () => {
  const pending = fixture(); pending.pending = true;
  await assert.rejects(scheduleNextActionInTransaction(pending.tx, record, mutation), hasCode("follow_up_pending"));
  assert.deepEqual(pending.events, []);
  const stale = fixture(); stale.updateCount = 0;
  await assert.rejects(scheduleNextActionInTransaction(stale.tx, record, mutation), hasCode("lead_concurrent_mutation"));
  assert.deepEqual(stale.events, ["projection"]);
});
