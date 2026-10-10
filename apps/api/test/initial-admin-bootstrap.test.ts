import assert from "node:assert/strict";
import test from "node:test";
import { scryptSync } from "node:crypto";
import { initialAdminConfiguration, initialAdminInput, initialAdminPassword, INITIAL_ADMIN_EVENT,
  INITIAL_ADMIN_GRANT, type InitialAdminInput } from "../src/jobs/initial-admin-contract.js";
import { initialAdminFailure, runInitialAdminBootstrap, type InitialAdminClient, type InitialAdminTransaction } from "../src/jobs/bootstrap-initial-admin.js";

const secret = "Synthetic-Private-Bootstrap-Only!9x";
const input: InitialAdminInput = {
  enabled: "true", environment: "staging", project: "crmynov-stg-n7x4q2", database: "crmynov_stg", observedProject: "crmynov-stg-n7x4q2",
  email: "admin-staging@example.invalid", displayName: "Admin synthétique STAGING", operationId: "13434d02-774f-4d48-8c85-2abc58f10982",
  decisionSha256: "d".repeat(64), sourceSha: "a".repeat(40), delegation: INITIAL_ADMIN_GRANT,
  secretVersion: "projects/crmynov-stg-n7x4q2/secrets/crm-staging-initial-admin/versions/1", temporarySecret: secret,
};
interface State { users: number; credentials: number; receipt?: Record<string, unknown> | undefined; inserted: Array<{ sql: string; values: unknown[] }> }
function harness(options: { database?: string; user?: string; completed?: number; unfinished?: number; failInsert?: number; failDisconnect?: boolean; occupied?: number } = {}): {
  client: InitialAdminClient; state: State; calls: string[]; output: string[]; disconnected(): number;
} {
  const state: State = { users: options.occupied ?? 0, credentials: 0, inserted: [] }, calls: string[] = [], output: string[] = [];
  let disconnects = 0;
  const client: InitialAdminClient = {
    $transaction: async <T>(work: (transaction: InitialAdminTransaction) => Promise<T>, transactionOptions: unknown): Promise<T> => {
      assert.deepEqual(transactionOptions, { isolationLevel: "Serializable", maxWait: 5000, timeout: 65000 });
      const draft = structuredClone(state);
      const transaction: InitialAdminTransaction = {
        $queryRaw: (parts, ...values): Promise<unknown> => {
          const sql = parts.join("?"); calls.push(sql);
          if (sql.includes("current_database()")) return Promise.resolve([{ databaseName: options.database ?? "crmynov_stg", databaseUser: options.user ?? "crm_migrator" }]);
          if (sql.includes('FROM "_prisma_migrations"')) return Promise.resolve([{ completed: options.completed ?? 52, unfinished: options.unfinished ?? 0 }]);
          if (sql.includes("WHERE idempotency_key")) { assert.equal(values[0], "initial-admin:crmynov-stg-n7x4q2"); return Promise.resolve(draft.receipt ? [draft.receipt] : []); }
          if (sql.includes("JOIN local_password_hashes")) return Promise.resolve(draft.users === 1 && draft.credentials === 1 ? [{ id: draft.receipt?.subjectId }] : []);
          if (sql.includes("AS collaborators")) return Promise.resolve([{ collaborators: draft.users, credentials: draft.credentials, bootstraps: 0 }]);
          return Promise.reject(new Error("unexpected_query"));
        },
        $executeRaw: (parts, ...values): Promise<unknown> => {
          const sql = parts.join("?"); calls.push(sql);
          if (sql.includes("INSERT INTO")) {
            draft.inserted.push({ sql, values });
            if (options.failInsert === draft.inserted.length) return Promise.reject(new Error(`private database error ${secret}`));
            if (sql.includes("INSERT INTO collaborators")) draft.users++;
            if (sql.includes("INSERT INTO local_password_hashes")) draft.credentials++;
            if (sql.includes("INSERT INTO audit_events")) draft.receipt = { subjectId: values[1], after: JSON.parse(String(values[4])) as unknown, result: "SUCCESS", eventType: INITIAL_ADMIN_EVENT };
          }
          return Promise.resolve(1);
        },
      };
      const result = await work(transaction); Object.assign(state, draft); return result;
    },
    $disconnect: (): Promise<void> => { disconnects++; return options.failDisconnect ? Promise.reject(new Error(`private disconnect ${secret}`)) : Promise.resolve(); },
  };
  return { client, state, calls, output, disconnected: (): number => disconnects };
}

