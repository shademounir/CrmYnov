import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePostgresProof, createPostgresDocker, hashProofBytes as hash } from "./postgres-proof-runtime.mjs";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";
import { createInitialRollbackProof, cutoverMigrationSets } from "./cutover-initial-rollback.mjs";

if (process.env.DATABASE_URL) throw new Error("cutover_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("cutover_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY63_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy63-cutover-"));
const baselineRef = "397883c46793c8cee5f71700df78b849722ac418";
// The baseline object must exist in the checkout. No implicit fetch or guessed
// fallback: CI checks out full history, while local work remains read-only Git.
const git = args => execFileSync("git", args, { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
const migrationDirectory = resolve(repository, "apps/api/prisma/migrations");
const migrationSets = cutoverMigrationSets(git(["ls-tree", "-d", "--name-only", `${baselineRef}:apps/api/prisma/migrations`]).trim().split(/\r?\n/u),
  readdirSync(migrationDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(migrationDirectory, entry.name, "migration.sql"))).map(entry => entry.name));
if (migrationSets.legacy.length !== 47 || !["20261009070000_cutover_preparation", "20261009090000_cutover_manual_catchup"].every(id => migrationSets.added.includes(id))) throw new Error("cutover_baseline_migration_set_invalid");
for (const id of migrationSets.legacy) if (hash(readFileSync(join(migrationDirectory, id, "migration.sql"))) !== hash(git(["show", `${baselineRef}:apps/api/prisma/migrations/${id}/migration.sql`]))) throw new Error(`cutover_legacy_migration_changed:${id}`);
const schemaPath = resolve(repository, "apps/api/prisma/schema.prisma");
const newMigrations = migrationSets.added.map(id => ({ id, sha256: hash(readFileSync(join(migrationDirectory, id, "migration.sql"))) }));
const bindings = () => ["package-lock.json", "apps/api/prisma/schema.prisma", "scripts/ci/cutover-postgres.mjs", "scripts/ci/cutover-initial-rollback.mjs", "scripts/ci/tests/cutover-initial-rollback.test.mjs",
  ...[...migrationSets.legacy, ...migrationSets.added].map(id => `apps/api/prisma/migrations/${id}/migration.sql`)].map(path => ({ path, sha256: hash(readFileSync(resolve(repository, path))) }));
const bindingsBefore = bindings();
const gitAtStart = { head: git(["rev-parse", "HEAD"]).trim(), tree: git(["rev-parse", "HEAD^{tree}"]).trim(),
  status: git(["status", "--porcelain=v1", "--untracked-files=normal"]).trim() };
// HEAD is context only while sources are uncommitted. A final audit must match
// these complete byte bindings to the published commit, not relabel a WIP run.
writeFileSync(join(proofDirectory, "source-context.json"), `${JSON.stringify({ gitAtStart, sourcesMayDifferFromHead: gitAtStart.status.length > 0, bindings: bindingsBefore }, null, 2)}\n`, { flag: "wx" });
const unitOutput = execFileSync(process.execPath, ["--test", "scripts/ci/tests/cutover-initial-rollback.test.mjs"],
  { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
if (!/^# tests [1-9]\d*$/mu.test(unitOutput) || !/^# skipped 0$/mu.test(unitOutput) || !/^# fail 0$/mu.test(unitOutput)) throw new Error("cutover_rollback_contracts_did_not_execute_fully");
writeFileSync(join(proofDirectory, "rollback-unit-execution.log"), unitOutput, { flag: "wx" });
const unitProof = { runtime: process.version, tests: Number(unitOutput.match(/^# tests (\d+)$/mu)[1]), passed: true, skipped: 0, stdoutSha256: hash(unitOutput),
  bindings: bindingsBefore.filter(item => item.path.startsWith("scripts/ci/")) };
writeFileSync(join(proofDirectory, "rollback-unit-proof.json"), `${JSON.stringify(unitProof, null, 2)}\n`, { flag: "wx" });
const compilationOptions = { repository, proofDirectory, errorPrefix: "cutover", requireCommonJs: true, includeDatabaseBindings: true,
  metadataInputType: "commonjs", metadataProgram: `require('reflect-metadata');
    const { CutoverService } = require('./compiled/src/cutover/cutover.service.js');
    const { CutoverRuntimeService } = require('./compiled/src/cutover/cutover-runtime.service.js');
    const { CutoverController } = require('./compiled/src/cutover/cutover.controller.js');
    console.log(JSON.stringify([[CutoverService,['DynamicPermissionRepository','BootstrapImportService','SheetSource','PersistentIngestionService','ImportMappingService']],
      [CutoverRuntimeService,['DynamicPermissionRepository','BootstrapImportService','PersistentIngestionService','ImportMappingService','SheetSource']],
      [CutoverController,['CutoverService','CutoverRuntimeService']]].map(([provider,expected]) => {
      const names = (Reflect.getMetadata('design:paramtypes',provider) ?? []).map(value => value?.name);
      if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('cutover_compiled_metadata_invalid');
      return { provider: provider.name, designParamTypes: names };
    })));` };
const compiledProofs = [{ directory: proofDirectory, testFile: "compiled/test/integration/cutover-postgres.test.js",
  ...compilePostgresProof({ ...compilationOptions, testSource: resolve(repository, "apps/api/test/integration/cutover-postgres.test.ts") }) }];
const workerTest = resolve(repository, "apps/api/test/integration/cutover-worker-postgres.test.ts");
if (migrationSets.added.includes("20261009110000_cutover_runtime_worker") && !existsSync(workerTest)) throw new Error("cutover_worker_test_required");
if (existsSync(workerTest)) {
  const directory = join(proofDirectory, "worker-proof"); mkdirSync(directory);
  compiledProofs.push({ directory, testFile: "compiled/test/integration/cutover-worker-postgres.test.js",
    ...compilePostgresProof({ ...compilationOptions, proofDirectory: directory, testSource: workerTest }) });
}
const nonce = randomUUID(), container = `crmy63-cutover-ci-${nonce}`, database = "crmy63_cutover_synthetic", emptyDatabase = "crmy63_empty_synthetic";
const { docker, ownedContainer, assertContainerAvailable, pinImage, loopbackBinding } = createPostgresDocker({ errorPrefix: "cutover", container, nonce, nonceLabel: "crmy63-cutover-test-nonce" });
const runNode = (args, options = {}) => execFileSync(process.execPath, args, { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 120000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, ...options });
const prisma = (schema, env) => runNode(["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", schema], { env });
let created = false, image;
await withPreservedCleanup(async () => {
  assertContainerAvailable(); image = pinImage();
  docker(["run", "-d", "--pull", "never", "--name", container, "--label", `crmy63-cutover-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true; await waitForPostgres(container, docker); const binding = loopbackBinding(image);
  // Full-row/privilege snapshots can exceed Windows' argv limit. Stream SQL to
  // the already-owned container instead of using a shell or command-line text.
  const sql = (db, statement) => execFileSync(process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "/usr/bin/docker",
    ["exec", "-i", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-At", "--file=-"],
    { input: statement, encoding: "utf8", windowsHide: true, timeout: 90_000, maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trim();
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`, CRMY63_EPHEMERAL_TEST: "true", CRMY63_DATABASE_NONCE: nonce,
    SHEETS_ENABLED: "false", CRM_BACKGROUND_WORKERS: "external", CRMY61_EPHEMERAL_TEST: "false" };
  sql(database, `CREATE SCHEMA crmy63_test_identity; CREATE TABLE crmy63_test_identity.marker(nonce text PRIMARY KEY,purpose text NOT NULL); INSERT INTO crmy63_test_identity.marker VALUES ('${nonce}','cutover-synthetic-qualification');`);
  if (sql(database, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") !== "0") throw new Error("cutover_database_not_empty");
  // Generate only private copies. No install/generate/build writes into shared dependency junctions.
  const legacyDirectory = join(proofDirectory, "legacy-prisma"); mkdirSync(legacyDirectory);
  const legacySchema = git(["show", `${baselineRef}:apps/api/prisma/schema.prisma`]);
  writeFileSync(join(legacyDirectory, "schema.prisma"), legacySchema, { flag: "wx" });
  cpSync(migrationDirectory, join(legacyDirectory, "migrations"), { recursive: true, filter: path => !migrationSets.added.some(id => path.split(/[\\/]/u).includes(id)) });
  const legacyOutput = prisma(join(legacyDirectory, "schema.prisma"), env);
  writeFileSync(join(proofDirectory, "migration-legacy.log"), legacyOutput, { flag: "wx" });
  sql(database, `INSERT INTO system_probes(id) VALUES ('${nonce}');`);
  const rollback = createInitialRollbackProof({ docker, ownedContainer, image, container, nonce, database, proofDirectory, sql });
  const initialBackup = rollback.prepare();
  const oldHistory = sql(database, "SELECT migration_name || ':' || checksum FROM _prisma_migrations ORDER BY migration_name"), oldProbe = sql(database, "SELECT id::text || ':' || created_at::text FROM system_probes ORDER BY id");
  const populatedOutput = prisma(schemaPath, env);
  writeFileSync(join(proofDirectory, "migration-populated.log"), populatedOutput, { flag: "wx" });
  if (sql(database, "SELECT id::text || ':' || created_at::text FROM system_probes ORDER BY id") !== oldProbe) throw new Error("cutover_populated_data_changed");
  if (sql(database, `SELECT migration_name || ':' || checksum FROM _prisma_migrations WHERE migration_name NOT IN (${migrationSets.added.map(id => `'${id}'`).join(",")}) ORDER BY migration_name`) !== oldHistory) throw new Error("cutover_prisma_history_changed");
  for (const migration of newMigrations) if (sql(database, `SELECT checksum FROM _prisma_migrations WHERE migration_name='${migration.id}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`) !== migration.sha256) throw new Error(`cutover_new_checksum_mismatch:${migration.id}`);
  docker(["exec", container, "createdb", "-h", "127.0.0.1", "-U", "postgres", emptyDatabase]);
  const emptyOutput = prisma(schemaPath, { ...env, DATABASE_URL: `postgresql://postgres@${binding}/${emptyDatabase}` });
  writeFileSync(join(proofDirectory, "migration-empty.log"), emptyOutput, { flag: "wx" });
  for (const migration of newMigrations) if (sql(emptyDatabase, `SELECT checksum FROM _prisma_migrations WHERE migration_name='${migration.id}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`) !== migration.sha256) throw new Error(`cutover_empty_checksum_mismatch:${migration.id}`);
  // Fresh client generation is isolated too, then queried against both actual migrated schemas.
  const clientDirectory = join(proofDirectory, "generated-client"), clientSchema = join(proofDirectory, "schema-client.prisma");
  writeFileSync(clientSchema, readFileSync(schemaPath, "utf8").replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(clientDirectory)}`), { flag: "wx" });
  const generate = runNode(["node_modules/prisma/build/index.js", "generate", "--schema", clientSchema], { env });
  writeFileSync(join(proofDirectory, "private-client-generation.log"), generate, { flag: "wx" });
  const clientSmoke = `const {PrismaClient}=require(${JSON.stringify(clientDirectory)}); const p=new PrismaClient();
    (async()=>{try{const counts={manifests:await p.importCutoverManifest.count(),receipts:await p.importCutoverReceipt.count(),effects:await p.importCutoverEffect.count(),
      runtimes:await p.importCutoverRuntime.count(),runtimeRuns:await p.importCutoverRuntimeRun.count(),runtimeReceipts:await p.importCutoverRuntimeReceipt.count()};
      if(Object.values(counts).some(count=>count!==0))throw Error('ledger_not_empty');
      console.log(JSON.stringify({newClient:true,counts}));}finally{await p.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});`;
  const smoke = [database, emptyDatabase].map(db => ({ database: db, result: JSON.parse(runNode(["-e", clientSmoke], { env: { ...env, DATABASE_URL: `postgresql://postgres@${binding}/${db}` } })) }));
  writeFileSync(join(proofDirectory, "migration-proof.json"), `${JSON.stringify({ migrations: newMigrations, checksumsAndFinishedHistoryVerifiedOnBothDatabases: true, emptyApplied: true, populatedApplied: true,
    preservedSystemProbe: true, preservedOldHistoryAndChecksums: true, oldMigrationCount: oldHistory.split("\n").length, isolatedGeneratedClient: smoke, noSharedGeneration: true }, null, 2)}\n`, { flag: "wx" });
  const run = { runtime: process.version, image, container, nonce, binding, generatedAt: new Date().toISOString(), database, emptyDatabase, baselineRef,
    initialBackup, gitAtStart, sourcesMayDifferFromHead: gitAtStart.status.length > 0, unitProof, compiledProofCount: compiledProofs.length,
    realDataUsed: false, sheetsEnabled: false, bindings: bindingsBefore };
  writeFileSync(join(proofDirectory, "run-start.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  let output;
  try {
    output = compiledProofs.map(proof => {
      const result = runNode(["--test", "--test-concurrency=1", proof.testFile], { cwd: proof.directory, env, timeout: 180000 });
      writeFileSync(join(proof.directory, "integration-execution.log"), result, { flag: "wx" });
      if (!/^# tests [1-9]\d*$/mu.test(result) || !/^# skipped 0$/mu.test(result) || !/^# fail 0$/mu.test(result)) throw new Error("cutover_test_did_not_execute_fully");
      return result;
    }).join("\n");
  }
  catch (error) {
    writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), error.stdout ?? "", { flag: "wx" }); writeFileSync(join(proofDirectory, "postgres-test.stderr.log"), error.stderr ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: error.status ?? null, status: "FAILED" }, null, 2)}\n`, { flag: "wx" });
    throw new Error(`cutover_postgres_test_failed_private_proof:${proofDirectory}`);
  }
  writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), output, { flag: "wx" });
  if (!/^# tests [1-9]\d*$/mu.test(output) || !/^# skipped 0$/mu.test(output) || !/^# fail 0$/mu.test(output)) throw new Error("cutover_test_did_not_execute_fully");
  const restoration = rollback.restoreAndVerify();
  if (compiledProofs.some(proof => JSON.stringify(proof.sourceHashes()) !== JSON.stringify(proof.sourcesBefore)) || JSON.stringify(bindings()) !== JSON.stringify(bindingsBefore)) throw new Error("cutover_proof_source_changed");
  writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, status: "PASSED", exitCode: 0, stdoutSha256: hash(output), restoration }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(output); console.log(JSON.stringify({ proof: "cutover-isolated-postgres", proofDirectory, generatedClientIsolated: true, oldHistoryPreserved: true, noSheetsActivation: true, initialRollbackRestoredToNewClone: true }));
}, () => {
  if (created) { ownedContainer(image); docker(["stop", "--timeout", "60", container]); if (ownedContainer(image).State.Running) throw new Error("cutover_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" }); }
});
