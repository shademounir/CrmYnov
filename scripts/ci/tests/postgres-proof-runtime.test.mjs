import assert from "node:assert/strict";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { compilePostgresProof, createPostgresDocker, hashProofBytes } from "../postgres-proof-runtime.mjs";

// All adapters below are memory-only: no compiler, Docker, filesystem write,
// PostgreSQL, credentials or network is invoked by these unit contracts.
function compilationFixture(changes = {}) {
  const repository = resolve("synthetic-repository"), proofDirectory = resolve("synthetic-proof");
  const api = join(repository, "apps/api"), dependencies = join(repository, "node_modules"), testSource = join(api, "test/only.test.ts");
  const emitted = join(proofDirectory, "compiled/src/observed.js");
  const files = new Map([
    [join(api, "package.json"), JSON.stringify({ type: changes.moduleType ?? "commonjs" })],
    [join(api, "src/observed.ts"), "production-shaped-source"], [testSource, "synthetic-test-source"],
    [join(dependencies, "typescript/package.json"), '{"version":"5.9.2"}'],
    [join(repository, "package-lock.json"), "exact-lock"], [join(api, "prisma/schema.prisma"), "exact-schema"],
    [emitted, "actual-output-shaped-by-memory-fixture"],
  ]);
  const calls = [], links = [];
  const io = {
    platform: changes.platform ?? "linux", runtime: "v22.23.3", nodeExecutable: "synthetic-node",
    readdirSync(directory, options) {
      assert.deepEqual(options, { withFileTypes: true }); assert.equal(directory, join(api, "src"));
      return [{ name: "observed.ts", isDirectory: () => false, isFile: () => true }];
    },
    readFileSync(path) { assert.ok(files.has(path), `declared fixture read: ${path}`); return files.get(path); },
    writeFileSync(path, bytes, options) { assert.deepEqual(options, { flag: "wx" }); assert.equal(files.has(path), false); files.set(path, bytes); },
    symlinkSync(...args) { links.push(args); },
    statSync(path) { assert.ok(path.startsWith(join(proofDirectory, "compiled"))); return { size: changes.compiledBytes ?? 42 }; },
    execFileSync(executable, args, options) {
      calls.push({ executable, args, options });
      if (args.includes("--listEmittedFiles")) {
        if (changes.compileError) throw changes.compileError;
        if (changes.sourceChanged) files.set(join(api, "src/observed.ts"), "changed-during-compilation");
        return changes.compilation ?? `TSFILE: ${emitted}\n`;
      }
      if (changes.metadataError) throw changes.metadataError;
      return changes.metadata ?? '{"provider":"SpecificProvider","designParamTypes":["RealDependency"]}';
    },
  };
  const options = { repository, proofDirectory, testSource, errorPrefix: changes.errorPrefix ?? "reporting",
    metadataProgram: "exact production metadata program", metadataInputType: "module", ...changes.options };
  return { io, options, files, calls, links, emitted, dependencies, api };
}

test("compiled proof preserves exact compiler options, source hashes, metadata and emitted-byte manifest", () => {
  const f = compilationFixture(); const proof = compilePostgresProof(f.options, f.io);
  const configuration = JSON.parse(f.files.get(join(f.options.proofDirectory, "tsconfig-proof.json")));
  assert.deepEqual(configuration.files, [f.options.testSource]); assert.deepEqual(configuration.include, []); assert.deepEqual(configuration.exclude, []);
  assert.deepEqual(configuration.compilerOptions, { noEmit: false, emitDecoratorMetadata: true, experimentalDecorators: true, rootDir: f.api,
    outDir: join(f.options.proofDirectory, "compiled"), sourceMap: true, declaration: false, incremental: false });
  assert.equal(f.calls[0].options.timeout, 120_000); assert.equal(f.calls[0].options.maxBuffer, 8 * 1024 * 1024);
  assert.equal(f.calls[0].options.env, undefined, "compiler inherits instrumentation without rewriting environment");
  assert.deepEqual(f.calls[1].args, ["--input-type=module", "-e", f.options.metadataProgram]);
  assert.equal(f.calls[1].options.timeout, 30_000); assert.equal(f.calls[1].options.cwd, f.options.proofDirectory);
  assert.deepEqual(f.links, [[f.dependencies, join(f.options.proofDirectory, "node_modules"), "dir"]]);
  const manifest = JSON.parse(f.files.get(join(f.options.proofDirectory, "compiled-manifest.json")));
  assert.equal(manifest.moduleType, "commonjs"); assert.equal(manifest.compilerVersion, "5.9.2"); assert.equal(manifest.compiledBytes, 42);
  assert.equal(manifest.compiled[0].sha256, hashProofBytes(f.files.get(f.emitted))); assert.deepEqual(manifest.sources, proof.sourceHashes());
  assert.equal(manifest.decoratorMetadata.provider, "SpecificProvider"); assert.equal(manifest.packageLockSha256, undefined);
  for (const key of ["dependenciesReusedReadOnly", "noPrismaGeneration", "noSharedBuild"]) assert.equal(manifest[key], true);
});

