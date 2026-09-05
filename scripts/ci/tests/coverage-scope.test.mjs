import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { matchesGlob } from "node:path";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Sonar test conventions include helpers without reclassifying API production", async () => {
  const properties = Object.fromEntries((await read("sonar-project.properties"))
    .split(/\r?\n/).filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const patterns = properties["sonar.test.inclusions"].split(",");
  const isTest = (path) => patterns.some((pattern) => matchesGlob(path, pattern));
  assert.ok(properties["sonar.tests"].split(",").includes("apps"));
  assert.ok(properties["sonar.sources"].split(",").includes("apps"));
  assert.ok(patterns.includes("apps/**/test/**/*.ts"));
  for (const directory of ["apps/api/test", "apps/web/test", "apps/api/src"]) {
    const files = await readdir(new URL(`${directory}/`, root), { recursive: true });
    for (const file of files.filter((path) => path.endsWith(".ts"))) {
      const path = `${directory}/${file.replaceAll("\\", "/")}`;
      assert.equal(isTest(path), directory.endsWith("/test"), path);
    }
  }
  // Sonar automatically applies test inclusions as source exclusions, keeping MAIN/TEST disjoint.
  assert.doesNotMatch(properties["sonar.coverage.exclusions"], /test\/helpers/);
});

test("canonical coverage remaps before the unchanged filters and is used by CI", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const lock = JSON.parse(await read("package-lock.json"));
  const command = pkg.scripts["test:coverage"];
  assert.equal(command, "c8 --all --exclude-after-remap --include=apps/**/*.ts --include=apps/**/*.tsx --include=packages/**/*.ts --include=scripts/**/*.mjs --exclude=**/.next/** --exclude=**/dist/** --exclude=**/tests/** --exclude=**/test/** --reporter=text --reporter=lcov npm test");
  assert.equal(lock.packages["node_modules/c8"].version, pkg.devDependencies.c8);
  assert.match(await read("node_modules/c8/lib/parse-args.js"), /option\('exclude-after-remap'/);
  const workflow = await read(".github/workflows/application-quality.yml");
  assert.match(workflow, /run: npm run test:coverage\s/);
  assert.doesNotMatch(workflow, /\bc8\b|--exclude-after-remap/);
  assert.match(workflow, /-Dsonar\.qualitygate\.wait=true/);
});
