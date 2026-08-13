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
const foundationRoot = path.join(infra, "bootstrap", "foundation");
const foundationVariables = readFileSync(path.join(foundationRoot, "variables.tf"), "utf8");
const foundationExample = readFileSync(path.join(foundationRoot, "terraform.tfvars.example"), "utf8");
const phase0Root = path.join(infra, "bootstrap", "phase0");
const phase0Main = readFileSync(path.join(phase0Root, "main.tf"), "utf8");
const foundationMain = readFileSync(path.join(foundationRoot, "main.tf"), "utf8");
const budgetModuleMain = readFileSync(path.join(infra, "modules", "budget", "main.tf"), "utf8");
const budgetModuleVariables = readFileSync(path.join(infra, "modules", "budget", "variables.tf"), "utf8");

test("approved project IDs are exact", () => {
  for (const projectId of [
    "crmynov-bst-n7x4q2",
    "crmynov-dev-n7x4q2",
    "crmynov-stg-n7x4q2",
    "crmynov-prod-n7x4q2",
  ]) assert.match(terraform, new RegExp(projectId, "g"));
});

test("Phase 0 exclusively owns the bootstrap project resource", () => {
  assert.match(phase0Main, /resource\s+"google_project"\s+"bootstrap"/);
  assert.match(phase0Main, /deletion_policy\s*=\s*"PREVENT"/);
  assert.match(phase0Main, /auto_create_network\s*=\s*false/);
  assert.doesNotMatch(foundationMain, /module\.projects\["bootstrap"\]/);
  assert.match(foundationMain, /data\s+"google_project"\s+"bootstrap"/);
});

test("Phase 0 documentation forbids plan before explicit import", () => {
  const phase0Readme = readFileSync(path.join(phase0Root, "README.md"), "utf8");
  assert.match(phase0Readme, /plan before project and service[\s\S]*imports is forbidden/i);
  assert.match(phase0Readme, /explicitly[\s\S]*authorized import/i);
});

test("Foundation can only read and cannot create or import the bootstrap project", () => {
  assert.match(foundationMain, /data\s+"google_project"\s+"bootstrap"/);
  assert.doesNotMatch(foundationMain, /resource\s+"google_project"\s+"bootstrap"/);
  assert.doesNotMatch(foundationMain, /import\s*\{[\s\S]*bootstrap/);
  assert.doesNotMatch(foundationMain, /crmynov-bst-n7x4q2[\s\S]*module\s+"projects"/);
});

test("Phase 0 and Phase 1 API ownership sets are disjoint", () => {
  const phase0Services = [...phase0Main.matchAll(/"([a-z]+(?:[a-z0-9]*\.)*googleapis\.com)"/g)].map((match) => match[1]);
  const foundationBootstrapBlock = foundationMain.match(/bootstrap\s*=\s*toset\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const foundationServices = [...foundationBootstrapBlock.matchAll(/"([a-z]+(?:[a-z0-9]*\.)*googleapis\.com)"/g)].map((match) => match[1]);
  assert.deepEqual(phase0Services.sort(), [
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]);
  assert.deepEqual(phase0Services.filter((service) => foundationServices.includes(service)), []);
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

test("Foundation budgets use exact integer cents and exact units/nanos pairs", () => {
  const approvedCents = {
    bootstrap: 833,
    dev: 4167,
    staging: 3333,
    prod: 10000,
    folder: 18333,
  };
  const expectedMoney = {
    bootstrap: { units: 8, nanos: 330000000 },
    dev: { units: 41, nanos: 670000000 },
    staging: { units: 33, nanos: 330000000 },
    prod: { units: 100, nanos: 0 },
    folder: { units: 183, nanos: 330000000 },
  };

  for (const [name, cents] of Object.entries(approvedCents)) {
    assert.match(foundationExample, new RegExp(`${name}\\s*=\\s*${cents}\\b`));
    const actual = { units: Math.floor(cents / 100), nanos: (cents % 100) * 10000000 };
    assert.deepEqual(actual, expectedMoney[name]);
    assert.ok(actual.nanos >= 0 && actual.nanos <= 999999999);
    assert.equal(actual.nanos % 10000000, 0);
  }

  assert.equal(
    approvedCents.bootstrap + approvedCents.dev + approvedCents.staging + approvedCents.prod,
    approvedCents.folder,
  );
  assert.match(budgetModuleMain, /amount_units\s*=\s*floor\(var\.amount_cents\s*\/\s*100\)/);
  assert.match(budgetModuleMain, /amount_nanos\s*=\s*\(var\.amount_cents\s*%\s*100\)\s*\*\s*10000000/);
  assert.doesNotMatch(budgetModuleMain, /var\.amount\b/);
  assert.doesNotMatch(budgetModuleMain, /\+\s*1\b/);
  assert.doesNotMatch(budgetModuleMain, /round\s*\(/);
});

test("Foundation budget validations fail closed", () => {
  const validAmount = (value) => Number.isInteger(value) && value > 0;
  for (const invalid of [-1, 0, 833.5]) assert.equal(validAmount(invalid), false);

  assert.match(foundationVariables, /amount_cents\s*>\s*0\s*&&\s*amount_cents\s*==\s*floor\(amount_cents\)/);
  assert.match(foundationVariables, /var\.budget_amount_cents\.bootstrap[\s\S]*var\.budget_amount_cents\.folder/);
  assert.match(budgetModuleVariables, /var\.amount_cents\s*>\s*0\s*&&\s*var\.amount_cents\s*==\s*floor\(var\.amount_cents\)/);
  assert.match(budgetModuleVariables, /var\.currency_code\s*==\s*"USD"/);
  assert.match(budgetModuleMain, /local\.amount_nanos\s*>=\s*0/);
  assert.match(budgetModuleMain, /local\.amount_nanos\s*<=\s*999999999/);
  assert.match(budgetModuleMain, /local\.amount_nanos\s*%\s*10000000\s*==\s*0/);

  const invalidFolder = { bootstrap: 833, dev: 4167, staging: 3333, prod: 10000, folder: 18334 };
  assert.notEqual(
    invalidFolder.bootstrap + invalidFolder.dev + invalidFolder.staging + invalidFolder.prod,
    invalidFolder.folder,
  );
});

test("Foundation budget regression signatures cannot reappear in Terraform", () => {
  const foundationTerraform = filesBelow(foundationRoot, (file) => file.endsWith(".tf"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const budgetTerraform = [budgetModuleMain, budgetModuleVariables].join("\n");
  for (const signature of ["329999999", "669999999", "8.329999999", "33.329999999", "183.329999999"])
    assert.ok(!foundationTerraform.includes(signature) && !budgetTerraform.includes(signature));
});

test("Foundation budget alert thresholds remain unchanged", () => {
  for (const pattern of [
    /threshold_percent\s*=\s*0\.50[\s\S]*spend_basis\s*=\s*"CURRENT_SPEND"/,
    /threshold_percent\s*=\s*0\.80[\s\S]*spend_basis\s*=\s*"CURRENT_SPEND"/,
    /threshold_percent\s*=\s*1\.00[\s\S]*spend_basis\s*=\s*"CURRENT_SPEND"/,
    /threshold_percent\s*=\s*1\.00[\s\S]*spend_basis\s*=\s*"FORECASTED_SPEND"/,
  ]) assert.match(budgetModuleMain, pattern);
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
