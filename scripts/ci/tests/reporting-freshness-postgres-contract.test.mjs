import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { collectTypeScriptInputs } from "../postgres-proof-runtime.mjs";

const runnerUrl = new URL("../reporting-freshness-postgres.mjs", import.meta.url);
const readRunner = () => readFile(runnerUrl, "utf8");
const entry = (name, kind) => ({ name, isDirectory: () => kind === "directory", isFile: () => kind === "file" });

// Shared discovery is pure; never import the runner's compilation/Docker flow.
function orderedInputs(directories, testSource) {
  return collectTypeScriptInputs("synthetic-api", testSource, (directory, options) => {
    assert.deepEqual(options, { withFileTypes: true });
    assert.ok(directories.has(directory), "only declared in-memory directories may be read");
    return directories.get(directory);
  });
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
  assert.throws(() => orderedInputs(new Map(), "synthetic-test.ts"), /only declared in-memory directories/u);
});

test("reporting runner retains isolation, integrity and targeted cleanup guards", async () => {
  const runner = await readRunner();
  for (const expected of ["reporting_must_not_inherit_database", 'errorPrefix: "reporting"', 'nonceLabel: "crmy162-test-nonce"', "compilePostgresProof", "createPostgresDocker",
    "reporting_database_not_empty", "reporting_test_source_changed", "loopbackBinding(image)", "assertContainerAvailable(); image = pinImage();",
    "crmy162_test_identity.marker", "CRMY162_EPHEMERAL_TEST: \"true\"", "CRMY162_DATABASE_NONCE: nonce", "CRM_BACKGROUND_WORKERS: \"external\"",
    "SHEETS_ENABLED: \"false\"", "withPreservedCleanup", "127.0.0.1::5432", 'metadataInputType: "module"', "ManagerDashboardService", "timeout: 180_000",
    "ownedContainer(image); docker([\"stop\", \"--timeout\", \"60\", container])"]) assert.ok(runner.includes(expected), expected);
  assert.doesNotMatch(runner, /migrate.*reset|seed:local|\["rm"/u);
});
