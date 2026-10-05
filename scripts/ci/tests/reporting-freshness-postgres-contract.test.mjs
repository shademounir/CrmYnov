import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const runnerUrl = new URL("../reporting-freshness-postgres.mjs", import.meta.url);
const readRunner = () => readFile(runnerUrl, "utf8");
const entry = (name, kind) => ({ name, isDirectory: () => kind === "directory", isFile: () => kind === "file" });

// Execute only the runner's pure source-discovery/order fragment with an
// in-memory directory adapter. Never import its compilation or Docker startup.
async function orderedInputs(directories, testSource) {
  const runner = await readRunner();
  const start = runner.indexOf("const sourceFiles = ");
  const end = runner.indexOf("const sourceHashes = ", start);
  assert.ok(start >= 0 && end > start, "the actual runner source-discovery fragment must exist");
  const apiDirectory = "synthetic-api";
  const inputs = runInNewContext(`${runner.slice(start, end)}\ninputs;`, {
    apiDirectory, testSource, join,
    readdirSync: (directory, options) => {
      assert.equal(options.withFileTypes, true);
      assert.deepEqual(Object.keys(options), ["withFileTypes"]);
      assert.ok(directories.has(directory), "only declared in-memory directories may be read");
      return directories.get(directory);
    },
  });
  return Array.from(inputs);
}

test("reporting manifest discovers only TypeScript files and preserves UTF-16 lexicographic order", async () => {
  const source = join("synthetic-api", "src");
  const nested = join(source, "nested");
  const directories = new Map([
    [source, [entry("é.ts", "file"), entry("a.ts", "file"), entry("nested", "directory"), entry("Z.ts", "file"), entry("ignored.js", "file"), entry("linked.ts", "link")]],
    [nested, [entry("😀.ts", "file"), entry("A.ts", "file")]],
  ]);
  const testSource = join("synthetic-api", "test", "reporting-freshness-postgres.test.ts");
  assert.deepEqual(await orderedInputs(directories, testSource), [
    join(source, "Z.ts"), join(source, "a.ts"), join(nested, "A.ts"), join(nested, "😀.ts"), join(source, "é.ts"), testSource,
  ]);
});

test("reporting source ordering handles equal paths without removing an input", async () => {
  const source = join("synthetic-api", "src");
  const duplicate = join(source, "same.ts");
  const directories = new Map([[source, [entry("same.ts", "file")]]]);
  assert.deepEqual(await orderedInputs(directories, duplicate), [duplicate, duplicate]);
});

test("reporting source-discovery errors remain failures instead of an empty manifest", async () => {
  await assert.rejects(orderedInputs(new Map(), "synthetic-test.ts"), /only declared in-memory directories/u);
});

test("reporting runner retains isolation, integrity and targeted cleanup guards", async () => {
  const runner = await readRunner();
  for (const expected of ["reporting_must_not_inherit_database", "reporting_container_name_occupied", "reporting_container_identity_mismatch",
    "reporting_database_not_empty", "reporting_loopback_binding_invalid", "reporting_compile_source_changed", "reporting_test_source_changed",
    "crmy162_test_identity.marker", "CRMY162_EPHEMERAL_TEST: \"true\"", "CRMY162_DATABASE_NONCE: nonce", "CRM_BACKGROUND_WORKERS: \"external\"",
    "SHEETS_ENABLED: \"false\"", "withPreservedCleanup", "HostConfig.Tmpfs", "mount.Type !== \"tmpfs\"", "127.0.0.1::5432",
    "ownedContainer(); docker([\"stop\", \"--timeout\", \"60\", container])"]) assert.ok(runner.includes(expected), expected);
  assert.doesNotMatch(runner, /migrate.*reset|seed:local|\["rm"/u);
});
