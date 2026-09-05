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
  assert.match(script, /--force-recreate/);
  assert.match(script, /docker volume rm \$ExpectedVolume/);
  assert.doesNotMatch(script, /down[^\r\n]*--volumes|volume prune|system prune|rm -rf|wsl --unregister/i);
});

test("runtime probes cover persistence, two instances, seed replay and outbox concurrency", async () => {
  const [check, dockerfile] = await Promise.all([readFile(files.check, "utf8"), readFile(files.dockerfile, "utf8")]);
  assert.match(check, /CRM_SECONDARY_READY_URL/);
  assert.match(check, /localReadinessUrl/);
  assert.match(check, /systemProbe\.upsert/);
  assert.match(check, /outbox_unique_concurrency_failed/);
  assert.match(check, /outbox_claim_concurrency_failed/);
  assert.match(check, /synthetic_seed_incomplete/);
  assert.match(check, /hostname !== "postgres"/);
  assert.match(dockerfile, /FROM gcr\.io\/distroless\/nodejs22-debian13:nonroot@sha256:9a052c12c6501f1248b682bf6d022276220cb2a65416d215e0973527394d1552 AS runtime/);
  assert.match(dockerfile, /USER 65532:65532/);
  assert.match(dockerfile, /ENTRYPOINT \["\/nodejs\/bin\/node"\]/);
});

test("migration and explicit synthetic seed use the API image without shell or npm", async () => {
  const compose = await readFile(files.compose, "utf8");
  const migration = compose.split(/^ {2}migrate:/m)[1]?.split(/^ {2}seed:/m)[0] ?? "";
  const seed = compose.split(/^ {2}seed:/m)[1]?.split(/^ {2}api:/m)[0] ?? "";
  assert.match(migration, /image: crmynov-api:local/);
  assert.match(migration, /command: \["node_modules\/prisma\/build\/index.js", "migrate", "deploy", "--schema", "apps\/api\/prisma\/schema.prisma"\]/);
  assert.doesNotMatch(migration, /CRM_LOCAL_SEED_PASSWORD|db:prepare|target: migration/);
  assert.match(seed, /profiles: \[seed\]/);
  assert.match(seed, /image: crmynov-api:local/);
  assert.match(seed, /command: \["apps\/api\/dist-local\/prisma\/seed-local.js"\]/);
  assert.match(seed, /CRM_LOCAL_SEED_PASSWORD/);
  for (const service of [migration, seed]) {
    assert.match(service, /read_only: true/);
    assert.match(service, /cap_drop: \[ALL\]/);
    assert.match(service, /restart: "no"/);
    assert.doesNotMatch(service, /"npm"|"npx"|"sh"|"bash"/);
  }
});
