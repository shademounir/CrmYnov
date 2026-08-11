import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseWorkflowUrl = new URL(
  "../../../.github/workflows/release-publish.yml",
  import.meta.url,
);
const mainGateWorkflowUrl = new URL(
  "../../../.github/workflows/main-release-gate.yml",
  import.meta.url,
);

test("release workflow declares every required read permission", async () => {
  const workflow = await readFile(releaseWorkflowUrl, "utf8");
  const permissions = workflow.match(
    /permissions:\s*\r?\n((?: {2}[^\r\n]+\r?\n)+)/,
  )?.[1];
  assert.ok(permissions);
  assert.match(permissions, /contents: read/);
  assert.match(permissions, /checks: read/);
  assert.match(permissions, /issues: read/);
  assert.match(permissions, /pull-requests: read/);
  assert.doesNotMatch(permissions, /:\s*write/);
  assert.doesNotMatch(permissions, /administration:/);
  assert.equal(
    permissions.trim(),
    ["contents: read", "  checks: read", "  issues: read", "  pull-requests: read"].join("\n"),
  );
});

test("workflows never use pull_request_target", async () => {
  const workflow = await readFile(releaseWorkflowUrl, "utf8");
  assert.equal(workflow.includes("pull_request_target"), false);
});

test("release workflow uses fail-closed policy approval evidence", async () => {
  const workflow = await readFile(releaseWorkflowUrl, "utf8");
  assert.match(
    workflow,
    /RELEASE_APPROVAL_MODE: \$\{\{ vars\.RELEASE_APPROVAL_MODE \}\}/,
  );
  assert.match(workflow, /verify-approval\.mjs/);
  assert.match(
    workflow,
    /RELEASE_APPROVAL_VALIDATED: \$\{\{ steps\.approval\.outputs\.approval_validated \}\}/,
  );
  assert.doesNotMatch(workflow, /independent_approvals|\/reviews/);
  assert.doesNotMatch(
    workflow,
    /gh pr (?:ready|merge)|--auto-merge|issues\/.*\/labels/,
  );
  assert.match(
    workflow,
    /RELEASE_COMMIT: \$\{\{ steps\.evidence\.outputs\.release_commit \}\}/,
  );
  assert.match(
    workflow,
    /RELEASE_PUBLISHED_AT: \$\{\{ github\.event\.release\.published_at \}\}/,
  );
  assert.doesNotMatch(workflow, /REPOSITORY_AUTO_MERGE_ATTESTED_/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
});

test("main release gate covers pull requests, pushes and controlled dispatch", async () => {
  const workflow = await readFile(mainGateWorkflowUrl, "utf8");
  assert.match(workflow, /pull_request:\s*[\s\S]*?- main/);
  assert.match(workflow, /push:\s*[\s\S]*?- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bpaths(?:-ignore)?:/);
  for (const job of ["unit-tests", "terraform-static", "iac-security", "secret-scan"]) {
    assert.match(workflow, new RegExp(`^  ${job}:`, "m"));
  }
});

test("main release gate is read-only, pinned and credential-free", async () => {
  const workflow = await readFile(mainGateWorkflowUrl, "utf8");
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.doesNotMatch(workflow, /:\s*write/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /google-github-actions|gcloud|credentials_json/);
  assert.doesNotMatch(workflow, /\bterraform\s+(plan|apply|destroy|import)\b/);
  for (const action of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
    assert.match(action[1], /^[0-9a-f]{40}$/);
  }
});

test("main release gate rejects untrusted sources before checkout", async () => {
  const workflow = await readFile(mainGateWorkflowUrl, "utf8");
  const firstTrust = workflow.indexOf("Enforce trusted event source");
  const firstCheckout = workflow.indexOf("actions/checkout@");
  assert.ok(firstTrust >= 0 && firstTrust < firstCheckout);
  assert.match(workflow, /HEAD_REPOSITORY/);
  assert.match(workflow, /EXPECTED_REPOSITORY/);
  assert.match(workflow, /EXPECTED_OWNER/);
});