test("recovery keeps CommonJS, lock/schema bindings and Windows dependency junction without generation", () => {
  const f = compilationFixture({ errorPrefix: "recovery", platform: "win32", options: { requireCommonJs: true, includeDatabaseBindings: true, metadataInputType: "commonjs" } });
  compilePostgresProof(f.options, f.io);
  const manifest = JSON.parse(f.files.get(join(f.options.proofDirectory, "compiled-manifest.json")));
  assert.equal(manifest.packageLockSha256, hashProofBytes("exact-lock")); assert.equal(manifest.prismaSchemaSha256, hashProofBytes("exact-schema"));
  assert.equal(f.links[0][2], "junction"); assert.equal(f.calls[1].args[0], "--input-type=commonjs");
  const forbidden = compilationFixture({ moduleType: "module", errorPrefix: "recovery", options: { requireCommonJs: true } });
  assert.throws(() => compilePostgresProof(forbidden.options, forbidden.io), /recovery_compilation_requires_commonjs/u);
  assert.equal(forbidden.calls.length, 0); assert.equal(forbidden.links.length, 0);
});

test("reporting retains its permitted module package and no recovery-only bindings", () => {
  const f = compilationFixture({ moduleType: "module" }); compilePostgresProof(f.options, f.io);
  assert.equal(JSON.parse(f.files.get(join(f.options.proofDirectory, "compiled-manifest.json"))).moduleType, "module");
});

test("compilation and DI failures retain private diagnostics and the caller-specific error", () => {
  const error = Object.assign(new Error("compiler refused"), { stdout: "diagnostic output", stderr: "diagnostic error" });
  for (const prefix of ["reporting", "recovery"]) {
    const f = compilationFixture({ errorPrefix: prefix, compileError: error, options: { includeCompilationCause: prefix === "reporting" } });
    assert.throws(() => compilePostgresProof(f.options, f.io), failure => {
      assert.equal(failure.message, `${prefix}_compilation_failed_private_proof:${f.options.proofDirectory}`);
      assert.equal(failure.cause, prefix === "reporting" ? error : undefined); return true;
    });
    assert.equal(f.files.get(join(f.options.proofDirectory, "compile-failure.log")), "diagnostic output\ndiagnostic error");
    const metadata = compilationFixture({ errorPrefix: prefix, metadataError: error });
    assert.throws(() => compilePostgresProof(metadata.options, metadata.io), new RegExp(`${prefix}_metadata_qualification_failed_private_proof`, "u"));
    assert.equal(metadata.files.get(join(metadata.options.proofDirectory, "qualification-failure.log")), "diagnostic output\ndiagnostic error");
    assert.equal(metadata.files.has(join(metadata.options.proofDirectory, "compiled-manifest.json")), false);
  }
});

test("fresh source integrity and emitted-file bounds fail before a qualified manifest", () => {
  const changed = compilationFixture({ sourceChanged: true });
  assert.throws(() => compilePostgresProof(changed.options, changed.io), /reporting_compile_source_changed/u);
  for (const compilation of ["no emitted files", `TSFILE: ${resolve("outside.js")}\n`]) {
    const f = compilationFixture({ compilation });
    assert.throws(() => compilePostgresProof(f.options, f.io), /reporting_emitted_path_invalid/u);
  }
  for (const changes of [{ compiledBytes: 16 * 1024 * 1024 + 1 }, { compilation: Array(2001).fill(`TSFILE: ${resolve("synthetic-proof/compiled/a.js")}`).join("\n") }]) {
    const f = compilationFixture(changes);
    assert.throws(() => compilePostgresProof(f.options, f.io), /reporting_compiled_output_exceeds_bound/u);
    assert.equal(f.files.has(join(f.options.proofDirectory, "compiled-manifest.json")), false);
  }
});

