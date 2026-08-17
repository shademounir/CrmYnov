import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/pr-policy.yml", import.meta.url);
const cliUrl = new URL("../cli.mjs", import.meta.url);
const migrationWorkflowUrl = new URL("../../../.github/workflows/prisma-migration-policy.yml", import.meta.url);

test("pr-policy workflow has stable triggers and job name", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  for (const event of ["opened", "reopened", "synchronize", "ready_for_review", "converted_to_draft"]) {
    assert.match(workflow, new RegExp(`- ${event}`));
  }
  assert.match(workflow, /branches:\s*[\s\S]*?- develop[\s\S]*?- main/);
  assert.match(workflow, /^  pr-policy:\s*$/m);
  assert.match(workflow, /name: pr-policy/);
});

test("pr-policy workflow is read-only and secret-free", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /:\s*write/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /credentials_json|github_pat|ghp_/i);
  assert.match(workflow, /persist-credentials: false/);
  for (const action of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
    assert.match(action[1], /^[0-9a-f]{40}$/);
  }
});

test("untrusted forks are refused before checkout", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.ok(workflow.indexOf("Refuse untrusted event source") < workflow.indexOf("actions/checkout@"));
  assert.match(workflow, /SOURCE_REPOSITORY/);
  assert.match(workflow, /EXPECTED_REPOSITORY/);
});

test("manual-po evidence collection is read-only and cannot perform reserved PO actions", async () => {
  const cli = await readFile(cliUrl, "utf8");
  assert.match(cli, /reviewThreads\(first:100\)/);
  assert.doesNotMatch(cli, /\bmutation\b/);
  assert.doesNotMatch(cli, /method:\s*["'](?:PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(cli, /\/merge(?:s|\b)|\/requested_reviewers|\/labels(?:\?|`|\")/);
  assert.doesNotMatch(cli, /gh\s+pr\s+(?:ready|merge)|--auto-merge/);
});

test("migration workflow is ephemeral, secret-free and pinned", async () => {
  const workflow = await readFile(migrationWorkflowUrl, "utf8");
  assert.match(workflow, /^\s*postgres:\s*$/m);
  assert.match(workflow, /image:\s*postgres:17\.6-bookworm/);
  assert.match(workflow, /DATABASE_URL:\s*postgresql:\/\/[^\s]+@127\.0\.0\.1:5432\/crm_policy/);
  assert.match(workflow, /MIGRATION_BASE_SHA/);
  assert.match(workflow, /MIGRATION_HEAD_SHA/);
  assert.doesNotMatch(workflow, /pull_request_target|:\s*write|\$\{\{\s*secrets\.|cloudsql|googleapis\.com/i);
  assert.match(workflow, /persist-credentials: false/);
  for (const action of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
    assert.match(action[1], /^[0-9a-f]{40}$/);
  }
});

test("pr-policy waits for the migration policy check", async () => {
  const cli = await readFile(cliUrl, "utf8");
  assert.match(cli, /"prisma-migration-policy"/);
  assert.match(cli, /assessChangedPrismaMigrations/);
});
