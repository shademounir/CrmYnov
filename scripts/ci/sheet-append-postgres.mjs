import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePostgresProof, createPostgresDocker, hashProofBytes as hash } from "./postgres-proof-runtime.mjs";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";

// The append proof owns a fresh, nonce-bound database. Never inherit a recipe,
// shared, DEV or PROD connection, source allowlist or private capture artifact.
if (process.env.DATABASE_URL) throw new Error("sheet_append_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("sheet_append_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY63_APPEND_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
for (let current = realpathSync(proofRoot); ; current = dirname(current)) {
  if (existsSync(join(current, ".git"))) throw new Error("sheet_append_private_proof_root_must_be_outside_git");
  if (dirname(current) === current) break;
}
const proofDirectory = mkdtempSync(join(proofRoot, "crmy63-sheet-append-"));
const artifactDirectory = mkdtempSync(join(proofRoot, "crmy63-sheet-append-artifacts-"));
// Keep the compiled application below its own root. The production private-file
// guard derives that root from the module path; compiling directly under TEMP
// would incorrectly make every sibling synthetic artifact look repository-local.
const applicationDirectory = join(proofDirectory, "application");
mkdirSync(applicationDirectory);
const testSource = resolve(repository, "apps/api/test/integration/sheet-append-postgres.test.ts");
const bindingPaths = ["package-lock.json", "apps/api/prisma/schema.prisma", "scripts/ci/sheet-append-postgres.mjs",
  "apps/api/prisma/migrations/20261010080000_sheet_row_append_boundary/migration.sql",
  "apps/api/prisma/migrations/20261010080000_sheet_row_append_boundary/rollback.md"];
const bindings = () => bindingPaths.map(path => ({ path, sha256: hash(readFileSync(resolve(repository, path))) }));
const bindingsBefore = bindings();
const { sourceHashes, sourcesBefore } = compilePostgresProof({ repository, proofDirectory: applicationDirectory, testSource, errorPrefix: "sheet_append",
  requireCommonJs: true, includeDatabaseBindings: true, metadataInputType: "commonjs", metadataProgram: `require('reflect-metadata');
  const { SheetImportExecutor } = require('./compiled/src/sheet-import/sheet-import-executor.js');
  const { SheetImportAdminService } = require('./compiled/src/sheet-import/sheet-import-admin.service.js');
  console.log(JSON.stringify([[SheetImportExecutor,['PrismaService','DynamicPermissionRepository','ImportMappingService','PersistentIngestionService','SheetSource','BootstrapImportService']],
    [SheetImportAdminService,['DynamicPermissionRepository','ImportMappingService','SheetSource','BootstrapImportService']]].map(([provider,expected]) => {
    const names = (Reflect.getMetadata('design:paramtypes',provider) ?? []).map(value => value?.name);
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('sheet_append_compiled_metadata_invalid');
    return { provider: provider.name, designParamTypes: names };
  })));` });
const nonce = randomUUID(), container = `crmy63-sheet-append-ci-${nonce}`, database = "crmy63_append_synthetic";
const { docker, ownedContainer, assertContainerAvailable, pinImage, loopbackBinding } = createPostgresDocker({
  errorPrefix: "sheet_append", container, nonce, nonceLabel: "crmy63-sheet-append-test-nonce" });
let created = false, image;
await withPreservedCleanup(async () => {
  assertContainerAvailable(); image = pinImage();
  docker(["run", "-d", "--pull", "never", "--name", container, "--label", `crmy63-sheet-append-test-nonce=${nonce}`,
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true; await waitForPostgres(container, docker);
  const binding = loopbackBinding(image);
  docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
    `CREATE SCHEMA crmy63_append_test_identity; CREATE TABLE crmy63_append_test_identity.marker(nonce text PRIMARY KEY,purpose text NOT NULL); INSERT INTO crmy63_append_test_identity.marker VALUES ('${nonce}','sheet-row-append-synthetic-qualification');`]);
  const empty = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-Atc",
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim();
  if (empty !== "0") throw new Error("sheet_append_database_not_empty");
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`,
    CRMY63_APPEND_EPHEMERAL_TEST: "true", CRMY63_APPEND_DATABASE_NONCE: nonce, CRMY63_APPEND_ARTIFACT_ROOT: artifactDirectory, CRM_BACKGROUND_WORKERS: "external",
    SHEETS_ENABLED: "false", SHEET_ROW_APPEND_ENABLED: "false", SHEET_CUTOVER_ENABLED: "false", FORMINATOR_WEBHOOK_ENABLED: "false",
    CRM_GOOGLE_SHEETS_ENABLED: "false", CRM_GOOGLE_SHEETS_CREDENTIALS_FILE: "", CRM_GOOGLE_SHEETS_ALLOWLIST_FILE: "",
    CRM_GOOGLE_SHEETS_AUTH_MODE: "", CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT: "",
    CRM_SHEET_APPEND_BOUNDARY_FILE: "", CRM_SHEET_APPEND_BOUNDARY_SHA256: "", CRM_SHEET_APPEND_QUALIFICATION_FILE: "",
    CRM_SHEET_APPEND_QUALIFICATION_SHA256: "", CRM_SHEET_APPEND_POLICY_QUALIFIED: "false" };
  const run = { runtime: process.version, image, container, nonce, binding, database, generatedAt: new Date().toISOString(),
    realSourceUsed: false, sharedDatabaseUsed: false, producerAttested: false, automaticActivationPerformed: false, artifactDirectory, bindings: bindingsBefore };
  writeFileSync(join(proofDirectory, "run-start.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  const migration = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"],
    { cwd: repository, env, encoding: "utf8", windowsHide: true, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(join(proofDirectory, "migration-execution.log"), migration, { flag: "wx" });
  let output;
  try {
    output = execFileSync(process.execPath, ["--test", "--test-concurrency=1", "compiled/test/integration/sheet-append-postgres.test.js"],
      { cwd: applicationDirectory, env, encoding: "utf8", windowsHide: true, timeout: 240_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), output, { flag: "wx" });
    if (!/^# tests [1-9]\d*$/mu.test(output) || !/^# skipped 0$/mu.test(output) || !/^# fail 0$/mu.test(output)) throw new Error("sheet_append_test_did_not_execute_fully");
    if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore) || JSON.stringify(bindings()) !== JSON.stringify(bindingsBefore)) throw new Error("sheet_append_test_source_changed");
  } catch (error) {
    writeFileSync(join(proofDirectory, "postgres-test.failure.stdout.log"), error.stdout ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "postgres-test.failure.stderr.log"), error.stderr ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: error.status ?? null, status: "FAILED" }, null, 2)}\n`, { flag: "wx" });
    throw new Error(`sheet_append_postgres_test_failed_private_proof:${proofDirectory}`);
  }
  writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: 0, status: "PASSED", stdoutSha256: hash(output) }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(output);
  console.log(JSON.stringify({ proof: "sheet-append-isolated-postgres", proofDirectory, realSourceUsed: false, sharedDatabaseUsed: false,
    producerAttested: false, automaticActivationPerformed: false }));
}, () => {
  if (created) {
    ownedContainer(image); docker(["stop", "--timeout", "60", container]);
    if (ownedContainer(image).State.Running) throw new Error("sheet_append_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" });
  }
});
