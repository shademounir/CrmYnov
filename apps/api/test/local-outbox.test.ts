/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/require-await */
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { LocalOutboxRepository, outboxTopics } from "../src/outbox/local-outbox.repository.js";
import { LocalOutboxWorker } from "../src/outbox/local-outbox.worker.js";

type Row = Record<string, unknown> & {
  id: string; topic: string; aggregateType: string; aggregateId: string; idempotencyKey: string;
  payload: Record<string, unknown>; status: string; attempts: number; maxAttempts: number;
  availableAt: Date; lockedAt: Date | null; lockedBy: string | null; deliveredAt: Date | null;
  lastErrorCode: string | null; createdAt: Date; updatedAt: Date;
};

function fakeOutbox() {
  const rows: Row[] = [];
  let sequence = 0;
  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.attempts !== undefined && row.attempts !== where.attempts) return false;
    if (where.lockedBy !== undefined && row.lockedBy !== where.lockedBy) return false;
    if (where.lockedAt instanceof Date && row.lockedAt?.valueOf() !== where.lockedAt.valueOf()) return false;
    return true;
  };
  const localOutboxEvent = {
    findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) =>
      rows.find((row) => (where.id ? row.id === where.id : row.idempotencyKey === where.idempotencyKey)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date("2020-01-01T00:00:00.000Z");
      const row: Row = { id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, topic: String(data.topic),
        aggregateType: String(data.aggregateType), aggregateId: String(data.aggregateId), idempotencyKey: String(data.idempotencyKey),
        payload: data.payload as Record<string, unknown>, status: "PENDING", attempts: 0, maxAttempts: Number(data.maxAttempts),
        availableAt: now, lockedAt: null, lockedBy: null, deliveredAt: null, lastErrorCode: null, createdAt: now, updatedAt: now };
      rows.push(row); return row;
    },
    findMany: async ({ where }: { where: { OR: [{ availableAt: { lte: Date } }, { lockedAt: { lt: Date } }] } }) => rows.filter((row) =>
      ((row.status === "PENDING" || row.status === "FAILED") && row.availableAt <= where.OR[0].availableAt.lte) ||
      (row.status === "PROCESSING" && row.lockedAt !== null && row.lockedAt < where.OR[1].lockedAt.lt)).map((row) => ({ ...row })),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((candidate) => matches(candidate, where)); if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        row[key] = typeof value === "object" && value !== null && "increment" in value
          ? Number(row[key]) + Number((value as { increment: number }).increment) : value;
      }
      return { count: 1 };
    },
  };
  const client = { localOutboxEvent, $transaction: async (callback: (tx: unknown) => unknown) => callback(client) };
  const repository = new LocalOutboxRepository({ enabled: true, client } as unknown as PrismaService);
  return { repository, rows };
}

const input = (idempotencyKey = "synthetic-event-0001") => ({ topic: "LEAD.CREATED", aggregateType: "LEAD",
  aggregateId: "lead-synthetic-1", idempotencyKey, payload: { operation: "CREATE", status: "PROSPECT", version: 1 } });

test("covers every local domain topic without external delivery", () => {
  assert.deepEqual(outboxTopics, ["LEAD.CREATED", "LEAD.MUTATED", "FOLLOW_UP.CHANGED", "NOTIFICATION.CREATED",
    "APPOINTMENT.CHANGED", "CHAT.MESSAGE", "CHAT.MENTION", "BROADCAST.CONFIRMED"]);
});

test("enqueues and replays one minimized event idempotently", async () => {
  const { repository, rows } = fakeOutbox();
  const first = await repository.enqueue(input());
  assert.equal((await repository.enqueue(input())).id, first.id); assert.equal(rows.length, 1);
  await assert.rejects(() => repository.enqueue({ ...input(), topic: "LEAD.MUTATED" }), (error: unknown) =>
    JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("outbox_idempotency_conflict"));
  await assert.rejects(() => repository.enqueue({ ...input("synthetic-event-0002"), payload: { email: "never@example.invalid" } }), /outbox_payload_not_minimized/);
  await assert.rejects(() => repository.enqueue({ ...input("short"), maxAttempts: 0 }), /outbox_input_invalid/);
});

test("claims exactly once under competing workers and acknowledges ownership", async () => {
  const { repository, rows } = fakeOutbox(); await repository.enqueue(input());
  const now = new Date("2026-08-26T10:00:00.000Z");
  const [first, second] = await Promise.all([repository.claim("worker-a", 1, now), repository.claim("worker-b", 1, now)]);
  assert.equal(first.length + second.length, 1); const owner = first.length ? "worker-a" : "worker-b";
  assert.equal(await repository.delivered(rows[0]!.id, "not-owner", now), false);
  assert.equal(await repository.delivered(rows[0]!.id, owner, now), true); assert.equal(rows[0]!.status, "DELIVERED");
});

test("recovers stale locks and applies bounded failure backoff", async () => {
  const { repository, rows } = fakeOutbox(); await repository.enqueue({ ...input(), maxAttempts: 2 });
  const firstNow = new Date("2026-08-26T10:00:00.000Z"); await repository.claim("worker-a", 1, firstNow);
  assert.equal(await repository.failed(rows[0]!.id, "worker-a", "delivery_refused", firstNow), true);
  assert.equal(rows[0]!.status, "PENDING");
  rows[0]!.availableAt = new Date("2026-08-26T10:00:00.000Z");
  await repository.claim("worker-b", 1, new Date("2026-08-26T10:01:00.000Z"));
  assert.equal(await repository.failed(rows[0]!.id, "worker-b", "delivery_refused", new Date("2026-08-26T10:01:00.000Z")), true);
  assert.equal(rows[0]!.status, "FAILED");
  assert.equal((await repository.claim("worker-c", 1, new Date("2026-08-26T11:00:00.000Z"))).length, 0);
  await assert.rejects(() => repository.claim("x", 0), /outbox_claim_invalid/);
  await assert.rejects(() => repository.failed(rows[0]!.id, "worker-c", "BAD"), /outbox_error_code_invalid/);
});

test("worker delivers registered topics and fails closed for missing handlers", async () => {
  const fixture = fakeOutbox(); const worker = new LocalOutboxWorker(fixture.repository); let delivered = 0;
  worker.register("LEAD.CREATED", async () => { delivered += 1; });
  assert.throws(() => worker.register("LEAD.CREATED", async () => undefined), /outbox_handler_duplicate/);
  await fixture.repository.enqueue(input());
  assert.deepEqual(await worker.drainOnce("worker-one"), { claimed: 1, delivered: 1, failed: 0 }); assert.equal(delivered, 1);
  await fixture.repository.enqueue({ ...input("synthetic-event-0003"), topic: "CHAT.MESSAGE" });
  assert.deepEqual(await worker.drainOnce("worker-one"), { claimed: 1, delivered: 0, failed: 1 });
  assert.equal(fixture.rows[1]!.lastErrorCode, "handler_missing");
});

test("fails closed when persistence is unavailable", async () => {
  const repository = new LocalOutboxRepository({ enabled: false, client: undefined } as unknown as PrismaService);
  assert.equal(repository.enabled, false);
  await assert.rejects(() => repository.enqueue(input()), /outbox_persistence_unavailable/);
});
