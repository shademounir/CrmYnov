import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CompiledApiLogCapture, compiledApiFailureDiagnostic, compiledBundleIdentity, type BundleIdentity } from "./helpers/compiled-api-diagnostics.js";
import { ownedApiBundle, type OwnedApiBundle } from "./helpers/compiled-api-bundle.js";

const identity: BundleIdentity = { files: 2, bytes: 123, sha256: "a".repeat(64), entrySha256: "b".repeat(64) };
function diagnostic(capture: CompiledApiLogCapture, overrides: Partial<Parameters<typeof compiledApiFailureDiagnostic>[0]> = {}): string {
  return compiledApiFailureDiagnostic({ index: 2, port: 43210, previousPort: 43209, pid: 1234, exitCode: 1, signal: null, spawnErrorCode: null, before: identity, after: identity, capture, ...overrides });
}
function parsed(value: string): { readonly [key: string]: unknown; output: ReturnType<CompiledApiLogCapture["summary"]> } {
  return JSON.parse(value) as { readonly [key: string]: unknown; output: ReturnType<CompiledApiLogCapture["summary"]> };
}
function fixtureBundle(registerCleanup: (cleanup: () => Promise<void>) => void): OwnedApiBundle {
  // These tiny fake modules are not instrumented API bundles. Their removal must
  // be tested even when this test file itself is measured by the outer c8 run.
  return ownedApiBundle(registerCleanup, false);
}

test("startup diagnostic preserves the failing child, exit, port and compiled identity", () => {
  const result = parsed(diagnostic(new CompiledApiLogCapture()));
  assert.equal(result.index, 2); assert.equal(result.exitCode, 1); assert.equal(result.pid, 1234);
  assert.equal(result.reusedPreviousPort, false); assert.deepEqual(result.bundleBefore, identity);
  assert.equal(result.bundleChanged, false); assert.equal(result.rawOutputPersisted, false);
});

test("startup diagnostic classifies a real listen error without publishing arbitrary output", () => {
  const capture = new CompiledApiLogCapture();
  capture.append(Buffer.from("Error: listen EADDRINUSE: address already in use 0.0.0.0:43210\nECONNREFUSED SQLSTATE 53300\n"));
  const result = parsed(diagnostic(capture));
  assert.deepEqual(result.output.errorCodes, ["EADDRINUSE", "ECONNREFUSED"]);
  assert.equal(result.output.postgresConnectionLimitReached, true);
});

test("startup capture never returns secrets, URLs, identities or free-form error messages", () => {
  const capture = new CompiledApiLogCapture();
  const secrets = ["postgresql://private:Secret!@localhost/database", "Bearer PRIVATE_TOKEN", "person@example.invalid", "Synthetic!12345", "arbitrary_private_exception_text"];
  capture.append(Buffer.from(`TypeError: ${secrets.join(" ")}`));
  const output = diagnostic(capture);
  for (const secret of secrets) assert.equal(output.includes(secret), false);
  assert.deepEqual(parsed(output).output.errorClasses, ["TypeError"]);
});

test("startup capture is byte-bounded including multibyte and split chunks", () => {
  const capture = new CompiledApiLogCapture();
  capture.append(Buffer.from("é".repeat(40_000)));
  capture.append(Buffer.from("ERR_MODULE_")); capture.append(Buffer.from("NOT_FOUND"));
  const result = capture.summary();
  assert.equal(result.retainedBytes, 32_768); assert.equal(result.totalBytes, 80_020); assert.equal(result.truncated, true);
  assert.deepEqual(result.errorCodes, ["ERR_MODULE_NOT_FOUND"]);
});

test("startup diagnostics distinguish signal, spawn failure and bundle drift", () => {
  const result = parsed(diagnostic(new CompiledApiLogCapture(), { exitCode: null, signal: "SIGKILL", spawnErrorCode: "ENOENT", after: { ...identity, sha256: "c".repeat(64) } }));
  assert.equal(result.signal, "SIGKILL"); assert.equal(result.spawnErrorCode, "ENOENT"); assert.equal(result.bundleChanged, true);
});

test("startup diagnostics keep unknown spawn messages private and flag unavailable after-identity", () => {
  const result = parsed(diagnostic(new CompiledApiLogCapture(), { spawnErrorCode: "private_message", after: null, previousPort: 43210 }));
  assert.equal(result.spawnErrorCode, "OTHER"); assert.equal(result.bundleChanged, null); assert.equal(result.reusedPreviousPort, true);
});

