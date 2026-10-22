import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { DynamicPermissionRepository } from "../src/permissions/dynamic-repository.js";
import type { PrismaService } from "../src/persistence/prisma.service.js";
import { initialFenceLockUnavailable, mailDiagnostic, mailStage, retainMailFailure, withMailCleanup } from "../src/permissions/safe-mail-diagnostic.js";
import { BusinessMailRuntime, emptyMailReport } from "../src/business-mail/business-mail-runtime.js";
import type { BusinessMailJournal } from "../src/business-mail/business-mail-journal.js";
import type { PrismaClient } from "@prisma/client";

const lock = (): Error => new Prisma.PrismaClientKnownRequestError("SECRET postgres://private/contact@example.invalid", { code: "P2010", clientVersion: "synthetic", meta: { code: "55P03", message: "SECRET" } });
function fixture(fail: (attempt: number) => unknown): { repository: DynamicPermissionRepository; counts: () => { attempts: number; rollbacks: number }; options: unknown[]; statements: string[] } {
  let attempts = 0, rollbacks = 0;
  const options: unknown[] = [], statements: string[] = [];
  const tx = { $executeRaw: (sql: TemplateStringsArray): Promise<number> => {
    const text = sql.join("?"); statements.push(text);
    if (text.includes("pg_advisory")) { const error = fail(attempts); if (error) return Promise.reject(error instanceof Error ? error : Object.assign(new Error("synthetic vendor lookalike"), error)); }
    return Promise.resolve(0);
  } };
  const client = { $transaction: async (action: (tx: unknown) => Promise<unknown>, config: unknown): Promise<unknown> => {
    attempts++; options.push(config);
    try { return await action(tx); } catch (error) { rollbacks++; throw error; }
  } };
  const prisma = { client, withTransaction: (_tx: unknown, action: () => Promise<unknown>): Promise<unknown> => action() } as unknown as PrismaService;
  return { repository: new DynamicPermissionRepository(prisma), counts: (): { attempts: number; rollbacks: number } => ({ attempts, rollbacks }), options, statements };
}
test("mail-only initial fence recovery retries after rollback, then handler exactly once", async () => {
  const f = fixture(attempt => attempt === 1 ? lock() : null); let actions = 0;
  const result = await f.repository.readTransaction(() => { actions++; assert.equal(f.counts().rollbacks, 1); return Promise.resolve("held"); }, { businessMailFence: { signal: AbortSignal.timeout(5000) } });
  assert.equal(result, "held"); assert.equal(actions, 1); assert.deepEqual(f.counts(), { attempts: 2, rollbacks: 1 });
  assert(f.statements.includes("SET LOCAL lock_timeout = '5000ms'"));
  assert(f.options.every(option => JSON.stringify(option) === JSON.stringify({ isolationLevel: "ReadCommitted", timeout: 30000, maxWait: 5000 })));
});
test("default imports, wrong vendor/code and post-handler failures never gain a retry", async () => {
  for (const error of [lock(), { code: "P2010", meta: { code: "55P03" } }, new Prisma.PrismaClientKnownRequestError("SECRET", { code: "P2010", clientVersion: "synthetic", meta: { code: "23505" } })]) {
    const f = fixture(() => error);
    await assert.rejects(f.repository.readTransaction(() => Promise.resolve())); assert.equal(f.counts().attempts, 1);
    if (!initialFenceLockUnavailable(error)) {
      const g = fixture(() => error); await assert.rejects(g.repository.readTransaction(() => Promise.resolve(), { businessMailFence: { signal: AbortSignal.timeout(5000) } })); assert.equal(g.counts().attempts, 1);
    }
  }
  const g = fixture(() => null); let actions = 0;
  await assert.rejects(g.repository.transaction(() => { actions++; return Promise.reject(lock()); }, "read-audited", { businessMailFence: { signal: AbortSignal.timeout(5000) } }), error => {
    const d = mailDiagnostic(error); assert.equal(d.vendorCode, "P2010"); assert.equal(d.sqlState, "55P03"); assert.equal(d.handlerStarted, true);
    assert(!JSON.stringify(error).includes("SECRET")); return true;
  });
  assert.equal(actions, 1); assert.equal(g.counts().attempts, 1);
});
test("one bounded mail acquisition budget includes P2034; abort stops backoff and handler", async () => {
  const f = fixture(attempt => attempt % 2 ? lock() : { code: "P2034" });
  await assert.rejects(f.repository.readTransaction(() => Promise.reject(Error("handler must not start")), { businessMailFence: { signal: AbortSignal.timeout(10000) } }), error => { assert.equal(mailDiagnostic(error).attempts, 4); return true; });
  assert.equal(f.counts().attempts, 4);
  const controller = new AbortController(), g = fixture(() => lock());
  const timer = setTimeout(() => controller.abort(), 20);
  try { await assert.rejects(g.repository.readTransaction(() => Promise.reject(Error("aborted handler")), { businessMailFence: { signal: controller.signal } })); }
  finally { clearTimeout(timer); }
  assert.equal(g.counts().attempts, 1);
  const h = fixture(() => null); controller.abort();
  await assert.rejects(h.repository.readTransaction(() => Promise.reject(Error("already aborted")), { businessMailFence: { signal: controller.signal } })); assert.equal(h.counts().attempts, 0);
});
test("nested actions are never retried and write mode cannot opt in", async () => {
  const f = fixture(() => null), options = { businessMailFence: { signal: AbortSignal.timeout(5000) } }; let actions = 0;
  await assert.rejects(f.repository.readTransaction(() => f.repository.readTransaction(() => { actions++; return Promise.reject(lock()); }, options), options));
  assert.equal(actions, 1); assert.equal(f.counts().attempts, 1);
  await assert.rejects(f.repository.transaction(() => Promise.resolve(), "write", options)); assert.equal(f.counts().attempts, 1);
});
test("legacy P2034 budget remains unchanged without mail options", async () => {
  const f = fixture(() => ({ code: "P2034" }));
  await assert.rejects(f.repository.readTransaction(() => Promise.reject(Error("fence never acquired"))));
  assert.equal(f.counts().attempts, 5);
});
test("candidate20s starts inside acquired handler and cannot replace an aborted global signal", async t => {
  const global = new AbortController(); let entered = false, timers = 0, sends = 0;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number): AbortSignal => { assert.equal(milliseconds, 20000); assert(entered); timers++; return new AbortController().signal; });
  const tx = { businessMailConfiguration: { findUniqueOrThrow: (): Promise<unknown> => Promise.resolve({ version: 1, enabled: false }) } };
  const permissions = { transaction: async (action: (tx: unknown) => Promise<void>, mode: string, options: { businessMailFence: { signal: AbortSignal } }): Promise<void> => {
    assert.equal(mode, "read-audited"); assert.equal(options.businessMailFence.signal, global.signal); assert.equal(timers, 0);
    entered = true; await action(tx);
  } } as unknown as DynamicPermissionRepository;
  const runtime = new BusinessMailRuntime({} as PrismaClient, permissions, {} as BusinessMailJournal, { configured: (): boolean => true, sendPrepared: (): Promise<{ providerMessageId: string }> => { sends++; return Promise.resolve({ providerMessageId: "never" }); } });
  const inspect = Reflect.get(runtime, "inspect") as (candidate: never, mode: "SEND", signal: AbortSignal, report: ReturnType<typeof emptyMailReport>) => Promise<void>;
  const report = { ...emptyMailReport(), configurationVersion: 1 };
  await inspect.call(runtime, {} as never, "SEND", global.signal, report); assert.equal(timers, 1); assert.equal(sends, 0);
  timers = 0; entered = false; global.abort();
  await assert.rejects(inspect.call(runtime, {} as never, "SEND", global.signal, report)); assert.equal(timers, 0); assert.equal(sends, 0);
});
test("safe cause keeps phase/code only; cleanup preserves primary, including primitive throws", async () => {
  const primary = retainMailFailure(lock(), "DISCOVERY_FENCE", { attempts: 4 }); let closed = 0;
  await assert.rejects(withMailCleanup(() => Promise.reject(primary), [(): Promise<void> => { closed++; return Promise.reject(Error("SECRET close")); }, (): Promise<void> => { closed++; return Promise.resolve(); }]), error => {
    assert.equal(error, primary); const d = mailDiagnostic(error); assert.equal(d.phase, "DISCOVERY_FENCE"); assert.equal(d.cleanupFailed, true);
    assert(!JSON.stringify(d).includes("SECRET")); assert.equal(Object.getOwnPropertyDescriptor(error, "cause")?.enumerable, false); return true;
  }); assert.equal(closed, 2);
  // Simulate an untyped external Promise rejection, not an application throw.
  await assert.rejects(withMailCleanup(() => new Promise((_resolve, reject) => { Reflect.apply(reject, undefined, [undefined]); }), [(): Promise<void> => Promise.reject(Error("SECRET"))]), error => { assert.equal(mailDiagnostic(error).phase, "CONTRACT"); return true; });
  await assert.rejects(withMailCleanup(() => Promise.resolve("ok"), [(): Promise<void> => Promise.reject(Error("SECRET"))]), error => { assert.equal(mailDiagnostic(error).phase, "CLEANUP"); return true; });
  await assert.rejects(mailStage("TRANSPORT", () => Promise.reject(primary)), error => { assert.equal(mailDiagnostic(error).phase, "DISCOVERY_FENCE"); return true; });
  assert.equal(mailDiagnostic({ get code(): string { throw Error("SECRET getter"); } }).vendorCode, "UNKNOWN");
});
