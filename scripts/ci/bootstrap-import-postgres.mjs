import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";
import { compilePostgresProof, createPostgresDocker, hashProofBytes as hash } from "./postgres-proof-runtime.mjs";

// Explicit isolated qualification only. Never inherit a recipe/DEV/PROD URL.
if (process.env.DATABASE_URL) throw new Error("bootstrap_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("bootstrap_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY61_BOOTSTRAP_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy61-bootstrap-"));
const apiDirectory = resolve(repository, "apps/api");
const testSource = resolve(apiDirectory, "test/integration/bootstrap-import-postgres.test.ts");
const fixturePaths = ["test/fixtures/import/historical-workbook.synthetic.ts", "test/fixtures/import/bootstrap-crash-child.ts"];
const fixtureHashes = () => fixturePaths.map(path => ({path, sha256: hash(readFileSync(resolve(apiDirectory, path)))}));
const fixtureSha256 = fixtureHashes();
const databaseBindings = () => ["package-lock.json", "apps/api/prisma/schema.prisma"].map(path => ({path,sha256:hash(readFileSync(resolve(repository,path)))}));
const bindingsBefore = databaseBindings();
const { sourceHashes, sourcesBefore } = compilePostgresProof({ repository, proofDirectory, testSource, errorPrefix: "bootstrap",
  requireCommonJs: true, includeDatabaseBindings: true, metadataInputType: "commonjs", metadataProgram: `require('reflect-metadata');
  const { BootstrapImportService } = require('./compiled/src/bootstrap-import/bootstrap-import.service.js');
  const { BootstrapImportController, BootstrapHistoricalNotesController } = require('./compiled/src/bootstrap-import/bootstrap-import.controller.js');
  const providers = [[BootstrapImportService,['DynamicPermissionRepository']], [BootstrapImportController,['BootstrapImportService']], [BootstrapHistoricalNotesController,['BootstrapImportService']]];
  console.log(JSON.stringify(providers.map(([provider, expected]) => {
    const names = (Reflect.getMetadata('design:paramtypes', provider) ?? []).map(value => value?.name);
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('bootstrap_compiled_metadata_invalid');
    return { provider: provider.name, designParamTypes: names };
  })));` });
const nonce = randomUUID(), container = `crmy61-bootstrap-ci-${nonce}`, database = "crmy61_bootstrap_synthetic";
const { docker, ownedContainer, assertContainerAvailable, pinImage, loopbackBinding } = createPostgresDocker({ errorPrefix: "bootstrap", container, nonce, nonceLabel: "crmy61-bootstrap-test-nonce" });
let created = false, image;
await withPreservedCleanup(async () => {
  assertContainerAvailable(); image = pinImage();
  docker(["run", "-d", "--pull", "never", "--name", container, "--label", `crmy61-bootstrap-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true; await waitForPostgres(container, docker);
  const binding = loopbackBinding(image);
  docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
    `CREATE SCHEMA crmy61_test_identity; CREATE TABLE crmy61_test_identity.marker(nonce text PRIMARY KEY, purpose text NOT NULL); INSERT INTO crmy61_test_identity.marker VALUES ('${nonce}', 'historical-bootstrap-synthetic-qualification');`]);
  const empty = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim();
  if (empty !== "0") throw new Error("bootstrap_database_not_empty");
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`, CRMY61_EPHEMERAL_TEST: "true", CRMY61_DATABASE_NONCE: nonce,
    CRM_BACKGROUND_WORKERS: "external", SHEETS_ENABLED: "false", CRMY61_UI_FIXTURE_DIR: "" };
  const run = { runtime: process.version, image, database, container, nonce, binding, fixtureSha256, generatedAt: new Date().toISOString(), sharedDatabaseUsed: false, realWorkbookUsed: false, realMailSent: false };
  writeFileSync(join(proofDirectory, "run-start.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env, stdio: "inherit", windowsHide: true, timeout: 120_000 });
  let output;
  try {
    output = execFileSync(process.execPath, ["--test", "--test-concurrency=1", "compiled/test/integration/bootstrap-import-postgres.test.js"], {
      cwd: proofDirectory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 420_000,
    });
  } catch (error) {
    writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), error.stdout ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "postgres-test.stderr.log"), error.stderr ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: error.status ?? null, status: "FAILED" }, null, 2)}\n`, { flag: "wx" });
    throw new Error(`bootstrap_postgres_test_failed_private_proof:${proofDirectory}`);
  }
  writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), output, { flag: "wx" });
  if (!/^# tests [1-9]\d*$/mu.test(output) || !/^# skipped 0$/mu.test(output) || !/^# fail 0$/mu.test(output)) throw new Error("bootstrap_test_did_not_execute_fully");
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore) || JSON.stringify(fixtureSha256) !== JSON.stringify(fixtureHashes()) || JSON.stringify(bindingsBefore) !== JSON.stringify(databaseBindings())) throw new Error("bootstrap_test_source_changed");
  writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: 0, status: "PASSED", stdoutSha256: hash(output) }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(output);
  console.log(JSON.stringify({ proof: "bootstrap-isolated-postgres", runtime: process.version, image, database, sharedDatabaseUsed: false, realWorkbookUsed: false, realMailSent: false }));
}, () => {
  if (created) {
    ownedContainer(image); docker(["stop", "--timeout", "60", container]);
    if (ownedContainer(image).State.Running) throw new Error("bootstrap_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ proof: "bootstrap-isolated-postgres-cleanup", container, preserved: true, stopped: true, tmpfsDatabaseNotABackup: true }));
  }
});
