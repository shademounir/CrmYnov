import assert from "node:assert/strict";
import test from "node:test";
import { FollowUpDueScheduler } from "../src/follow-up/follow-up-due.scheduler.js";
import { followUpDueFailure, runFollowUpDueJob } from "../src/jobs/follow-up-due.js";
import { runRuntimeDatabaseGrantJob, runtimeDatabaseGrantFailure } from "../src/jobs/grant-runtime-database.js";

test("follow-up job requires external workers, writes its result and always closes", async () => {
  await assert.rejects(
    runFollowUpDueJob({ workersMode: "embedded", createContext: () => Promise.reject(new Error("unexpected")), now: () => new Date(0), write: () => undefined }),
    /crm_background_workers_must_be_external/u,
  );

  const writes: string[] = [];
  let closed = 0;
  const now = new Date("2026-09-22T12:00:00.000Z");
  await runFollowUpDueJob({
    workersMode: "external",
    createContext: () => Promise.resolve({
      get: (token) => {
        assert.equal(token, FollowUpDueScheduler);
        return { tick: (value): Promise<{ due: number; notifications: number }> => {
          assert.equal(value, now);
          return Promise.resolve({ due: 3, notifications: 2 });
        } };
      },
      close: () => { closed += 1; return Promise.resolve(); },
    }),
    now: () => now,
    write: (message) => writes.push(message),
  });

  assert.equal(closed, 1);
  assert.deepEqual(JSON.parse(writes[0] ?? "{}"), { job: "follow-up-due", completed: true, due: 3, notifications: 2 });
  assert.match(followUpDueFailure(new Error("synthetic_failure")), /synthetic_failure/u);
  assert.match(followUpDueFailure("unknown"), /unknown_error/u);
});

test("runtime database grant validates the allowlist and executes the bounded grant sequence", async () => {
  const noClient = (): never => { throw new Error("client_must_not_be_created"); };
  await assert.rejects(
    runRuntimeDatabaseGrantJob({ runtimeRole: "", createClient: noClient, write: () => undefined }),
    /crm_runtime_database_role_invalid/u,
  );
  await assert.rejects(
    runRuntimeDatabaseGrantJob({ runtimeRole: "another_role", createClient: noClient, write: () => undefined }),
    /crm_runtime_database_role_not_allowlisted/u,
  );

  const statements: string[] = [];
  const writes: string[] = [];
  let disconnected = 0;
  await runRuntimeDatabaseGrantJob({
    runtimeRole: "crm_runtime",
    createClient: () => ({
      $executeRaw: (strings): Promise<unknown> => { statements.push(strings.join("?")); return Promise.resolve(1); },
      $disconnect: (): Promise<void> => { disconnected += 1; return Promise.resolve(); },
    }),
    write: (message) => writes.push(message),
  });

  assert.equal(statements.length, 10);
  assert.match(statements[0] ?? "", /REVOKE cloudsqlsuperuser/u);
  assert.match(statements[1] ?? "", /NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20/u);
  assert.match(statements[2] ?? "", /REVOKE CREATE ON SCHEMA public FROM PUBLIC/u);
  assert.match(statements[9] ?? "", /REVOKE ALL ON TABLE public\."_prisma_migrations"/u);
  assert.equal(disconnected, 1);
  assert.deepEqual(JSON.parse(writes[0] ?? "{}"), { job: "grant-runtime-database", completed: true, runtimeRole: "crm_runtime" });
  assert.match(runtimeDatabaseGrantFailure(new Error("postgresql://private:secret@host/db")), /crm_runtime_database_grant_failed/u);
  assert.doesNotMatch(runtimeDatabaseGrantFailure(new Error("postgresql://private:secret@host/db")), /secret|postgresql/u);
  assert.match(runtimeDatabaseGrantFailure(null), /crm_runtime_database_grant_failed/u);
  assert.match(runtimeDatabaseGrantFailure(new Error("crm_runtime_database_role_invalid")), /crm_runtime_database_role_invalid/u);
});
