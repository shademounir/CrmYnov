import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const read = file => readFile(new URL("../../../" + file, import.meta.url), "utf8");
const runnerBody = source => source.replace(/^import \{ execFileSync \} from "node:child_process";\s*/u, "");

test("the integration gate explicitly enables the existing real PostgreSQL reminder proof", async () => {
  const workflow = await read(".github/workflows/application-quality.yml");
  const integration = workflow.match(/\n  integration-tests:[\s\S]+?(?=\n  playwright:)/)?.[0] ?? "";
  assert.match(integration, /node scripts\/ci\/follow-up-due-postgres\.mjs/u);
  const coverage = await read("scripts/ci/coverage-runner.mjs");
  assert.match(coverage, /\["follow-up-postgres\.test\.ts", "CRMY_FOLLOW_UP_POSTGRES"\]/u);
});

test("the runner uses the current Node and forcibly disables live Sheets and workers without losing coverage instrumentation", async () => {
  const source = await read("scripts/ci/follow-up-due-postgres.mjs");
  for (const flag of [undefined, "false", "TRUE", "true"]) {
    const calls = [];
    const inherited = { SHEETS_ENABLED: "true", CRM_BACKGROUND_WORKERS: "embedded", NODE_V8_COVERAGE: "synthetic-coverage", ...(flag === undefined ? {} : { CRMY_FOLLOW_UP_POSTGRES: flag }) };
    runInNewContext(runnerBody(source), { process: { env: inherited, execPath: "/synthetic/node" }, execFileSync: (...args) => calls.push(args) });
    assert.equal(calls.length, 1);
    const [program, args, options] = calls[0];
    assert.equal(program, "/synthetic/node");
    assert.deepEqual(Array.from(args), ["--import", "tsx", "--test", "--test-concurrency=1", "test/follow-up-postgres.test.ts"]);
    assert.equal(options.cwd, "apps/api"); assert.equal(options.stdio, "inherit"); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 300_000);
    assert.equal(options.env.CRMY_FOLLOW_UP_POSTGRES, "true"); assert.equal(options.env.CRM_BACKGROUND_WORKERS, "external"); assert.equal(options.env.SHEETS_ENABLED, "false");
    assert.equal(options.env.NODE_V8_COVERAGE, "synthetic-coverage"); assert.equal(options.env.DATABASE_URL, undefined);
  }
});

test("every inherited DATABASE_URL is refused before any subprocess starts", async () => {
  const source = await read("scripts/ci/follow-up-due-postgres.mjs");
  for (const database of ["postgresql://synthetic.invalid/do-not-open", "", " "]) {
    let calls = 0;
    assert.throws(() => runInNewContext(runnerBody(source), { process: { env: { DATABASE_URL: database }, execPath: "/synthetic/node" }, execFileSync: () => { calls += 1; } }), /follow_up_due_must_not_inherit_database/u);
    assert.equal(calls, 0);
  }
});
