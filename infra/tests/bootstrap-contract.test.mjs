import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "..", "..");
const infra = path.join(repository, "infra");

function filesBelow(directory, predicate = () => true) {
  const result = [];
  for (const entry of readdirSync(directory)) {
    if ([".git", ".terraform", "node_modules"].includes(entry)) continue;
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) result.push(...filesBelow(absolute, predicate));
    else if (predicate(absolute)) result.push(absolute);
  }
  return result;
}

const terraformFiles = filesBelow(infra, (file) => file.endsWith(".tf"));
const terraform = terraformFiles.map((file) => readFileSync(file, "utf8")).join("\n");

test("approved project IDs are exact", () => {
  for (const projectId of [
    "crmynov-bst-n7x4q2",
    "crmynov-dev-n7x4q2",
    "crmynov-stg-n7x4q2",
    "crmynov-prod-n7x4q2",
  ]) assert.match(terraform, new RegExp(projectId, "g"));
});

test("Terraform cannot assign basic Owner or Editor roles", () => {
  assert.doesNotMatch(terraform, /role\s*=\s*"roles\/(owner|editor)"/i);
  assert.doesNotMatch(terraform, /"roles\/(owner|editor)"\s*=/i);
});

test("WIF binds exact repository identity, branch, and environment", () => {
  const wif = filesBelow(path.join(infra, "bootstrap", "wif"), (file) => file.endsWith(".tf"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  for (const expected of [
    "shademounir/CrmYnov",
    "1313619083",
    "151538330",
    "refs/heads/develop",
    "refs/heads/release/",
    "refs/heads/main",
    "assertion.environment == '${each.value.environment}'",
  ]) assert.ok(wif.includes(expected), `missing WIF contract: ${expected}`);
});

test("state buckets are isolated and fail closed", () => {
  const stateRoot = readFileSync(path.join(infra, "bootstrap", "state", "main.tf"), "utf8");
  for (const bucket of ["bst", "dev", "stg", "prod"])
    assert.ok(stateRoot.includes(`crmynov-tfstate-${bucket}-n7x4q2`));
  const stateModule = readFileSync(path.join(infra, "modules", "terraform-state", "main.tf"), "utf8");
  assert.match(stateModule, /uniform_bucket_level_access\s*=\s*true/);
  assert.match(stateModule, /public_access_prevention\s*=\s*"enforced"/);
  assert.match(stateModule, /prevent_destroy\s*=\s*true/);
  assert.doesNotMatch(stateModule, /retention_policy/);
});

test("Phase 2 runtime resources are absent", () => {
  assert.doesNotMatch(terraform, /resource\s+"google_(cloud_run|sql|artifact_registry|secret_manager|compute_network)/);
});

test("billing identifiers and credential artifacts are absent", () => {
  const sourceFiles = filesBelow(repository, (file) => !/package-lock\.json$/.test(file));
  const billingId = /\b[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}\b/;
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    assert.doesNotMatch(content, billingId, `billing ID found in ${file}`);
    assert.doesNotMatch(file, /(terraform\.tfstate|\.tfplan|service-account\.json)$/i);
  }
});

test("temporary Terraform artifacts are ignored and untracked", () => {
  const ignore = readFileSync(path.join(repository, ".gitignore"), "utf8");
  for (const pattern of ["**/.terraform/", "**/terraform.tfstate", "**/*.tfplan", "**/*.tfvars"])
    assert.ok(ignore.includes(pattern));
  const tracked = execFileSync("git", ["ls-files"], { cwd: repository, encoding: "utf8" });
  assert.doesNotMatch(tracked, /(^|\/)(terraform\.tfstate|terraform\.tfstate\.backup|\.terraform\/|[^/]+\.tfplan$)/m);
});

test("CNDP documentation is explicit and non-automatic", () => {
  const checklistPath = path.join(repository, "docs", "compliance", "cndp-preproduction-checklist.md");
  assert.equal(existsSync(checklistPath), true);
  const checklist = readFileSync(checklistPath, "utf8");
  assert.match(checklist, /Formalités CNDP suivies par le Product Owner/);
  assert.match(checklist, /ne\s+constitue pas une validation juridique automatique de conformité/);
});
