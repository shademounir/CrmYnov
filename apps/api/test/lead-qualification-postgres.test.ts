import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { createApplication } from "../src/application.js";
import { defaultConfiguration } from "../src/permissions/dynamic-evaluator.js";

const enabled = process.env.CRMY_QUALIFICATION_POSTGRES === "true";
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const value = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return value;
}

test("commercial qualification HTTP/PostgreSQL is scoped, atomic, replayable and multi-instance safe", { skip: !enabled, timeout: 240_000 }, async (t) => {
  const container = `crm-qualification-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", container, "--label", "crmy.test=lead-qualification", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_DB=crm_qualification", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 60_000 });
  t.after(() => { execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }); });
  const databasePort = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" }).trim().split(":").at(-1)!;
  const databaseUrl = `postgresql://postgres@127.0.0.1:${databasePort}/crm_qualification`;
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  t.after(() => client.$disconnect());
  for (let attempt = 0; ; attempt += 1) {
    try { await client.$queryRaw`SELECT 1`; break; }
    catch (error) { if (attempt >= 30) throw error; await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 90_000 });
  process.env.DATABASE_URL = databaseUrl;

  const campus = "SYNTHETIC-QUALIFICATION-A";
  const otherCampus = "SYNTHETIC-QUALIFICATION-B";
  for (const code of [campus, otherCampus]) await client.crmReference.create({ data: { kind: "CAMPUS", scope: "GLOBAL", scopeKey: "GLOBAL", code, label: code, keys: { create: { kind: "CAMPUS", scopeKey: "GLOBAL", key: code, version: 1 } } } });
  const actorId = randomUUID();
  const email = `${actorId}@example.invalid`;
  const password = `Synt!9${randomBytes(24).toString("hex")}`;
  const salt = randomBytes(16).toString("hex");
  await client.collaborator.create({ data: { id: actorId, professionalEmail: email, roles: ["ADMIN"], campusId: campus, firstLoginRequired: false } });
  await client.localPasswordHash.create({ data: { collaboratorId: actorId, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt: salt, passwordDigest: scryptSync(password, salt, 32).toString("hex"), mustChange: false } });
  const superActorId = randomUUID(); const superEmail = `${superActorId}@example.invalid`; const superSalt = randomBytes(16).toString("hex");
  await client.collaborator.create({ data: { id: superActorId, professionalEmail: superEmail, roles: ["SUPER_ADMIN"], firstLoginRequired: false } });
  await client.localPasswordHash.create({ data: { collaboratorId: superActorId, identityDigest: createHash("sha256").update(superEmail).digest("hex"), passwordSalt: superSalt, passwordDigest: scryptSync(password, superSalt, 32).toString("hex"), mustChange: false } });
  const grants = { ...defaultConfiguration({ kind: "ROLE", role: "ADMIN", campus: "GLOBAL" }), "lead.qualification.update": "CAMPUS" as const };
  await client.rolePermissionConfiguration.create({ data: { id: "ROLE:ADMIN:GLOBAL", kind: "ROLE", role: "ADMIN", campus: "GLOBAL", version: 1, versions: { create: { number: 1, grants: { create: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })) } } } } });
  const lead = await client.lead.create({ data: { leadCode: "LD-QUALIFICATION-A", firstName: "Lead", lastName: "Synthétique", campus, campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "TEST" } });
  const outside = await client.lead.create({ data: { leadCode: "LD-QUALIFICATION-B", firstName: "Lead", lastName: "Hors campus", campus: otherCampus, campaign: "Campagne synthétique", educationLevel: "BAC", program: "Programme synthétique", source: "TEST" } });

  const firstPort = await port(); const secondPort = await port();
  const first = await createApplication("error"); const second = await createApplication("error");
  await first.listen(firstPort, "127.0.0.1"); await second.listen(secondPort, "127.0.0.1");
  let secondClosed = false;
  t.after(async () => { await first.close(); if (!secondClosed) await second.close(); });
  const base = (value: number): string => `http://127.0.0.1:${value}`;
  const login = await fetch(`${base(firstPort)}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 201);
  const { token } = await login.json() as { token: string };
  const superLogin = await fetch(`${base(firstPort)}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: superEmail, password }) });
  assert.equal(superLogin.status, 201); const { token: superToken } = await superLogin.json() as { token: string };
  const request = (apiPort: number, leadId: string, body: unknown, correlation: string): Promise<Response> => fetch(`${base(apiPort)}/leads/${leadId}/qualification`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-correlation-id": correlation }, body: JSON.stringify(body) });

  const before = await fetch(`${base(firstPort)}/leads/${lead.id}/qualification`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(before.status, 200); assert.deepEqual((await before.json() as { current: { temperature: string; version: number } }).current, { leadId: lead.id, temperature: "UNEVALUATED", temperatureLabel: "Non évalué", version: 0 });
  const body = { temperature: "HOT", reason: "Intérêt explicite et prochaine étape datée", expectedVersion: 0, idempotencyKey: "qualification:http-replay" };
  const created = await request(firstPort, lead.id, body, "qualification-created"); assert.equal(created.status, 200);
  const firstResult = await created.json() as { id: string; version: number };
  const replay = await request(secondPort, lead.id, body, "qualification-replay"); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), firstResult);
  assert.equal(await client.leadCommercialQualification.count({ where: { leadId: lead.id } }), 1);
  assert.equal(await client.auditEvent.count({ where: { resourceId: lead.id, eventType: "LEAD_QUALIFICATION_UPDATED" } }), 1);
  assert.equal((await client.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "PROSPECT");

  const concurrency = await Promise.all([
    request(firstPort, lead.id, { temperature: "WARM", reason: "Projet à préciser", expectedVersion: 1, idempotencyKey: "qualification:concurrent-a" }, "qualification-concurrent-a"),
    request(secondPort, lead.id, { temperature: "COLD", reason: "Projet sans échéance", expectedVersion: 1, idempotencyKey: "qualification:concurrent-b" }, "qualification-concurrent-b"),
  ]);
  assert.deepEqual(concurrency.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await client.leadCommercialQualification.count({ where: { leadId: lead.id } }), 2);
  assert.equal(await client.auditEvent.count({ where: { resourceId: lead.id, eventType: "LEAD_QUALIFICATION_UPDATED" } }), 2);

  const outsideResponse = await request(firstPort, outside.id, { temperature: "WARM", reason: "Projet synthétique", expectedVersion: 0, idempotencyKey: "qualification:outside" }, "qualification-outside");
  assert.equal(outsideResponse.status, 403); assert.equal(await client.leadCommercialQualification.count({ where: { leadId: outside.id } }), 0);
  const superResponse = await fetch(`${base(firstPort)}/leads/${outside.id}/qualification`, { method: "PATCH", headers: { authorization: `Bearer ${superToken}`, "content-type": "application/json", "x-correlation-id": "qualification-super-global" }, body: JSON.stringify({ temperature: "WARM", reason: "Qualification globale synthétique", expectedVersion: 0, idempotencyKey: "qualification:super-global" }) });
  assert.equal(superResponse.status, 200); assert.equal(await client.leadCommercialQualification.count({ where: { leadId: outside.id } }), 1);

  await client.$executeRawUnsafe("CREATE FUNCTION fail_qualification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id = 'qualification-rollback' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END $$");
  await client.$executeRawUnsafe("CREATE TRIGGER qualification_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_qualification_audit()");
  const current = await client.leadCommercialQualification.findFirstOrThrow({ where: { leadId: lead.id }, orderBy: { version: "desc" } });
  const rollback = await request(firstPort, lead.id, { temperature: "HOT", reason: "Rollback synthétique", expectedVersion: current.version, idempotencyKey: "qualification:rollback" }, "qualification-rollback");
  assert.equal(rollback.status, 503);
  assert.equal(await client.leadCommercialQualification.count({ where: { leadId: lead.id } }), 2);
  assert.equal(await client.auditEvent.count({ where: { correlationId: "qualification-rollback" } }), 0);
  await client.$executeRawUnsafe("DROP TRIGGER qualification_audit_failure ON audit_events");
  await client.$executeRawUnsafe("DROP FUNCTION fail_qualification_audit()");

  await second.close(); secondClosed = true;
  const restarted = await createApplication("error"); const restartPort = await port(); await restarted.listen(restartPort, "127.0.0.1");
  t.after(() => restarted.close());
  const persisted = await fetch(`${base(restartPort)}/leads/${lead.id}/qualification`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(persisted.status, 200); assert.equal((await persisted.json() as { current: { version: number } }).current.version, 2);
  t.diagnostic("Admin campus scope, Super Admin global scope, two API instances, one PostgreSQL transaction fence, exact replay, optimistic conflict, inter-campus refusal, rollback and restart persistence verified.");
});
