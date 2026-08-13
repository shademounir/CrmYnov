import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, parse, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = resolve(here, "../run-foundation-plan.ps1");
const positive = resolve(here, "../fixtures/foundation-positive.synthetic.json");
const fakeTerraform = resolve(here, "../fakes/terraform.cmd");
const repository = resolve(here, "../../..");
const terraformRoot = resolve(repository, "infra/bootstrap/foundation");
const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const windowsOnly = { skip: process.platform !== "win32" };

function parseSummary(result) {
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return JSON.parse(line);
}

function invokeSynthetic(path = positive, failure = "None", env = {}) {
  return spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-SyntheticFixture", "-FixturePath", path, "-SyntheticFailure", failure], {
    encoding: "utf8",
    env: { ...process.env, ...env, GOOGLE_APPLICATION_CREDENTIALS: "", CLOUDSDK_CORE_PROJECT: "" },
  });
}

function invokeContract({ scenario = "success", expectedSha, tfvarsMode = "valid", temporaryParent, inheritedTfDataDir } = {}) {
  const harness = mkdtempSync(resolve(tmpdir(), "crmynov-contract-harness-"));
  const tempBase = temporaryParent || resolve(harness, "temporary parent");
  if (!temporaryParent) mkdirSync(tempBase, { recursive: true });
  const tfvars = resolve(harness, "input.tfvars");
  if (tfvarsMode !== "missing") {
    writeFileSync(tfvars, tfvarsMode === "empty" ? "" : 'billing_account_id = "SYNTHETIC-BILLING-ACCOUNT"\napi_token = "SYNTHETIC-TOKEN-SECRET"\n', "utf8");
  }
  const log = resolve(harness, "terraform-calls.jsonl");
  const sha = expectedSha || execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const args = [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper,
    "-ContractSimulation",
    "-TerraformExecutable", fakeTerraform,
    "-RepositoryRoot", repository,
    "-TerraformRoot", terraformRoot,
    "-TfVarsPath", tfvars,
    "-ExpectedMainSha", sha,
    "-TemporaryParent", tempBase,
  ];
  const result = spawnSync(shell, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      TF_DATA_DIR: inheritedTfDataDir ?? process.env.TF_DATA_DIR,
      FAKE_TERRAFORM_SCENARIO: scenario,
      FAKE_TERRAFORM_LOG: log,
      FAKE_TERRAFORM_FIXTURE: positive,
      GOOGLE_APPLICATION_CREDENTIALS: "",
      CLOUDSDK_CORE_PROJECT: "",
    },
  });
  const calls = readdirSync(harness).includes("terraform-calls.jsonl")
    ? readFileSync(log, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  const snapshot = { result, summary: parseSummary(result), calls, harness, tempBase, tfvars, log };
  return snapshot;
}

function cleanupHarness(run) {
  rmSync(run.harness, { recursive: true, force: true });
}

test("synthetic wrapper emits the exact evidence contract without inventing a plan hash", () => {
  const result = invokeSynthetic();
  assert.equal(result.status, 0, result.stderr);
  const output = parseSummary(result);
  assert.equal(output.schemaVersion, 2);
  assert.equal(output.valid, true);
  assert.equal(output.mode, "synthetic_fixture");
  assert.equal(output.actions.create, 26);
  assert.equal(output.plan.status, "synthetic_not_produced");
  assert.equal(output.plan.sha256, null);
  assert.match(output.json.sha256, /^[a-f0-9]{64}$/);
  for (const stage of ["terraformVersion", "fmt", "init", "validate", "plan", "show"]) {
    assert.deepEqual(output.exitCodes[stage], { executed: false, reason: "synthetic_fixture" });
  }
  assert.equal(output.exitCodes.analyzer, 0);
  assert.equal(output.sensitiveDataDetected, false);
  assert.equal(output.cleanupSucceeded, true);
  assert.equal(output.tfDataDirRestored, true);
});

for (const failure of ["Command", "PlanAbsent", "PlanEmpty", "JsonAbsent", "JsonEmpty", "Analyzer"]) {
  test(`synthetic wrapper fails closed for ${failure}`, () => {
    const result = invokeSynthetic(positive, failure);
    assert.equal(result.status, 1);
    const output = parseSummary(result);
    assert.equal(output.valid, false);
    assert.equal(output.cleanupSucceeded, true);
    assert.equal(output.artifactsRemaining, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /SYNTHETIC-BILLING-ACCOUNT|SYNTHETIC-TOKEN-SECRET/i);
  });
}

test("synthetic wrapper always cleans its isolated temporary directory", () => {
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("crmynov-evidence-")));
  invokeSynthetic();
  invokeSynthetic(positive, "Analyzer");
  const after = readdirSync(tmpdir()).filter((name) => name.startsWith("crmynov-evidence-") && !before.has(name));
  assert.deepEqual(after, []);
});

test("synthetic wrapper refuses a path outside its fixture allowlist", () => {
  const result = invokeSynthetic(resolve(repository, "package.json"));
  assert.equal(result.status, 1);
  assert.equal(parseSummary(result).valid, false);
});

