import assert from "node:assert/strict";
import test from "node:test";
import { digestRecoveryValue, LocalCredentialAdapter } from "../../src/access-recovery/access-recovery.store.js";
import { AuditService } from "../../src/audit/audit.service.js";
import { SessionService } from "../../src/auth/session.service.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { UserService } from "../../src/users/user.service.js";

const enabled = Boolean(process.env.DATABASE_URL);

test("identity, credential and session survive a local service restart", { skip: !enabled }, async () => {
  const prisma = new PrismaService();
  const client = prisma.client;
  assert.ok(client);
  const email = "persistent-admin@example.invalid";
  await client.localSession.deleteMany({ where: { collaborator: { professionalEmail: email } } });
  await client.localRecoveryChallenge.deleteMany({ where: { collaborator: { professionalEmail: email } } });
  await client.localPasswordHash.deleteMany({ where: { collaborator: { professionalEmail: email } } });
  await client.collaborator.deleteMany({ where: { professionalEmail: email } });

  const sessions = new SessionService(prisma);
  const users = new UserService(sessions, new AuditService(), prisma);
  const credentials = new LocalCredentialAdapter(prisma);
  const user = users.create({ professionalEmail: email, roles: ["SUPER_ADMIN"] }, "synthetic-bootstrap", "persistent-user");
  await users.flush();
  credentials.provisionTemporary(user.id, "Temporary1!Persistent", digestRecoveryValue(email));
  await credentials.flush();
  const created = sessions.create(user.id, user.roles, [{ kind: "GLOBAL" }], 3_600_000, true, user.authenticationVersion);
  await sessions.flush();

  const restartedSessions = new SessionService(prisma);
  await restartedSessions.onModuleInit();
  assert.equal(restartedSessions.authenticate(created.token)?.userId, user.id);

  await client.localSession.deleteMany({ where: { collaboratorId: user.id } });
  await client.localPasswordHash.deleteMany({ where: { collaboratorId: user.id } });
  await client.collaborator.delete({ where: { id: user.id } });
  await prisma.onModuleDestroy();
});