test("startup capture recognizes Nest dependency and heap exhaustion categories without their payload", () => {
  const capture = new CompiledApiLogCapture(); capture.append(Buffer.from("Nest can't resolve dependencies of SECRET. FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"));
  const result = parsed(diagnostic(capture));
  assert.equal(result.output.nestDependencyResolutionFailed, true); assert.equal(result.output.nodeHeapExhausted, true);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("owned bundles are distinct and cleanup closes only owned processes before deleting only owned files", async () => {
  const cleanup: Array<() => Promise<void>> = [];
  const first = fixtureBundle((close) => cleanup.push(close)), second = fixtureBundle((close) => cleanup.push(close));
  assert.notEqual(first.directory, second.directory);
  writeFileSync(join(first.directory, "main.js"), "first");
  writeFileSync(join(second.directory, "main.js"), "second");
  let closed = false;
  first.onClose(() => { assert.equal(existsSync(join(first.directory, "main.js")), true); closed = true; return Promise.resolve(); });
  await cleanup[0]!();
  assert.equal(closed, true); assert.equal(existsSync(first.directory), false);
  assert.equal(existsSync(second.directory), true);
  await cleanup[1]!(); assert.equal(existsSync(second.directory), false);
});

test("bundle identity covers all emitted JS and JSON, and a dependency edit changes its digest", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  const bundle = fixtureBundle((close) => { cleanup = close; });
  try {
    writeFileSync(join(bundle.directory, "main.js"), "require('./dependency.js');");
    writeFileSync(join(bundle.directory, "dependency.js"), "module.exports = 1;");
    writeFileSync(join(bundle.directory, "manifest.json"), "{}");
    writeFileSync(join(bundle.directory, "main.js.map"), "source map is not executed");
    const before = compiledBundleIdentity(bundle.directory);
    assert.equal(before.files, 3); assert.deepEqual(compiledBundleIdentity(bundle.directory), before);
    writeFileSync(join(bundle.directory, "dependency.js"), "module.exports = 2;");
    const after = compiledBundleIdentity(bundle.directory);
    assert.equal(before.entrySha256, after.entrySha256); assert.notEqual(before.sha256, after.sha256);
  } finally { await cleanup!(); }
});

test("failed child cleanup still attempts the other child and preserves the bundle", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  const bundle = fixtureBundle((close) => { cleanup = close; });
  let firstFails = true, secondClosed = false;
  bundle.onClose(() => { if (firstFails) throw new Error("synthetic_flush_failed"); return Promise.resolve(); });
  bundle.onClose(() => { secondClosed = true; return Promise.resolve(); });
  await assert.rejects(cleanup!(), { name: "AggregateError", message: "owned_compiled_api_close_failed_bundle_preserved" });
  assert.equal(secondClosed, true); assert.equal(existsSync(bundle.directory), true);
  firstFails = false;
  await cleanup!(); assert.equal(existsSync(bundle.directory), false);
});

test("owned output retains the API CommonJS package boundary and normal dependency resolution", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  const bundle = fixtureBundle((close) => { cleanup = close; });
  try {
    const entry = join(bundle.directory, "main.js");
    writeFileSync(entry, "module.exports = typeof require('@nestjs/core').NestFactory.create;");
    const load = createRequire(entry);
    const result: unknown = load(entry);
    assert.equal(result, "function");
  } finally { await cleanup!(); }
});

test("owned compilation refuses a redirected dist before writing into its target", async () => {
  const cleanup: Array<() => Promise<void>> = [];
  const fixture = fixtureBundle((close) => cleanup.push(close)), target = fixtureBundle((close) => cleanup.push(close));
  try {
    symlinkSync(target.directory, join(fixture.directory, "dist"), process.platform === "win32" ? "junction" : "dir");
    const source = pathToFileURL(resolve("test/helpers/compiled-api-bundle.ts")).href;
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `import assert from 'node:assert/strict'; import {ownedApiBundle} from ${JSON.stringify(source)}; assert.throws(() => ownedApiBundle(() => {}), {message: /^owned_compiled_api_parent_must_be_physical(?:\\n|$)/});`], { cwd: fixture.directory, stdio: "pipe", timeout: 10_000 });
    assert.deepEqual(readdirSync(target.directory), []);
  } finally { for (const close of cleanup) await close(); }
});

test("instrumented API cleanup retains JS and external maps for the later c8 conversion", async () => {
  let cleanup: (() => Promise<void>) | undefined;
  const bundle = ownedApiBundle((close) => { cleanup = close; }, true);
  try {
    writeFileSync(join(bundle.directory, "main.js"), "synthetic compiled output");
    writeFileSync(join(bundle.directory, "main.js.map"), "synthetic external source map");
    let stopped = false;
    bundle.onClose(() => { stopped = true; return Promise.resolve(); });
    await cleanup!();
    assert.equal(stopped, true);
    assert.equal(existsSync(join(bundle.directory, "main.js")), true);
    assert.equal(existsSync(join(bundle.directory, "main.js.map")), true);
  } finally {
    // Only this non-executed synthetic fixture is removed, not an API bundle
    // whose real V8 counters still require remapping.
    assert.equal(dirname(bundle.directory), resolve("dist"));
    assert.match(basename(bundle.directory), /^crmy-compiled-api-[A-Za-z0-9]+$/u);
    rmSync(bundle.directory, { recursive: true });
  }
});
