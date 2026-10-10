import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("append-only PostgreSQL proof runs explicitly in integration and canonical coverage", async () => {
  const workflow = await read("../../../.github/workflows/application-quality.yml");
  const integration = workflow.match(/\n  integration-tests:[\s\S]+?(?=\n  playwright:)/u)?.[0] ?? "";
  assert.match(integration, /run: node scripts\/ci\/sheet-append-postgres\.mjs/u);
  assert.doesNotMatch(integration, /continue-on-error|secrets\./u);
  const coverage = await read("../coverage-runner.mjs");
  assert.match(coverage, /run\(process\.execPath, \["scripts\/ci\/sheet-append-postgres\.mjs"\]\)/u);
  assert.match(coverage, /coverage_instrumentation_required/u);
});

test("append proof compiles real metadata and binds changed sources without shared builds", async () => {
  const runner = await read("../sheet-append-postgres.mjs");
  for (const marker of ["sheet_append_must_not_inherit_database", "sheet_append_repository_cwd_required", "compilePostgresProof", "SheetImportExecutor",
    "SheetImportAdminService", "BootstrapImportService", "sheet_append_compiled_metadata_invalid", "sourcesBefore", "bindingsBefore",
    "sheet_append_test_source_changed", "sheet_append_private_proof_root_must_be_outside_git", "CRMY63_APPEND_ARTIFACT_ROOT: artifactDirectory",
    "compiled/test/integration/sheet-append-postgres.test.js"]) assert.ok(runner.includes(marker), marker);
  assert.doesNotMatch(runner, /seed:local|migrate.*reset|gcloud|terraform|\["rm"|npm.*(?:install|ci)|prisma.*generate/u);
});

test("append proof uses only its owned nonce-bound loopback tmpfs database", async () => {
  const runner = await read("../sheet-append-postgres.mjs");
  for (const marker of ["crmy63_append_synthetic", "crmy63_append_test_identity.marker", "sheet-row-append-synthetic-qualification",
    "crmy63-sheet-append-test-nonce", 'CRMY63_APPEND_EPHEMERAL_TEST: "true"', "CRMY63_APPEND_DATABASE_NONCE: nonce",
    '"127.0.0.1::5432"', '"--pull", "never"', "sheet_append_database_not_empty", "loopbackBinding(image)", "withPreservedCleanup",
    "ownedContainer(image); docker", "stopped: true, preserved: true", "tmpfsDatabaseNotABackup: true"]) assert.ok(runner.includes(marker), marker);
});

test("append proof clears real transport and private artifacts and refuses skipped execution", async () => {
  const runner = await read("../sheet-append-postgres.mjs");
  for (const marker of ['SHEETS_ENABLED: "false"', 'SHEET_ROW_APPEND_ENABLED: "false"', 'SHEET_CUTOVER_ENABLED: "false"',
    'CRM_BACKGROUND_WORKERS: "external"', 'FORMINATOR_WEBHOOK_ENABLED: "false"', 'CRM_GOOGLE_SHEETS_ENABLED: "false"',
    'CRM_SHEET_APPEND_BOUNDARY_FILE: ""', 'CRM_SHEET_APPEND_QUALIFICATION_FILE: ""', 'CRM_SHEET_APPEND_POLICY_QUALIFIED: "false"',
    '"--test-concurrency=1"', "sheet_append_test_did_not_execute_fully", "# skipped 0", "# fail 0"]) assert.ok(runner.includes(marker), marker);
  assert.match(runner, /execFileSync\(process\.execPath,[\s\S]+env,[\s\S]+status: "PASSED"/u);
  assert.doesNotMatch(runner, /NODE_V8_COVERAGE\s*:/u, "child instrumentation is inherited, not replaced");
});
