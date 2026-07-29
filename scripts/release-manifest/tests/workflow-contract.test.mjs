import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseWorkflowUrl = new URL(
  "../../../.github/workflows/release-publish.yml",
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
  assert.match(permissions, /pull-requests: read/);
  assert.doesNotMatch(permissions, /:\s*write/);
});

test("workflows never use pull_request_target", async () => {
  const workflow = await readFile(releaseWorkflowUrl, "utf8");
  assert.equal(workflow.includes("pull_request_target"), false);
});
