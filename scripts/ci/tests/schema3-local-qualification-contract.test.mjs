import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = readFileSync(new URL("../schema3-local-qualification.mjs", import.meta.url), "utf8");

test("schema3 source and test inventories use explicit English alphabetical comparators", () => {
  assert.equal([...source.matchAll(/\.sort\(\(a, b\) => a\.localeCompare\(b, "en"\)\)/g)].length, 2);
  assert.doesNotMatch(source, /\.sort\(\s*\)/);
  const names = ["z.test.ts", "A.test.ts", "a-b.test.ts", "a.test.ts"];
  const compare = (a, b) => a.localeCompare(b, "en");
  assert.deepEqual([...names].sort(compare), ["a-b.test.ts", "a.test.ts", "A.test.ts", "z.test.ts"]);
});

test("schema3 inventory ordering retains before/after source-drift and database isolation guards", () => {
  assert.match(source, /JSON\.stringify\(snapshot\(\)\) !== JSON\.stringify\(sources\)/);
  assert.match(source, /schema3_source_changed_during_qualification/);
  assert.match(source, /!root \|\| process\.env\.DATABASE_URL/);
  assert.match(source, /flag: "wx"/);
});

for (const scenario of ["success", "drift", "stage-failure", "database"]) {
  test(`executes actual schema3 qualifier with isolated dependencies: ${scenario}`, () => {
    const fixture = fileURLToPath(new URL("./schema3-local-qualification.fixture.mjs", import.meta.url));
    const output = execFileSync(process.execPath, ["--experimental-test-module-mocks", fixture, scenario], {
      encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
    });
    assert.deepEqual(JSON.parse(output.trim().split(/\r?\n/).at(-1)), { scenario, verified: true });
  });
}
