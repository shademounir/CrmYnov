import assert from "node:assert/strict";
import test from "node:test";
import { cutoverMigrationSets, initialRestoreRefusals, rollbackSnapshot, createInitialRollbackProof } from "../cutover-initial-rollback.mjs";

const observed = () => ({ baselineSha256: "a".repeat(64), currentSha256: "a".repeat(64), windowOpenedAt: null, activeClients: [],
  database: { connectionLimit: 0, readOnlyDefault: true }, applicationRoles: [{ superuser: false, bypassRls: false }, { superuser: false, bypassRls: false }] });
test("rollback oracle refuses reopening, same-count edits, producers and privileged roles independently", () => {
  assert.deepEqual(initialRestoreRefusals(observed()), []);
  assert.ok(initialRestoreRefusals({ ...observed(), windowOpenedAt: "2026-10-09T12:00:00Z" }).includes("WINDOW_REOPENED"));
  assert.ok(initialRestoreRefusals({ ...observed(), currentSha256: "b".repeat(64) }).includes("BUSINESS_STATE_CHANGED"));
  assert.ok(initialRestoreRefusals({ ...observed(), activeClients: [{ pid: 1 }] }).includes("PRODUCER_OR_CLIENT_ACTIVE"));
  assert.ok(initialRestoreRefusals({ ...observed(), database: { connectionLimit: -1, readOnlyDefault: false } }).includes("SYNTHETIC_MAINTENANCE_NOT_CLOSED"));
  assert.ok(initialRestoreRefusals({ ...observed(), applicationRoles: [{ superuser: true, bypassRls: false }, { superuser: false, bypassRls: false }] }).includes("APPLICATION_AUTHORITY_UNSAFE"));
  assert.ok(initialRestoreRefusals({ baselineSha256: "a".repeat(64), currentSha256: "a".repeat(64), maintenanceConfirmed: true }).length > 0, "A caller-attested boolean cannot replace collected database observations");
});
test("migration discovery keeps all old identifiers and accepts future additive worker migrations", () => {
  const first = "20261009070000_cutover_preparation", second = "20261009090000_cutover_manual_catchup", third = "20261009110000_cutover_runtime_worker", old = "00000000000000_bootstrap";
  assert.deepEqual(cutoverMigrationSets([old], [third, old, second, first]), { legacy: [old], added: [first, second, third] });
  assert.throws(() => cutoverMigrationSets([old], [first]), /history_invalid/u);
  assert.throws(() => cutoverMigrationSets([old], [old, old]), /history_invalid/u);
  assert.throws(() => cutoverMigrationSets([old], [old, "../private"]), /history_invalid/u);
});
test("migration ordering is explicit ordinal order for timestamp and name ties, independent of input order", () => {
  const oldA = "20260901000000_a", oldZ = "20260901000000_z";
  const first = "20261009070000_a", tied = "20261009070000_z", later = "20261009120000_quarantine";
  const before = [oldZ, oldA], current = [later, oldZ, tied, first, oldA];
  assert.deepEqual(cutoverMigrationSets(before, current), { legacy: [oldA, oldZ], added: [first, tied, later] });
  assert.deepEqual(before, [oldZ, oldA]);
  assert.deepEqual(current, [later, oldZ, tied, first, oldA]);
});
test("snapshot hashes exact row content, not only counts, and rejects unsafe catalogue identifiers", () => {
  let label = "Before";
  const sql = (_database, statement) => {
    if (statement.includes("FROM pg_tables")) return '["leads"]';
    if (statement.includes("FROM pg_sequences")) return "[]";
    if (statement.includes("FROM public.\"leads\"")) return JSON.stringify({ rows: [{ table: "leads", rows: [{ id: "synthetic", name: label }] }], sequences: [], privileges: [] });
    return "true";
  };
  const before = rollbackSnapshot(sql, "synthetic", ["reader", "writer"]); label = "After";
  const after = rollbackSnapshot(sql, "synthetic", ["reader", "writer"]);
  assert.deepEqual(before.rowCounts, after.rowCounts); assert.notEqual(before.sha256, after.sha256);
  assert.throws(() => rollbackSnapshot(sql, "synthetic", ["reader"], ['leads;DROP TABLE leads']), /identifier_invalid/u);
});
test("rollback helper rejects non-synthetic targets or malformed nonce before any IO", () => {
  assert.throws(() => createInitialRollbackProof({ nonce: "private", database: "production" }), /scope_invalid/u);
  assert.throws(() => createInitialRollbackProof({ nonce: "00000000-0000-4000-8000-000000000063", database: "production" }), /scope_invalid/u);
});
test("snapshot SQL covers scoped effective privileges and schemas beyond PostgreSQL's variadic argument bound", () => {
  const tables = Array.from({ length: 110 }, (_, index) => `synthetic_${index}`); let statement;
  const sql = (_database, query) => {
    if (query.includes("FROM pg_tables")) return JSON.stringify(tables);
    if (query.includes("FROM pg_sequences")) return '["synthetic_sequence"]';
    statement = query; return JSON.stringify({ rows: tables.map(table => ({ table, rows: [] })), sequences: [], privileges: [] });
  };
  const result = rollbackSnapshot(sql, "synthetic", ["reader", "writer"]);
  assert.equal(result.tables.length, 110); assert.doesNotMatch(statement, /jsonb_build_array/u);
  assert.match(statement, /jsonb_agg\(entry.value ORDER BY entry.position\)/u);
  for (const permission of ["TRUNCATE", "REFERENCES", "TRIGGER", "TEMPORARY"]) assert.ok(statement.includes(permission));
  assert.match(statement, /has_sequence_privilege/u); assert.match(statement, /has_schema_privilege\('reader','public','CREATE'\)/u);
});
test("snapshot digest preserves bigint changes beyond JavaScript's safe integer range", () => {
  let amount = "9007199254740992";
  const sql = (_database, statement) => statement.includes("FROM pg_sequences") ? "[]"
    : `{"rows":[{"table":"leads","rows":[{"counter":${amount}}]}],"sequences":[],"privileges":[]}`;
  const before = rollbackSnapshot(sql, "synthetic", [], ["leads"]); amount = "9007199254740993";
  const after = rollbackSnapshot(sql, "synthetic", [], ["leads"]);
  assert.deepEqual(before.rows, after.rows, "JS number parsing alone loses this distinction");
  assert.notEqual(before.sha256, after.sha256); assert.notEqual(before.canonicalJson, after.canonicalJson);
});
