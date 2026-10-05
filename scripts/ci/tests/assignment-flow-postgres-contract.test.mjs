import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = file => readFile(new URL("../../../" + file, import.meta.url), "utf8");

test("assignment integration gate uses only a new nonce-bound loopback PostgreSQL", async () => {
  const workflow = await read(".github/workflows/application-quality.yml");
  const integration = workflow.match(/\n  integration-tests:[\s\S]+?(?=\n  playwright:)/)?.[0] ?? "";
  assert.match(integration, /node scripts\/ci\/assignment-flow-postgres\.mjs/u);
  const runner = await read("scripts/ci/assignment-flow-postgres.mjs");
  for (const expected of ["assignment_must_not_inherit_database", "assignment_container_name_occupied", "assignment_container_identity_mismatch", "assignment_database_not_empty", "crmy94_test_identity.marker", "CRMY94_EPHEMERAL_TEST: \"true\"", "CRMY94_DATABASE_NONCE: nonce", "CRM_BACKGROUND_WORKERS: \"external\"", "SHEETS_ENABLED: \"false\"", "--test-concurrency=1", "assignment-flow-postgres.test.ts", "withPreservedCleanup", "127.0.0.1::5432"]) assert.ok(runner.includes(expected), expected);
  assert.doesNotMatch(runner, /migrate.*reset|seed:local|\["rm"/u);
});

test("assignment real PostgreSQL proof contributes to canonical c8 coverage", async () => {
  const coverage = await read("scripts/ci/coverage-runner.mjs");
  assert.match(coverage, /run\(process\.execPath, \["scripts\/ci\/assignment-flow-postgres\.mjs"\]\)/u);
  assert.match(coverage, /coverage_must_not_inherit_database/u);
  assert.match(coverage, /coverage_instrumentation_required/u);
});
