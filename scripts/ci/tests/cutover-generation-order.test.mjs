import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cutover generates its private Prisma client only before PostgreSQL starts, retaining both migrated schema probes", async () => {
  const source = await readFile(new URL("../cutover-postgres.mjs", import.meta.url), "utf8");
  const generation = source.indexOf('const generate = runNode(["node_modules/prisma/build/index.js", "generate"');
  const start = source.indexOf('docker(["run", "-d"');
  assert.ok(generation > 0 && generation < start);
  assert.equal((source.match(/"generate", "--schema", clientSchema/gu) ?? []).length, 1);
  assert.ok(source.indexOf("cutover_generation_requires_no_running_containers") < generation);
  assert.match(source, /DATABASE_URL: `postgresql:\/\/postgres@127\.0\.0\.1:1\/\$\{database\}`/u);
  assert.ok(source.includes("[database, emptyDatabase].map"));
  for (const guard of ["cutover_populated_data_changed", "cutover_prisma_history_changed", "cutover_new_checksum_mismatch", "cutover_empty_checksum_mismatch", "generatedBeforePostgres: true", "generationUsedDisconnectedLoopback: true", "noSharedGeneration: true"]) assert.ok(source.includes(guard), guard);
});
