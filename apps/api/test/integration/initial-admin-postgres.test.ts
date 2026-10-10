import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { deriveSecret } from "../../src/access-recovery/access-recovery.store.js";
import { INITIAL_ADMIN_EVENT, INITIAL_ADMIN_GRANT, type InitialAdminInput } from "../../src/jobs/initial-admin-contract.js";
import { runInitialAdminBootstrap, type InitialAdminClient, type InitialAdminTransaction } from "../../src/jobs/bootstrap-initial-admin.js";

const enabled = process.env.CRMY28_INITIAL_ADMIN_EPHEMERAL_TEST === "true";

test("CRMY-28 initial admin PostgreSQL: atomicity, collision refusal, concurrent one-shot and replay after first login", { skip: !enabled, timeout: 120000 }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid"), nonce = process.env.CRMY28_INITIAL_ADMIN_DATABASE_NONCE;
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/crmynov_stg");
  assert.equal(url.username, "crm_migrator"); assert.match(nonce ?? "", /^[a-f0-9-]{36}$/u);
  const client = new PrismaClient();
  const input: InitialAdminInput = {
    enabled: "true", environment: "staging", project: "crmynov-stg-n7x4q2", database: "crmynov_stg", observedProject: "crmynov-stg-n7x4q2",
    email: "admin-staging@example.invalid", displayName: "Admin synthétique STAGING", operationId: randomUUID(),
    decisionSha256: "d".repeat(64), sourceSha: "a".repeat(40), delegation: INITIAL_ADMIN_GRANT,
    secretVersion: "projects/crmynov-stg-n7x4q2/secrets/crm-staging-initial-admin/versions/1",
    temporarySecret: `Synthetic-Private!9${randomBytes(24).toString("hex")}`,
  };
  const counts = async (): Promise<number[]> => [await client.collaborator.count(), await client.localPasswordHash.count(), await client.auditEvent.count({ where: { eventType: INITIAL_ADMIN_EVENT } })];
  const writes: string[] = [];
  try {
    const marker = await client.$queryRaw<Array<{ nonce: string; purpose: string }>>`SELECT nonce,purpose FROM crmy28_initial_admin_test_identity.marker`;
    assert.equal(marker.length, 1); assert.equal(marker[0]?.nonce, nonce); assert.equal(marker[0]?.purpose, "initial-admin-synthetic-qualification");
    assert.deepEqual(await counts(), [0, 0, 0]);
    // An existing identity, even inactive/non-admin, must not be elevated or replaced.
    const rollback = new Error("synthetic_existing_identity_transaction_rollback");
    await assert.rejects(client.$transaction(async (tx) => {
      const existing = await tx.collaborator.create({ data: { professionalEmail: "existing-synthetic@example.invalid", roles: ["AUDITOR"], active: false } });
      const adapter: InitialAdminClient = { $transaction: (work) => work(tx), $disconnect: (): Promise<void> => Promise.resolve() };
      await assert.rejects(runInitialAdminBootstrap({ input, createClient: () => adapter, write: (message): void => { writes.push(message); } }), /initial_admin_already_initialized/u);
      assert.deepEqual((await tx.collaborator.findUniqueOrThrow({ where: { id: existing.id } })).roles, ["AUDITOR"]);
      assert.equal(await tx.localPasswordHash.count(), 0); assert.equal(await tx.auditEvent.count({ where: { eventType: INITIAL_ADMIN_EVENT } }), 0);
      throw rollback;
    }, { isolationLevel: "Serializable", timeout: 15000 }), (error: unknown): boolean => error === rollback);
    assert.deepEqual(await counts(), [0, 0, 0]);
    // Real SQL inserts for collaborator and credential roll back if the audit fails.
    const faultClient: InitialAdminClient = {
      $transaction: <T>(work: (transaction: InitialAdminTransaction) => Promise<T>, options: { isolationLevel: "Serializable"; maxWait: number; timeout: number }): Promise<T> => client.$transaction((tx) => work({
        $queryRaw: (parts, ...values): Promise<unknown> => tx.$queryRaw(parts, ...values),
        $executeRaw: (parts, ...values): Promise<unknown> => parts.join("").includes("INSERT INTO audit_events")
          ? Promise.reject(new Error("synthetic_audit_failure")) : tx.$executeRaw(parts, ...values),
      }), options), $disconnect: (): Promise<void> => Promise.resolve(),
    };
    await assert.rejects(runInitialAdminBootstrap({ input, createClient: () => faultClient, write: (message): void => { writes.push(message); } }), /synthetic_audit_failure/u);
    assert.deepEqual(await counts(), [0, 0, 0]); assert.equal(writes.length, 0);
    const concurrent = await Promise.allSettled([0, 1].map(() => runInitialAdminBootstrap({ input, createClient: () => new PrismaClient(), write: (message): void => { writes.push(message); } })));
    const completed = concurrent.filter((result) => result.status === "fulfilled");
    assert.ok(completed.length >= 1); assert.equal(completed.filter((result) => !result.value.replayed).length, 1);
    assert.deepEqual(await counts(), [1, 1, 1]);
    const collaborator = await client.collaborator.findUniqueOrThrow({ where: { professionalEmail: "admin-staging@example.invalid" } });
    const credential = await client.localPasswordHash.findUniqueOrThrow({ where: { collaboratorId: collaborator.id } });
    assert.deepEqual(collaborator.roles, ["SUPER_ADMIN"]); assert.equal(collaborator.active, true); assert.equal(collaborator.firstLoginRequired, true);
    assert.equal(collaborator.campusId, null); assert.equal(collaborator.teamId, null); assert.equal(credential.mustChange, true);
    assert.equal(credential.passwordDigest, deriveSecret(input.temporarySecret ?? "", credential.passwordSalt));
    assert.equal(credential.identityDigest, createHash("sha256").update(input.email ?? "").digest("hex"));
    const audit = await client.auditEvent.findFirstOrThrow({ where: { eventType: INITIAL_ADMIN_EVENT } });
    assert.equal(audit.actorId, null); assert.deepEqual(audit.actorRoles, []);
    const after = audit.after as Record<string, unknown>;
    assert.equal(after.executor, "Codex"); assert.equal(after.delegation, INITIAL_ADMIN_GRANT); assert.equal(after.humanReviewClaimed, false);
    assert.doesNotMatch(JSON.stringify({ audit, writes }), /Synthetic-Private/u);
    // This SQL fixture represents a later completed password change, not a claim of UI activation.
    const nextSecret = `Later-Changed!9${randomBytes(24).toString("hex")}`;
    await client.$transaction([
      client.localPasswordHash.update({ where: { collaboratorId: collaborator.id }, data: { passwordDigest: deriveSecret(nextSecret, credential.passwordSalt), mustChange: false } }),
      client.collaborator.update({ where: { id: collaborator.id }, data: { firstLoginRequired: false, authenticationVersion: 2 } }),
    ]);
    const beforeReplay = await client.localPasswordHash.findUniqueOrThrow({ where: { collaboratorId: collaborator.id } });
    const replay = await runInitialAdminBootstrap({ input, createClient: () => new PrismaClient(), write: (message): void => { writes.push(message); } });
    assert.equal(replay.replayed, true); assert.equal(replay.subjectId, collaborator.id); assert.deepEqual(await counts(), [1, 1, 1]);
    assert.deepEqual(await client.localPasswordHash.findUniqueOrThrow({ where: { collaboratorId: collaborator.id } }), beforeReplay);
    assert.equal((await client.collaborator.findUniqueOrThrow({ where: { id: collaborator.id } })).firstLoginRequired, false);
    await assert.rejects(runInitialAdminBootstrap({ input: { ...input, operationId: randomUUID() }, createClient: () => new PrismaClient(), write: (message): void => { writes.push(message); } }), /initial_admin_already_initialized/u);
    assert.deepEqual(await counts(), [1, 1, 1]);
    console.log("CRMY28_INITIAL_ADMIN_ASSERTIONS", JSON.stringify({ existingIdentityRefused: true, atomicAuditFailure: true, concurrentSingleCreation: true,
      requiredFirstLogin: true, existingVerifierCompatible: true, delegatedAudit: true, passwordChangeReplayPreserved: true, changedIntentRefused: true }));
  } finally { await client.$disconnect(); }
});
