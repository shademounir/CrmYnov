import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../src/persistence/prisma.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { UserService } from "../src/users/user.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import {
  digestRecoveryValue,
  LocalCredentialAdapter,
  LocalIdentityDirectory,
  LocalRecoveryChallengeStore,
} from "../src/access-recovery/access-recovery.store.js";

function prismaFixture(): { prisma: PrismaService; calls: string[] } {
  const calls: string[] = [];
  const now = Date.now();
  const client = {
    localSession: {
      findMany: (): Promise<unknown[]> => Promise.resolve([{
        id: "session-persisted",
        collaboratorId: "user-persisted",
        tokenDigest: createHash("sha256").update("persisted-token").digest("hex"),
        roles: ["SUPER_ADMIN"],
        scopes: [{ kind: "GLOBAL" }, { kind: "UNKNOWN" }],
        authenticationVersion: 2,
        active: true,
        expiresAt: new Date(now + 60_000),
        collaborator: { active: true, authenticationVersion: 2, passwordHash: { mustChange: false } },
      }]),
      create: (): Promise<object> => { calls.push("session.create"); return Promise.resolve({}); },
      updateMany: (): Promise<{ count: number }> => { calls.push("session.updateMany"); return Promise.resolve({ count: 1 }); },
    },
    collaborator: {
      findMany: (input?: unknown): Promise<unknown[]> => {
        if (input) return Promise.resolve([{ id: "user-persisted", professionalEmail: "persisted@example.invalid" }]);
        return Promise.resolve([{
          id: "user-persisted",
          professionalEmail: "persisted@example.invalid",
          secondaryEmail: null,
          roles: ["SUPER_ADMIN"],
          campusId: null,
          teamId: null,
          active: true,
          authenticationVersion: 2,
        }]);
      },
      create: (): Promise<object> => { calls.push("collaborator.create"); return Promise.resolve({}); },
      update: (): Promise<object> => { calls.push("collaborator.update"); return Promise.resolve({}); },
    },
    localRecoveryChallenge: {
      findMany: (): Promise<unknown[]> => Promise.resolve([{
        id: "challenge-persisted",
        collaboratorId: "user-persisted",
        tokenDigest: digestRecoveryValue("challenge-token"),
        returnPath: "/access-recovery/complete",
        expiresAt: new Date(now + 60_000),
      }]),
      create: (): Promise<object> => { calls.push("challenge.create"); return Promise.resolve({}); },
      update: (): Promise<object> => { calls.push("challenge.update"); return Promise.resolve({}); },
    },
    localPasswordHash: {
      findMany: (): Promise<unknown[]> => Promise.resolve([{
        collaboratorId: "user-persisted",
        identityDigest: digestRecoveryValue("persisted@example.invalid"),
        passwordSalt: "00".repeat(16),
        passwordDigest: "00".repeat(32),
        mustChange: true,
      }]),
      upsert: (): Promise<object> => { calls.push("password.upsert"); return Promise.resolve({}); },
    },
  };
  return { prisma: { client } as unknown as PrismaService, calls };
}

test("enables Prisma only when the local database URL is configured", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const disabled = new PrismaService();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.client, undefined);
  await disabled.onModuleDestroy();

  process.env.DATABASE_URL = "postgresql://localhost:5432/crmynov_local";
  const enabled = new PrismaService();
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.client);
  await enabled.onModuleDestroy();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});

test("hydrates and persists local sessions and collaborator authorization", async () => {
  const { prisma, calls } = prismaFixture();
  const sessions = new SessionService(prisma);
  await sessions.onModuleInit();
  assert.equal(sessions.authenticate("persisted-token")?.userId, "user-persisted");

  const users = new UserService(sessions, new AuditService(), prisma);
  await users.onModuleInit();
  assert.equal(users.findByProfessionalEmail("PERSISTED@example.invalid")?.id, "user-persisted");
  const created = users.create({ professionalEmail: "created@example.invalid", roles: ["AUDITOR"] }, "actor", "corr-create");
  const issued = sessions.create(created.id, created.roles, [{ kind: "GLOBAL" }], 60_000, false, created.authenticationVersion);
  assert.equal(sessions.authenticate(issued.token)?.userId, created.id);
  users.updateAuthorization(created.id, { roles: ["ADMISSIONS"], campusId: "campus-a", reason: "ACCESS_REVIEW", confirmed: true }, "actor", "corr-update");
  users.completeFirstLogin(created.id);
  await users.flush();
  assert.equal(sessions.revoke(issued.sessionId), true);
  await sessions.flush();
  assert.ok(calls.includes("collaborator.create"));
  assert.ok(calls.includes("collaborator.update"));
  assert.ok(calls.includes("session.create"));
  assert.ok(calls.includes("session.updateMany"));
});

test("hydrates and persists recovery, identity and local password adapters", async () => {
  const { prisma, calls } = prismaFixture();
  const challenges = new LocalRecoveryChallengeStore(prisma);
  await challenges.onModuleInit();
  assert.equal(challenges.consume("challenge-token", "/access-recovery/complete") , "user-persisted");
  challenges.issue("user-persisted", "/access-recovery/complete");
  await challenges.flush();

  const directory = new LocalIdentityDirectory(prisma);
  await directory.onModuleInit();
  assert.equal(directory.resolve(digestRecoveryValue("persisted@example.invalid")), "user-persisted");
  directory.register("new@example.invalid", "user-new");
  assert.equal(directory.has(digestRecoveryValue("new@example.invalid")), true);

  const credentials = new LocalCredentialAdapter(prisma);
  await credentials.onModuleInit();
  credentials.provisionTemporary("user-new", "Temporary1!Synthetic", digestRecoveryValue("new@example.invalid"));
  assert.deepEqual(credentials.verifyIdentity(digestRecoveryValue("new@example.invalid"), "Temporary1!Synthetic"), { subjectId: "user-new", mustChange: true });
  assert.equal(credentials.replaceRequired("user-new", "Temporary1!Synthetic", "Replacement2!Synthetic"), true);
  assert.equal(credentials.requiresChange("user-new"), false);
  credentials.replace("user-new", "Replacement3!Synthetic");
  await credentials.flush();
  assert.ok(calls.includes("challenge.create"));
  assert.ok(calls.includes("challenge.update"));
  assert.ok(calls.includes("password.upsert"));
});
