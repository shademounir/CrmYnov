import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, HttpException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../src/permissions/dynamic-repository.js";

/** In-memory transaction boundary only: no Prisma client or database is opened. */
function boundary(fenceFailures: unknown[]): {
  repository: DynamicPermissionRepository; attempts: () => number;
  epochs: () => number; tx: PermissionTransaction;
} {
  let attempts = 0;
  let epochs = 0;
  const tx = {
    $executeRaw: (): Promise<number> => {
      attempts++;
      if (fenceFailures.length) throw fenceFailures.shift();
      return Promise.resolve(1);
    },
    rolePermissionEpoch: { upsert: (): Promise<{ id: number; version: number }> => { epochs++; return Promise.resolve({ id: 1, version: epochs }); } },
  } as unknown as PermissionTransaction;
  const client = {
    $transaction: async (action: (value: PermissionTransaction) => Promise<unknown>, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: "Serializable", timeout: 30_000, maxWait: 5_000 });
      return action(tx);
    },
  } as unknown as PrismaClient;
  const prisma = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prisma, "client", { get: () => client });
  prisma.withTransaction = <T>(_tx: PermissionTransaction, action: () => Promise<T>): Promise<T> => action();
  return { repository: new DynamicPermissionRepository(prisma), attempts: (): number => attempts, epochs: (): number => epochs, tx };
}

function status(error: unknown, expected: number, code: string): boolean {
  assert.ok(error instanceof HttpException);
  assert.equal(error.getStatus(), expected);
  assert.deepEqual(error.getResponse(), { code });
  return true;
}

test("CRMY-169 only pre-handler serialization conflicts are retried, with one business effect", async () => {
  const fixture = boundary([{ code: "P2034" }, { code: "P2034" }]);
  let effects = 0;
  const result = await fixture.repository.transaction(async (tx) => {
    effects++;
    assert.equal(tx, fixture.tx);
    return fixture.repository.transaction((nested) => { assert.equal(nested, tx); return Promise.resolve("authorized"); });
  });
  assert.equal(result, "authorized"); assert.equal(effects, 1);
  assert.equal(fixture.attempts(), 3); assert.equal(fixture.epochs(), 1);
});

test("CRMY-169 fence retry limit fails closed without entering the handler", async () => {
  const fixture = boundary(Array.from({ length: 5 }, () => ({ code: "P2034" })));
  let effects = 0;
  await assert.rejects(() => fixture.repository.transaction(() => { effects++; return Promise.resolve(); }), (error) => status(error, 409, "permission_version_conflict"));
  assert.equal(fixture.attempts(), 5); assert.equal(fixture.epochs(), 0); assert.equal(effects, 0);
});

for (const code of ["P2034", "P2002", "P2025"]) {
  test(`CRMY-169 handler ${code} is a conflict and is never replayed`, async () => {
    const fixture = boundary([]); let effects = 0;
    await assert.rejects(() => fixture.repository.transaction(() => { effects++; return Promise.reject(Object.assign(new Error("synthetic conflict"), { code })); }), (error) => status(error, 409, "permission_version_conflict"));
    assert.equal(fixture.attempts(), 1); assert.equal(effects, 1);
  });
}

test("CRMY-169 business HTTP refusal is propagated unchanged without retries", async () => {
  const fixture = boundary([]), refusal = new ForbiddenException({ code: "permission_denied" });
  await assert.rejects(() => fixture.repository.transaction(() => Promise.reject(refusal)), (error) => error === refusal);
  assert.equal(fixture.attempts(), 1);
});

for (const failure of [new Error("synthetic internal failure"), { code: "UNKNOWN" }, "synthetic", null]) {
  test(`CRMY-169 unknown store failure (${typeof failure}) is sanitized and never retried`, async () => {
    const fixture = boundary([failure]); let effects = 0;
    await assert.rejects(() => fixture.repository.transaction(() => { effects++; return Promise.resolve(); }), (error) => status(error, 503, "permission_store_unavailable"));
    assert.equal(fixture.attempts(), 1); assert.equal(effects, 0);
  });
}
