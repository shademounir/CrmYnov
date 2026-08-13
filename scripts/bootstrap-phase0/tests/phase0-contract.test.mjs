import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzePhase0Contract, publicFailure } from "../phase0-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const positive = JSON.parse(await readFile(resolve(here, "../fixtures/positive.synthetic.json"), "utf8"));
const run = (patch = {}) => analyzePhase0Contract(structuredClone(Object.assign({}, positive, patch)), {
  mode: "SyntheticFixture",
  now: "2026-08-13T10:01:00.000Z",
});
const fails = (patch, code) => {
  let failure;
  try {
    run(patch);
  } catch (error) {
    failure = publicFailure(error);
  }
  assert.equal(failure?.errorCode, code);
};

test("positive synthetic evidence is redacted and non-mutating", () => {
  const result = run();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.mutated, false);
  assert.equal(result.cleanupSucceeded, true);
  assert.equal(result.operations.terraformCreates, 5);
  assert.equal(result.operations.quotaProjectConfigurations, 1);
  assert.doesNotMatch(JSON.stringify(result), /billingAccount|Authorization|token/i);
});

test("contract simulation is supported without a cloud executor", () => {
  const result = analyzePhase0Contract(positive, { mode: "ContractSimulation", now: "2026-08-13T10:01:00.000Z" });
  assert.equal(result.mode, "ContractSimulation");
  assert.equal(result.mutated, false);
});

test("wrong account is refused", () => fails({ humanIdentity: "wrong@example.invalid" }, "identity_mismatch"));
test("wrong organization is refused", () => fails({ organizationId: "000000000000" }, "organization_mismatch"));
test("wrong project id is refused", () => fails({ bootstrapProjectId: "wrong-project" }, "project_id_mismatch"));
test("missing billing id is refused", () => fails({ billingAccountPresent: false }, "billing_account_missing"));
test("extra API is refused", () => fails({ services: [...positive.services, "storage.googleapis.com"] }, "service_allowlist_mismatch"));
test("existing project is refused", () => fails({ projectAlreadyExists: true }, "project_already_exists"));
test("partial execution is refused", () => fails({ partialExecution: true }, "partial_execution_detected"));
test("double invocation is refused", () => fails({ previousAttempt: true }, "single_attempt_violation"));
test("concurrent invocation is refused", () => fails({ concurrentInvocation: true }, "single_attempt_violation"));
test("Terraform ownership conflict is refused", () => fails({ terraformOwners: { bootstrapProject: "foundation", foundationOwnsBootstrapProject: true } }, "terraform_ownership_conflict"));
test("cleanup failure is refused", () => fails({ observed: { ...positive.observed, cleanupSucceeded: false } }, "cleanup_failed"));
test("sensitive evidence is refused", () => fails({ startedAtUtc: "2026-08-13T10:00:00Z access_token" }, "sensitive_output"));
test("inverted timestamps are refused", () => fails({ startedAtUtc: "2026-08-14T10:00:00.000Z" }, "timestamp_order_invalid"));
