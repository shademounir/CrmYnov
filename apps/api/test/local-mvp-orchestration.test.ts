import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(process.cwd(), "../..");
const files = {
  compose: resolve(repositoryRoot, "compose.yaml"),
  dockerfile: resolve(repositoryRoot, "apps/api/Dockerfile"),
  script: resolve(repositoryRoot, "apps/api/scripts/local-mvp.ps1"),
  check: resolve(repositoryRoot, "apps/api/scripts/local-mvp-check.ts"),
};

test("local MVP compose isolates PostgreSQL and starts two hardened API instances", async () => {
  const compose = await readFile(files.compose, "utf8");
  assert.match(compose, /name: crmynov-local/);
  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /backend:\s*\r?\n\s*internal: true/);
  assert.match(compose, /migrate:[\s\S]*service_healthy/);
  assert.match(compose, /api-secondary:[\s\S]*profiles: \[multi-instance\]/);
  assert.match(compose, /service_completed_successfully/g);
  assert.match(compose, /health\/ready/g);
  const postgresService = compose.split(/^ {2}migrate:/m)[0] ?? "";
  assert.doesNotMatch(postgresService, /^ {4}ports:/m);
  assert.doesNotMatch(compose, /cloudsql|googleapis\.com|staging/i);
});

test("Windows runbook script refuses persistent databases and broad cleanup", async () => {
  const script = await readFile(files.script, "utf8");
  assert.match(script, /CRM_LOCAL_MODE/);
  assert.match(script, /crmynov-local_postgres-data/);
  assert.match(script, /Host -ne "postgres"/);
  assert.match(script, /ConfirmCleanup is required/);
  assert.match(script, /docker volume rm \$ExpectedVolume/);
  assert.doesNotMatch(script, /down[^\r\n]*--volumes|volume prune|system prune|rm -rf|wsl --unregister/i);
});

test("runtime probes cover persistence, two instances, seed replay and outbox concurrency", async () => {
  const [check, dockerfile] = await Promise.all([readFile(files.check, "utf8"), readFile(files.dockerfile, "utf8")]);
  assert.match(check, /api-secondary:3001\/health\/ready/);
  assert.match(check, /systemProbe\.upsert/);
  assert.match(check, /outbox_unique_concurrency_failed/);
  assert.match(check, /outbox_claim_concurrency_failed/);
  assert.match(check, /synthetic_seed_incomplete/);
  assert.match(check, /hostname !== "postgres"/);
  assert.match(dockerfile, /AS migration/);
  assert.match(dockerfile, /USER node:node/);
});
