import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AuditService } from "../../src/audit/audit.service.js";
import type { Principal } from "../../src/auth/auth.types.js";
import { NotificationPersistenceRepository } from "../../src/notifications/notification-persistence.repository.js";
import { NotificationService } from "../../src/notifications/notification.service.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";

const enabled = process.env.CRMY165_EPHEMERAL_TEST === "true";

test("CRMY-165 notifications survive restart, replay once and refuse cross-user reads", { skip: !enabled }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.ok(["/crmy165_notifications_recipe_20260916", "/crmy94_reconcile_copy_20260922"].includes(database.pathname));
  const recipientId = randomUUID(); const otherId = randomUUID(); const marker = randomUUID();
  const principal: Principal = { userId: recipientId, roles: ["ADMISSIONS"], scopes: [{ kind: "GLOBAL" }], sessionId: randomUUID() };
  const input = { recipientId, type: "FOLLOW_UP_DUE" as const, priority: "HIGH" as const, resourceType: "LEAD" as const, resourceId: marker, href: `/leads/${marker}` };
  const deduplicationKey = `crmy165:${marker}`;
  const prisma = new PrismaService(); const client = prisma.client!;
  let createdId: string | undefined;
  try {
    const first = new NotificationService(new AuditService(), new NotificationPersistenceRepository(prisma));
    await first.onModuleInit(); const created = first.create(input, deduplicationKey); createdId = created.id; await first.flush();
    assert.equal((await first.listForApi(principal, 1, 25)).unread, 1);

    const restarted = new NotificationService(new AuditService(), new NotificationPersistenceRepository(prisma));
    await restarted.onModuleInit();
    assert.equal((await restarted.listForApi(principal, 1, 25)).items[0]?.id, created.id);
    await restarted.markReadForApi(created.id, principal, "crmy165-read");

    const verified = new NotificationService(new AuditService(), new NotificationPersistenceRepository(prisma));
    await verified.onModuleInit();
    assert.ok((await verified.listForApi(principal, 1, 25)).items[0]?.readAt);
    verified.create(input, deduplicationKey); await verified.flush();
    assert.equal(await client.internalNotification.count({ where: { deduplicationKey } }), 1);
    assert.equal((await verified.listForApi({ ...principal, userId: otherId }, 1, 25)).total, 0);
    await assert.rejects(() => verified.markReadForApi(created.id, { ...principal, userId: otherId }, "crmy165-cross-user"), (error: unknown) => JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()).includes("notification_not_found"));
    assert.equal(await client.auditEvent.count({ where: { resourceType: "NOTIFICATION", resourceId: created.id, eventType: "NOTIFICATION_READ" } }), 1);
  } finally {
    if (createdId) await client.auditEvent.deleteMany({ where: { resourceType: "NOTIFICATION", resourceId: createdId } });
    await client.internalNotification.deleteMany({ where: { deduplicationKey } });
    await prisma.onModuleDestroy();
  }
});
