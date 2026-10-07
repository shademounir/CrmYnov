import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { FollowUpPersistenceRepository } from "../src/follow-up/follow-up-persistence.repository.js";

const now = new Date("2099-01-01T10:01:00.000Z");
type Row = { id: string; leadId: string; ownerId: string; dueAt: Date; state: string; version: number; reason: string; createdAt: Date; updatedAt: Date };
type AuditRow = { idempotencyKey: string; eventType: string; resourceType: string; resourceId: string; result: string; after: Record<string, unknown> };
type NotificationRow = { id: string; deduplicationKey: string; recipientId: string; type: string; priority: string; resourceType: string; resourceId: string; href: string; fingerprint: string; createdAt: Date; readAt: Date | null };
type FixtureState = { item: Row; audits: AuditRow[]; notifications: NotificationRow[] };
type Fixture = { repository(): FollowUpPersistenceRepository; state(): FixtureState; failWrite(value: boolean): void };

function fixture(state = "SCHEDULED", version = 1): Fixture {
  let stored = {
    item: { id: randomUUID(), leadId: randomUUID(), ownerId: randomUUID(), state, version, dueAt: new Date("2099-01-01T10:00:00.000Z"), reason: "Synthétique", createdAt: new Date("2098-01-01T10:00:00.000Z"), updatedAt: new Date("2099-01-01T10:00:00.000Z") } as Row,
    audits: [] as AuditRow[], notifications: [] as NotificationRow[],
  };
  let failNotification = false;
  const client = {
    $transaction: async (action: (tx: unknown) => Promise<unknown>, options: unknown): Promise<unknown> => {
      assert.deepEqual(options, { isolationLevel: "ReadCommitted" });
      const draft = structuredClone(stored);
      const tx = {
        $queryRaw: (sql: TemplateStringsArray, date: Date, repairDate: Date, limit: number): Promise<Array<{ id: string }>> => {
          assert.match(sql.join("?"), /FOR UPDATE OF f SKIP LOCKED/u); assert.deepEqual(date, repairDate); assert.ok(limit <= 50);
          const legacyKey = `follow-up-due:${draft.item.id}`;
          const input = { recipientId: draft.item.ownerId, type: "FOLLOW_UP_DUE", priority: "HIGH", resourceType: "LEAD", resourceId: draft.item.leadId, href: `/leads/${draft.item.leadId}/follow-ups` };
          const expectedFingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
          const delivered = draft.notifications.some((notification) => {
            const audit = draft.audits.find((row) => row.idempotencyKey === notification.deduplicationKey);
            return [legacyKey, `${legacyKey}:v${draft.item.version}`].includes(notification.deduplicationKey)
              && Object.entries(input).every(([key, value]) => notification[key as keyof NotificationRow] === value) && notification.fingerprint === expectedFingerprint
              && audit?.eventType === "FOLLOW_UP_DUE" && audit.result === "SUCCESS" && audit.resourceType === "LEAD" && audit.resourceId === draft.item.leadId
              && audit.after.followUpId === draft.item.id && audit.after.state === "DUE" && audit.after.version === draft.item.version && audit.after.dueAt === draft.item.dueAt.toISOString()
              && (notification.deduplicationKey === legacyKey || audit.after.ownerId === draft.item.ownerId);
          });
          return Promise.resolve((draft.item.state === "SCHEDULED" && draft.item.dueAt <= date) || (draft.item.state === "DUE" && draft.item.dueAt <= repairDate && !delivered) ? [{ id: draft.item.id }] : []);
        },
        leadFollowUp: {
          findUniqueOrThrow: (): Promise<Row> => Promise.resolve(structuredClone(draft.item)),
          updateMany: (): Promise<{ count: number }> => { draft.item.state = "DUE"; draft.item.version += 1; draft.item.updatedAt = now; return Promise.resolve({ count: 1 }); },
        },
        auditEvent: {
          findUnique: ({ where }: { where: { idempotencyKey: string } }): Promise<AuditRow | null> => Promise.resolve(draft.audits.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null),
          create: ({ data }: { data: AuditRow }): Promise<AuditRow> => { draft.audits.push(data); return Promise.resolve(data); },
        },
        internalNotification: {
          findUnique: ({ where }: { where: { deduplicationKey: string } }): Promise<NotificationRow | null> => Promise.resolve(draft.notifications.find((row) => row.deduplicationKey === where.deduplicationKey) ?? null),
          create: ({ data }: { data: NotificationRow }): Promise<NotificationRow> => { if (failNotification) return Promise.reject(new Error("synthetic_notification_write_failure")); draft.notifications.push(data); return Promise.resolve(data); },
        },
      };
      const result = await action(tx); stored = draft; return result;
    },
  };
  const repository = (): FollowUpPersistenceRepository => new FollowUpPersistenceRepository({ enabled: true, client } as never);
  return { repository, state: (): FixtureState => stored, failWrite: (value: boolean): void => { failNotification = value; } };
}

