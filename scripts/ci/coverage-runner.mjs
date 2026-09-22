import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { waitForPostgres } from "./postgres-readiness.mjs";

// Invoked inside c8 by the same canonical command locally and in CI. All child
// processes inherit NODE_V8_COVERAGE; c8 alone produces/remaps the final LCOV.
const run = (program, args, options = {}) => execFileSync(program, args, { windowsHide: true, stdio: "inherit", timeout: 900_000, ...options });
const docker = args => run("docker", args, { stdio: "pipe", timeout: 90_000, encoding: "utf8" });
const npm = args => run(process.execPath, [process.env.npm_execpath, ...args]);

async function verifyDatabase(url, nonce) {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await client.$queryRaw`SELECT nonce FROM crmy171_test_identity.marker`;
    if (rows.length !== 1 || rows[0].nonce !== nonce) throw Error("coverage_database_identity_mismatch");
    const tables = await client.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
    if (tables[0]?.count !== 0) throw Error("coverage_database_not_empty");
  } finally { await client.$disconnect(); }
}

async function postgresProofs() {
  let container;
  const precreated = process.env.CRMY171_COVERAGE_PRECREATED === "true";
  const nonce = precreated ? process.env.CRMY171_DATABASE_NONCE : randomUUID();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(nonce ?? "")) throw Error("coverage_database_nonce_invalid");
  let port = "5432";
  try {
    if (!precreated) {
      container = `crmy171-coverage-${randomUUID()}`;
      docker(["run", "-d", "--name", container, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"]);
      await waitForPostgres(container, docker);
      port = docker(["port", container, "5432"]).trim().split(":").at(-1);
      if (!/^\d+$/u.test(port ?? "")) throw Error("coverage_postgres_port_invalid");
      for (const database of ["crmy171_synthetic", "crmy171_http_synthetic"]) {
        docker(["exec", container, "createdb", "-h", "127.0.0.1", "-U", "postgres", database]);
        docker(["exec", container, "psql", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-c", `CREATE SCHEMA crmy171_test_identity; CREATE TABLE crmy171_test_identity.marker(nonce text NOT NULL); INSERT INTO crmy171_test_identity.marker VALUES ('${nonce}');`]);
      }
    }
    const direct = `postgresql://postgres@127.0.0.1:${port}/crmy171_synthetic`;
    const http = `postgresql://postgres@127.0.0.1:${port}/crmy171_http_synthetic`;
    await verifyDatabase(direct, nonce); await verifyDatabase(http, nonce);
    run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: direct } });
    run(process.execPath, ["--import", "tsx", "--test", "test/integration/notification-postgres.test.ts"], {
      cwd: "apps/api", env: { ...process.env, DATABASE_URL: direct, CRMY165_EPHEMERAL_TEST: "true", CRMY171_DATABASE_NONCE: nonce },
    });
    for (const [testFile, flag] of [["telephony-postgres.test.ts", "CRMY165_TELEPHONY_TEST"], ["telephony-agent-postgres.test.ts", "CRMY165_AGENT_TEST"]]) {
      run(process.execPath, ["--import", "tsx", "--test", `test/integration/${testFile}`], {
        cwd: "apps/api", env: { ...process.env, DATABASE_URL: direct, [flag]: "true", CRMY171_DATABASE_NONCE: nonce },
      });
    }
    run(process.execPath, ["--import", "tsx", "--test", "test/sheet-import-postgres.test.ts"], { cwd: "apps/api", env: { ...process.env, DATABASE_URL: direct, CRMY171_EPHEMERAL_TEST: "true" } });
    for (const testFile of ["sheet-local-postgres.test.ts", "sheet-local-executor-postgres.test.ts", "sheet-local-admin-postgres.test.ts"]) {
      run(process.execPath, ["--import", "tsx", "--test", `test/${testFile}`], { cwd: "apps/api", env: { ...process.env, DATABASE_URL: direct, CRMY171_EPHEMERAL_TEST: "true" } });
    }
    run(process.execPath, ["--import", "tsx", "--test", "test/sheet-import-http-postgres.test.ts"], { cwd: "apps/api", env: { ...process.env, CRMY171_HTTP_TEST: "true", CRMY171_HTTP_PRECREATED_URL: http, CRMY171_DATABASE_NONCE: nonce } });
  } finally { if (container) docker(["rm", "-f", container]); }
}

function leadWorkflowPostgresProofs() {
  for (const [testFile, enabledFlag] of [
    ["lead-qualification-postgres.test.ts", "CRMY_QUALIFICATION_POSTGRES"],
    ["follow-up-postgres.test.ts", "CRMY_FOLLOW_UP_POSTGRES"],
  ]) {
    run(process.execPath, ["--import", "tsx", "--test", `test/${testFile}`], {
      cwd: "apps/api",
      env: { ...process.env, [enabledFlag]: "true" },
    });
  }
}

if (!process.env.NODE_V8_COVERAGE) throw Error("coverage_instrumentation_required");
if (process.env.DATABASE_URL) throw Error("coverage_must_not_inherit_database");
npm(["test"]);
await postgresProofs();
leadWorkflowPostgresProofs();
