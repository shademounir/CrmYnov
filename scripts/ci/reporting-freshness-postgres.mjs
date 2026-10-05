import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForPostgres } from "./postgres-readiness.mjs";
import { withPreservedCleanup } from "./preserved-cleanup.mjs";

// Independent disposable database; never inherit a shared, recipe or DEV URL.
// The official local/CI image is pinned by ID before starting this owned tmpfs.
if (process.env.DATABASE_URL) throw new Error("reporting_must_not_inherit_database");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (resolve(process.cwd()) !== repository) throw new Error("reporting_repository_cwd_required");
const proofRoot = resolve(process.env.CRMY162_PROOF_ROOT ?? process.env.RUNNER_TEMP ?? tmpdir());
mkdirSync(proofRoot, { recursive: true });
const proofDirectory = mkdtempSync(join(proofRoot, "crmy162-reporting-"));
const compiledDirectory = join(proofDirectory, "compiled");
const dependencyDirectory = resolve(repository, "node_modules");
const compiler = resolve(dependencyDirectory, "typescript/bin/tsc");
const apiDirectory = resolve(repository, "apps/api");
const apiPackage = JSON.parse(readFileSync(join(apiDirectory, "package.json"), "utf8"));
const moduleType = apiPackage.type === "module" ? "module" : "commonjs";
const testSource = resolve(apiDirectory, "test/reporting-freshness-postgres.test.ts");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(join(directory, entry.name))
  : entry.isFile() && entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
