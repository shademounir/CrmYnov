import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomBytes, randomUUID, createHash, scryptSync } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Role } from "../src/auth/auth.types.js";
import { prepareLeadAuditFixture } from "./helpers/audit-lead-cycle.test.js";
import { assertSharingCycle, type SharingFixture } from "./helpers/view-sharing-cycle.test.js";
import { assertViewMetadata } from "./helpers/view-sharing-metadata.test.js";
import { sharingDatabase, verifySharingDatabase } from "./helpers/view-sharing-database.js";

const loginWindowMs = 60_000; // RateLimitService: five attempts per IP in this real-time window.
const loginMarginMs = 250;

async function awaitLoginWindow(response: Response, firstAttempt: number, report: (message: string) => void): Promise<void> {
  assert.equal(response.status, 429, "sixth login must first hit the unchanged server rate limit");
  assert.deepEqual(await response.json(), { code: "rate_limit_exceeded" });
  const retryAfter = response.headers.get("retry-after");
  let waitMs = loginWindowMs;
  if (retryAfter !== null) {
    const headerMs = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    assert.ok(Number.isFinite(headerMs), "invalid Retry-After: stop without retry");
    waitMs = Math.max(0, headerMs, loginWindowMs - (performance.now() - firstAttempt));
  }
  waitMs = Math.ceil(waitMs) + loginMarginMs;
  assert.ok(waitMs <= 120_000 + loginMarginMs, "Retry-After exceeds the bounded harness wait: stop without retry");
  report(`Five HTTP 201 logins; sixth HTTP 429 confirmed. Retry-After ${retryAfter === null ? "absent (documented 60-second window)" : "present"}; waiting ${waitMs} ms before one retry.`);
  const started = performance.now();
  // Real elapsed time, no fake clock, limiter reset, address change or server restart.
  await new Promise<void>((done) => setTimeout(done, waitMs));
  assert.ok(performance.now() - started >= waitMs - 1, "bounded real-time wait must elapse");
  assert.ok(performance.now() - firstAttempt >= loginWindowMs, "server login window must have expired");
}

async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const result = (server.address() as AddressInfo).port;
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return result;
}
async function api(t: TestContext, databaseUrl: string): Promise<string> {
  const number = await port();
  const child = spawn(process.execPath, [resolve("dist/main.js")], {
    env: { ...process.env, DATABASE_URL: databaseUrl, API_PORT: String(number), LOG_LEVEL: "error" }, windowsHide: true, stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((done) => child.once("exit", () => done())); child.kill(); await stopped;
    }
  });
  const base = `http://127.0.0.1:${number}`;
  for (let attempt = 0; ; attempt++) {
    if (child.exitCode !== null) throw new Error("compiled_api_exited");
    try { if ((await fetch(`${base}/health/ready`)).ok) return base; } catch { /* bounded startup */ }
    if (attempt >= 60) throw new Error("compiled_api_health_timeout");
    await new Promise((done) => setTimeout(done, 500));
  }
}

