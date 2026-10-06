import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryUrl = new URL("../../../", import.meta.url);
const fixedDependencies = { "proxy-addr": "2.0.8", "source-map-js": "1.2.2" };

// Resolve from the consuming package, not a possibly unrelated top-level copy.
// No application modules, configuration, credentials or network are loaded.
function runtimeDependency(context, workspace, consumer, dependency) {
  const workspaceRequire = createRequire(new URL(`${workspace}/package.json`, repositoryUrl));
  let consumerEntry;
  try {
    consumerEntry = workspaceRequire.resolve(consumer);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    context.skip(`${consumer} is not installed; lockfile assertions still run`);
    return null;
  }
  const consumerRequire = createRequire(consumerEntry);
  return {
    entry: consumerRequire.resolve(dependency),
    manifest: consumerRequire.resolve(`${dependency}/package.json`),
    load: () => consumerRequire(dependency),
  };
}

function indexedMap(offsetLine) {
  return {
    version: 3,
    sections: [{
      offset: { line: offsetLine, column: 0 },
      map: { version: 3, sources: ["input.css"], names: [], mappings: "AAAA" },
    }],
  };
}

test("security overrides and every locked dependency copy use the patched versions", async () => {
  const [manifest, lock] = await Promise.all(["package.json", "package-lock.json"].map(async (file) =>
    JSON.parse(await readFile(new URL(file, repositoryUrl), "utf8"))));
  for (const [dependency, version] of Object.entries(fixedDependencies)) {
    assert.equal(manifest.overrides[dependency], version, `${dependency} must remain exactly overridden`);
    const entries = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${dependency}` || path.endsWith(`/node_modules/${dependency}`));
    assert.ok(entries.length > 0, `${dependency} must be present in the lockfile`);
    for (const [path, entry] of entries) {
      assert.equal(entry.version, version, `${path} must use the patched version`);
      assert.equal(entry.resolved, `https://registry.npmjs.org/${dependency}/-/${dependency}-${version}.tgz`);
    }
  }
});

for (const [workspace, consumer, dependency] of [
  ["apps/api", "express", "proxy-addr"],
  ["apps/web", "postcss", "source-map-js"],
]) {
  test(`${consumer} resolves the patched ${dependency} at runtime`, async (context) => {
    const installed = runtimeDependency(context, workspace, consumer, dependency);
    if (!installed) return;
    const manifest = JSON.parse(await readFile(installed.manifest, "utf8"));
    assert.equal(manifest.name, dependency);
    assert.equal(manifest.version, fixedDependencies[dependency]);
  });
}

test("proxy-addr rejects short mapped prefixes without changing valid IPv4 or IPv6 trust", (context) => {
  // https://github.com/advisories/GHSA-jqcg-44mw-7w3h
  const installed = runtimeDependency(context, "apps/api", "express", "proxy-addr");
  if (!installed) return;
  const proxyaddr = installed.load();
  const candidates = [
    ["10.0.0.1", true], ["10.255.255.255", true], ["11.0.0.1", false],
    ["203.0.113.9", false], ["0.0.0.0", false],
    ["::ffff:10.0.0.1", true], ["::ffff:203.0.113.9", false],
    ["::1", false], ["::abcd", false],
  ];
  // Exercise both optimized single-subnet and multi-subnet implementations.
  for (const extra of [[], ["192.0.2.0/24"]]) {
    const shortMapped = proxyaddr.compile(["::ffff:10.0.0.0/8", ...extra]);
    for (const [address] of candidates) assert.equal(shortMapped(address), false, `short prefix: ${address}`);
    for (const subnet of ["::ffff:10.0.0.0/104", "10.0.0.0/8"]) {
      const valid = proxyaddr.compile([subnet, ...extra]);
      for (const [address, expected] of candidates) assert.equal(valid(address), expected, `${subnet}: ${address}`);
    }
    if (extra.length > 0) assert.equal(shortMapped("192.0.2.1"), true, "the other valid subnet remains usable");
  }
  const native = proxyaddr.compile(["2001:db8::/32"]);
  assert.equal(native("2001:db8::1"), true);
  assert.equal(native("::1"), false);
  assert.equal(native("::ffff:203.0.113.9"), false);
  const zeroPrefix = proxyaddr.compile(["::/1"]);
  assert.equal(zeroPrefix("203.0.113.9"), false);
  assert.equal(zeroPrefix("::ffff:203.0.113.9"), false);
  assert.equal(zeroPrefix("::1"), true);

  const request = (remoteAddress) => ({
    connection: { remoteAddress }, headers: { "x-forwarded-for": "198.51.100.7" },
  });
  const shortMapped = proxyaddr.compile(["::ffff:10.0.0.0/8"]);
  for (const address of ["203.0.113.9", "::ffff:203.0.113.9", "::1"]) {
    assert.equal(proxyaddr(request(address), shortMapped), address, "untrusted peers cannot supply the client IP");
  }
  assert.equal(proxyaddr(request("::ffff:10.0.0.1"), proxyaddr.compile(["::ffff:10.0.0.0/104"])), "198.51.100.7");
});

test("source-map-js rejects an excessive indexed offset in a bounded isolated process", (context) => {
  // https://github.com/advisories/GHSA-68fv-2mgg-jv7q
  const installed = runtimeDependency(context, "apps/web", "postcss", "source-map-js");
  if (!installed) return;
  const program = `
    const assert = require("node:assert/strict");
    const { SourceMapConsumer } = require(process.argv[1]);
    assert.throws(() => new SourceMapConsumer(${JSON.stringify(indexedMap(10_000_001))}),
      /Section offset line must not exceed/);
  `;
  // Do not inherit private app configuration, NODE_OPTIONS or preload hooks.
  const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP"]
    .filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  const result = spawnSync(process.execPath, ["--max-old-space-size=64", "--input-type=commonjs", "-e", program, installed.entry], {
    cwd: fileURLToPath(repositoryUrl), env: environment, windowsHide: true,
    timeout: 5_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024,
    stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
  });
  assert.equal(result.error, undefined, "indexed offset rejection must complete within five seconds");
  assert.equal(result.signal, null, "indexed offset rejection must not exhaust the bounded child");
  assert.equal(result.status, 0, `indexed offset rejection failed: ${result.stderr.trim()}`);
});

test("source-map-js preserves valid indexed offsets and generated mappings", (context) => {
  const installed = runtimeDependency(context, "apps/web", "postcss", "source-map-js");
  if (!installed) return;
  const { SourceMapConsumer, SourceMapGenerator } = installed.load();
  const consumer = new SourceMapConsumer(indexedMap(2));
  assert.deepEqual(consumer.originalPositionFor({ line: 3, column: 1 }), {
    source: "input.css", line: 1, column: 0, name: null,
  });
  const generator = new SourceMapGenerator();
  consumer.eachMapping((mapping) => generator.addMapping({
    generated: { line: mapping.generatedLine, column: mapping.generatedColumn },
    original: { line: mapping.originalLine, column: mapping.originalColumn },
    source: mapping.source,
  }));
  assert.equal(generator.toJSON().mappings, ";;AAAA");
});
