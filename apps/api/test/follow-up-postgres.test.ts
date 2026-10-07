import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { execFileSync, fork } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createApplication } from "../src/application.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";
import { FollowUpPersistenceRepository } from "../src/follow-up/follow-up-persistence.repository.js";

const enabled = process.env.CRMY_FOLLOW_UP_POSTGRES === "true";
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const value = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return value;
}

test("Lead follow-ups persist atomically, replay exactly and remain safe across API instances", { skip: !enabled, timeout: 240_000 }, async (t) => {
  const previousWorkersMode = process.env.CRM_BACKGROUND_WORKERS;
  process.env.CRM_BACKGROUND_WORKERS = "external";
  t.after(() => { if (previousWorkersMode === undefined) delete process.env.CRM_BACKGROUND_WORKERS; else process.env.CRM_BACKGROUND_WORKERS = previousWorkersMode; });
  const container = `crm-follow-up-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", container, "--label", "crmy.test=lead-follow-up", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_DB=crm_follow_up", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 60_000 });
  t.after(() => { execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }); });
  const databasePort = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" }).trim().split(":").at(-1)!;
  const databaseUrl = `postgresql://postgres@127.0.0.1:${databasePort}/crm_follow_up`;
  const client = new PrismaClient({ datasourceUrl: databaseUrl }); t.after(() => client.$disconnect());
  for (let attempt = 0; ; attempt += 1) {
    try { await client.$queryRaw`SELECT 1`; break; }
    catch (error) { if (attempt >= 30) throw error; await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 90_000 });
  process.env.DATABASE_URL = databaseUrl;

  const campus = "SYNTHETIC-FOLLOW-UP-A"; const otherCampus = "SYNTHETIC-FOLLOW-UP-B";
  for (const code of [campus, otherCampus]) await client.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code, label: code, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: code, version: 1 } } } });
  const actorId = randomUUID(); const email = `${actorId}@example.invalid`; const password = `Synt!9${randomBytes(24).toString("hex")}`; const salt = randomBytes(16).toString("hex");
  await client.collaborator.create({ data: { id: actorId, professionalEmail: email, roles: ["ADMIN"], campusId: campus, firstLoginRequired: false } });
  await client.localPasswordHash.create({ data: { collaboratorId: actorId, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: scryptSync(password, salt, 32).toString("hex"), mustChange: false } });
  await client.rolePermissionConfiguration.create({ data: { id: "ROLE:ADMIN:GLOBAL", kind: "ROLE", role: "ADMIN", campus: "GLOBAL", version: 1, versions: { create: { number: 1, grants: { create: Object.entries(defaultConfiguration({ kind: "ROLE", role: "ADMIN", campus: "GLOBAL" })).map(([permission, scope]) => ({ permission, scope })) } } } } });
  const leadData = { firstName: "Lead", lastName: "Synthétique", campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "TEST", assignedToId: actorId };
  const lead = await client.lead.create({ data: { ...leadData, leadCode: "LD-FOLLOW-UP-A", campus } });
  const concurrentLead = await client.lead.create({ data: { ...leadData, leadCode: "LD-FOLLOW-UP-C", campus } });
  const rollbackLead = await client.lead.create({ data: { ...leadData, leadCode: "LD-FOLLOW-UP-R", campus } });
  const outside = await client.lead.create({ data: { ...leadData, leadCode: "LD-FOLLOW-UP-B", campus: otherCampus } });

  const firstPort = await availablePort(); const secondPort = await availablePort(); const first = await createApplication("error"); const second = await createApplication("error");
  await first.listen(firstPort, "127.0.0.1"); await second.listen(secondPort, "127.0.0.1"); let secondClosed = false;
  t.after(async () => { await first.close(); if (!secondClosed) await second.close(); });
  const base = (value: number): string => `http://127.0.0.1:${value}`;
  const login = await fetch(`${base(firstPort)}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); assert.equal(login.status, 201);
  const { token } = await login.json() as { token: string };
  const schedule = (apiPort: number, leadId: string, body: unknown, correlation: string): Promise<Response> => fetch(`${base(apiPort)}/leads/${leadId}/follow-ups`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": correlation }, body: JSON.stringify(body) });
  const decide = (apiPort: number, id: string, body: unknown, correlation: string): Promise<Response> => fetch(`${base(apiPort)}/follow-ups/${id}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": correlation }, body: JSON.stringify(body) });

  const body = { dueAt: "2099-09-10T10:30:00.000Z", reason: "Rappel synthétique", idempotencyKey: "follow-up-http-replay" };
  const created = await schedule(firstPort, lead.id, body, "follow-up-created"); assert.equal(created.status, 201); const createdItem = await created.json() as { id: string; version: number };
  const replay = await schedule(secondPort, lead.id, body, "follow-up-replay"); assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), createdItem);
  assert.equal(await client.leadFollowUp.count({ where: { leadId: lead.id } }), 1); assert.equal(await client.leadFollowUpMutationReceipt.count({ where: { followUpId: createdItem.id } }), 1);
  assert.equal(await client.leadActivity.count({ where: { leadId: lead.id, result: "FOLLOW_UP_SCHEDULED" } }), 1); assert.equal(await client.auditEvent.count({ where: { resourceId: lead.id, eventType: "FOLLOW_UP_SCHEDULED" } }), 1);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).nextActionAt?.toISOString(), body.dueAt);

  const concurrentSchedules = await Promise.all([
    schedule(firstPort, concurrentLead.id, { ...body, idempotencyKey: "follow-up-concurrent-a" }, "follow-up-concurrent-a"),
    schedule(secondPort, concurrentLead.id, { ...body, idempotencyKey: "follow-up-concurrent-b" }, "follow-up-concurrent-b"),
  ]); assert.deepEqual(concurrentSchedules.map((response) => response.status).sort(), [201, 409]); assert.equal(await client.leadFollowUp.count({ where: { leadId: concurrentLead.id } }), 1);

  const decisionBodies = [
    { action: "COMPLETE", reason: "Dossier reçu", expectedVersion: 1, idempotencyKey: "follow-up-decision-a" },
    { action: "CANCEL", reason: "Relance annulée", expectedVersion: 1, idempotencyKey: "follow-up-decision-b" },
  ];
  const decisions = await Promise.all([decide(firstPort, createdItem.id, decisionBodies[0], "follow-up-decision-a"), decide(secondPort, createdItem.id, decisionBodies[1], "follow-up-decision-b")]);
  assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]); const winningIndex = decisions.findIndex((response) => response.status === 200); assert.notEqual(winningIndex, -1); const winning = await decisions[winningIndex]!.json() as Record<string, unknown>;
  const decisionReplay = await decide(winningIndex === 0 ? secondPort : firstPort, createdItem.id, decisionBodies[winningIndex]!, "follow-up-decision-replay"); assert.equal(decisionReplay.status, 200); assert.deepEqual(await decisionReplay.json(), winning);
  assert.equal(await client.leadFollowUpMutationReceipt.count({ where: { followUpId: createdItem.id } }), 2); assert.equal(await client.auditEvent.count({ where: { resourceId: lead.id, eventType: { startsWith: "FOLLOW_UP_" } } }), 2);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).nextActionAt, null);

  const outsideResponse = await schedule(firstPort, outside.id, { ...body, idempotencyKey: "follow-up-outside" }, "follow-up-outside"); assert.equal(outsideResponse.status, 403); assert.equal(await client.leadFollowUp.count({ where: { leadId: outside.id } }), 0);

  const dueNow = new Date("2098-01-01T10:01:00.000Z");
  const dueAt = "2098-01-01T10:00:00.000Z";
  const firstRepository = first.get(FollowUpPersistenceRepository);
  const secondRepository = second.get(FollowUpPersistenceRepository);
  const scanInChild = async (clock: Date): Promise<{ due: number; notifications: number }> => {
    const child = fork(join(__dirname, "fixtures/follow-up-due-worker.ts"), [], { execPath: process.execPath, execArgv: ["--import", "tsx"], env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    const result = await new Promise<{ due: number; notifications: number }>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("synthetic_due_child_timeout")); }, 30_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("synthetic_due_child_exited_before_commit_marker")); });
      child.once("message", (message) => {
        clearTimeout(timer);
        const marker = message as { committed?: boolean; result?: { due: number; notifications: number } };
        if (!marker.committed || !marker.result) reject(new Error("synthetic_due_child_commit_failed"));
        else resolve(marker.result);
      });
      child.send({ now: clock.toISOString() });
    });
    // The marker follows the resolved transaction, not a graceful shutdown.
    // Kill only this test-owned worker, then wait for its real process exit.
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    assert.equal(child.kill("SIGKILL"), true); await exited;
    return result;
  };
  const createReminder = async (suffix: string, ownerId = actorId): Promise<{ lead: typeof lead; item: { id: string; version: number } }> => {
    const fixtureLead = await client.lead.create({ data: { ...leadData, leadCode: `LD-DURABLE-${suffix}`, campus } });
    const response = await schedule(firstPort, fixtureLead.id, { ...body, dueAt, ownerId, idempotencyKey: `follow-up-durable-${suffix}` }, `follow-up-durable-${suffix}`);
    assert.equal(response.status, 201);
    const item = await response.json() as { id: string; version: number };
    return { lead: fixtureLead, item };
  };
  // Fault injection is confined to this disposable database, not a production
  // flag. It fires after the audit write, before notification persistence.
  const crashFixture = await createReminder("CRASH");
  const beforeCrash = await client.leadFollowUp.findUniqueOrThrow({ where: { id: crashFixture.item.id } });
  await client.$executeRawUnsafe(`CREATE FUNCTION fail_due_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id = '${crashFixture.lead.id}' AND NEW.type = 'FOLLOW_UP_DUE' THEN RAISE EXCEPTION 'synthetic_due_notification_failure'; END IF; RETURN NEW; END $$`);
  await client.$executeRawUnsafe("CREATE TRIGGER due_notification_failure BEFORE INSERT ON internal_notifications FOR EACH ROW EXECUTE FUNCTION fail_due_notification()");
  await assert.rejects(() => firstRepository.markDue(dueNow), /synthetic_due_notification_failure/u);
  assert.deepEqual(await client.leadFollowUp.findUniqueOrThrow({ where: { id: crashFixture.item.id } }), beforeCrash);
  assert.equal(await client.auditEvent.count({ where: { resourceId: crashFixture.lead.id, eventType: "FOLLOW_UP_DUE" } }), 0);
  assert.equal(await client.internalNotification.count({ where: { resourceId: crashFixture.lead.id } }), 0);
  assert.equal(await client.leadFollowUpMutationReceipt.count({ where: { followUpId: crashFixture.item.id } }), 1);
  assert.equal(await client.leadActivity.count({ where: { leadId: crashFixture.lead.id } }), 1);
  await client.$executeRawUnsafe("DROP TRIGGER due_notification_failure ON internal_notifications"); await client.$executeRawUnsafe("DROP FUNCTION fail_due_notification()");

  // Lose the response after a real commit, before service refresh. A new API
  // instance must observe the notification without replaying the side effect.
  assert.deepEqual(await scanInChild(dueNow), { due: 1, notifications: 1 });
  assert.deepEqual(await scanInChild(dueNow), { due: 0, notifications: 0 });
  const dueKey = `follow-up-due:${crashFixture.item.id}:v2`;
  const committedNotification = await client.internalNotification.findUniqueOrThrow({ where: { deduplicationKey: dueKey } });
  assert.equal(committedNotification.recipientId, actorId); assert.equal(committedNotification.href, `/leads/${crashFixture.lead.id}/follow-ups`);
  assert.equal((await client.leadFollowUp.findUniqueOrThrow({ where: { id: crashFixture.item.id } })).version, 2);
  assert.equal(await client.auditEvent.count({ where: { resourceId: crashFixture.lead.id, eventType: "FOLLOW_UP_DUE" } }), 1);
  assert.equal(await client.internalNotification.count({ where: { resourceId: crashFixture.lead.id, type: "FOLLOW_UP_DUE" } }), 1);
  assert.deepEqual(await secondRepository.markDue(dueNow), { due: 0, notifications: 0 });

  // More than one batch of older delivered DUE rows must not starve a repair.
  // The locks divide concurrent workers' batches, and the cap is enforced.
  const batch = Array.from({ length: 51 }, (_, index) => ({ leadId: randomUUID(), followUpId: randomUUID(), index }));
  await client.lead.createMany({ data: batch.map((entry) => ({ ...leadData, id: entry.leadId, leadCode: `LD-DURABLE-BATCH-${entry.index}`, campus })) });
  await client.leadFollowUp.createMany({ data: batch.map((entry) => ({
    id: entry.followUpId, leadId: entry.leadId, ownerId: actorId, dueAt: new Date("2098-01-01T09:59:00.000Z"), state: "SCHEDULED",
    reason: "Lot synthétique borné", idempotencyKey: `follow-up-batch:${entry.followUpId}`, fingerprint: "0".repeat(64),
  })) });
  const concurrentDue = await Promise.all([firstRepository.markDue(dueNow, 25), secondRepository.markDue(dueNow, 25)]);
  assert.deepEqual(concurrentDue, [{ due: 25, notifications: 25 }, { due: 25, notifications: 25 }]);
  assert.deepEqual(await firstRepository.markDue(dueNow), { due: 1, notifications: 1 });
  assert.deepEqual(await secondRepository.markDue(dueNow), { due: 0, notifications: 0 });
  const batchIds = batch.map((entry) => entry.leadId);
  assert.equal(await client.auditEvent.count({ where: { resourceId: { in: batchIds }, eventType: "FOLLOW_UP_DUE" } }), 51);
  assert.equal(await client.internalNotification.count({ where: { resourceId: { in: batchIds }, type: "FOLLOW_UP_DUE" } }), 51);
  assert.equal(await client.leadFollowUpMutationReceipt.count({ where: { followUpId: { in: batch.map((entry) => entry.followUpId) } } }), 0);

  const legacyFixture = await createReminder("LEGACY");
  const legacyKey = `follow-up-due:${legacyFixture.item.id}`;
  await client.$transaction(async (tx) => {
    await tx.leadFollowUp.update({ where: { id: legacyFixture.item.id }, data: { state: "DUE", version: 2, updatedAt: dueNow } });
    await tx.auditEvent.create({ data: {
      eventType: "FOLLOW_UP_DUE", resourceType: "LEAD", resourceId: legacyFixture.lead.id, actorId: "system:follow-up-scheduler", actorRoles: [],
      correlationId: legacyKey, result: "SUCCESS", idempotencyKey: legacyKey,
      after: { followUpId: legacyFixture.item.id, state: "DUE", dueAt, version: 2 },
    } });
  });
  const legacyBefore = await client.leadFollowUp.findUniqueOrThrow({ where: { id: legacyFixture.item.id } });
  const legacyAudit = await client.auditEvent.findUniqueOrThrow({ where: { idempotencyKey: legacyKey } });
  const legacyReceipts = await client.leadFollowUpMutationReceipt.findMany({ where: { followUpId: legacyFixture.item.id } });
  const legacyActivities = await client.leadActivity.findMany({ where: { leadId: legacyFixture.lead.id } });
  await client.$executeRawUnsafe(`CREATE FUNCTION fail_due_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id = '${legacyFixture.lead.id}' THEN RAISE EXCEPTION 'synthetic_legacy_notification_failure'; END IF; RETURN NEW; END $$`);
  await client.$executeRawUnsafe("CREATE TRIGGER due_notification_failure BEFORE INSERT ON internal_notifications FOR EACH ROW EXECUTE FUNCTION fail_due_notification()");
  await assert.rejects(() => firstRepository.markDue(dueNow), /synthetic_legacy_notification_failure/u);
  assert.deepEqual(await client.leadFollowUp.findUniqueOrThrow({ where: { id: legacyFixture.item.id } }), legacyBefore);
  assert.deepEqual(await client.auditEvent.findUniqueOrThrow({ where: { idempotencyKey: legacyKey } }), legacyAudit);
  assert.equal(await client.internalNotification.count({ where: { deduplicationKey: legacyKey } }), 0);
  await client.$executeRawUnsafe("DROP TRIGGER due_notification_failure ON internal_notifications"); await client.$executeRawUnsafe("DROP FUNCTION fail_due_notification()");
  const repairs = await Promise.all([firstRepository.markDue(dueNow), secondRepository.markDue(dueNow)]);
  assert.equal(repairs.reduce((total, result) => total + result.due, 0), 0); assert.equal(repairs.reduce((total, result) => total + result.notifications, 0), 1);
  assert.deepEqual(await client.leadFollowUp.findUniqueOrThrow({ where: { id: legacyFixture.item.id } }), legacyBefore);
  assert.deepEqual(await client.auditEvent.findUniqueOrThrow({ where: { idempotencyKey: legacyKey } }), legacyAudit);
  assert.deepEqual(await client.leadFollowUpMutationReceipt.findMany({ where: { followUpId: legacyFixture.item.id } }), legacyReceipts);
  assert.deepEqual(await client.leadActivity.findMany({ where: { leadId: legacyFixture.lead.id } }), legacyActivities);
  assert.equal(await client.internalNotification.count({ where: { deduplicationKey: legacyKey } }), 1);
  assert.deepEqual(await firstRepository.markDue(dueNow), { due: 0, notifications: 0 });

  // A second occurrence has a new identity/recipient; the old read marker,
  // payload and audit remain immutable. Decision replay retains its receipt.
  await client.internalNotification.update({ where: { id: committedNotification.id }, data: { readAt: dueNow } });
  const oldNotification = await client.internalNotification.findUniqueOrThrow({ where: { id: committedNotification.id } });
  const postponedBody = { action: "POSTPONE", dueAt: "2098-01-02T10:00:00.000Z", reason: "Nouvelle échéance synthétique", expectedVersion: 2, idempotencyKey: "follow-up-durable-postpone" };
  const postponed = await decide(firstPort, crashFixture.item.id, postponedBody, "follow-up-durable-postpone"); assert.equal(postponed.status, 200);
  const postponedItem = await postponed.json() as { id: string; version: number; state: string };
  const postponedReplay = await decide(secondPort, crashFixture.item.id, postponedBody, "follow-up-durable-postpone-replay"); assert.equal(postponedReplay.status, 200); assert.deepEqual(await postponedReplay.json(), postponedItem);
  const changedOwner = randomUUID(); await client.leadFollowUp.update({ where: { id: crashFixture.item.id }, data: { ownerId: changedOwner } });
  const nextClock = new Date("2098-01-02T10:01:00.000Z"); assert.deepEqual(await firstRepository.markDue(nextClock), { due: 1, notifications: 1 });
  const nextNotification = await client.internalNotification.findUniqueOrThrow({ where: { deduplicationKey: `follow-up-due:${crashFixture.item.id}:v4` } });
  assert.equal(nextNotification.recipientId, changedOwner); assert.equal(nextNotification.readAt, null);
  assert.deepEqual(await client.internalNotification.findUniqueOrThrow({ where: { id: committedNotification.id } }), oldNotification);
  assert.equal(await client.auditEvent.count({ where: { resourceId: crashFixture.lead.id, eventType: "FOLLOW_UP_DUE" } }), 2);
  assert.equal(await client.leadFollowUpMutationReceipt.count({ where: { followUpId: crashFixture.item.id } }), 2);
  assert.equal(await client.leadActivity.count({ where: { leadId: crashFixture.lead.id } }), 2);
  assert.deepEqual(await secondRepository.markDue(nextClock), { due: 0, notifications: 0 });

  // A matching key/version alone is not a delivery receipt: both the immutable
  // audit and the persisted payload/fingerprint must prove the occurrence.
  await client.internalNotification.update({ where: { id: nextNotification.id }, data: { recipientId: randomUUID() } });
  await assert.rejects(() => firstRepository.markDue(nextClock), /Conflict/u);
  assert.equal(await client.internalNotification.count({ where: { resourceId: crashFixture.lead.id, type: "FOLLOW_UP_DUE" } }), 2);
  await client.internalNotification.update({ where: { id: nextNotification.id }, data: { recipientId: changedOwner, fingerprint: "f".repeat(64) } });
  await assert.rejects(() => firstRepository.markDue(nextClock), /Conflict/u);
  await client.internalNotification.update({ where: { id: nextNotification.id }, data: { fingerprint: nextNotification.fingerprint } });
  assert.deepEqual(await firstRepository.markDue(nextClock), { due: 0, notifications: 0 });

  const inconsistentFixture = await createReminder("INCONSISTENT"); const inconsistentKey = `follow-up-due:${inconsistentFixture.item.id}`;
  await client.leadFollowUp.update({ where: { id: inconsistentFixture.item.id }, data: { state: "DUE", version: 2 } });
  await client.auditEvent.create({ data: { eventType: "OTHER", resourceType: "LEAD", resourceId: inconsistentFixture.lead.id, actorRoles: [], correlationId: inconsistentKey, result: "SUCCESS", idempotencyKey: inconsistentKey, after: { version: 2 } } });
  const inconsistentPayload = { recipientId: actorId, type: "FOLLOW_UP_DUE", priority: "HIGH", resourceType: "LEAD", resourceId: inconsistentFixture.lead.id, href: `/leads/${inconsistentFixture.lead.id}/follow-ups` };
  await client.internalNotification.create({ data: { ...inconsistentPayload, deduplicationKey: inconsistentKey, fingerprint: createHash("sha256").update(JSON.stringify(inconsistentPayload)).digest("hex") } });
  const inconsistentBefore = await client.leadFollowUp.findUniqueOrThrow({ where: { id: inconsistentFixture.item.id } });
  const inconsistentAudit = await client.auditEvent.findUniqueOrThrow({ where: { idempotencyKey: inconsistentKey } });
  await assert.rejects(() => firstRepository.markDue(nextClock), /follow_up_due_legacy_inconsistent/u);
  assert.deepEqual(await client.leadFollowUp.findUniqueOrThrow({ where: { id: inconsistentFixture.item.id } }), inconsistentBefore);
  assert.deepEqual(await client.auditEvent.findUniqueOrThrow({ where: { idempotencyKey: inconsistentKey } }), inconsistentAudit);
  assert.equal(await client.internalNotification.count({ where: { resourceId: inconsistentFixture.lead.id } }), 1);
  // The synthetic owner's normal cancellation makes later test scans possible;
  // the malformed historical evidence itself is never rewritten by the repair.
  const cancelInconsistent = await decide(firstPort, inconsistentFixture.item.id, { action: "CANCEL", reason: "Annulation synthétique après diagnostic", expectedVersion: 2, idempotencyKey: "follow-up-durable-inconsistent-cancel" }, "follow-up-durable-inconsistent-cancel"); assert.equal(cancelInconsistent.status, 200);

  const cancelledFixture = await createReminder("CANCELLED");
  const cancelled = await decide(firstPort, cancelledFixture.item.id, { action: "CANCEL", reason: "Annulée avant échéance", expectedVersion: 1, idempotencyKey: "follow-up-durable-cancelled" }, "follow-up-durable-cancelled"); assert.equal(cancelled.status, 200);
  assert.deepEqual(await firstRepository.markDue(nextClock), { due: 0, notifications: 0 });
  assert.equal(await client.internalNotification.count({ where: { resourceId: cancelledFixture.lead.id } }), 0);

  const racingFixture = await createReminder("CANCEL-RACE", randomUUID());
  const racingCancelBody = { action: "CANCEL", reason: "Annulation concurrente synthétique", expectedVersion: 1, idempotencyKey: "follow-up-durable-cancel-race" };
  const [racingDue, racingCancel] = await Promise.all([firstRepository.markDue(nextClock), decide(secondPort, racingFixture.item.id, racingCancelBody, "follow-up-durable-cancel-race")]);
  if (racingCancel.status === 200) {
    assert.deepEqual(racingDue, { due: 0, notifications: 0 });
    assert.equal(await client.internalNotification.count({ where: { resourceId: racingFixture.lead.id } }), 0);
  } else {
    const failure = await racingCancel.json() as { code?: unknown };
    const failureCode = typeof failure.code === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(failure.code) ? failure.code : "unavailable";
    assert.equal(racingCancel.status, 409, `cancel_race_status:${racingCancel.status};code:${failureCode}`); assert.deepEqual(racingDue, { due: 1, notifications: 1 });
    assert.equal(await client.internalNotification.count({ where: { resourceId: racingFixture.lead.id } }), 1);
    const eventualCancel = await decide(firstPort, racingFixture.item.id, { ...racingCancelBody, expectedVersion: 2, idempotencyKey: "follow-up-durable-cancel-race-retry" }, "follow-up-durable-cancel-race-retry"); assert.equal(eventualCancel.status, 200);
  }
  assert.equal((await client.leadFollowUp.findUniqueOrThrow({ where: { id: racingFixture.item.id } })).state, "CANCELLED");
  assert.deepEqual(await secondRepository.markDue(nextClock), { due: 0, notifications: 0 });

  await client.$executeRawUnsafe("CREATE FUNCTION fail_follow_up_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = 'follow-up-rollback' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$");
  await client.$executeRawUnsafe("CREATE TRIGGER follow_up_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_follow_up_audit()");
  const beforeRollback = await client.lead.findUniqueOrThrow({ where: { id: rollbackLead.id } });
  const rollback = await schedule(firstPort, rollbackLead.id, { ...body, idempotencyKey: "follow-up-rollback" }, "follow-up-rollback"); assert.equal(rollback.status, 503);
  assert.equal(await client.leadFollowUp.count({ where: { leadId: rollbackLead.id } }), 0); assert.equal(await client.leadActivity.count({ where: { leadId: rollbackLead.id } }), 0); assert.equal(await client.auditEvent.count({ where: { correlationId: "follow-up-rollback" } }), 0);
  const afterRollback = await client.lead.findUniqueOrThrow({ where: { id: rollbackLead.id } }); assert.equal(afterRollback.version, beforeRollback.version); assert.equal(afterRollback.nextActionAt, null);
  await client.$executeRawUnsafe("DROP TRIGGER follow_up_audit_failure ON audit_events"); await client.$executeRawUnsafe("DROP FUNCTION fail_follow_up_audit()");

  await second.close(); secondClosed = true; const restarted = await createApplication("error"); const restartPort = await availablePort(); await restarted.listen(restartPort, "127.0.0.1"); t.after(() => restarted.close());
  const persisted = await fetch(`${base(restartPort)}/follow-ups`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(persisted.status, 200); const persistedItems = await persisted.json() as { items: Array<{ id: string }> }; assert.ok(persistedItems.items.some((item) => item.id === createdItem.id));
  assert.deepEqual(await restarted.get(FollowUpPersistenceRepository).markDue(nextClock), { due: 0, notifications: 0 });
  const notificationsResponse = await fetch(`${base(restartPort)}/notifications`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(notificationsResponse.status, 200);
  const notificationPage = await notificationsResponse.json() as { items: Array<{ id: string }>; total: number };
  assert.equal(notificationPage.total, 54); assert.ok(!notificationPage.items.some((item) => item.id === nextNotification.id));
  const crossUserRead = await fetch(`${base(restartPort)}/notifications/${nextNotification.id}/read`, { method: "PATCH", headers: { authorization: `Bearer ${token}` } }); assert.equal(crossUserRead.status, 404);
  t.diagnostic("Atomic due/audit/notification rollback, response-loss/restart replay, 51-row concurrent bounded batches, legacy repair fairness, immutable receipts/audits, second postponed occurrence, persisted owner and cancelled reminders verified.");
});
