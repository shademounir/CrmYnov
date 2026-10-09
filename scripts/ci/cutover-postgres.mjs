import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePostgresProof, createPostgresDocker, hashProofBytes as hash } from "./postgres-proof-runtime.mjs";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";

if (process.env.DATABASE_URL) throw new Error("cutover_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("cutover_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY63_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy63-cutover-"));
const migrationId = "20261009070000_cutover_preparation";
const consumerMigrationId = "20261009090000_cutover_manual_catchup";
const schemaPath = resolve(repository, "apps/api/prisma/schema.prisma");
const newMigrations = [migrationId, consumerMigrationId].map(id => ({ id, sha256: hash(readFileSync(resolve(repository, `apps/api/prisma/migrations/${id}/migration.sql`))) }));
const bindings = () => ["package-lock.json", "apps/api/prisma/schema.prisma", ...[migrationId, consumerMigrationId].map(id => `apps/api/prisma/migrations/${id}/migration.sql`)].map(path => ({ path, sha256: hash(readFileSync(resolve(repository, path))) }));
const bindingsBefore = bindings();
const { sourceHashes, sourcesBefore } = compilePostgresProof({ repository, proofDirectory,
  testSource: resolve(repository, "apps/api/test/integration/cutover-postgres.test.ts"), errorPrefix: "cutover", requireCommonJs: true, includeDatabaseBindings: true,
  metadataInputType: "commonjs", metadataProgram: `require('reflect-metadata');
    const { CutoverService } = require('./compiled/src/cutover/cutover.service.js');
    const { CutoverController } = require('./compiled/src/cutover/cutover.controller.js');
    console.log(JSON.stringify([[CutoverService,['DynamicPermissionRepository','BootstrapImportService','SheetSource','PersistentIngestionService','ImportMappingService']],[CutoverController,['CutoverService']]].map(([provider,expected]) => {
      const names = (Reflect.getMetadata('design:paramtypes',provider) ?? []).map(value => value?.name);
      if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('cutover_compiled_metadata_invalid');
      return { provider: provider.name, designParamTypes: names };
    })));` });
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
  const sql = (db, statement) => docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atc", statement]).trim();
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`, CRMY63_EPHEMERAL_TEST: "true", CRMY63_DATABASE_NONCE: nonce,
    SHEETS_ENABLED: "false", CRM_BACKGROUND_WORKERS: "external", CRMY61_EPHEMERAL_TEST: "false" };
  sql(database, `CREATE SCHEMA crmy63_test_identity; CREATE TABLE crmy63_test_identity.marker(nonce text PRIMARY KEY,purpose text NOT NULL); INSERT INTO crmy63_test_identity.marker VALUES ('${nonce}','cutover-synthetic-qualification');`);
  if (sql(database, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") !== "0") throw new Error("cutover_database_not_empty");
  // Generate only private copies. No install/generate/build writes into shared dependency junctions.
  const legacyDirectory = join(proofDirectory, "legacy-prisma"); mkdirSync(legacyDirectory);
  const legacySchema = runNode(["-e", "process.stdout.write(require('node:child_process').execFileSync('git',['show','397883c46793c8cee5f71700df78b849722ac418:apps/api/prisma/schema.prisma'],{encoding:'utf8'}))"]);
  writeFileSync(join(legacyDirectory, "schema.prisma"), legacySchema, { flag: "wx" });
  cpSync(resolve(repository, "apps/api/prisma/migrations"), join(legacyDirectory, "migrations"), { recursive: true, filter: path => ![migrationId, consumerMigrationId].some(id => path.split(/[\\/]/u).includes(id)) });
  const legacyOutput = prisma(join(legacyDirectory, "schema.prisma"), env);
  writeFileSync(join(proofDirectory, "migration-legacy.log"), legacyOutput, { flag: "wx" });
  sql(database, `INSERT INTO system_probes(id) VALUES ('${nonce}');`);
  const oldHistory = sql(database, "SELECT migration_name || ':' || checksum FROM _prisma_migrations ORDER BY migration_name"), oldProbe = sql(database, "SELECT id::text || ':' || created_at::text FROM system_probes ORDER BY id");
  const populatedOutput = prisma(schemaPath, env);
  writeFileSync(join(proofDirectory, "migration-populated.log"), populatedOutput, { flag: "wx" });
  if (sql(database, "SELECT id::text || ':' || created_at::text FROM system_probes ORDER BY id") !== oldProbe) throw new Error("cutover_populated_data_changed");
  if (sql(database, `SELECT migration_name || ':' || checksum FROM _prisma_migrations WHERE migration_name NOT IN ('${migrationId}','${consumerMigrationId}') ORDER BY migration_name`) !== oldHistory) throw new Error("cutover_prisma_history_changed");
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
    (async()=>{try{if(await p.importCutoverManifest.count()!==0||await p.importCutoverReceipt.count()!==0||await p.importCutoverEffect.count()!==0)throw Error('ledger_not_empty');
      console.log(JSON.stringify({newClient:true,manifestCount:0,receiptCount:0}));}finally{await p.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});`;
  const smoke = [database, emptyDatabase].map(db => ({ database: db, result: JSON.parse(runNode(["-e", clientSmoke], { env: { ...env, DATABASE_URL: `postgresql://postgres@${binding}/${db}` } })) }));
  writeFileSync(join(proofDirectory, "migration-proof.json"), `${JSON.stringify({ migrations: newMigrations, checksumsAndFinishedHistoryVerifiedOnBothDatabases: true, emptyApplied: true, populatedApplied: true,
    preservedSystemProbe: true, preservedOldHistoryAndChecksums: true, oldMigrationCount: oldHistory.split("\n").length, isolatedGeneratedClient: smoke, noSharedGeneration: true }, null, 2)}\n`, { flag: "wx" });
  const run = { runtime: process.version, image, container, nonce, binding, generatedAt: new Date().toISOString(), database, emptyDatabase, realDataUsed: false, sheetsEnabled: false, bindings: bindingsBefore };
  writeFileSync(join(proofDirectory, "run-start.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  let output;
  try { output = runNode(["--test", "--test-concurrency=1", "compiled/test/integration/cutover-postgres.test.js"], { cwd: proofDirectory, env, timeout: 180000 }); }
  catch (error) {
    writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), error.stdout ?? "", { flag: "wx" }); writeFileSync(join(proofDirectory, "postgres-test.stderr.log"), error.stderr ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: error.status ?? null, status: "FAILED" }, null, 2)}\n`, { flag: "wx" });
    throw new Error(`cutover_postgres_test_failed_private_proof:${proofDirectory}`);
  }
  writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), output, { flag: "wx" });
  if (!/^# tests [1-9]\d*$/mu.test(output) || !/^# skipped 0$/mu.test(output) || !/^# fail 0$/mu.test(output)) throw new Error("cutover_test_did_not_execute_fully");
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore) || JSON.stringify(bindings()) !== JSON.stringify(bindingsBefore)) throw new Error("cutover_proof_source_changed");
  writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, status: "PASSED", exitCode: 0, stdoutSha256: hash(output) }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(output); console.log(JSON.stringify({ proof: "cutover-isolated-postgres", proofDirectory, generatedClientIsolated: true, oldHistoryPreserved: true, noSheetsActivation: true }));
}, () => {
  if (created) { ownedContainer(image); docker(["stop", "--timeout", "60", container]); if (ownedContainer(image).State.Running) throw new Error("cutover_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" }); }
});
