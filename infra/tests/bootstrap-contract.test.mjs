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
const wifRoot = path.join(infra, "bootstrap", "wif");
const wifFiles = filesBelow(wifRoot, (file) => file.endsWith(".tf"));
const wif = wifFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const wifMain = readFileSync(path.join(wifRoot, "main.tf"), "utf8");

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

test("Terraform billing roles are additive and exclude billing administration", () => {
  const billingUser = wifMain.match(
    /resource\s+"google_billing_account_iam_member"\s+"terraform_billing_user"\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  const costsManager = wifMain.match(
    /resource\s+"google_billing_account_iam_member"\s+"terraform_billing_costs_manager"\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(billingUser, "missing additive Billing User member");
  assert.ok(costsManager, "missing additive Billing Costs Manager member");
  assert.match(billingUser, /role\s*=\s*"roles\/billing\.user"/);
  assert.match(costsManager, /role\s*=\s*"roles\/billing\.costsManager"/);
  assert.match(billingUser, /member\s*=\s*local\.terraform_bootstrap_member/);
  assert.match(costsManager, /member\s*=\s*local\.terraform_bootstrap_member/);
  assert.doesNotMatch(terraform, /roles\/billing\.admin/i);
});

test("WIF binds exact repository identity, branch, and environment", () => {
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

test("WIF positive and negative claim matrix is fail closed", () => {
  const policies = {
    DEV: { ref: "refs/heads/develop" },
    STAGING: { refPrefix: "refs/heads/release/" },
    PROD: { ref: "refs/heads/main" },
  };
  const allows = (claims, environment) => {
    const policy = policies[environment];
    return Boolean(
      policy &&
      claims.repository === "shademounir/CrmYnov" &&
      claims.repositoryId === "1313619083" &&
      claims.repositoryOwnerId === "151538330" &&
      claims.environment === environment &&
      (policy.ref ? claims.ref === policy.ref : claims.ref?.startsWith(policy.refPrefix))
    );
  };
  const valid = {
    repository: "shademounir/CrmYnov",
    repositoryId: "1313619083",
    repositoryOwnerId: "151538330",
  };

  assert.equal(allows({ ...valid, ref: "refs/heads/develop", environment: "DEV" }, "DEV"), true);
  assert.equal(allows({ ...valid, ref: "refs/heads/release/1.0.0", environment: "STAGING" }, "STAGING"), true);
  assert.equal(allows({ ...valid, ref: "refs/heads/main", environment: "PROD" }, "PROD"), true);

  const invalidDevClaims = [
    { ...valid, repository: "someone/CrmYnov", ref: "refs/heads/develop", environment: "DEV" },
    { ...valid, repositoryId: "999", ref: "refs/heads/develop", environment: "DEV" },
    { ...valid, repositoryOwnerId: "999", ref: "refs/heads/develop", environment: "DEV" },
    { ...valid, ref: "refs/heads/feature/CRMY-108", environment: "DEV" },
    { ...valid, ref: "refs/heads/develop" },
    { ...valid, ref: "refs/heads/develop", environment: "STAGING" },
  ];
  for (const claims of invalidDevClaims) assert.equal(allows(claims, "DEV"), false);
});

test("WIF administration identity is distinct from tf-bootstrap", () => {
  const variables = readFileSync(path.join(wifRoot, "variables.tf"), "utf8");
  const provider = readFileSync(path.join(wifRoot, "providers.tf"), "utf8");
  assert.match(variables, /variable\s+"bootstrap_administrator_service_account_email"/);
  assert.match(variables, /!=\s*"tf-bootstrap@\$\{var\.bootstrap_project_id\}\.iam\.gserviceaccount\.com"/);
  assert.match(provider, /impersonate_service_account\s*=\s*var\.bootstrap_administrator_service_account_email/);
  assert.doesNotMatch(wif, /impersonate_service_account\s*=\s*var\.terraform_service_account_email/);
});

test("Terraform static workflow is credential-free and non-mutating", () => {
  const workflow = readFileSync(path.join(repository, ".github", "workflows", "terraform-static.yml"), "utf8");
  assert.match(workflow, /pull_request:\s*[\s\S]*branches:\s*[\s\S]*- develop/);
  assert.doesNotMatch(workflow, /\bpaths(?:-ignore)?:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /terraform_version: 1\.15\.8/);
  assert.match(workflow, /terraform-static:/);
  assert.match(workflow, /iac-security:/);
  assert.match(workflow, /-backend=false/);
  assert.match(workflow, /-input=false/);
  assert.match(workflow, /-lockfile=readonly/);
  assert.match(workflow, /severity: HIGH,CRITICAL/);
  assert.match(workflow, /exit-code: '1'/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /\bterraform\s+(plan|apply|destroy|import)\b/);
  for (const action of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
    assert.match(action[1], /^[0-9a-f]{40}$/, `action is not pinned by full SHA: ${action[0]}`);
  }
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
