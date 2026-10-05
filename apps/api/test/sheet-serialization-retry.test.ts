import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { retrySheetSerialization } from "../src/sheet-import/sheet-serialization-retry.js";

const conflict = (): Error & { code: string } => Object.assign(new Error("synthetic transaction conflict"), { code: "P2034" });

test("successful transactions return the actual value without retry or delay", async () => {
  let attempts = 0;
  const result = await retrySheetSerialization(() => { attempts++; return Promise.resolve({ actual: true }); },
    (): Promise<never> => Promise.reject(new Error("unexpected delay")));
  assert.deepEqual(result, { actual: true }); assert.equal(attempts, 1);
});

test("the production timer default completes a bounded retry without an injected wait", async () => {
  let attempts = 0;
  const result = await retrySheetSerialization(async (): Promise<string> => {
    await Promise.resolve();
    if (++attempts === 1) throw conflict();
    return "committed after production delay";
  });
  assert.equal(result, "committed after production delay"); assert.equal(attempts, 2);
});

test("P2034 reopens the whole callback after rollback, with only 25/50 ms waits and three attempts", async () => {
  const events: string[] = [], waits: number[] = [];
  let attempts = 0, transactionOpen = false;
  const result = await retrySheetSerialization(async (): Promise<string> => {
    assert.equal(transactionOpen, false); transactionOpen = true;
    events.push(`authorize-and-lease:${++attempts}`);
    try { await Promise.resolve(); if (attempts < 3) throw conflict(); return "committed"; }
    finally { transactionOpen = false; events.push(`closed:${attempts}`); }
  }, (delayMs): Promise<void> => {
    assert.equal(transactionOpen, false, "no wait may hold a database transaction or lock");
    waits.push(delayMs); events.push(`wait:${delayMs}`); return Promise.resolve();
  });
  assert.equal(result, "committed"); assert.deepEqual(waits, [25, 50]); assert.equal(attempts, 3);
  assert.deepEqual(events, ["authorize-and-lease:1", "closed:1", "wait:25", "authorize-and-lease:2", "closed:2", "wait:50", "authorize-and-lease:3", "closed:3"]);
});

test("exhausted Serializable conflicts preserve the third error without a fourth attempt or final wait", async () => {
  const errors = [conflict(), conflict(), conflict()], waits: number[] = []; let attempts = 0;
  await assert.rejects(retrySheetSerialization((): Promise<never> => { const error = errors[attempts++]; assert.ok(error); return Promise.reject(error); },
    (delayMs): Promise<void> => { waits.push(delayMs); return Promise.resolve(); }), (error: unknown): boolean => error === errors[2]);
  assert.equal(attempts, 3); assert.deepEqual(waits, [25, 50]);
});

test("permission, lease, integrity, transport and malformed errors are terminal, not retried", async () => {
  for (const error of [new Error("sheet_authority_revoked"), new Error("sheet_lease_lost"),
    Object.assign(new Error("integrity"), { code: "P2002" }), Object.assign(new Error("raw SQL error"), { code: "40001" }),
    Object.assign(new Error("transport"), { code: "ECONNRESET" }), new Error("P2034"),
    Object.assign(new Error("malformed code"), { code: 2034 }), Object.assign(new Error("missing code"), { code: null })]) {
    let attempts = 0, waits = 0;
    await assert.rejects(retrySheetSerialization((): Promise<never> => { attempts++; return Promise.reject(error); },
      (): Promise<void> => { waits++; return Promise.resolve(); }), (received: unknown): boolean => received === error);
    assert.equal(attempts, 1); assert.equal(waits, 0);
  }
});

test("revoked authority or lost lease on a reopened callback stops before any business effect", async () => {
  for (const terminalCode of ["sheet_authority_revoked", "sheet_lease_lost"]) {
    let attempts = 0, authorized = true, effects = 0; const terminal = new Error(terminalCode);
    await assert.rejects(retrySheetSerialization(async (): Promise<void> => {
      await Promise.resolve();
      attempts++; if (!authorized) throw terminal;
      if (attempts === 1) throw conflict(); effects++;
    }, (): Promise<void> => { authorized = false; return Promise.resolve(); }), (error: unknown): boolean => error === terminal);
    assert.equal(attempts, 2); assert.equal(effects, 0);
  }
});

test("a failed wait cannot silently reopen or repeat the transaction", async () => {
  const refused = new Error("synthetic wait failure"); let attempts = 0;
  await assert.rejects(retrySheetSerialization((): Promise<never> => { attempts++; return Promise.reject(conflict()); },
    (): Promise<never> => Promise.reject(refused)), (error: unknown): boolean => error === refused);
  assert.equal(attempts, 1);
});

test("the real executor keeps external read outside retries and reuses the full permission/lease-fenced transaction", () => {
  const executor = readFileSync(resolve(__dirname, "../src/sheet-import/sheet-import-executor.ts"), "utf8");
  assert.equal((executor.match(/this\.source\.read\(/gu) ?? []).length, 1);
  assert.ok(executor.includes("return retrySheetSerialization(() => this.authorizedTransaction(context, action))"));
  const transaction = executor.slice(executor.indexOf("private async authorizedTransaction"), executor.indexOf("private async processRow"));
  for (const guard of ["client.$transaction", 'acquirePermissionFence(tx, "read-audited")', "this.prisma.withTransaction(tx",
    "this.coordinator.transaction(context.lease", "assertSheetAuthority(joined", 'isolationLevel: "Serializable"', "timeout: 10_000", "maxWait: 5_000"])
    assert.ok(transaction.includes(guard), guard);
  assert.equal(transaction.includes("source.read"), false);
});
