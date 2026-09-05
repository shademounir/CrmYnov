import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, HttpException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { DynamicPermissionRepository, type PermissionTransaction } from "../src/permissions/dynamic-repository.js";
import type { PermissionTransactionMode } from "../src/permissions/permission-fence.js";

/** In-memory transaction boundary only: no Prisma client or database is opened. */
function boundary(fenceFailures: unknown[], mode: PermissionTransactionMode = "write"): {
  repository: DynamicPermissionRepository; attempts: () => number;
  epochs: () => number; tx: PermissionTransaction; statements: string[];
} {
  let attempts = 0;
  let epochs = 0;
  const statements: string[] = [];
  const tx = {
    $executeRaw: (query: TemplateStringsArray): Promise<number> => {
      const sql = query.join("?"); statements.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) {
        attempts++;
        if (fenceFailures.length) throw fenceFailures.shift();
      }
      return Promise.resolve(1);
    },
    rolePermissionEpoch: { upsert: (): Promise<{ id: number; version: number }> => { epochs++; return Promise.resolve({ id: 1, version: epochs }); } },
  } as unknown as PermissionTransaction;
  const client = {
    $transaction: async (action: (value: PermissionTransaction) => Promise<unknown>, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: mode === "write" ? "Serializable" : "ReadCommitted", timeout: 30_000, maxWait: 5_000 });
      return action(tx);
    },
  } as unknown as PrismaClient;
  const prisma = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prisma, "client", { get: () => client });
  prisma.withTransaction = <T>(_tx: PermissionTransaction, action: () => Promise<T>): Promise<T> => action();
  return { repository: new DynamicPermissionRepository(prisma), attempts: (): number => attempts, epochs: (): number => epochs, tx, statements };
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
  await assert.rejects(() => fixture.repository.transaction(() => { effects++; return Promise.resolve(); }), (error) => status(error, 503, "permission_store_unavailable"));
  assert.equal(fixture.attempts(), 5); assert.equal(fixture.epochs(), 0); assert.equal(effects, 0);
});

for (const code of ["P2034", "P2002", "P2025"]) {
  test(`CRMY-169 handler ${code} is a conflict and is never replayed`, async () => {
    const fixture = boundary([]); let effects = 0;
    await assert.rejects(() => fixture.repository.transaction(() => { effects++; return Promise.reject(Object.assign(new Error("synthetic conflict"), { code })); }), (error) => status(error, 409, "permission_version_conflict"));
    assert.equal(fixture.attempts(), 1); assert.equal(effects, 1);
  });
}

test("CRMY-170 shared readers do not write an epoch and nested readers retain the same transaction", async () => {
  const fixture = boundary([], "read");
  const result = await fixture.repository.readTransaction((tx) => fixture.repository.readTransaction((nested) => {
    assert.equal(nested, tx);
    return Promise.resolve("authorized read");
  }));
  assert.equal(result, "authorized read");
  assert.equal(fixture.attempts(), 1);
  assert.equal(fixture.epochs(), 0);
  assert.deepEqual(fixture.statements, ["SET TRANSACTION READ ONLY", "SET LOCAL lock_timeout = '5000ms'", "SELECT pg_advisory_xact_lock_shared(169, 1)"]);
});

test("CRMY-170 nested write cannot upgrade a shared read or enter its business handler", async () => {
  const fixture = boundary([], "read"); let effects = 0;
  await assert.rejects(() => fixture.repository.readTransaction(() => fixture.repository.transaction(() => {
    effects++; return Promise.resolve();
  })), (error) => status(error, 503, "permission_store_unavailable"));
  assert.equal(effects, 0); assert.equal(fixture.epochs(), 0); assert.equal(fixture.attempts(), 1);
});

test("CRMY-170 authorization reads nested in a mutation retain its exclusive protection", async () => {
  const fixture = boundary([]);
  await fixture.repository.transaction((tx) => fixture.repository.readTransaction((nested) => {
    assert.equal(nested, tx); return Promise.resolve();
  }));
  assert.equal(fixture.epochs(), 1); assert.equal(fixture.attempts(), 1);
  assert.deepEqual(fixture.statements, ["SET LOCAL lock_timeout = '5000ms'", "SELECT pg_advisory_xact_lock(169, 1)"]);
});

test("CRMY-170 audit consultation uses shared protection without incrementing permissions", async () => {
  const fixture = boundary([], "read-audited");
  await fixture.repository.transaction((tx) => fixture.repository.readTransaction((nested) => {
    assert.equal(nested, tx); return Promise.resolve();
  }), "read-audited");
  assert.equal(fixture.epochs(), 0); assert.equal(fixture.attempts(), 1);
  assert.deepEqual(fixture.statements, ["SET LOCAL lock_timeout = '5000ms'", "SELECT pg_advisory_xact_lock_shared(169, 1)"]);
});

test("CRMY-170 read-audited does not authorize a nested permission mutation", async () => {
  const fixture = boundary([], "read-audited"); let effects = 0;
  await assert.rejects(() => fixture.repository.transaction(() => fixture.repository.transaction(() => {
    effects++; return Promise.resolve();
  }), "read-audited"), (error) => status(error, 503, "permission_store_unavailable"));
  assert.equal(effects, 0); assert.equal(fixture.epochs(), 0); assert.equal(fixture.attempts(), 1);
});

test("CRMY-170 a pure reader cannot disable SQL read-only through an audited nested operation", async () => {
  const fixture = boundary([], "read"); let effects = 0;
  await assert.rejects(() => fixture.repository.readTransaction(() => fixture.repository.transaction(() => {
    effects++; return Promise.resolve();
  }, "read-audited")), (error) => status(error, 503, "permission_store_unavailable"));
  assert.equal(effects, 0); assert.equal(fixture.epochs(), 0); assert.equal(fixture.attempts(), 1);
});

test("CRMY-170 bounded lock timeout remains a sanitized store failure without replay", async () => {
  const fixture = boundary([{ code: "P2010", meta: { code: "55P03", message: "synthetic lock timeout" } }], "read");
  let effects = 0;
  await assert.rejects(() => fixture.repository.readTransaction(() => { effects++; return Promise.resolve(); }), (error) => status(error, 503, "permission_store_unavailable"));
  assert.equal(effects, 0); assert.equal(fixture.attempts(), 1); assert.equal(fixture.epochs(), 0);
});

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
