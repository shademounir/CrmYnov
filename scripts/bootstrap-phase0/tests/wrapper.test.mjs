import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../run-phase0.mjs");
const fixture = resolve(here, "../fixtures/positive.synthetic.json");
const lock = resolve(tmpdir(), "crmynov-phase0-code-only.lock");

function invoke(mode, fixturePath = fixture) {
  return spawnSync(process.execPath, [cli, "--mode", mode, "--fixture", fixturePath], { encoding: "utf8" });
}

test("SyntheticFixture succeeds and cleans its lock", async () => {
  const result = invoke("SyntheticFixture");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.mutated, false);
  assert.equal(evidence.operationEstimates.countersValidatedByRealPlan, false);
  await assert.rejects(access(lock));
});

test("ContractSimulation succeeds without GCP", () => {
  const result = invoke("ContractSimulation");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).mode, "ContractSimulation");
});

test("Real mode is fail-closed", () => {
  const result = invoke("Real");
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errorCode, "real_mode_disabled");
});

test("invalid fixture fails and cleans its lock", async () => {
  const result = invoke("SyntheticFixture", resolve(here, "missing.json"));
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).mutated, false);
  await assert.rejects(access(lock));
});
