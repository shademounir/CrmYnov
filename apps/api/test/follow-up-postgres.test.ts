import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { createApplication } from "../src/application.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";

const enabled = process.env.CRMY_FOLLOW_UP_POSTGRES === "true";
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const value = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return value;
}

test("Lead follow-ups persist atomically, replay exactly and remain safe across API instances", { skip: !enabled, timeout: 240_000 }, async (t) => {
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

  await client.$executeRawUnsafe("CREATE FUNCTION fail_follow_up_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = 'follow-up-rollback' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$");
  await client.$executeRawUnsafe("CREATE TRIGGER follow_up_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_follow_up_audit()");
  const beforeRollback = await client.lead.findUniqueOrThrow({ where: { id: rollbackLead.id } });
  const rollback = await schedule(firstPort, rollbackLead.id, { ...body, idempotencyKey: "follow-up-rollback" }, "follow-up-rollback"); assert.equal(rollback.status, 503);
  assert.equal(await client.leadFollowUp.count({ where: { leadId: rollbackLead.id } }), 0); assert.equal(await client.leadActivity.count({ where: { leadId: rollbackLead.id } }), 0); assert.equal(await client.auditEvent.count({ where: { correlationId: "follow-up-rollback" } }), 0);
  const afterRollback = await client.lead.findUniqueOrThrow({ where: { id: rollbackLead.id } }); assert.equal(afterRollback.version, beforeRollback.version); assert.equal(afterRollback.nextActionAt, null);
  await client.$executeRawUnsafe("DROP TRIGGER follow_up_audit_failure ON audit_events"); await client.$executeRawUnsafe("DROP FUNCTION fail_follow_up_audit()");

  await second.close(); secondClosed = true; const restarted = await createApplication("error"); const restartPort = await availablePort(); await restarted.listen(restartPort, "127.0.0.1"); t.after(() => restarted.close());
  const persisted = await fetch(`${base(restartPort)}/follow-ups`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(persisted.status, 200); const persistedItems = await persisted.json() as { items: Array<{ id: string }> }; assert.ok(persistedItems.items.some((item) => item.id === createdItem.id));
  t.diagnostic("Schedule/decision transactions, exact replay, two-instance conflicts, campus refusal, audit rollback and restart persistence verified.");
});