test("bootstrap is explicit, target-bound and never infers DEV or a PROD identity", () => {
  const configuration = initialAdminConfiguration(input);
  assert.equal(configuration.target.databaseName, "crmynov_stg");
  assert.equal(configuration.email, "admin-staging@example.invalid");
  const invalid: InitialAdminInput[] = [{}, { ...input, enabled: "false" }, { ...input, observedProject: undefined },
    { ...input, environment: "dev", database: "crmynov_dev", project: "crmynov-dev-n7x4q2" },
    { ...input, project: "crmynov-prod-n7x4q2" }, { ...input, database: "crmynov_stg; DROP DATABASE crmynov_prod" },
    { ...input, observedProject: "crmynov-dev-n7x4q2" }, { ...input, delegation: "human-po" },
    { ...input, email: "mounir@example.invalid" }, { ...input, displayName: "Mounir" },
    { ...input, email: " admin-staging@example.invalid" }, { ...input, operationId: "placeholder" },
    { ...input, sourceSha: "main" }, { ...input, decisionSha256: "approved" },
    { ...input, secretVersion: "projects/crmynov-stg-n7x4q2/secrets/crm-staging-initial-admin/versions/latest" },
    { ...input, secretVersion: "projects/crmynov-dev-n7x4q2/secrets/crm-staging-initial-admin/versions/1" },
    { ...input, temporarySecret: "weak" }, { ...input, temporarySecret: `${secret}\n` }];
  for (const candidate of invalid) assert.throws(() => initialAdminConfiguration(candidate));
  const production = { ...input, environment: "prod", project: "crmynov-prod-n7x4q2", database: "crmynov_prod", observedProject: "crmynov-prod-n7x4q2",
    secretVersion: "projects/crmynov-prod-n7x4q2/secrets/crm-prod-initial-admin/versions/7" };
  assert.throws(() => initialAdminConfiguration(production), /identity_not_authorized/u);
  assert.equal(initialAdminConfiguration({ ...production, email: "explicit-authorized-admin@institution.example", displayName: "Explicit future authorized principal" }).target.environment, "prod");
});

test("invalid configuration creates no connection and environment mapping has no identity or secret fallback", async () => {
  assert.equal(initialAdminInput({}).email, undefined); assert.equal(initialAdminInput({}).temporarySecret, undefined);
  let connected = false;
  await assert.rejects(runInitialAdminBootstrap({ input: {}, createClient: (): never => { connected = true; throw new Error("must_not_connect"); }, write: (): never => { throw new Error("must_not_write"); } }));
  assert.equal(connected, false);
});

test("identity and migrator role are checked before all locks or writes", async () => {
  for (const options of [{ database: "crmynov_dev" }, { user: "crm_runtime" }, { user: "postgres" }]) {
    const proof = harness(options);
    await assert.rejects(runInitialAdminBootstrap({ input, createClient: () => proof.client, write: (message): void => { proof.output.push(message); } }));
    assert.equal(proof.calls.length, 1); assert.equal(proof.state.inserted.length, 0); assert.equal(proof.disconnected(), 1); assert.deepEqual(proof.output, []);
  }
});

test("all 52 completed migrations, no unresolved migration, and an uninitialized identity store are required", async () => {
  for (const options of [{ completed: 51 }, { completed: 53 }, { unfinished: 1 }, { occupied: 1 }]) {
    const proof = harness(options);
    await assert.rejects(runInitialAdminBootstrap({ input, createClient: () => proof.client, write: (message): void => { proof.output.push(message); } }));
    assert.equal(proof.state.inserted.length, 0); assert.equal(proof.output.length, 0);
  }
});

