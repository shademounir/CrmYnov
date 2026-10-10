import assert from "node:assert/strict";
import test from "node:test";
import { assertRuntimeDatabaseIdentity, runtimeDatabaseTarget, type RuntimeDatabaseTargetInput } from "../src/jobs/runtime-database-target.js";
import { runRuntimeDatabaseGrantJob, runtimeDatabaseGrantFailure } from "../src/jobs/grant-runtime-database.js";

const targets = [
  { databaseName: "crmynov_dev", databaseEnvironment: "dev", databaseProject: "crmynov-dev-n7x4q2" },
  { databaseName: "crmynov_stg", databaseEnvironment: "staging", databaseProject: "crmynov-stg-n7x4q2" },
  { databaseName: "crmynov_prod", databaseEnvironment: "prod", databaseProject: "crmynov-prod-n7x4q2" },
] as const;

test("runtime target preserves only legacy DEV and accepts the three exact explicit tuples", () => {
  assert.deepEqual(runtimeDatabaseTarget({}), { databaseName: "crmynov_dev", environment: "dev", project: "crmynov-dev-n7x4q2" });
  for (const target of targets) {
    assert.deepEqual(runtimeDatabaseTarget({ ...target, observedProject: target.databaseProject }), {
      databaseName: target.databaseName, environment: target.databaseEnvironment, project: target.databaseProject,
    });
  }
});

test("partial, crossed, unknown and injected targets are refused before creating a client", async () => {
  const invalid: RuntimeDatabaseTargetInput[] = [
    { databaseName: "crmynov_prod" }, { databaseEnvironment: "prod" }, { databaseProject: "crmynov-prod-n7x4q2" },
    { ...targets[0], databaseEnvironment: "prod" }, { ...targets[1], databaseName: "crmynov_staging" },
    { ...targets[2], databaseProject: "crmynov-dev-n7x4q2" }, { ...targets[2], observedProject: "crmynov-dev-n7x4q2" },
    { ...targets[2], databaseName: 'crmynov_prod"; DROP DATABASE crmynov_dev; --' },
    { ...targets[2], databaseProject: "institutional-unverified" }, { ...targets[2], databaseEnvironment: "PROD" },
    { databaseName: "" }, { databaseName: " crmynov_prod " }, { observedProject: "crmynov-prod-n7x4q2" },
  ];
  for (const input of invalid) {
    let created = false;
    await assert.rejects(runRuntimeDatabaseGrantJob({ ...input, runtimeRole: "crm_runtime", createClient: (): never => {
      created = true; throw new Error("must_not_connect");
    }, write: (): never => { throw new Error("must_not_report_success"); } }), /crm_runtime_database_target_invalid/u);
    assert.equal(created, false);
  }
});

test("identity proof requires exactly one current database matching the selected target", () => {
  const target = runtimeDatabaseTarget(targets[2]);
  for (const result of [undefined, null, {}, [], [null], [{ databaseName: "crmynov_dev" }], [{ databasename: "crmynov_prod" }], [{ databaseName: "crmynov_prod" }, { databaseName: "crmynov_prod" }]]) {
    assert.throws(() => assertRuntimeDatabaseIdentity(result, target), /crm_runtime_database_target_mismatch/u);
  }
  assertRuntimeDatabaseIdentity([{ databaseName: "crmynov_prod" }], target);
});

test("all targets read identity before the unchanged grant sequence using fixed quoted identifiers", async () => {
  for (const target of targets) {
    const calls: string[] = []; let disconnected = 0; let reported = 0;
    await runRuntimeDatabaseGrantJob({ ...target, runtimeRole: "crm_runtime", createClient: () => ({
      $queryRaw: (strings, ...values): Promise<unknown> => {
        assert.deepEqual(values, []); calls.push(strings.join("?")); return Promise.resolve([{ databaseName: target.databaseName }]);
      },
      $executeRaw: (strings, ...values): Promise<unknown> => {
        assert.deepEqual(values, []); calls.push(strings.join("?")); return Promise.resolve(1);
      },
      $disconnect: (): Promise<void> => { disconnected++; return Promise.resolve(); },
    }), write: (): void => { reported++; } });
    assert.equal(calls.length, 11);
    assert.equal(calls[0], 'SELECT current_database() AS "databaseName"');
    assert.equal(calls[1], 'REVOKE cloudsqlsuperuser FROM "crm_runtime"');
    assert.equal(calls[2], 'ALTER ROLE "crm_runtime" NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20');
    assert.equal(calls[3], "REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    assert.equal(calls[4], `GRANT CONNECT ON DATABASE "${target.databaseName}" TO "crm_runtime"`);
    assert.equal(calls[5], 'GRANT USAGE ON SCHEMA public TO "crm_runtime"');
    assert.equal(calls[6], 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "crm_runtime"');
    assert.equal(calls[7], 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "crm_runtime"');
    assert.equal(calls[8], 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "crm_runtime"');
    assert.equal(calls[9], 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "crm_runtime"');
    assert.equal(calls[10], 'REVOKE ALL ON TABLE public."_prisma_migrations" FROM "crm_runtime"');
    assert.equal(disconnected, 1); assert.equal(reported, 1);
  }
});

test("miswired database or failed identity query performs zero grants, disconnects and logs only a safe code", async () => {
  for (const queryFails of [false, true]) {
    let executed = 0; let disconnected = 0;
    await assert.rejects(runRuntimeDatabaseGrantJob({ ...targets[2], runtimeRole: "crm_runtime", createClient: () => ({
      $queryRaw: (): Promise<unknown> => queryFails ? Promise.reject(new Error("postgresql://private:secret@host/db")) : Promise.resolve([{ databaseName: "crmynov_dev" }]),
      $executeRaw: (): Promise<unknown> => { executed++; return Promise.resolve(1); },
      $disconnect: (): Promise<void> => { disconnected++; return Promise.resolve(); },
    }), write: (): never => { throw new Error("must_not_report_success"); } }), (error: unknown): boolean => {
      const output = runtimeDatabaseGrantFailure(error, {});
      const event = JSON.parse(output) as Record<string, unknown>;
      assert.equal(event.stage, "verify_database_target");
      assert.equal(event.code, queryFails ? "crm_runtime_database_grant_failed" : "crm_runtime_database_target_mismatch");
      assert.doesNotMatch(output, /private|secret|postgresql|host/u); return true;
    });
    assert.equal(executed, 0); assert.equal(disconnected, 1);
  }
});

test("disconnect failure after an identity mismatch cannot replace the refusal or report success", async () => {
  await assert.rejects(runRuntimeDatabaseGrantJob({ runtimeRole: "crm_runtime", createClient: () => ({
    $queryRaw: (): Promise<unknown> => Promise.resolve([{ databaseName: "crmynov_prod" }]),
    $executeRaw: (): Promise<never> => Promise.reject(new Error("must_not_execute")),
    $disconnect: (): Promise<never> => Promise.reject(new Error("postgresql://another:secret@host/db")),
  }), write: (): never => { throw new Error("must_not_report_success"); } }), (error: unknown): boolean => {
    assert.equal((JSON.parse(runtimeDatabaseGrantFailure(error, {})) as Record<string, unknown>).code, "crm_runtime_database_target_mismatch"); return true;
  });
});
