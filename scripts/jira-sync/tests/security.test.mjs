import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);
const textExtensions = new Set([
  ".json",
  ".md",
  ".mjs",
  ".yml",
  ".yaml",
  ".gitignore",
]);

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await textFiles(fullPath)));
    } else if (
      textExtensions.has(path.extname(entry.name)) ||
      entry.name === ".gitignore"
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

test("repository contains no obvious secret, private key or service account", async () => {
  const patterns = [
    new RegExp(["gh", "p_[A-Za-z0-9]{20,}"].join("")),
    new RegExp(["github_pat", "_[A-Za-z0-9_]{20,}"].join("")),
    new RegExp(["AKIA", "[0-9A-Z]{16}"].join("")),
    new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join("")),
    new RegExp(['"type"\\s*:\\s*"', "service_account", '"'].join("")),
    new RegExp(['"private_', 'key_id"\\s*:'].join("")),
  ];
  const findings = [];

  for (const file of await textFiles(repositoryRoot)) {
    const content = await readFile(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        findings.push(path.relative(repositoryRoot, file));
      }
    }
  }

  assert.deepEqual(findings, []);
});

test("no real environment file is committed", async () => {
  const entries = await readdir(repositoryRoot, { withFileTypes: true });
  const environmentFiles = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(".env"))
    .map((entry) => entry.name)
    .filter((name) => name !== ".env.example");
  assert.deepEqual(environmentFiles, []);
});

test("Jira read-only probe is manual, main-only and least-privileged", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/jira-readonly-probe.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request(?:_target)?:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: refs\/heads\/main/);
  assert.match(workflow, /secrets\.JIRA_API_TOKEN/);
  assert.equal(workflow.match(/secrets\.JIRA_API_TOKEN/g)?.length, 1);
  assert.match(
    workflow,
    /name: Execute read-only Jira probe[\s\S]*?env:\s*\n\s*JIRA_API_TOKEN: \$\{\{ secrets\.JIRA_API_TOKEN \}\}/,
  );
  assert.match(workflow, /vars\.JIRA_SYNC_ENABLED/);
  assert.match(workflow, /vars\.JIRA_CLOUD_ID/);
  assert.match(workflow, /JIRA_SYNC_ALLOWED_ACTORS/);
  assert.doesNotMatch(workflow, /environment:/);
});

test("Jira read-only probe implementation cannot use write HTTP methods", async () => {
  const probe = await readFile(
    path.join(repositoryRoot, "scripts/jira-sync/readonly-probe.mjs"),
    "utf8",
  );
  assert.match(probe, /method: "GET"/);
  assert.match(probe, /redirect: "manual"/);
  assert.match(probe, /_edge\/tenant_info/);
  assert.match(probe, /api\.atlassian\.com/);
  assert.doesNotMatch(probe, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(probe, /console\.(?:log|dir|table)/);
  assert.doesNotMatch(probe, /process\.env/);
});

test("pull-request workflows cannot access the Jira API token secret", async () => {
  const workflowDirectory = path.join(repositoryRoot, ".github/workflows");
  const findings = [];
  for (const entry of await readdir(workflowDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const workflow = await readFile(path.join(workflowDirectory, entry.name), "utf8");
    if (/pull_request:\s*/.test(workflow) && /secrets\.JIRA_API_TOKEN/.test(workflow)) {
      findings.push(entry.name);
    }
  }
  assert.deepEqual(findings, []);
});
