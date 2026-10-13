import assert from "node:assert/strict";
import test from "node:test";
import { BootstrapApiError, type BootstrapPackage, type BootstrapRow, type BootstrapReport } from "../app/imports/bootstrap/bootstrap-client.js";
import { parseBatchPlan, runBatchPlan, type BatchPlan } from "../app/imports/bootstrap/bootstrap-batch.js";

const id = "00000000-0000-4000-8000-000000000061";
const source = { id, sha256: "a".repeat(64), version: 3, state: "MAPPED" } as BootstrapPackage;
function fixture(count: number): { plan: BatchPlan; rows: BootstrapRow[] } {
  const items = Array.from({ length: count }, (_, index) => ({ rowId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, fingerprint: "b".repeat(64), expectedVersion: 1,
    decision: { action: "CREATE_DOSSIER" as const, reason: "Décision synthétique explicitement qualifiée" } }));
  return { plan: { schemaVersion: 1, packageId: id, sha256: source.sha256, items }, rows: items.map(item => ({ id: item.rowId, version: 1, fingerprint: item.fingerprint, state: "REVIEW" }) as BootstrapRow) };
}
type Body = { expectedVersion: number; idempotencyKey: string; items: Array<{ rowId: string; decision: { idempotencyKey: string } }> };
function runtime(rows: BootstrapRow[], refuseId?: string): { request: <T>(path: string, init?: RequestInit) => Promise<T>; writes: Body[]; getVersion: () => number } {
  let version = 3; const writes: Body[] = [];
  const report = (): BootstrapReport => ({ package: { ...source, version }, bySheet: [], cutoverBlocked: true,
    reconciliation: { complete: false, truncated: false, totalOccurrences: rows.length, unresolvedOccurrences: rows.filter(row => row.state === "REVIEW").length, effects: {}, contacts: { email: { groups: 0, occurrences: 0 }, phone: { groups: 0, occurrences: 0 }, overlappingGroupsNotUniquePeople: true }, currentDossierAxes: { visible: 0, withheld: 0 }, axes: {}, discrepancies: [] } });
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    await Promise.resolve();
    if (path.includes("/rows?")) return { items: rows, nextAfter: null } as T;
    if (path.endsWith("/report")) return report() as T;
    if (!init) return { ...source, version } as T;
    assert.equal(typeof init.body, "string"); const body = JSON.parse(init.body as string) as Body; writes.push(body); assert.equal(body.expectedVersion, version); assert.ok(body.items.length <= 25);
    if (body.items.some(item => item.rowId === refuseId)) throw new BootstrapApiError(422, "bootstrap_contact_reconciliation_required");
    for (const item of body.items) { const row = rows.find(row => row.id === item.rowId)!; assert.equal(row.state, "REVIEW"); row.state = "ACCEPTED"; row.version += 2; row.decision = { action: "CREATE_DOSSIER", reason: "Fixture", idempotencyKey: item.decision.idempotencyKey }; }
    version++; return { report: report(), block: { rowIds: body.items.map(item => item.rowId), deferredRowIds: [] } } as T;
  };
  return { request, writes, getVersion: () => version };
}
test("plan binds exact package/fingerprints, distinct rows and explicit motives", () => {
  const { plan } = fixture(2); assert.deepEqual(parseBatchPlan(JSON.stringify(plan), source), plan);
  for (const changed of [{ ...plan, sha256: "c".repeat(64) }, { ...plan, items: [plan.items[0], plan.items[0]] }, { ...plan, items: [{ ...plan.items[0], decision: { action: "DEFER", reason: "Explicit exception but no confirmation" } }] }]) assert.throws(() => parseBatchPlan(JSON.stringify(changed), source));
});
test("continues beyond 25 with current versions then reload skips exact persisted row keys", async () => {
  const { plan, rows } = fixture(57); const fake = runtime(rows);
  const done = await runBatchPlan(plan, fake.request, () => {}, () => false);
  assert.equal(done.committed, 57); assert.deepEqual(fake.writes.map(body => body.items.length), [25, 25, 7]); assert.equal(fake.getVersion(), 6);
  const replay = await runBatchPlan(plan, fake.request, () => {}, () => false); assert.equal(replay.committed, 0); assert.equal(replay.alreadyPersisted, 57); assert.equal(fake.writes.length, 3);
});

test("durable keys ignore object insertion order and locale-dependent display sorting", async () => {
  const { plan, rows } = fixture(1); const fake = runtime(rows);
  await runBatchPlan(plan, fake.request, () => {}, () => false);
  const item = plan.items[0]!;
  const reordered: BatchPlan = { ...plan, items: [{ decision: { reason: item.decision.reason, action: "CREATE_DOSSIER" },
    expectedVersion: item.expectedVersion, fingerprint: item.fingerprint, rowId: item.rowId }] };
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error("locale_sort_forbidden_for_receipt_identity"); };
  try {
    const replay = await runBatchPlan(reordered, fake.request, () => {}, () => false);
    assert.equal(replay.alreadyPersisted, 1); assert.equal(fake.writes.length, 1);
  } finally { String.prototype.localeCompare = original; }
});
test("definitive refusal is isolated; other admissible rows continue without automatic DEFER", async () => {
  const { plan, rows } = fixture(6); const fake = runtime(rows, rows[2]!.id);
  const done = await runBatchPlan(plan, fake.request, () => {}, () => false);
  assert.equal(done.committed, 5); assert.equal(done.deferred, 0); assert.deepEqual(done.failures, [{ rowId: rows[2]!.id, code: "bootstrap_contact_reconciliation_required" }]); assert.equal(rows[2]!.state, "REVIEW");
});
test("uncertain response reuses exact body once; auth and concurrency refuse continuation", async () => {
  for (const status of [401, 403, 409]) {
    const { plan, rows } = fixture(26); const fake = runtime(rows); let count = 0;
    await assert.rejects(runBatchPlan(plan, async <T>(path: string, init?: RequestInit): Promise<T> => { if (init) { count++; throw new BootstrapApiError(status, "refused"); } return fake.request(path); }, () => {}, () => false)); assert.equal(count, 1);
  }
  const { plan, rows } = fixture(1); const fake = runtime(rows); let body = "", response: unknown, count = 0;
  const done = await runBatchPlan(plan, async <T>(path: string, init?: RequestInit): Promise<T> => {
    if (!init) return fake.request(path);
    count++; if (count === 1) { assert.equal(typeof init.body, "string"); body = init.body as string; response = await fake.request(path, init); throw new TypeError("response_lost"); }
    assert.equal(init.body, body); return response as T;
  }, () => {}, () => false);
  assert.equal(count, 2); assert.equal(fake.writes.length, 1); assert.equal(done.committed, 1);
});
test("stop takes effect only between completed blocks; changed source and foreign decisions stop", async () => {
  const { plan, rows } = fixture(26); const fake = runtime(rows); let stop = false;
  const done = await runBatchPlan(plan, fake.request, progress => { if (progress.committed) stop = true; }, () => stop); assert.equal(done.committed, 25); assert.equal(fake.writes.length, 1);
  rows[25]!.fingerprint = "c".repeat(64); await assert.rejects(runBatchPlan(plan, fake.request, () => {}, () => false), /source_changed/);
  rows[25]!.fingerprint = "b".repeat(64); rows[25]!.state = "DEFERRED"; await assert.rejects(runBatchPlan(plan, fake.request, () => {}, () => false), /other_decision_present/);
});
