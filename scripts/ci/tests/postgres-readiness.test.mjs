import assert from "node:assert/strict";
import test from "node:test";
import { waitForPostgres } from "../postgres-readiness.mjs";

test("readiness waits for a successful TCP SQL query, not the temporary socket server", async () => {
  let probes = 0;
  const delays = [];
  await waitForPostgres("isolated-test", args => {
    assert.deepEqual(args, ["exec", "isolated-test", "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", "SELECT 1"]);
    probes++;
    if (probes === 1) throw Error("TCP refused during initdb");
    return probes === 2 ? "" : "1\r\n";
  }, ms => { delays.push(ms); });
  assert.equal(probes, 3);
  assert.deepEqual(delays, [250, 250]);
});

test("readiness fails closed after bounded retries", async () => {
  let probes = 0;
  let delays = 0;
  await assert.rejects(waitForPostgres("isolated-test", () => {
    probes++;
    throw Error("unavailable");
  }, () => { delays++; }), /coverage_postgres_not_ready/);
  assert.equal(probes, 61);
  assert.equal(delays, 60);
});