test("a notification failure rolls back the DUE fence and audit; a new instance retries exactly once", async () => {
  const f = fixture(); const original = structuredClone(f.state()); f.failWrite(true);
  await assert.rejects(() => f.repository().markDue(now), /synthetic_notification_write_failure/u);
  assert.deepEqual(f.state(), original);
  f.failWrite(false); assert.deepEqual(await f.repository().markDue(now), { due: 1, notifications: 1 });
  assert.equal(f.state().item.version, 2); assert.equal(f.state().audits.length, 1); assert.equal(f.state().notifications.length, 1);
  assert.equal(f.state().notifications[0]!.recipientId, original.item.ownerId);
  assert.equal(f.state().notifications[0]!.href, `/leads/${original.item.leadId}/follow-ups`);
  // Drop the first repository/response: the transaction itself is the receipt.
  assert.deepEqual(await f.repository().markDue(now), { due: 0, notifications: 0 });
});

test("legacy DUE repair preserves the exact audit and state; replay remains a no-op", async () => {
  const f = fixture("DUE", 2); const key = `follow-up-due:${f.state().item.id}`;
  f.state().audits.push({ idempotencyKey: key, eventType: "FOLLOW_UP_DUE", resourceType: "LEAD", resourceId: f.state().item.leadId, result: "SUCCESS", after: { followUpId: f.state().item.id, state: "DUE", dueAt: f.state().item.dueAt.toISOString(), version: 2 } });
  const original = structuredClone(f.state()); f.failWrite(true);
  await assert.rejects(() => f.repository().markDue(now), /synthetic_notification_write_failure/u); assert.deepEqual(f.state(), original);
  f.failWrite(false); assert.deepEqual(await f.repository().markDue(now), { due: 0, notifications: 1 });
  assert.deepEqual(f.state().item, original.item); assert.deepEqual(f.state().audits, original.audits); assert.equal(f.state().notifications[0]!.deduplicationKey, key);
  assert.deepEqual(await f.repository().markDue(now), { due: 0, notifications: 0 });
  const legacyNotification = structuredClone(f.state().notifications[0]);
  f.state().item.state = "SCHEDULED"; f.state().item.version = 3; f.state().item.ownerId = randomUUID();
  assert.deepEqual(await f.repository().markDue(now), { due: 1, notifications: 1 });
  assert.deepEqual(f.state().audits[0], original.audits[0]); assert.deepEqual(f.state().notifications[0], legacyNotification);
  assert.equal(f.state().notifications[1]!.deduplicationKey, `${key}:v4`); assert.equal(f.state().notifications[1]!.recipientId, f.state().item.ownerId);
});

test("unproven DUE rows and inconsistent legacy notifications fail closed", async () => {
  const missing = fixture("DUE", 2);
  await assert.rejects(() => missing.repository().markDue(now), /follow_up_due_audit_inconsistent/u); assert.equal(missing.state().notifications.length, 0);
  const f = fixture("DUE", 2);
  f.state().notifications.push({ id: randomUUID(), deduplicationKey: `follow-up-due:${f.state().item.id}` } as NotificationRow);
  await assert.rejects(() => f.repository().markDue(now), /follow_up_due_legacy_inconsistent/u); assert.equal(f.state().notifications.length, 1);
  await assert.rejects(() => f.repository().markDue(now, 51), /follow_up_due_limit_invalid/u);
});