test("one transaction creates only the activated synthetic administrator, required-change credential and delegated audit", async () => {
  const proof = harness();
  const result = await runInitialAdminBootstrap({ input, createClient: () => proof.client, write: (message): void => { proof.output.push(message); } });
  assert.equal(result.replayed, false); assert.equal(proof.state.users, 1); assert.equal(proof.state.credentials, 1); assert.equal(proof.state.inserted.length, 3);
  assert.match(proof.calls[3] ?? "", /LOCK TABLE collaborators, local_password_hashes, audit_events IN SHARE ROW EXCLUSIVE MODE/u);
  const [collaborator, password, audit] = proof.state.inserted;
  assert.match(collaborator?.sql ?? "", /ARRAY\['SUPER_ADMIN'\]::text\[\],true,true,1/u);
  assert.equal(collaborator?.values[1], input.email); assert.equal(password?.values[1], result.subjectId);
  assert.equal(password?.values[4], scryptSync(secret, String(password.values[3]), 32).toString("hex"));
  const after = proof.state.receipt?.after as Record<string, unknown>;
  assert.equal(after.executor, "Codex"); assert.equal(after.delegation, INITIAL_ADMIN_GRANT); assert.equal(after.humanReviewClaimed, false);
  assert.equal(after.firstLoginRequired, true); assert.equal(audit?.values[2], INITIAL_ADMIN_EVENT);
  assert.doesNotMatch(JSON.stringify(proof.state), new RegExp(secret, "u")); assert.doesNotMatch(proof.output.join(""), /password|salt|digest|temporarySecret/u);
});

test("same bound receipt replays without resetting credential or first-login state; changed intent refuses", async () => {
  const proof = harness(), dependencies = { input, createClient: (): InitialAdminClient => proof.client, write: (message: string): void => { proof.output.push(message); } };
  const first = await runInitialAdminBootstrap(dependencies), before = structuredClone(proof.state);
  const replay = await runInitialAdminBootstrap(dependencies);
  assert.equal(replay.replayed, true); assert.equal(replay.subjectId, first.subjectId); assert.deepEqual(proof.state, before);
  for (const changed of [{ ...input, sourceSha: "b".repeat(40) }, { ...input, decisionSha256: "c".repeat(64) },
    { ...input, secretVersion: "projects/crmynov-stg-n7x4q2/secrets/crm-staging-initial-admin/versions/2" }]) {
    await assert.rejects(runInitialAdminBootstrap({ ...dependencies, input: changed }), /initial_admin_already_initialized/u);
    assert.deepEqual(proof.state, before);
  }
});

test("credential or audit failure rolls back all writes and logs never expose provider messages", async () => {
  for (const failInsert of [1, 2, 3]) {
    const proof = harness({ failInsert });
    await assert.rejects(runInitialAdminBootstrap({ input, createClient: () => proof.client, write: (message): void => { proof.output.push(message); } }), (error: unknown): boolean => {
      const message = initialAdminFailure(error); assert.doesNotMatch(message, /Synthetic|private|postgresql/u); assert.match(message, /reconcile_before_retry/u); return true;
    });
    assert.equal(proof.state.users, 0); assert.equal(proof.state.credentials, 0); assert.equal(proof.state.inserted.length, 0); assert.equal(proof.output.length, 0);
  }
});

test("a receipt whose identity or credential disappeared is not reported as a completed replay", async () => {
  const proof = harness(), dependencies = { input, createClient: (): InitialAdminClient => proof.client, write: (message: string): void => { proof.output.push(message); } };
  await runInitialAdminBootstrap(dependencies); proof.state.credentials = 0;
  await assert.rejects(runInitialAdminBootstrap(dependencies), /initial_admin_receipt_integrity_invalid/u);
  assert.equal(proof.state.inserted.length, 3); assert.equal(proof.output.length, 1);
});

test("disconnect failure does not report success or mask an earlier target refusal", async () => {
  const proof = harness({ failDisconnect: true, database: "crmynov_dev" });
  await assert.rejects(runInitialAdminBootstrap({ input, createClient: () => proof.client, write: (message): void => { proof.output.push(message); } }), /crm_runtime_database_target_mismatch/u);
  assert.equal(proof.output.length, 0);
  const unknown = initialAdminFailure(new Error(`postgresql://private:${secret}@host/db`)); assert.doesNotMatch(unknown, /postgresql|Synthetic|host/u);
});

test("password encoding matches the existing login verifier and never stores the raw secret", () => {
  const password = initialAdminPassword(secret);
  assert.match(password.identitySalt, /^[a-f0-9]{32}$/u); assert.match(password.passwordDigest, /^[a-f0-9]{64}$/u);
  assert.equal(password.passwordDigest, scryptSync(secret, password.identitySalt, 32).toString("hex"));
  assert.notEqual(password.passwordDigest, initialAdminPassword(secret).passwordDigest);
  assert.doesNotMatch(JSON.stringify(password), new RegExp(secret, "u"));
});
