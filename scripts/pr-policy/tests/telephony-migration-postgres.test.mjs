import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("telephony migrations preserve populated calls and support the documented ephemeral rollback", { skip: process.env.CRMY165_MIGRATION_TEST !== "true", timeout: 120_000 }, async (t) => {
  const container = `crmy165-migration-${randomUUID()}`;
  const docker = (args) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: "pipe", timeout: 60_000 });
  docker(["run", "-d", "--name", container, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"]);
  t.after(() => docker(["rm", "-f", container]));
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres"]); break; }
    catch { if (attempt >= 30) throw Error("synthetic_postgres_not_ready"); await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  const sql = (database, source) => execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"],
    { input: source, encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 60_000 },
  ).trim();
  const root = fileURLToPath(new URL("../../../apps/api/prisma/migrations/", import.meta.url));
  const names = readdirSync(root).filter((name) => name !== "migration_lock.toml").sort();
  const firstTelephonyMigration = "20260916143000_persist_telephony_masked_phone";
  const apply = (database, selected) => {
    for (const name of selected) sql(database, readFileSync(`${root}/${name}/migration.sql`, "utf8"));
  };

  sql("postgres", "CREATE DATABASE telephony_empty; CREATE DATABASE telephony_populated;");
  apply("telephony_empty", names);
  apply("telephony_populated", names.filter((name) => name < firstTelephonyMigration));
  sql("telephony_populated", `
    INSERT INTO telephony_calls(id,provider,external_id,direction,state,phone_fingerprint,match_state,requested_at,created_by)
    VALUES ('00000000-0000-4000-8000-000000000101','LIBLINPHONE','synthetic-before-migration','OUTBOUND','REQUESTED','synthetic-fingerprint','MATCHED',CURRENT_TIMESTAMP,'synthetic-admin');
  `);
  const before = sql("telephony_populated", "SELECT id,provider,external_id,state FROM telephony_calls ORDER BY id;");
  apply("telephony_populated", names.filter((name) => name >= firstTelephonyMigration));
  assert.equal(sql("telephony_populated", "SELECT id,provider,external_id,state FROM telephony_calls ORDER BY id;"), before);
  assert.equal(sql("telephony_populated", "SELECT masked_phone,dispatch_state,purpose_code IS NULL,purpose_comment IS NULL FROM telephony_calls WHERE external_id='synthetic-before-migration';"), "***|ACCEPTED|t|t");

  for (const database of ["telephony_empty", "telephony_populated"]) {
    assert.equal(sql(database, "SELECT character_maximum_length FROM information_schema.columns WHERE table_name='telephony_user_profiles' AND column_name='state';"), "40");
    sql(database, `
      INSERT INTO collaborators(id,professional_email,roles)
      VALUES ('00000000-0000-4000-8000-000000000111','synthetic-telephony@example.invalid',ARRAY['ADMIN'])
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO telephony_server_profiles(id,name,sip_domain,transport,enabled,version,created_by,updated_by,updated_at)
      VALUES ('00000000-0000-4000-8000-000000000112','Pilote synthétique','sip.example.invalid','TLS',false,1,'synthetic-admin','synthetic-admin',CURRENT_TIMESTAMP);
      INSERT INTO telephony_user_profiles(id,user_id,server_profile_id,sip_address,state,version,updated_by,updated_at)
      VALUES ('00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000112','sip:synthetic@example.invalid','PROFILE_READY_FOR_REGISTRATION',1,'synthetic-admin',CURRENT_TIMESTAMP);
    `);
    assert.throws(() => sql(database, `
      INSERT INTO telephony_user_profiles(id,user_id,server_profile_id,sip_address,state,version,updated_by,updated_at)
      VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000112','sip:duplicate@example.invalid','INCOMPLETE',1,'synthetic-admin',CURRENT_TIMESTAMP);
    `), /unique constraint/);
    assert.throws(() => sql(database, `
      INSERT INTO telephony_workstations(id,user_profile_id,public_id,display_name,token_digest,agent_version,sdk_version)
      VALUES (gen_random_uuid(),'00000000-0000-4000-8000-999999999999','synthetic-workstation','Poste synthétique','synthetic-token','test','test');
    `), /foreign key constraint/);
  }

  sql("telephony_empty", `
    BEGIN;
    ALTER TABLE telephony_calls DROP COLUMN purpose_comment;
    ALTER TABLE telephony_calls DROP COLUMN purpose_code;
    DROP TABLE telephony_agent_commands;
    DROP TABLE telephony_workstations;
    DROP TABLE telephony_pairing_codes;
    DROP TABLE telephony_user_profiles;
    DROP TABLE telephony_server_profiles;
    ROLLBACK;
  `);
  assert.equal(sql("telephony_empty", "SELECT to_regclass('public.telephony_server_profiles') IS NOT NULL, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telephony_calls' AND column_name='purpose_code');"), "t|t");
  t.diagnostic("Empty and populated isolated databases migrated; prior call preserved, defaults/FK/uniqueness/widening verified, and documented ephemeral rollback order executed inside a rolled-back transaction. Preview and its _prisma_migrations history were untouched.");
});
