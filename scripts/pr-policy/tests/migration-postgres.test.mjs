import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("final additive migrations preserve a populated prior state and enforce FK/CHECK on fresh PostgreSQL", { skip: process.env.CRMY171_MIGRATION_TEST !== "true", timeout: 120_000 }, async (t) => {
  const container = `crmy171-migration-${randomUUID()}`;
  const docker = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: "pipe", timeout: 60_000 });
  docker(["run", "-d", "--name", container, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17.6-bookworm"]);
  t.after(() => docker(["rm", "-f", container]));
  for (let n = 0; ; n++) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres"]); break; }
    catch { if (n >= 30) throw Error("synthetic_postgres_not_ready"); await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  const sql = (database, source) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"], { input: source, encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 60_000 }).trim();
  const root = fileURLToPath(new URL("../../../apps/api/prisma/migrations/", import.meta.url));
  const names = readdirSync(root).filter(name => name !== "migration_lock.toml").sort();
  const apply = (database, selected) => { for (const name of selected) sql(database, readFileSync(`${root}/${name}/migration.sql`, "utf8")); };
  sql("postgres", "CREATE DATABASE synthetic_empty; CREATE DATABASE synthetic_prior;");
  apply("synthetic_empty", names);
  apply("synthetic_prior", names.filter(name => name < "20260905"));
  sql("synthetic_prior", `INSERT INTO collaborators(id,professional_email,roles) VALUES ('00000000-0000-4000-8000-000000000001','synthetic-migration@example.invalid',ARRAY['ADMIN']);
    INSERT INTO leads(id,lead_code,first_name,last_name,campus,campaign,education_level,program,source,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','SYN-MIGRATION','Lead','Synthétique','SYN-CAMPUS','SYN-CAMPAIGN','SYN-LEVEL','SYN-PROGRAM','FORMINATOR_ZAPIER',CURRENT_TIMESTAMP);`);
  const snapshot = () => sql("synthetic_prior", "SELECT row_to_json(c) FROM collaborators c; SELECT row_to_json(l) FROM leads l;");
  const before = snapshot(); apply("synthetic_prior", names.filter(name => name >= "20260905")); assert.equal(snapshot(), before);
  for (const database of ["synthetic_empty", "synthetic_prior"]) {
    assert.equal(sql(database, "SELECT count(*) FROM sheet_import_connectors; SELECT count(*) FROM campus_assignment_configurations; SELECT count(*) FROM lead_commercial_qualifications; SELECT count(*) FROM lead_follow_ups; SELECT count(*) FROM lead_follow_up_mutation_receipts;"), "0\n0\n0\n0\n0");
    sql(database, `INSERT INTO sheet_import_connectors(id,campus_id,workbook_id,tab,configuration,updated_by,updated_at) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','synthetic:constraint','Synthétique','{}','00000000-0000-4000-8000-000000000001',CURRENT_TIMESTAMP);
      INSERT INTO sheet_import_runs(id,connector_id,status,trigger) VALUES ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000003','COMPLETED','MANUAL');`);
    assert.equal(sql(database, "SELECT enabled,interval_minutes,manual_requested FROM sheet_import_connectors; SELECT source_failures,configuration_snapshot IS NULL,configuration_version IS NULL FROM sheet_import_runs;"), "f|15|f\n0|t|t");
    assert.throws(() => sql(database, "UPDATE sheet_import_runs SET source_failures=-1;"), /check constraint/);
    assert.throws(() => sql(database, "UPDATE sheet_import_connectors SET interval_minutes=4;"), /check constraint/);
    assert.throws(() => sql(database, "DELETE FROM sheet_import_connectors;"), /foreign key constraint/);
    sql(database, "UPDATE sheet_import_connectors SET id='00000000-0000-4000-8000-000000000006';");
    assert.equal(sql(database, "SELECT connector_id FROM sheet_import_runs;"), "00000000-0000-4000-8000-000000000006");
    assert.equal(sql(database, "SELECT source_failures FROM sheet_import_runs;"), "0");
    const qualificationLead = database === "synthetic_prior" ? "00000000-0000-4000-8000-000000000002" : "00000000-0000-4000-8000-000000000012";
    if (database === "synthetic_empty") sql(database, `INSERT INTO leads(id,lead_code,first_name,last_name,campus,campaign,education_level,program,source,updated_at) VALUES ('${qualificationLead}','SYN-QUALIFICATION','Lead','Synthétique','SYN-CAMPUS','SYN-CAMPAIGN','SYN-LEVEL','SYN-PROGRAM','TEST',CURRENT_TIMESTAMP);`);
    sql(database, `INSERT INTO lead_commercial_qualifications(id,lead_id,temperature,reason,author_id,version,idempotency_key,fingerprint) VALUES ('00000000-0000-4000-8000-000000000013','${qualificationLead}','WARM','Projet synthétique à préciser','synthetic-author',1,'migration-qualification-${database}','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');`);
    assert.equal(sql(database, `SELECT temperature,version FROM lead_commercial_qualifications WHERE lead_id='${qualificationLead}';`), "WARM|1");
    assert.throws(() => sql(database, `INSERT INTO lead_commercial_qualifications(id,lead_id,temperature,reason,author_id,version,idempotency_key,fingerprint) VALUES (gen_random_uuid(),'${qualificationLead}','UNKNOWN','Motif synthétique','synthetic-author',2,'migration-invalid-${database}','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');`), /check constraint/);
    assert.throws(() => sql(database, `INSERT INTO lead_commercial_qualifications(id,lead_id,temperature,reason,author_id,version,idempotency_key,fingerprint) VALUES (gen_random_uuid(),'${qualificationLead}','HOT','Motif synthétique','synthetic-author',0,'migration-zero-${database}','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');`), /check constraint/);
    assert.throws(() => sql(database, `DELETE FROM leads WHERE id='${qualificationLead}';`), /foreign key constraint/);
    const followUpId = database === "synthetic_prior" ? "00000000-0000-4000-8000-000000000014" : "00000000-0000-4000-8000-000000000015";
    sql(database, `INSERT INTO lead_follow_ups(id,lead_id,owner_id,due_at,state,reason,version,idempotency_key,fingerprint,updated_at) VALUES ('${followUpId}','${qualificationLead}','00000000-0000-4000-8000-000000000001',CURRENT_TIMESTAMP + INTERVAL '1 day','SCHEDULED','Relance synthétique',1,'migration-follow-up-${database}','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',CURRENT_TIMESTAMP);
      INSERT INTO lead_follow_up_mutation_receipts(idempotency_key,follow_up_id,fingerprint,result) VALUES ('migration-follow-up-receipt-${database}','${followUpId}','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','{}');`);
    assert.equal(sql(database, `SELECT state,version FROM lead_follow_ups WHERE id='${followUpId}'; SELECT count(*) FROM lead_follow_up_mutation_receipts WHERE follow_up_id='${followUpId}';`), "SCHEDULED|1\n1");
    assert.throws(() => sql(database, `UPDATE lead_follow_ups SET state='UNKNOWN' WHERE id='${followUpId}';`), /check constraint/);
    assert.throws(() => sql(database, `UPDATE lead_follow_ups SET version=0 WHERE id='${followUpId}';`), /check constraint/);
    assert.throws(() => sql(database, `UPDATE lead_follow_ups SET due_at=created_at WHERE id='${followUpId}';`), /check constraint/);
    assert.throws(() => sql(database, `DELETE FROM lead_follow_ups WHERE id='${followUpId}';`), /foreign key constraint/);
    assert.throws(() => sql(database, `DELETE FROM leads WHERE id='${qualificationLead}';`), /foreign key constraint/);
  }
  assert.equal(snapshot(), before);
  t.diagnostic("Both dedicated databases migrated; prior collaborator/Lead unchanged, no automatic qualification/follow-up/assignment/configuration, qualification, follow-up and Sheets RESTRICT/CASCADE/CHECK constraints enforced. Preview and _prisma_migrations untouched.");
});
