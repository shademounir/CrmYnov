import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { collectTypeScriptInputs } from "../postgres-proof-runtime.mjs";

const runnerUrl = new URL("../access-recovery-postgres.mjs", import.meta.url);
const readRunner = () => readFile(runnerUrl, "utf8");
const entry = (name, kind) => ({ name, isDirectory: () => kind === "directory", isFile: () => kind === "file" });

// Only pure shared discovery is exercised; the startup runner is not imported.
function orderedInputs(directories, testSource) {
  return collectTypeScriptInputs("synthetic-api", testSource, (directory, options) => {
    assert.equal(options.withFileTypes, true);
    assert.ok(directories.has(directory), "only the declared in-memory directories may be read");
    return directories.get(directory);
  });
}

test("recovery manifest discovers real TypeScript inputs in explicit lexicographic order", async () => {
  const source = join("synthetic-api", "src"), nested = join(source, "access-recovery");
  const testSource = join("synthetic-api", "test/integration/access-recovery-postgres.test.ts");
  const directories = new Map([
    [source, [entry("é.ts", "file"), entry("a.ts", "file"), entry("access-recovery", "directory"), entry("Z.ts", "file"), entry("ignored.js", "file"), entry("linked.ts", "link")]],
    [nested, [entry("😀.ts", "file"), entry("A.ts", "file")]],
  ]);
  assert.deepEqual(await orderedInputs(directories, testSource), [join(source, "Z.ts"), join(source, "a.ts"), join(nested, "A.ts"), join(nested, "😀.ts"), join(source, "é.ts"), testSource]);
});

test("recovery manifest retains equal entries and fails closed on source discovery errors", async () => {
  const source = join("synthetic-api", "src"), duplicate = join(source, "same.ts");
  assert.deepEqual(await orderedInputs(new Map([[source, [entry("same.ts", "file")]]]), duplicate), [duplicate, duplicate]);
  assert.throws(() => orderedInputs(new Map(), "synthetic-test.ts"), /declared in-memory directories/u);
});

test("recovery compilation binds fresh sources and emitted CJS metadata without generation or unrelated tests", async () => {
  const runner = await readRunner();
  for (const marker of ["recovery_repository_cwd_required", 'requireCommonJs: true', 'includeDatabaseBindings: true', 'metadataInputType: "commonjs"',
    "compilePostgresProof", 'errorPrefix: "recovery"', "recovery_test_source_changed", "AccessRecoveryService", "AccessRecoveryController", "AccessRecoveryRateLimitGuard",
    "DynamicPermissionRepository", "GmailInvitationSender", 'flag: "wx"', "compiled/test/integration/access-recovery-postgres.test.js"]) assert.ok(runner.includes(marker), marker);
  assert.doesNotMatch(runner, /reporting-freshness-postgres|ManagerDashboardService|prisma.*generate|shared.*build|npm ci/u);
});

test("recovery runner retains nonce-bound loopback isolation and targeted preserved cleanup", async () => {
  const runner = await readRunner();
  for (const marker of ["recovery_must_not_inherit_database", "createPostgresDocker", 'nonceLabel: "crmy161-recovery-test-nonce"', "recovery_database_not_empty",
    "loopbackBinding(image)", "assertContainerAvailable(); image = pinImage();", "crmy161_recovery_synthetic", "crmy161_recovery_test_identity.marker", 'CRMY161_RECOVERY_EPHEMERAL_TEST: "true"',
    "CRMY161_RECOVERY_DATABASE_NONCE: nonce", 'CRM_BACKGROUND_WORKERS: "external"', 'SHEETS_ENABLED: "false"', "withPreservedCleanup",
    '"127.0.0.1::5432"', '"--pull", "never"', "timeout: 420_000",
    'ownedContainer(image); docker(["stop", "--timeout", "60", container])', "tmpfsDatabaseNotABackup: true", "realMailSent: false"]) assert.ok(runner.includes(marker), marker);
  assert.doesNotMatch(runner, /migrate.*reset|seed:local|\["rm"|gcloud|terraform|docker\(\["pull"/u);
});

test("recovery runner explicitly enables only its isolated test contract, regardless of inherited feature state", async () => {
  const runner = await readRunner(), start = runner.indexOf("  const env = "), end = runner.indexOf("  const run = ", start);
  assert.ok(start >= 0 && end > start);
  for (const inherited of [undefined, "false", "TRUE", "true"]) {
    const inheritedEnv = inherited === undefined ? {} : { CRM_ACCESS_RECOVERY_ENABLED: inherited };
    const env = runInNewContext(`${runner.slice(start, end)}\nenv;`, { process: { env: inheritedEnv }, binding: "127.0.0.1:54321", database: "crmy161_recovery_synthetic", nonce: "synthetic-nonce" });
    assert.equal(env.CRM_ACCESS_RECOVERY_ENABLED, "true", "the runner must not inherit a disabled or ambiguous feature state");
    assert.equal(env.DATABASE_URL, "postgresql://postgres@127.0.0.1:54321/crmy161_recovery_synthetic");
    assert.equal(env.CRM_BACKGROUND_WORKERS, "external");
    assert.equal(env.SHEETS_ENABLED, "false");
  }
});

test("recovery PostgreSQL proof is required by integration and canonical coverage without weaker filters", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/application-quality.yml", import.meta.url), "utf8");
  const integration = workflow.slice(workflow.indexOf("  integration-tests:"), workflow.indexOf("  playwright:"));
  assert.match(integration, /run: node scripts\/ci\/access-recovery-postgres\.mjs/u);
  const coverage = await readFile(new URL("../coverage-runner.mjs", import.meta.url), "utf8");
  assert.match(coverage, /run\(process\.execPath, \["scripts\/ci\/access-recovery-postgres\.mjs"\]\)/u);
  const pkg = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["test:coverage"], "c8 --all --exclude-after-remap --include=apps/**/*.ts --include=apps/**/*.tsx --include=packages/**/*.ts --include=scripts/**/*.mjs --exclude=**/.next/** --exclude=**/dist/** --exclude=**/tests/** --exclude=**/test/** --reporter=text --reporter=lcov node scripts/ci/coverage-runner.mjs");
});