function dockerFixture(changes = {}) {
  const image = `sha256:${"a".repeat(64)}`, container = "crmy-synthetic-owned", nonce = "synthetic-nonce", nonceLabel = "test-nonce";
  const info = { Name: `/${container}`, Image: image, Config: { Labels: { [nonceLabel]: nonce } }, HostConfig: { Tmpfs: { "/var/lib/postgresql/data": "rw" } },
    Mounts: [{ Type: "tmpfs" }], NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } }, State: { Running: false } };
  changes.changeInfo?.(info);
  const calls = [], access = [];
  const io = { platform: changes.platform ?? "linux", statSync: () => ({ isFile: () => changes.regularFile ?? true }),
    accessSync: (...args) => access.push(args), execFileSync(executable, args, options) {
      calls.push({ executable, args, options });
      if (args[0] === "ps") return changes.occupied ? container : "";
      if (args[0] === "image") return changes.image ?? image;
      if (args[0] === "port") return changes.binding ?? "127.0.0.1:54321";
      assert.deepEqual(args, ["inspect", container]); return JSON.stringify([info]);
    } };
  return { io, calls, access, info, image, options: { errorPrefix: "recovery", container, nonce, nonceLabel } };
}

test("Docker uses the actual platform executable, local pinned image and exact loopback/tmpfs ownership", () => {
  for (const platform of ["linux", "win32"]) {
    const f = dockerFixture({ platform }), client = createPostgresDocker(f.options, f.io);
    client.assertContainerAvailable(); assert.equal(client.pinImage(), f.image); assert.equal(client.loopbackBinding(f.image), "127.0.0.1:54321");
    assert.equal(client.ownedContainer(f.image).State.Running, false);
    assert.equal(f.access[0][1], platform === "win32" ? constants.F_OK : constants.X_OK);
    assert.equal(f.calls[0].executable, platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "/usr/bin/docker");
    for (const call of f.calls) { assert.equal(call.options.timeout, 90_000); assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]); }
    assert.ok(f.calls.every(call => !["run", "rm", "pull", "stop"].includes(call.args[0])));
  }
});

test("Docker refuses unsupported executables, occupied names and unverified images", () => {
  for (const changes of [{ platform: "darwin" }, { regularFile: false }]) {
    const f = dockerFixture(changes); assert.throws(() => createPostgresDocker(f.options, f.io), /recovery_docker_unsupported/u); assert.equal(f.calls.length, 0);
  }
  const occupied = dockerFixture({ occupied: true }); assert.throws(() => createPostgresDocker(occupied.options, occupied.io).assertContainerAvailable(), /recovery_container_name_occupied/u);
  const unpinned = dockerFixture({ image: "postgres:17.6-bookworm" }); assert.throws(() => createPostgresDocker(unpinned.options, unpinned.io).pinImage(), /recovery_postgres_image_unverified/u);
});

test("ownership rejects foreign names/nonces/images, persistent mounts and unexpected tmpfs", () => {
  const variants = [v => { v.Name = "/foreign"; }, v => { v.Config.Labels["test-nonce"] = "foreign"; }, v => { v.Image = `sha256:${"b".repeat(64)}`; },
    v => { v.Mounts = [{ Type: "volume" }]; }, v => { v.HostConfig.Tmpfs["/extra"] = "rw"; }, v => { v.HostConfig.Tmpfs["/var/lib/postgresql/data"] = "ro"; },
    v => { delete v.HostConfig.Tmpfs; }];
  for (const changeInfo of variants) {
    const f = dockerFixture({ changeInfo }); assert.throws(() => createPostgresDocker(f.options, f.io).ownedContainer(f.image), /recovery_container_identity_mismatch/u);
  }
});

test("loopback refuses public/multiple/mismatched published bindings and rechecks ownership", () => {
  for (const binding of ["0.0.0.0:54321", "127.0.0.1:54321\n[::]:54321"]) {
    const f = dockerFixture({ binding }); assert.throws(() => createPostgresDocker(f.options, f.io).loopbackBinding(f.image), /recovery_port_invalid/u);
  }
  for (const ports of [undefined, [], [{ HostIp: "0.0.0.0", HostPort: "54321" }], [{ HostIp: "127.0.0.1", HostPort: "54322" }],
    [{ HostIp: "127.0.0.1", HostPort: "54321" }, { HostIp: "127.0.0.1", HostPort: "54321" }]]) {
    const f = dockerFixture({ changeInfo: v => { v.NetworkSettings.Ports["5432/tcp"] = ports; } });
    assert.throws(() => createPostgresDocker(f.options, f.io).loopbackBinding(f.image), /recovery_loopback_binding_invalid/u);
  }
});