test("CRMY-170 authenticated sharing / two compiled APIs / ephemeral PostgreSQL", {
  skip: process.env.CRMY170_EPHEMERAL_TEST !== "true" && process.env.CI !== "true" && process.env.CRMY170_TEST_DATABASE_URL === undefined, timeout: 240_000,
}, async (t) => {
  execFileSync(process.execPath, ["../../node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "pipe", timeout: 120_000 });
  const database = sharingDatabase(process.env, () => {
    const container = `crmy170-views-${randomUUID()}`;
    execFileSync("docker", ["run", "-d", "--name", container, "--label", "crmy.ticket=CRMY-170", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_DB=crm_crmy170", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 120_000 });
    t.after(() => execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }));
    const mapped = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" }).trim().split(":").at(-1);
    assert.ok(mapped && /^\d+$/.test(mapped));
    return `postgresql://postgres@127.0.0.1:${mapped}/crm_crmy170`;
  });
  const databaseUrl = database.url;
  const client = new PrismaClient({ datasourceUrl: databaseUrl }); t.after(() => client.$disconnect());
  for (let attempt = 0; ; attempt++) {
    try { await client.$queryRaw`SELECT 1`; break; } catch {
      if (attempt >= 30) throw new Error("ephemeral_postgres_unavailable");
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (database.external) await verifySharingDatabase(client, database.database);
  try {
    execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 60_000 });
  } catch (error) {
    if (database.external) throw new Error("crmy170_preconfigured_migration_failed");
    throw error;
  }
  const initial = await prepareLeadAuditFixture(client), campusA = initial.accounts[0].campusId, campusB = initial.accounts[2].campusId;
  async function account(role: Role, campus: string, team: string | null): Promise<{ id: string; email: string; password: string }> {
    const id = randomUUID(), email = `${id}@example.invalid`, password = `Synth!9${randomBytes(24).toString("hex")}`;
    await client.collaborator.create({ data: { id, professionalEmail: email, roles: [role], campusId: campus, teamId: team, firstLoginRequired: false } });
    const passwordSalt = randomBytes(16).toString("hex");
    await client.localPasswordHash.create({ data: { collaboratorId: id, identityDigest: createHash("sha256").update(email).digest("hex"), passwordSalt, passwordDigest: scryptSync(password, passwordSalt, 32).toString("hex"), mustChange: false } });
    return { id, email, password };
  }
  const manager = await account("MANAGER", campusA, "SYNTHETIC-TEAM"), adviser = await account("ADMISSIONS", campusA, "SYNTHETIC-TEAM");
  const auditor = await account("AUDITOR", campusA, null), superAdmin = await account("SUPER_ADMIN", campusB, null);
  const responsibility = await client.teamResponsibility.create({ data: { teamId: "SYNTHETIC-TEAM", campusId: campusA, managerId: manager.id, active: true } });
  const bases = [await api(t, databaseUrl), await api(t, databaseUrl)];
  const firstAttempt = performance.now();
  let successfulLogins = 0;
  async function token(account: { id: string; email: string; password: string }, role: Role, campus: string, sixth = false): Promise<{ id: string; token: string }> {
    const login = (): Promise<Response> => fetch(`${bases[0]}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(15_000) });
    let response = await login();
    if (sixth) {
      assert.equal(successfulLogins, 5, "five successful initial authentications required");
      await awaitLoginWindow(response, firstAttempt, (message) => t.diagnostic(message));
      response = await login(); // Exactly one retry, only after the real window expires.
    }
    assert.equal(response.status, 201, sixth ? "sixth authentication after window expiry: stop if still refused" : "initial synthetic local authentication");
    const session = await response.json() as { token: string; sessionId: string };
    assert.ok(typeof session.token === "string" && typeof session.sessionId === "string", "valid authentication response without exposing credentials");
    const persisted = await client.localSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    const user = await client.collaborator.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(persisted.collaboratorId, account.id); assert.equal(persisted.active, true);
    assert.deepEqual(persisted.roles, [role]); assert.deepEqual(user.roles, [role]); assert.equal(user.campusId, campus);
    assert.equal(persisted.authenticationVersion, user.authenticationVersion); assert.ok(persisted.expiresAt > new Date());
    assert.ok(persisted.tokenDigest === createHash("sha256").update(session.token).digest("hex"), "session belongs to the returned token");
    successfulLogins++;
    return { id: account.id, token: session.token };
  }
  const fixture: SharingFixture = {
    campusA, campusB, responsibility: responsibility.id, leadId: initial.assignmentLeadId,
    manager: await token(manager, "MANAGER", campusA), adviser: await token(adviser, "ADMISSIONS", campusA), auditor: await token(auditor, "AUDITOR", campusA),
    admin: await token(initial.accounts[0], "ADMIN", campusA), outsider: await token(initial.accounts[2], "ADMIN", campusB), superAdmin: await token(superAdmin, "SUPER_ADMIN", campusB, true),
  };
  assert.equal(successfulLogins, 6);
  t.diagnostic("Rate-limit gate passed: 5 x 201, then 429, actual window expiry, one retry returning 201; all six persisted identities, roles and campuses verified.");
  await assertSharingCycle(client, bases, fixture, (message) => t.diagnostic(message));
  await assertViewMetadata(client, bases, fixture, (message) => t.diagnostic(message));
});
