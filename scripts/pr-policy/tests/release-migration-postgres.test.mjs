import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("historical release migrations preserve prior data and restore on isolated PostgreSQL", {
  skip: process.env.CRMY174_RELEASE_MIGRATION_TEST !== "true", timeout: 120_000,
}, async t => {
  const container = `crmy174-release-migration-${randomUUID()}`;
  const docker = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  // No published port or network; retain the stopped container and its data.
  docker(["run", "-d", "--name", container, "--network", "none", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"]);
  t.after(() => { docker(["stop", "--time", "30", container]); t.diagnostic(`Preserved isolated container: ${container}`); });
  for (let n = 0; ; n++) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres"]); break; }
    catch { if (n >= 30) throw Error("isolated_postgres_not_ready"); await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  const sql = (database, source) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"], {
    input: source, encoding: "utf8", windowsHide: true, timeout: 60_000,
  }).trim();
  const root = fileURLToPath(new URL("../../../apps/api/prisma/migrations/", import.meta.url));
  const names = readdirSync(root).filter(name => name !== "migration_lock.toml").sort();
  const sources = names.map(name => ({ name, source: readFileSync(`${root}/${name}/migration.sql`, "utf8") }));
  const hashes = sources.map(item => ({ migration: item.name, sha256: createHash("sha256").update(item.source).digest("hex") }));
  const apply = (database, selected) => { for (const item of selected) sql(database, item.source); };
  sql("postgres", "CREATE DATABASE synthetic_empty; CREATE DATABASE synthetic_prior; CREATE DATABASE synthetic_restored;");
  apply("synthetic_empty", sources);
  apply("synthetic_prior", sources.filter(item => item.name < "20260905"));
  sql("synthetic_prior", `INSERT INTO system_probes(id) VALUES ('00000000-0000-4000-8000-000000000001');
    INSERT INTO collaborators(id,professional_email,roles) VALUES ('00000000-0000-4000-8000-000000000002','release-synthetic@example.invalid',ARRAY['ADMIN']);
    INSERT INTO leads(id,lead_code,first_name,last_name,campus,campaign,education_level,program,source,updated_at) VALUES ('00000000-0000-4000-8000-000000000003','SYN-RELEASE','Lead','Synthétique','SYN-CAMPUS','SYN-CAMPAIGN','SYN-LEVEL','SYN-PROGRAM','TEST',CURRENT_TIMESTAMP);`);
  const snapshot = database => sql(database, "SELECT row_to_json(s) FROM system_probes s; SELECT row_to_json(c) FROM collaborators c; SELECT row_to_json(l) FROM leads l;");
  const before = snapshot("synthetic_prior");
  apply("synthetic_prior", sources.filter(item => item.name >= "20260905"));
  assert.equal(snapshot("synthetic_prior"), before);
  assert.throws(() => sql("synthetic_prior", "INSERT INTO system_probes(id) VALUES ('00000000-0000-4000-8000-000000000001');"), /unique constraint/);
  assert.equal(sql("synthetic_prior", "SELECT count(*) FROM sheet_import_connectors WHERE enabled=true; SELECT count(*) FROM telephony_calls;"), "0\n0");
  docker(["exec", container, "pg_dump", "-U", "postgres", "-Fc", "-f", "/tmp/synthetic-prior.dump", "synthetic_prior"]);
  const archiveHash = docker(["exec", container, "sha256sum", "/tmp/synthetic-prior.dump"]).split(" ")[0];
  const archiveBytes = Number(docker(["exec", container, "stat", "-c", "%s", "/tmp/synthetic-prior.dump"]).trim());
  assert.ok(archiveBytes > 0);
  assert.match(docker(["exec", container, "pg_restore", "--list", "/tmp/synthetic-prior.dump"]), /system_probes/);
  docker(["exec", container, "pg_restore", "--exit-on-error", "-U", "postgres", "-d", "synthetic_restored", "/tmp/synthetic-prior.dump"]);
  assert.equal(snapshot("synthetic_restored"), before);
  for (const item of hashes) assert.equal(createHash("sha256").update(readFileSync(`${root}/${item.migration}/migration.sql`)).digest("hex"), item.sha256);
  t.diagnostic(JSON.stringify({ migrationCount: names.length, emptyApplied: true, populatedPreserved: true, isolatedRestoreVerified: true, archiveHash, archiveBytes, hashes }));
  t.diagnostic("Direct SQL sequence on synthetic databases, not Prisma history reconciliation or a Cloud SQL restore; no preview/cloud database accessed.");
});
