import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { assertEmptyPilotageDatabase, pilotageDatabaseIdentity } from "./fixtures/pilotage-database-guard.js";

const nonce = "00000000-0000-4000-8000-000000000178";
const database = `crmy178_test_${nonce}`;
const secret = "synthetic-secret-never-in-diagnostics";
const valid = (): NodeJS.ProcessEnv => ({ CRMY178_EPHEMERAL_TEST: "true", CRMY178_DATABASE_NONCE: nonce,
  CRMY178_DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:34128/${database}`, SHEETS_ENABLED: "false", CRM_BACKGROUND_WORKERS: "external",
  CRMY178_DATABASE_SERVER_ADDRESS: "172.18.0.2", CRMY178_DATABASE_SERVER_PORT: "5432" });
const refusals: Array<[string, Partial<NodeJS.ProcessEnv>]> = [
  ["missing explicit integration flag", { CRMY178_EPHEMERAL_TEST: undefined }],
  ["inherited DATABASE_URL", { DATABASE_URL: "postgresql://preserved.example.invalid/retained" }],
  ["missing independent nonce", { CRMY178_DATABASE_NONCE: undefined }],
  ["retained database name", { CRMY178_DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:34128/crmy178_pilotage_preview_20261006` }],
  ["remote hostname", { CRMY178_DATABASE_URL: `postgresql://postgres:${secret}@remote.example.invalid:34128/${database}` }],
  ["localhost alias", { CRMY178_DATABASE_URL: `postgresql://postgres:${secret}@localhost:34128/${database}` }],
  ["connection options", { CRMY178_DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:34128/${database}?schema=public` }],
  ["missing credential", { CRMY178_DATABASE_URL: `postgresql://postgres@127.0.0.1:34128/${database}` }],
  ["active connector", { SHEETS_ENABLED: "true" }],
  ["active workers", { CRM_BACKGROUND_WORKERS: "internal" }],
  ["missing independent SQL endpoint receipt", { CRMY178_DATABASE_SERVER_ADDRESS: undefined }],
  ["public SQL endpoint receipt", { CRMY178_DATABASE_SERVER_ADDRESS: "8.8.8.8" }],
  ["invalid SQL endpoint port receipt", { CRMY178_DATABASE_SERVER_PORT: "invalid" }],
];
for (const [label, patch] of refusals) test(`CRMY-178 fresh database guard rejects ${label} without exposing credentials`, () => {
  assert.throws(() => pilotageDatabaseIdentity({ ...valid(), ...patch }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.equal(error.message.includes(secret), false); return error.message.startsWith("pilotage_fixture_");
  });
});

test("CRMY-178 guard accepts only the exact independently named fresh database identity", () => {
  const identity = pilotageDatabaseIdentity(valid()); assert.equal(identity.database, database); assert.equal(identity.nonce, nonce); assert.equal(identity.port, 34128);
  assert.equal(identity.serverAddress, "172.18.0.2"); assert.equal(identity.serverPort, 5432);
});

test("CRMY-178 marker and empty table proof happen before any fixture write", async () => {
  const identity = pilotageDatabaseIdentity(valid());
  const tables = ["collaborators", "leads", ...Array.from({ length: 20 }, (_, index) => `synthetic_table_${index}`)];
  const fake = (occupied = false, marker = nonce): PrismaClient => ({
    $queryRaw: (query: TemplateStringsArray): Promise<unknown> => {
      const sql = query.join("");
      if (sql.includes("current_database")) return Promise.resolve([{ database, username: "postgres", address: "172.18.0.2", port: 5432 }]);
      if (sql.includes("crmy178_test_identity")) return Promise.resolve([{ nonce: marker }]);
      if (sql.includes("information_schema")) return Promise.resolve(tables.map((table_name) => ({ table_name })));
      throw new Error("unexpected_read");
    },
    $queryRawUnsafe: (): Promise<unknown> => Promise.resolve([{ count: occupied ? 1n : 0n }]),
  }) as unknown as PrismaClient;
  await assertEmptyPilotageDatabase(fake(), identity);
  await assert.rejects(() => assertEmptyPilotageDatabase(fake(), { ...identity, serverPort: 34128 }), /pilotage_fixture_database_identity_or_empty_state_refused/u);
  await assert.rejects(() => assertEmptyPilotageDatabase(fake(true), identity), /pilotage_fixture_database_identity_or_empty_state_refused/u);
  await assert.rejects(() => assertEmptyPilotageDatabase(fake(false, "wrong-independent-marker"), identity), /pilotage_fixture_database_identity_or_empty_state_refused/u);
});
