import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";
import { compilePostgresProof, createPostgresDocker, hashProofBytes as hash } from "./postgres-proof-runtime.mjs";

// Independent disposable database; never inherit a shared, recipe or DEV URL.
// The official local/CI image is pinned by ID before starting this owned tmpfs.
if (process.env.DATABASE_URL) throw new Error("reporting_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("reporting_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY162_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy162-reporting-"));
const apiDirectory = resolve(repository, "apps/api");
const testSource = resolve(apiDirectory, "test/reporting-freshness-postgres.test.ts");
// Qualify the compiled real decorator metadata, without creating an API, DB or
// replacing any provider. The regular production TypeScript compiler emits it.
const { sourceHashes, sourcesBefore } = compilePostgresProof({ repository, proofDirectory, testSource, errorPrefix: "reporting",
  metadataInputType: "module", includeCompilationCause: true, metadataProgram: `import 'reflect-metadata';
  const { ManagerDashboardService } = await import('./compiled/src/reporting/manager-dashboard.service.js');
  const names = (Reflect.getMetadata('design:paramtypes', ManagerDashboardService) ?? []).map(value => value?.name);
  const expected = ['CommercialFunnelService','CommercialPerformanceService','SourceEffectivenessService','OperationalRiskService','SharedContributionService','LeadService','AuditService','ReportingPersistenceService'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('reporting_compiled_metadata_invalid');
  console.log(JSON.stringify({provider:'ManagerDashboardService',designParamTypes:names}));` });
const nonce = randomUUID(), container = `crmy162-ci-${nonce}`, database = "crmy162_reporting_synthetic";
const { docker, ownedContainer, assertContainerAvailable, pinImage, loopbackBinding } = createPostgresDocker({ errorPrefix: "reporting", container, nonce, nonceLabel: "crmy162-test-nonce" });
let created = false, image;
await withPreservedCleanup(async () => {
  assertContainerAvailable(); image = pinImage();
  docker(["run", "-d", "--name", container, "--label", `crmy162-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true; await waitForPostgres(container, docker);
  const binding = loopbackBinding(image);
  docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
    `CREATE SCHEMA crmy162_test_identity; CREATE TABLE crmy162_test_identity.marker(nonce text NOT NULL); INSERT INTO crmy162_test_identity.marker VALUES ('${nonce}');`]);
  const empty = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim();
  if (empty !== "0") throw new Error("reporting_database_not_empty");
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`, CRMY162_EPHEMERAL_TEST: "true", CRMY162_DATABASE_NONCE: nonce,
    CRM_BACKGROUND_WORKERS: "external", SHEETS_ENABLED: "false" };
  const run = { runtime: process.version, image, database, container, nonce, binding, generatedAt: new Date().toISOString(), twoApiInstances: true, sharedDatabaseUsed: false };
  writeFileSync(join(proofDirectory, "run-start.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  // Trust is restricted to the owned loopback binding: no password is stored or
  // printed. Random login credentials exist only inside the fixture's memory.
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env, stdio: "inherit", windowsHide: true, timeout: 120_000 });
  let output;
  try {
    output = execFileSync(process.execPath, ["--test", "--test-concurrency=1", "compiled/test/reporting-freshness-postgres.test.js"], {
      cwd: proofDirectory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 180_000,
    });
  } catch (error) {
    writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), error.stdout ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "postgres-test.stderr.log"), error.stderr ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: error.status ?? null, status: "FAILED" }, null, 2)}\n`, { flag: "wx" });
    throw new Error(`reporting_postgres_test_failed_private_proof:${proofDirectory}`);
  }
  writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), output, { flag: "wx" });
  writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: 0, status: "PASSED", stdoutSha256: hash(output) }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(output);
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore)) throw new Error("reporting_test_source_changed");
  console.log(JSON.stringify({ proof: "reporting-isolated-postgres", runtime: process.version, image, database, twoApiInstances: true, sharedDatabaseUsed: false }));
}, () => {
  if (created) {
    ownedContainer(image); docker(["stop", "--timeout", "60", container]);
    if (ownedContainer(image).State.Running) throw new Error("reporting_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" });
    // Preserve the stopped owned container for inspection; no preserved image,
    // volume or other worktree container is removed. Stopping discards tmpfs.
    console.log(JSON.stringify({ proof: "reporting-isolated-postgres-cleanup", container, preserved: true, stopped: true, tmpfsDatabaseNotABackup: true }));
  }
});
