import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = file => readFile(new URL("../../../" + file, import.meta.url), "utf8");

test("personal telephony integration gate runs authenticated and concurrent real PostgreSQL proofs without inheriting a database", async () => {
  const workflow = await read(".github/workflows/application-quality.yml");
  const integration = workflow.match(/\n  integration-tests:[\s\S]+?(?=\n  playwright:)/)?.[0] ?? "";
  assert.match(integration, /node scripts\/ci\/personal-telephony-postgres\.mjs/u);
  const runner = await read("scripts/ci/personal-telephony-postgres.mjs");
  assert.match(runner, /personal_telephony_must_not_inherit_database/u);
  assert.match(runner, /C:\/Program Files\/Docker\/Docker\/resources\/bin\/docker\.exe/u);
  assert.match(runner, /\/usr\/bin\/docker/u);
  assert.match(runner, /accessSync\(dockerExecutable/u);
  assert.match(runner, /127\\\.0\\\.0\\\.1:\\d/u);
  assert.match(runner, /crmy171_test_identity\.marker/u);
  assert.match(runner, /CRMY176_EPHEMERAL_TEST: "true"/u);
  assert.match(runner, /CRMY171_DATABASE_NONCE: nonce/u);
  assert.match(runner, /telephony-own-http-postgres\.test\.ts/u);
  assert.match(runner, /telephony-own-concurrency-postgres\.test\.ts/u);
  assert.match(runner, /--test-concurrency=1/u);
  assert.match(runner, /personal_telephony_container_identity_mismatch/u);
  assert.doesNotMatch(runner, /migrate.*reset|seed:local|\["rm"/u);
});

test("personal telephony PostgreSQL proofs participate in canonical Sonar native coverage", async () => {
  const runner = await read("scripts/ci/coverage-runner.mjs");
  assert.match(runner, /telephony-own-http-postgres\.test\.ts/u);
  assert.match(runner, /telephony-own-concurrency-postgres\.test\.ts/u);
  assert.match(runner, /CRMY176_EPHEMERAL_TEST: "true", CRMY171_DATABASE_NONCE: nonce/u);
  assert.match(runner, /await verifyDatabase\(direct, nonce\)/u);
});