const inputs = [...sourceFiles(join(apiDirectory, "src")), testSource].sort();
const sourceHashes = () => inputs.map(path => ({ path: relative(repository, path).replaceAll("\\", "/"), sha256: hash(readFileSync(path)) }));
const sourcesBefore = sourceHashes();
const configuration = { extends: resolve(apiDirectory, "tsconfig.json"), compilerOptions: {
  noEmit: false, emitDecoratorMetadata: true, experimentalDecorators: true, rootDir: apiDirectory,
  outDir: compiledDirectory, sourceMap: true, declaration: false, incremental: false,
}, files: [testSource], include: [], exclude: [] };
const configurationPath = join(proofDirectory, "tsconfig-proof.json");
// These are private generated compiler artifacts, never tracked source/config.
writeFileSync(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, { flag: "wx" });
writeFileSync(join(proofDirectory, "package.json"), `${JSON.stringify({ private: true, type: moduleType })}\n`, { flag: "wx" });
symlinkSync(dependencyDirectory, join(proofDirectory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
let compilation;
try {
  compilation = execFileSync(process.execPath, [compiler, "--project", configurationPath, "--listEmittedFiles"], {
    encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  writeFileSync(join(proofDirectory, "compile-failure.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { flag: "wx" });
  throw new Error(`reporting_compilation_failed_private_proof:${proofDirectory}`, { cause: error });
}
writeFileSync(join(proofDirectory, "compile-output.log"), compilation, { flag: "wx" });
if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore)) throw new Error("reporting_compile_source_changed");
const emitted = compilation.split(/\r?\n/u).filter(line => line.startsWith("TSFILE: ")).map(line => resolve(line.slice(8)));
if (!emitted.length || emitted.some(path => { const item = relative(compiledDirectory, path); return item.startsWith("..") || isAbsolute(item); })) throw new Error("reporting_emitted_path_invalid");
const compiledBytes = emitted.reduce((total, path) => total + statSync(path).size, 0);
if (emitted.length > 2_000 || compiledBytes > 16 * 1024 * 1024) throw new Error("reporting_compiled_output_exceeds_bound");
// Qualify the compiled real decorator metadata, without creating an API, DB or
// replacing any provider. The regular production TypeScript compiler emits it.
let metadata;
try {
  metadata = execFileSync(process.execPath, ["--input-type=module", "-e", `import 'reflect-metadata';
  const { ManagerDashboardService } = await import('./compiled/src/reporting/manager-dashboard.service.js');
  const names = (Reflect.getMetadata('design:paramtypes', ManagerDashboardService) ?? []).map(value => value?.name);
  const expected = ['CommercialFunnelService','CommercialPerformanceService','SourceEffectivenessService','OperationalRiskService','SharedContributionService','LeadService','AuditService','ReportingPersistenceService'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('reporting_compiled_metadata_invalid');
  console.log(JSON.stringify({provider:'ManagerDashboardService',designParamTypes:names}));`],
  { cwd: proofDirectory, encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
} catch (error) {
  writeFileSync(join(proofDirectory, "qualification-failure.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { flag: "wx" });
  throw new Error(`reporting_metadata_qualification_failed_private_proof:${proofDirectory}`);
}
writeFileSync(join(proofDirectory, "compiled-manifest.json"), `${JSON.stringify({ runtime: process.version,
  compilerVersion: JSON.parse(readFileSync(join(dependencyDirectory, "typescript/package.json"), "utf8")).version, moduleType,
  configurationSha256: hash(readFileSync(configurationPath)), decoratorMetadata: JSON.parse(metadata), compiledBytes, sources: sourcesBefore,
  compiled: emitted.map(path => ({ path: relative(proofDirectory, path).replaceAll("\\", "/"), sha256: hash(readFileSync(path)) })),
  dependenciesReusedReadOnly: true, noPrismaGeneration: true, noSharedBuild: true,
}, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ proof: "reporting-compiled-runtime-qualified", proofDirectory, emittedFileCount: emitted.length, sourceFileCount: sourcesBefore.length, runtime: process.version }));
const nonce = randomUUID(), container = `crmy162-ci-${nonce}`, database = "crmy162_reporting_synthetic";
const dockerExecutable = process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "/usr/bin/docker";
if (!["win32", "linux"].includes(process.platform) || !statSync(dockerExecutable).isFile()) throw new Error("reporting_docker_unsupported");
accessSync(dockerExecutable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
const docker = args => execFileSync(dockerExecutable, args, { encoding: "utf8", windowsHide: true, timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
let created = false, image;
const ownedContainer = () => {
  const info = JSON.parse(docker(["inspect", container]))[0];
  const tmpfs = info.HostConfig.Tmpfs ?? {};
  if (info.Name !== `/${container}` || info.Config.Labels["crmy162-test-nonce"] !== nonce || info.Image !== image
    || info.Mounts.some(mount => mount.Type !== "tmpfs") || Object.keys(tmpfs).length !== 1 || tmpfs["/var/lib/postgresql/data"] !== "rw") {
    throw new Error("reporting_container_identity_mismatch");
  }
  return info;
};
await withPreservedCleanup(async () => {
  if (docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"] ).trim()) throw new Error("reporting_container_name_occupied");
  image = docker(["image", "inspect", "postgres:17.6-bookworm", "--format", "{{.Id}}"] ).trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(image)) throw new Error("reporting_postgres_image_unverified");
  docker(["run", "-d", "--name", container, "--label", `crmy162-test-nonce=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", `POSTGRES_DB=${database}`, image]);
  created = true; await waitForPostgres(container, docker);
  const binding = docker(["port", container, "5432/tcp"] ).trim();
  if (!/^127\.0\.0\.1:\d+$/u.test(binding)) throw new Error("reporting_port_invalid");
  const info = ownedContainer(), ports = info.NetworkSettings.Ports["5432/tcp"];
  if (ports?.length !== 1 || ports[0].HostIp !== "127.0.0.1" || `${ports[0].HostIp}:${ports[0].HostPort}` !== binding) throw new Error("reporting_loopback_binding_invalid");
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
    ownedContainer(); docker(["stop", "--timeout", "60", container]);
    if (ownedContainer().State.Running) throw new Error("reporting_owned_container_not_stopped");
    writeFileSync(join(proofDirectory, "cleanup-result.json"), `${JSON.stringify({ container, image, ownedNonceMatched: true, stopped: true, preserved: true, tmpfsDatabaseNotABackup: true }, null, 2)}\n`, { flag: "wx" });
    // Preserve the stopped owned container for inspection; no preserved image,
    // volume or other worktree container is removed. Stopping discards tmpfs.
    console.log(JSON.stringify({ proof: "reporting-isolated-postgres-cleanup", container, preserved: true, stopped: true, tmpfsDatabaseNotABackup: true }));
  }
});
