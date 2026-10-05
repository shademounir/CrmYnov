// Shared mechanics only: importing this module does not compile or start Docker.
// Each caller retains its own test, DI contract, nonce, schema and cleanup flow.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export const hashProofBytes = bytes => createHash("sha256").update(bytes).digest("hex");

export function collectTypeScriptInputs(apiDirectory, testSource, readDirectory = readdirSync) {
  const sourceFiles = directory => readDirectory(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return sourceFiles(join(directory, entry.name));
    if (entry.isFile() && entry.name.endsWith(".ts")) return [join(directory, entry.name)];
    return [];
  });
  return [...sourceFiles(join(apiDirectory, "src")), testSource].sort((first, second) => {
    if (first < second) return -1;
    if (first > second) return 1;
    return 0;
  });
}

const compilationIO = { execFileSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
  platform: process.platform, runtime: process.version, nodeExecutable: process.execPath };

export function compilePostgresProof(options, io = compilationIO) {
  const { repository, proofDirectory, testSource, errorPrefix, metadataProgram, metadataInputType } = options;
  const apiDirectory = resolve(repository, "apps/api"), dependencyDirectory = resolve(repository, "node_modules");
  const compiledDirectory = join(proofDirectory, "compiled"), compiler = resolve(dependencyDirectory, "typescript/bin/tsc");
  const apiPackage = JSON.parse(io.readFileSync(join(apiDirectory, "package.json"), "utf8"));
  if (options.requireCommonJs && apiPackage.type === "module") throw new Error(`${errorPrefix}_compilation_requires_commonjs`);
  const moduleType = apiPackage.type === "module" ? "module" : "commonjs";
  const inputs = collectTypeScriptInputs(apiDirectory, testSource, io.readdirSync);
  const sourceHashes = () => inputs.map(path => ({ path: relative(repository, path).replaceAll("\\", "/"), sha256: hashProofBytes(io.readFileSync(path)) }));
  const sourcesBefore = sourceHashes();
  const configuration = { extends: resolve(apiDirectory, "tsconfig.json"), compilerOptions: {
    noEmit: false, emitDecoratorMetadata: true, experimentalDecorators: true, rootDir: apiDirectory,
    outDir: compiledDirectory, sourceMap: true, declaration: false, incremental: false,
  }, files: [testSource], include: [], exclude: [] };
  const configurationPath = join(proofDirectory, "tsconfig-proof.json");
  // Generated artifacts live only in the caller's fresh private proof directory.
  io.writeFileSync(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, { flag: "wx" });
  io.writeFileSync(join(proofDirectory, "package.json"), `${JSON.stringify({ private: true, type: moduleType })}\n`, { flag: "wx" });
  io.symlinkSync(dependencyDirectory, join(proofDirectory, "node_modules"), io.platform === "win32" ? "junction" : "dir");
  let compilation;
  try {
    compilation = io.execFileSync(io.nodeExecutable, [compiler, "--project", configurationPath, "--listEmittedFiles"], {
      encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    io.writeFileSync(join(proofDirectory, "compile-failure.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { flag: "wx" });
    throw new Error(`${errorPrefix}_compilation_failed_private_proof:${proofDirectory}`, options.includeCompilationCause ? { cause: error } : undefined);
  }
  io.writeFileSync(join(proofDirectory, "compile-output.log"), compilation, { flag: "wx" });
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(sourcesBefore)) throw new Error(`${errorPrefix}_compile_source_changed`);
  const emitted = compilation.split(/\r?\n/u).filter(line => line.startsWith("TSFILE: ")).map(line => resolve(line.slice(8)));
  if (!emitted.length || emitted.some(path => { const item = relative(compiledDirectory, path); return item.startsWith("..") || isAbsolute(item); })) throw new Error(`${errorPrefix}_emitted_path_invalid`);
  const compiledBytes = emitted.reduce((total, path) => total + io.statSync(path).size, 0);
  if (emitted.length > 2_000 || compiledBytes > 16 * 1024 * 1024) throw new Error(`${errorPrefix}_compiled_output_exceeds_bound`);
  // Inspect metadata emitted by the real compiler; callers supply only their
  // specific production provider contract, never a substitute provider/factory.
  let metadata;
  try {
    metadata = io.execFileSync(io.nodeExecutable, [`--input-type=${metadataInputType}`, "-e", metadataProgram],
      { cwd: proofDirectory, encoding: "utf8", windowsHide: true, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    io.writeFileSync(join(proofDirectory, "qualification-failure.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`, { flag: "wx" });
    throw new Error(`${errorPrefix}_metadata_qualification_failed_private_proof:${proofDirectory}`);
  }
  const databaseBindings = options.includeDatabaseBindings ? {
    packageLockSha256: hashProofBytes(io.readFileSync(join(repository, "package-lock.json"))),
    prismaSchemaSha256: hashProofBytes(io.readFileSync(join(apiDirectory, "prisma/schema.prisma"))),
  } : {};
  io.writeFileSync(join(proofDirectory, "compiled-manifest.json"), `${JSON.stringify({ runtime: io.runtime,
    compilerVersion: JSON.parse(io.readFileSync(join(dependencyDirectory, "typescript/package.json"), "utf8")).version, moduleType,
    configurationSha256: hashProofBytes(io.readFileSync(configurationPath)), ...databaseBindings, decoratorMetadata: JSON.parse(metadata), compiledBytes, sources: sourcesBefore,
    compiled: emitted.map(path => ({ path: relative(proofDirectory, path).replaceAll("\\", "/"), sha256: hashProofBytes(io.readFileSync(path)) })),
    dependenciesReusedReadOnly: true, noPrismaGeneration: true, noSharedBuild: true,
  }, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ proof: `${errorPrefix}-compiled-runtime-qualified`, proofDirectory, emittedFileCount: emitted.length, sourceFileCount: sourcesBefore.length, runtime: io.runtime }));
  return { sourceHashes, sourcesBefore };
}

const dockerIO = { execFileSync, statSync, accessSync, platform: process.platform };

export function createPostgresDocker(options, io = dockerIO) {
  const { errorPrefix, container, nonce, nonceLabel } = options;
  const dockerExecutable = io.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "/usr/bin/docker";
  if (!["win32", "linux"].includes(io.platform) || !io.statSync(dockerExecutable).isFile()) throw new Error(`${errorPrefix}_docker_unsupported`);
  io.accessSync(dockerExecutable, io.platform === "win32" ? constants.F_OK : constants.X_OK);
  const docker = args => io.execFileSync(dockerExecutable, args, { encoding: "utf8", windowsHide: true, timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
  const ownedContainer = image => {
    const info = JSON.parse(docker(["inspect", container]))[0], tmpfs = info.HostConfig.Tmpfs ?? {};
    if (info.Name !== `/${container}` || info.Config.Labels[nonceLabel] !== nonce || info.Image !== image
      || info.Mounts.some(mount => mount.Type !== "tmpfs") || Object.keys(tmpfs).length !== 1 || tmpfs["/var/lib/postgresql/data"] !== "rw") {
      throw new Error(`${errorPrefix}_container_identity_mismatch`);
    }
    return info;
  };
  return {
    docker, ownedContainer,
    assertContainerAvailable() {
      if (docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"] ).trim()) throw new Error(`${errorPrefix}_container_name_occupied`);
    },
    pinImage() {
      const image = docker(["image", "inspect", "postgres:17.6-bookworm", "--format", "{{.Id}}"] ).trim();
      if (!/^sha256:[a-f0-9]{64}$/u.test(image)) throw new Error(`${errorPrefix}_postgres_image_unverified`);
      return image;
    },
    loopbackBinding(image) {
      const binding = docker(["port", container, "5432/tcp"] ).trim();
      if (!/^127\.0\.0\.1:\d+$/u.test(binding)) throw new Error(`${errorPrefix}_port_invalid`);
      const ports = ownedContainer(image).NetworkSettings.Ports["5432/tcp"];
      if (ports?.length !== 1 || ports[0].HostIp !== "127.0.0.1" || `${ports[0].HostIp}:${ports[0].HostPort}` !== binding) throw new Error(`${errorPrefix}_loopback_binding_invalid`);
      return binding;
    },
  };
}
