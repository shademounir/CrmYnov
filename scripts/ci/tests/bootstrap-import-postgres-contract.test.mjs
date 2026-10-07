import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bootstrap isolated runner compiles production providers and binds source/fixture without inheriting a database", async () => {
  const runner = await readFile(new URL("../bootstrap-import-postgres.mjs", import.meta.url), "utf8");
  for (const marker of ["bootstrap_must_not_inherit_database", "bootstrap_repository_cwd_required", "compilePostgresProof", "BootstrapImportService", "BootstrapImportController", "BootstrapHistoricalNotesController", "bootstrap_compiled_metadata_invalid", "fixtureSha256", "bootstrap_test_source_changed", "bootstrap_test_did_not_execute_fully", "compiled/test/integration/bootstrap-import-postgres.test.js"]) assert.ok(runner.includes(marker), marker);
  assert.doesNotMatch(runner, /seed:local|migrate.*reset|gcloud|terraform|\["rm"/u);
});

test("bootstrap runner enables its nonce-bound tmpfs proof and preserves only its owned container", async () => {
  const runner = await readFile(new URL("../bootstrap-import-postgres.mjs", import.meta.url), "utf8");
  for (const marker of ["crmy61-bootstrap-test-nonce", "crmy61_test_identity.marker", 'CRMY61_EPHEMERAL_TEST: "true"', "CRMY61_DATABASE_NONCE: nonce", 'SHEETS_ENABLED: "false"', 'CRM_BACKGROUND_WORKERS: "external"', 'CRMY61_UI_FIXTURE_DIR: ""', '"127.0.0.1::5432"', '"--pull", "never"', "bootstrap_database_not_empty", "loopbackBinding(image)", "ownedContainer(image); docker", "stopped: true, preserved: true", "tmpfsDatabaseNotABackup: true"]) assert.ok(runner.includes(marker), marker);
});

test("bootstrap PostgreSQL proof is invoked by integration and canonical coverage rather than merely skipped", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/application-quality.yml", import.meta.url), "utf8");
  const integration = workflow.slice(workflow.indexOf("  integration-tests:"), workflow.indexOf("  playwright:"));
  assert.match(integration, /run: node scripts\/ci\/bootstrap-import-postgres\.mjs/u);
  const coverage = await readFile(new URL("../coverage-runner.mjs", import.meta.url), "utf8");
  assert.match(coverage, /run\(process\.execPath, \["scripts\/ci\/bootstrap-import-postgres\.mjs"\]\)/u);
});
