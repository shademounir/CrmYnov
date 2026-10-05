import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";
import { compilePostgresProof, createPostgresDocker, hashProofBytes as hash } from "./postgres-proof-runtime.mjs";

// Recovery writes only to this runner's fresh nonce-bound loopback tmpfs. No
// recipe, preserved volume, shared DEV URL or Gmail delivery is reused.
if (process.env.DATABASE_URL) throw new Error("recovery_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("recovery_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY161_RECOVERY_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy161-recovery-"));
const apiDirectory = resolve(repository, "apps/api");
const testSource = resolve(apiDirectory, "test/integration/access-recovery-postgres.test.ts");
// Inspect actual production decorator metadata before creating either API.
const { sourceHashes, sourcesBefore } = compilePostgresProof({ repository, proofDirectory, testSource, errorPrefix: "recovery",
  requireCommonJs: true, includeDatabaseBindings: true, metadataInputType: "commonjs", metadataProgram: `require('reflect-metadata');
  const { AccessRecoveryService } = require('./compiled/src/access-recovery/access-recovery.service.js');
  const { AccessRecoveryController } = require('./compiled/src/access-recovery/access-recovery.controller.js');
  const { AccessRecoveryRateLimitGuard } = require('./compiled/src/access-recovery/access-recovery-rate-limit.guard.js');
  const providers = [
    [AccessRecoveryService, ['LocalIdentityDirectory','LocalRecoveryChallengeStore','LocalCredentialAdapter','RateLimitService','PrismaService','DynamicPermissionRepository','GmailInvitationSender']],
    [AccessRecoveryController, ['AccessRecoveryService']],
    [AccessRecoveryRateLimitGuard, ['AccessRecoveryService']],
  ];
  const results = providers.map(([provider, expected]) => {
    const names = (Reflect.getMetadata('design:paramtypes', provider) ?? []).map(value => value?.name);
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('recovery_compiled_metadata_invalid');
    return { provider: provider.name, designParamTypes: names };
  });
  console.log(JSON.stringify(results));` });
const nonce = randomUUID(), container = `crmy161-recovery-ci-${nonce}`, database = "crmy161_recovery_synthetic";
const { docker, ownedContainer, assertContainerAvailable, pinImage, loopbackBinding } = createPostgresDocker({ errorPrefix: "recovery", container, nonce, nonceLabel: "crmy161-recovery-test-nonce" });
let created = false, image;
await withPreservedCleanup(async () => {
  assertContainerAvailable(); image = pinImage();
  docker(["run", "-d", "--pull", "never", "--name", container, "--label", `crmy161-recovery-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true; await waitForPostgres(container, docker);
  const binding = loopbackBinding(image);
  docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
    `CREATE SCHEMA crmy161_recovery_test_identity; CREATE TABLE crmy161_recovery_test_identity.marker(nonce text NOT NULL); INSERT INTO crmy161_recovery_test_identity.marker VALUES ('${nonce}');`]);
  const empty = docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "-Atc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]).trim();
  if (empty !== "0") throw new Error("recovery_database_not_empty");
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres@${binding}/${database}`, CRMY161_RECOVERY_EPHEMERAL_TEST: "true", CRMY161_RECOVERY_DATABASE_NONCE: nonce,
    CRM_BACKGROUND_WORKERS: "external", SHEETS_ENABLED: "false", CRM_ACCESS_RECOVERY_ENABLED: "true" };
  const run = { runtime: process.version, image, database, container, nonce, binding, generatedAt: new Date().toISOString(), twoApiInstances: true, sharedDatabaseUsed: false, realMailSent: false };
  writeFileSync(join(proofDirectory, "run-start.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env, stdio: "inherit", windowsHide: true, timeout: 120_000 });
  let output;
  try {
    // Includes the real common response window and concurrent HTTP APIs. No
    // clock acceleration or delivery provider call is substituted by the runner.
    output = execFileSync(process.execPath, ["--test", "--test-concurrency=1", "compiled/test/integration/access-recovery-postgres.test.js"], {
      cwd: proofDirectory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 420_000,
    });
  } catch (error) {
    writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), error.stdout ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "postgres-test.stderr.log"), error.stderr ?? "", { flag: "wx" });
    writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: error.status ?? null, status: "FAILED" }, null, 2)}\n`, { flag: "wx" });
    throw new Error(`recovery_postgres_test_failed_private_proof:${proofDirectory}`);
  }
  writeFileSync(join(proofDirectory, "postgres-test.stdout.log"), output, { flag: "wx" });
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore)) throw new Error("recovery_test_source_changed");
  writeFileSync(join(proofDirectory, "run-result.json"), `${JSON.stringify({ ...run, exitCode: 0, status: "PASSED", stdoutSha256: hash(output) }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(output);
  console.log(JSON.stringify({ proof: "recovery-isolated-postgres", runtime: process.version, image, database, twoApiInstances: true, sharedDatabaseUsed: false, realMailSent: false }));
}, () => {
  if (created) {
    ownedContainer(image); docker(["stop", "--timeout", "60", container]);
    if (ownedContainer(image).State.Running) throw new Error("recovery_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ proof: "recovery-isolated-postgres-cleanup", container, preserved: true, stopped: true, tmpfsDatabaseNotABackup: true }));
  }
});
