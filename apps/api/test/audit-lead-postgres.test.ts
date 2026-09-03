import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertLeadAuditCycle, prepareLeadAuditFixture } from "./helpers/audit-lead-cycle.test.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePort); });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port;
}

const enabled = process.env.CRMY54_EPHEMERAL_TEST === "true" || process.env.CI === "true";
async function runCompiledAudit(t: TestContext, additionRollbackOnly: boolean): Promise<void> {
  // Same compiler and configuration as the official API build. Never run Nest under tsx.
  execFileSync(process.execPath, ["../../node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "pipe", timeout: 120_000 });
  const entry = resolve("dist/main.js");
  assert.ok(readFileSync(resolve("dist/assignment/lead-assignment.service.js"), "utf8").includes('__metadata("design:paramtypes"'));
  const container = `crmy54-lead-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", container, "--label", "crmy.ticket=CRMY-54", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_DB=crm_crmy54_lead", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 120_000 });
  t.after(() => { execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }); });
  const port = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" }).trim().split(":").at(-1)!;
  assert.match(port, /^\d+$/);
  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/crm_crmy54_lead`;
  const client = new PrismaClient({ datasourceUrl: databaseUrl }); t.after(() => client.$disconnect());
  for (let attempt = 0; ; attempt++) {
    try { await client.$queryRaw`SELECT 1`; break; } catch (error) {
      if (attempt >= 30) throw error; await new Promise((done) => setTimeout(done, 500));
    }
  }
  execFileSync(process.execPath, ["../../node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 60_000 });
  const fixture = await prepareLeadAuditFixture(client), apiPort = await availablePort();
  const child = spawn(process.execPath, [entry], { env: { ...process.env, DATABASE_URL: databaseUrl, API_PORT: String(apiPort), LOG_LEVEL: "error" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  const capture = (chunk: Buffer): void => { serverLog = (serverLog + chunk.toString("utf8")).slice(-32_000); };
  child.stdout.on("data", capture); child.stderr.on("data", capture);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((done) => child.once("exit", () => done())); child.kill(); await stopped;
    }
  });
  const base = `http://127.0.0.1:${apiPort}`;
  try {
    for (let attempt = 0; ; attempt++) {
      if (child.exitCode !== null) throw new Error("compiled_api_exited_before_healthcheck");
      try { const response = await fetch(`${base}/health/ready`); if (response.ok) break; } catch { /* bounded readiness wait */ }
      if (attempt >= 60) throw new Error("compiled_api_healthcheck_timeout");
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.equal(child.spawnargs[1], entry); assert.ok(child.pid);
    t.diagnostic(`API process verified: node dist/main.js; PID ${child.pid}; readiness HTTP 200; dedicated localhost PostgreSQL.`);
    await assertLeadAuditCycle(client, base, fixture, (message) => t.diagnostic(message), additionRollbackOnly);
  } catch (error) {
    let redacted = serverLog;
    for (const account of fixture.accounts) redacted = redacted.replaceAll(account.password, "[REDACTED]").replaceAll(account.email, "[SYNTHETIC_ID]");
    const errors = redacted.split(/\r?\n/).filter((line) => /(?:TypeError|ReferenceError|Error:|Exception)/.test(line));
    if (errors.length) t.diagnostic(errors.join("\n").replace(/Bearer\s+\S+|[a-f\d]{64,}|postgresql:\/\/\S+/gi, "[REDACTED]"));
    throw error;
  }
}

test("CRMY-54 compiled HTTP API / ephemeral PostgreSQL: collaborator addition rollback and retry", { skip: !enabled, timeout: 240_000 }, async (t) => runCompiledAudit(t, true));
test("CRMY-54 compiled HTTP API / ephemeral PostgreSQL: assignment then complete Lead audit cycle", { skip: !enabled, timeout: 240_000 }, async (t) => runCompiledAudit(t, false));