test("contract harness executes the exact ordered path and links all evidence", windowsOnly, () => {
  const run = invokeContract({ inheritedTfDataDir: resolve(tmpdir(), "preexisting-tfdata") });
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.deepEqual(run.calls.map(({ command }) => command), ["version", "fmt", "init", "validate", "plan", "show"]);
    assert.equal(run.calls.filter(({ command }) => command === "plan").length, 1);
    for (const call of run.calls) {
      assert.equal(call.args[0], `-chdir=${terraformRoot}`);
      assert.ok(call.tfDataDir);
      assert.equal(call.tfDataDir.startsWith(repository), false);
      assert.match(call.tfDataDir, /crmynov-evidence-[a-f0-9]{32}.+tfdata/i);
    }
    assert.equal(run.summary.valid, true);
    assert.equal(run.summary.mode, "contract_simulation");
    assert.match(run.summary.plan.sha256, /^[a-f0-9]{64}$/);
    assert.match(run.summary.json.sha256, /^[a-f0-9]{64}$/);
    assert.match(run.summary.evidenceChain, /^git:[a-f0-9]{40} -> plan:[a-f0-9]{64} -> json:[a-f0-9]{64} -> analyzer:valid$/);
    for (const stage of ["gitSha", "terraformVersion", "fmt", "init", "validate", "plan", "show", "analyzer"]) {
      assert.equal(run.summary.exitCodes[stage], 0);
    }
    assert.equal(run.summary.terraformVersion, "1.15.8");
    assert.equal(run.summary.providerVersion, "7.43.0");
    assert.equal(run.summary.actions.create, 26);
    assert.equal(run.summary.cleanupSucceeded, true);
    assert.equal(run.summary.artifactsRemaining, 0);
    assert.equal(run.summary.tfDataDirRestored, true);
    assert.equal(readdirSync(run.tempBase).length, 0);
    assert.doesNotMatch(JSON.stringify(run.calls), /SYNTHETIC-BILLING-ACCOUNT|SYNTHETIC-TOKEN-SECRET/);
  } finally { cleanupHarness(run); }
});

const failureCases = [
  ["fail_version", "terraform_version_failed", "terraformVersion"],
  ["fail_fmt", "terraform_fmt_failed", "fmt"],
  ["fail_init", "terraform_init_failed", "init"],
  ["fail_validate", "terraform_validate_failed", "validate"],
  ["fail_plan", "terraform_plan_failed", "plan"],
  ["plan_missing", "terraform_plan_missing", "plan"],
  ["plan_empty", "terraform_plan_empty", "plan"],
  ["fail_show", "terraform_show_failed", "show"],
  ["json_missing", "terraform_json_empty", "show"],
  ["json_empty", "terraform_json_empty", "show"],
  ["json_truncated", "analyzer_failed", "analyzer"],
  ["summary_nonconform", "analyzer_failed", "analyzer"],
];

for (const [scenario, errorCode, stage] of failureCases) {
  test(`contract harness fails closed and cleans for ${scenario}`, windowsOnly, () => {
    const run = invokeContract({ scenario });
    try {
      assert.equal(run.result.status, 1);
      assert.equal(run.summary.valid, false);
      assert.equal(run.summary.errorCode, errorCode);
      assert.equal(run.summary.stage, stage);
      assert.equal(run.summary.cleanupSucceeded, true);
      assert.equal(run.summary.artifactsRemaining, 0);
      assert.equal(run.summary.tfDataDirRestored, true);
      assert.equal(readdirSync(run.tempBase).length, 0);
      assert.doesNotMatch(`${run.result.stdout}${run.result.stderr}`, /SYNTHETIC-BILLING-ACCOUNT|SYNTHETIC-TOKEN-SECRET|Bearer/i);
      assert.ok(run.calls.filter(({ command }) => command === "plan").length <= 1);
    } finally { cleanupHarness(run); }
  });
}

test("contract harness rejects a wrong Git SHA before Terraform", windowsOnly, () => {
  const run = invokeContract({ expectedSha: "0".repeat(40) });
  try {
    assert.equal(run.result.status, 1);
    assert.equal(run.summary.errorCode, "git_sha_mismatch");
    assert.deepEqual(run.calls, []);
    assert.equal(run.summary.cleanupSucceeded, true);
  } finally { cleanupHarness(run); }
});

for (const tfvarsMode of ["missing", "empty"]) {
  test(`contract harness rejects ${tfvarsMode} tfvars`, windowsOnly, () => {
    const run = invokeContract({ tfvarsMode });
    try {
      assert.equal(run.result.status, 1);
      assert.equal(run.summary.errorCode, "tfvars_invalid");
      assert.deepEqual(run.calls, []);
    } finally { cleanupHarness(run); }
  });
}

test("contract harness rejects a temporary parent inside the repository", windowsOnly, () => {
  const run = invokeContract({ temporaryParent: repository });
  try {
    assert.equal(run.result.status, 1);
    assert.equal(run.summary.errorCode, "unsafe_temp_path");
    assert.deepEqual(run.calls, []);
  } finally { cleanupHarness(run); }
});

test("contract harness rejects the user profile and volume root as temporary parents", windowsOnly, () => {
  for (const unsafe of [homedir(), parse(repository).root]) {
    const run = invokeContract({ temporaryParent: unsafe });
    try {
      assert.equal(run.result.status, 1);
      assert.equal(run.summary.errorCode, "unsafe_temp_path");
      assert.deepEqual(run.calls, []);
    } finally { cleanupHarness(run); }
  }
});

test("wrapper source forbids unsafe command construction and mutating commands", async () => {
  const source = await (await import("node:fs/promises")).readFile(wrapper, "utf8");
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(source, /function Invoke-NativeChecked/);
  assert.match(source, /\$env:TF_DATA_DIR\s*=/);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /(?:&|Get-Command)\s+gcloud\b/i);
  assert.doesNotMatch(source, /"(?:apply|destroy|import|target|auto-approve)"/i);
});

test("fake Terraform and fixtures contain no cloud or network command", () => {
  const fake = readFileSync(resolve(here, "../fakes/fake-terraform.mjs"), "utf8");
  assert.doesNotMatch(fake, /\bgcloud\b|https?:\/\//i);
});
