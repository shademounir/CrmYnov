import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = resolve(here, "../run-foundation-plan.ps1");
const positive = resolve(here, "../fixtures/foundation-positive.synthetic.json");
const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";

function invoke(path, failure = "None") {
  return spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-SyntheticFixture", "-FixturePath", path, "-SyntheticFailure", failure], {
    encoding: "utf8",
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "", CLOUDSDK_CORE_PROJECT: "" },
  });
}

test("synthetic wrapper emits only the analyzer summary", { skip: process.platform !== "win32" && !process.env.CI }, () => {
  const result = invoke(positive);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.valid, true);
  assert.equal(output.actions.create, 31);
  assert.equal(output.sensitiveDataDetected, false);
});

for (const failure of ["Command", "PlanAbsent", "PlanEmpty", "JsonAbsent", "JsonEmpty", "Analyzer"]) {
  test(`synthetic wrapper fails closed for ${failure}`, { skip: process.platform !== "win32" && !process.env.CI }, () => {
    const result = invoke(positive, failure);
    assert.equal(result.status, 1);
    const output = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)).at(-1);
    assert.equal(output.valid, false);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /SYNTHETIC-BILLING-ACCOUNT|authorization|api[_-]?token/i);
  });
}

test("wrapper always cleans its isolated temporary directory", { skip: process.platform !== "win32" && !process.env.CI }, async () => {
  const { readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("crmynov-evidence-")));
  invoke(positive);
  invoke(positive, "Analyzer");
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith("crmynov-evidence-") && !before.has(name));
  assert.deepEqual(after, []);
});

test("synthetic wrapper refuses a path outside its fixture allowlist", { skip: process.platform !== "win32" && !process.env.CI }, () => {
  const result = invoke(resolve(here, "../../../package.json"));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { valid: false, errorCode: "wrapper_fail_closed", category: "wrapper" });
});

test("wrapper never contains a gcloud, apply, destroy, or import invocation", async () => {
  const source = await (await import("node:fs/promises")).readFile(wrapper, "utf8");
  assert.doesNotMatch(source, /(?:&|Get-Command)\s+gcloud\b/i);
  assert.doesNotMatch(source, /&\s+terraform[^\n]+\s(?:apply|destroy|import)\b/i);
});
