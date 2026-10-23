import { mock } from "node:test";
import assert from "node:assert/strict";

const scenario = process.argv[2] ?? "success";
const writes = new Map(), commands = [];
let inventories = 0;
process.env.CRMY63_SCHEMA3_PROOF_ROOT = "/synthetic-proof";
delete process.env.DATABASE_URL;
if (scenario === "database") process.env.DATABASE_URL = "synthetic-refused";
mock.module("node:fs", { namedExports: {
  statSync: () => ({ isFile: () => true }),
  mkdtempSync: () => "/synthetic-proof/run",
  readFileSync: () => "immutable source bytes",
  readdirSync: () => ["z.test.ts", "a.test.ts", "not-a-test.txt"],
  writeFileSync: (path, value, options) => {
    assert.equal(options.flag, "wx");
    const key = String(path).replaceAll("\\", "/");
    assert(!writes.has(key));
    writes.set(key, value);
  },
} });
mock.module("node:child_process", { namedExports: {
  execFileSync: (_executable, args) => {
    commands.push(args);
    if (args[0] === "ls-files") {
      inventories++;
      return scenario === "drift" && inventories > 1 ? "changed\0" : "zeta\0Alpha\0";
    }
    if (scenario === "stage-failure") throw Object.assign(new Error("synthetic command refusal"), { status: 7, stdout: "safe stdout", stderr: "safe stderr" });
    return "synthetic success log";
  },
} });
let error;
try { await import("../schema3-local-qualification.mjs"); } catch (caught) { error = caught; }
if (scenario === "database") {
  assert.equal(error?.message, "schema3_local_proof_root_required_without_database");
  assert.equal(commands.length, 0);
  assert.equal(writes.size, 0);
} else if (scenario === "stage-failure") {
  assert.equal(error?.message, "schema3_stage_failed:repository-unit");
  const failure = JSON.parse(writes.get("/synthetic-proof/run/failure.json"));
  assert.equal(failure.stages[0].status, 7);
  assert(!writes.has("/synthetic-proof/run/result.json"));
} else if (scenario === "drift") {
  assert.equal(error?.message, "schema3_source_changed_during_qualification");
  assert(writes.has("/synthetic-proof/run/failure.json"));
  assert(!writes.has("/synthetic-proof/run/result.json"));
} else {
  assert.equal(error, undefined);
  const result = JSON.parse(writes.get("/synthetic-proof/run/result.json"));
  assert.equal(result.status, "PASSED");
  assert.deepEqual(result.sources.map(({ path }) => path), ["Alpha", "zeta"]);
  assert.equal(result.stages.length, 10);
  const api = commands.find(args => args.includes("test/a.test.ts"));
  assert(api.indexOf("test/a.test.ts") < api.indexOf("test/z.test.ts"));
  assert.equal(result.productionMutation, false);
  assert.equal(result.prismaGeneration, false);
}
console.log(JSON.stringify({ scenario, verified: true }));
