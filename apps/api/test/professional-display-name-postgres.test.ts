import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

test("CRMY-170 additive display name: empty database and populated N-1 keep existing values", {
  skip: process.env.CRMY170_EPHEMERAL_TEST !== "true" && process.env.CI !== "true", timeout: 120_000,
}, async (t) => {
  const container = `crmy170-name-${randomUUID()}`;
  execFileSync("docker", ["run", "-d", "--name", container, "--label", "crmy.ticket=CRMY-170", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"], { stdio: "pipe", timeout: 60_000 });
  t.after(() => execFileSync("docker", ["rm", "-f", container], { stdio: "pipe", timeout: 30_000 }));
  for (let attempt = 0; ; attempt++) {
    try { execFileSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { stdio: "pipe" }); break; }
    catch { if (attempt >= 30) throw new Error("ephemeral_postgres_unavailable"); await new Promise((done) => setTimeout(done, 500)); }
  }
  function sql(database: string, input: string): string {
    return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-Atq"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 }).trim();
  }
  const root = resolve("prisma/migrations"), current = "20260903200000_collaborator_display_name";
  const previous = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name < current).map((entry) => entry.name).sort();
  const migration = readFileSync(resolve(root, current, "migration.sql"), "utf8");
  for (const populated of [false, true]) {
    const database = populated ? "synthetic_existing" : "synthetic_empty";
    sql("postgres", `CREATE DATABASE ${database}`);
    for (const name of previous) sql(database, readFileSync(resolve(root, name, "migration.sql"), "utf8"));
    if (populated) sql(database, "INSERT INTO collaborators (id, professional_email, roles, updated_at) VALUES ('00000000-0000-4000-8000-000000000170', 'synthetic-existing@example.invalid', ARRAY['ADMIN'], CURRENT_TIMESTAMP)");
    const before = sql(database, "SELECT row_to_json(c)::text FROM collaborators c ORDER BY id");
    sql(database, migration);
    assert.equal(sql(database, "SELECT is_nullable || ':' || character_maximum_length::text || ':' || COALESCE(column_default, 'NULL') FROM information_schema.columns WHERE table_schema='public' AND table_name='collaborators' AND column_name='professional_display_name'"), "YES:120:NULL");
    assert.equal(sql(database, "SELECT count(*) FROM collaborators WHERE professional_display_name IS NOT NULL"), "0");
    // Compare every old column, not just the new nullable field.
    const after = sql(database, "SELECT (row_to_json(c)::jsonb - 'professional_display_name')::text FROM collaborators c ORDER BY id");
    if (populated) assert.deepEqual(JSON.parse(after), JSON.parse(before)); else assert.equal(after, before);
    assert.equal(sql(database, "SELECT count(*) FROM pg_indexes WHERE tablename='collaborators' AND indexdef LIKE '%professional_display_name%'"), "0");
    t.diagnostic(`${populated ? "Populated N-1" : "Empty database"}: nullable VARCHAR(120), no default/backfill/index; previous columns unchanged.`);
  }
});
