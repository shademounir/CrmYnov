import assert from "node:assert/strict";
import test from "node:test";
import { sharingDatabase, verifySharingDatabaseIdentity } from "./helpers/view-sharing-database.js";

const database = "crm_crmy170_0123456789abcdef";
const url = `postgresql://postgres:SyntheticOnly@crmy170-postgres:5432/${database}`;
const env = { CRMY170_EPHEMERAL_TEST: "true", CRMY170_TEST_DATABASE_URL: url };

test("preconfigured synthetic database never invokes the owned Docker lifecycle", () => {
  const result = sharingDatabase(env, () => { assert.fail("docker run/port/cleanup must not be registered"); });
  assert.equal(result.external, true); assert.equal(result.database, database); assert.equal(result.url, url);
  assert.equal(sharingDatabase({ ...env, CRMY170_TEST_DATABASE_URL: url.replace("postgresql:", "postgres:") }, () => assert.fail()).url, url);
});
test("absent dedicated variable retains the owned legacy lifecycle", () => {
  let calls = 0;
  const result = sharingDatabase({}, () => { calls++; return "postgresql://postgres@127.0.0.1:5432/crm_crmy170"; });
  assert.equal(calls, 1); assert.equal(result.external, false); assert.equal(result.database, "crm_crmy170");
});
for (const [name, supplied] of [
  ["empty URL", ""], ["invalid URL", "not-a-url"], ["protocol", url.replace("postgresql:", "https:")],
  ["remote host", url.replace("crmy170-postgres", "remote.example.invalid")], ["loopback substitution", url.replace("crmy170-postgres", "127.0.0.1")],
  ["wrong port", url.replace(":5432/", ":5433/")], ["non-dedicated database", url.replace(database, "crm")],
  ["options", `${url}?host=remote.example.invalid`], ["missing password", url.replace(":SyntheticOnly", "")],
]) {
  test(`preconfigured database rejects ${name} without exposing the secret`, () => {
    assert.throws(() => sharingDatabase({ ...env, CRMY170_TEST_DATABASE_URL: supplied }, () => assert.fail()), (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^crmy170_preconfigured_/); assert.doesNotMatch(error.message, /SyntheticOnly|postgresql:\/\//); return true;
    });
  });
}
test("a supplied database requires the explicit integration flag, not CI alone", () => {
  assert.throws(() => sharingDatabase({ CI: "true", CRMY170_TEST_DATABASE_URL: url }, () => assert.fail()), /requires_ephemeral_flag/);
});
test("connection identity proves the unique private endpoint, marker and empty database", () => {
  const identity = { database, marker: `CRMY170_SYNTHETIC:${database}`, address: "172.20.0.2", relations: 0n };
  assert.doesNotThrow(() => verifySharingDatabaseIdentity(database, identity, ["172.20.0.2"]));
  assert.throws(() => verifySharingDatabaseIdentity(database, { ...identity, marker: null }, ["172.20.0.2"]), /marker_missing/);
  assert.throws(() => verifySharingDatabaseIdentity(database, { ...identity, database: "other" }, ["172.20.0.2"]), /marker_missing/);
  assert.throws(() => verifySharingDatabaseIdentity(database, { ...identity, relations: 1n }, ["172.20.0.2"]), /database_not_empty/);
  for (const addresses of [[], ["172.20.0.3"], ["172.20.0.2", "172.20.0.3"], ["8.8.8.8"]]) {
    assert.throws(() => verifySharingDatabaseIdentity(database, identity, addresses), /connection_ambiguous/);
  }
});
