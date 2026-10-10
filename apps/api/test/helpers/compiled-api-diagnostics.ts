import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const logLimitBytes = 32_768;
const errorCodes = ["EADDRINUSE", "EACCES", "ENOENT", "ENOMEM", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_REQUIRE_ESM", "ERR_DLOPEN_FAILED", "ERR_OUT_OF_RANGE"] as const;
const errorClasses = ["TypeError", "ReferenceError", "SyntaxError", "RangeError", "PrismaClientInitializationError", "PrismaClientKnownRequestError", "UnknownDependenciesException"] as const;

export type BundleIdentity = Readonly<{ files: number; bytes: number; sha256: string; entrySha256: string }>;

export function compiledBundleIdentity(root: string): BundleIdentity {
  const names: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:js|json)$/u.test(entry.name)) names.push(path);
    }
  }
  visit(root);
  names.sort((left, right) => relative(root, left).localeCompare(relative(root, right), "en"));
  const digest = createHash("sha256");
  let bytes = 0;
  for (const path of names) {
    const contents = readFileSync(path);
    bytes += contents.byteLength;
    digest.update(relative(root, path).replaceAll("\\", "/")).update("\0");
    digest.update(createHash("sha256").update(contents).digest("hex")).update("\n");
  }
  return { files: names.length, bytes, sha256: digest.digest("hex"), entrySha256: createHash("sha256").update(readFileSync(join(root, "main.js"))).digest("hex") };
}

// Child output is bounded in memory. Never return or write its free-form text:
// even an exception can contain a database URL, credential or identity.
export class CompiledApiLogCapture {
  private tail = Buffer.alloc(0);
  private totalBytes = 0;

  append(chunk: Buffer): void {
    this.totalBytes += chunk.byteLength;
    this.tail = Buffer.concat([this.tail, chunk]).subarray(-logLimitBytes);
  }

  summary(): Readonly<{ totalBytes: number; retainedBytes: number; truncated: boolean; sha256: string; errorCodes: readonly string[]; errorClasses: readonly string[]; nestDependencyResolutionFailed: boolean; nodeHeapExhausted: boolean; postgresConnectionLimitReached: boolean }> {
    const text = this.tail.toString("utf8").replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"), "");
    return {
      totalBytes: this.totalBytes, retainedBytes: this.tail.byteLength, truncated: this.totalBytes > this.tail.byteLength,
      sha256: createHash("sha256").update(this.tail).digest("hex"),
      errorCodes: errorCodes.filter((code) => new RegExp(`\\b${code}\\b`, "u").test(text)),
      errorClasses: errorClasses.filter((name) => new RegExp(`\\b${name}\\b`, "u").test(text)),
      nestDependencyResolutionFailed: /Nest can't resolve dependencies|UnknownDependenciesException/u.test(text),
      nodeHeapExhausted: /JavaScript heap out of memory|Reached heap limit/u.test(text),
      postgresConnectionLimitReached: /\b53300\b|too_many_connections|too many clients already/u.test(text),
    };
  }
}

export function compiledApiFailureDiagnostic(input: Readonly<{
  index: number; port: number; previousPort: number | null; pid: number | undefined;
  exitCode: number | null; signal: NodeJS.Signals | null; spawnErrorCode: string | null;
  before: BundleIdentity; after: BundleIdentity | null; capture: CompiledApiLogCapture;
}>): string {
  assert.ok(input.index === 1 || input.index === 2);
  assert.ok(Number.isInteger(input.port) && input.port > 0 && input.port <= 65_535);
  return JSON.stringify({
    kind: "synthetic_compiled_api_startup_failure", index: input.index, port: input.port,
    previousPort: input.previousPort, reusedPreviousPort: input.port === input.previousPort,
    pid: input.pid ?? null, exitCode: input.exitCode, signal: input.signal,
    spawnErrorCode: errorCodes.find((code) => code === input.spawnErrorCode) ?? (input.spawnErrorCode === null ? null : "OTHER"),
    bundleBefore: input.before, bundleAfter: input.after,
    bundleChanged: input.after === null ? null : input.before.sha256 !== input.after.sha256,
    output: input.capture.summary(), rawOutputPersisted: false,
  });
}