test("a future unproven DUE row is untouched, but fails closed once its deadline elapses", async () => {
  const f = fixture("DUE", 1); f.state().item.dueAt = new Date("2099-01-01T11:00:00.000Z");
  const original = structuredClone(f.state());
  assert.deepEqual(await f.repository().markDue(now), { due: 0, notifications: 0 }); assert.deepEqual(f.state(), original);
  await assert.rejects(() => f.repository().markDue(new Date("2099-01-01T11:01:00.000Z")), /follow_up_due_audit_inconsistent/u);
  assert.deepEqual(f.state(), original);
});

test("a delivered canonical occurrence replays without effects; unsupported same-occurrence owner changes fail closed", async () => {
  const canonical = fixture(); await canonical.repository().markDue(now); const delivered = structuredClone(canonical.state());
  assert.deepEqual(await canonical.repository().markDue(now), { due: 0, notifications: 0 }); assert.deepEqual(canonical.state(), delivered);
  canonical.state().item.ownerId = randomUUID(); const changedCanonical = structuredClone(canonical.state());
  await assert.rejects(() => canonical.repository().markDue(now), /follow_up_due_audit_inconsistent/u); assert.deepEqual(canonical.state(), changedCanonical);
  const legacy = fixture("DUE", 2); const key = `follow-up-due:${legacy.state().item.id}`;
  legacy.state().audits.push({ idempotencyKey: key, eventType: "FOLLOW_UP_DUE", resourceType: "LEAD", resourceId: legacy.state().item.leadId, result: "SUCCESS", after: { followUpId: legacy.state().item.id, state: "DUE", dueAt: legacy.state().item.dueAt.toISOString(), version: 2 } });
  await legacy.repository().markDue(now); legacy.state().item.ownerId = randomUUID(); const changedLegacy = structuredClone(legacy.state());
  await assert.rejects(() => legacy.repository().markDue(now), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("notification_idempotency_conflict"));
  assert.deepEqual(legacy.state(), changedLegacy);
});

test("the delivered fast path cannot hide invalid exact-version legacy proof or conflicting payload", async () => {
  const legacy = fixture("DUE", 2); const key = `follow-up-due:${legacy.state().item.id}`;
  legacy.state().audits.push({ idempotencyKey: key, eventType: "OTHER", resourceType: "LEAD", resourceId: legacy.state().item.leadId, result: "SUCCESS", after: { version: 2 } });
  legacy.state().notifications.push({ id: randomUUID(), deduplicationKey: key } as NotificationRow);
  await assert.rejects(() => legacy.repository().markDue(now), /follow_up_due_legacy_inconsistent/u);
  legacy.state().audits[0]!.eventType = "FOLLOW_UP_DUE";
  legacy.state().audits[0]!.after = { followUpId: legacy.state().item.id, state: "DUE", dueAt: legacy.state().item.dueAt.toISOString(), version: "2" };
  await assert.rejects(() => legacy.repository().markDue(now), /follow_up_due_legacy_inconsistent/u);
  const f = fixture(); await f.repository().markDue(now);
  f.state().notifications[0]!.recipientId = randomUUID(); const corrupted = structuredClone(f.state());
  await assert.rejects(() => f.repository().markDue(now), (error: unknown) => JSON.stringify((error as { getResponse(): unknown }).getResponse()).includes("notification_idempotency_conflict"));
  assert.deepEqual(f.state(), corrupted);
});

test("cancelled reminders are not repaired and later occurrences use a new key and persisted owner", async () => {
  const cancelled = fixture("CANCELLED", 2); assert.deepEqual(await cancelled.repository().markDue(now), { due: 0, notifications: 0 });
  const f = fixture(); await f.repository().markDue(now); const previous = structuredClone(f.state().notifications[0]!);
  f.state().item.state = "SCHEDULED"; f.state().item.version = 3; f.state().item.ownerId = randomUUID();
  assert.deepEqual(await f.repository().markDue(now), { due: 1, notifications: 1 });
  assert.equal(f.state().item.version, 4); assert.equal(f.state().notifications.length, 2); assert.equal(f.state().audits.length, 2);
  assert.deepEqual(f.state().notifications[0], previous); assert.equal(f.state().notifications[1]!.recipientId, f.state().item.ownerId);
  assert.match(f.state().notifications[1]!.deduplicationKey, /:v4$/u);
});
