import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashProofBytes as hash } from "./postgres-proof-runtime.mjs";

const identifier = value => {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) throw new Error("cutover_rollback_identifier_invalid");
  return `"${value}"`;
};
// An aggregate has no PostgreSQL variadic argument limit (jsonb_build_array has
// one). Preserve ordinal order even when a schema grows beyond 100 tables.
const jsonArray = expressions => expressions.length
  ? `(SELECT jsonb_agg(entry.value ORDER BY entry.position) FROM (VALUES ${expressions.map((expression, index) => `(${index},${expression})`).join(",")}) AS entry(position,value))`
  : "'[]'::jsonb";

export function cutoverMigrationSets(baseline, current) {
  const valid = value => /^\d{14}_[a-z0-9_]+$/u.test(value);
  if (!baseline.length || [...baseline, ...current].some(value => !valid(value)) || new Set(current).size !== current.length
    || new Set(baseline).size !== baseline.length || baseline.some(value => !current.includes(value))) throw new Error("cutover_rollback_migration_history_invalid");
  const compareIds = (left, right) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  };
  return { legacy: [...baseline].sort(compareIds), added: current.filter(value => !baseline.includes(value)).sort(compareIds) };
}

/** An oracle over observations collected from PostgreSQL by this owned synthetic
 * harness, NOT a maintenance fence or a production restore authorization API.
 * Default read-only and connection limits alone cannot fence privileged clients. */
export function initialRestoreRefusals({ baselineSha256, currentSha256, windowOpenedAt, activeClients, database, applicationRoles }) {
  const reasons = [];
  if (!/^[a-f\d]{64}$/u.test(baselineSha256 ?? "") || baselineSha256 !== currentSha256) reasons.push("BUSINESS_STATE_CHANGED");
  if (windowOpenedAt !== null) reasons.push("WINDOW_REOPENED");
  if (!Array.isArray(activeClients) || activeClients.length !== 0) reasons.push("PRODUCER_OR_CLIENT_ACTIVE");
  if (database?.connectionLimit !== 0 || database?.readOnlyDefault !== true) reasons.push("SYNTHETIC_MAINTENANCE_NOT_CLOSED");
  if (!Array.isArray(applicationRoles) || applicationRoles.length !== 2 || applicationRoles.some(role => role.superuser !== false || role.bypassRls !== false)) reasons.push("APPLICATION_AUTHORITY_UNSAFE");
  return reasons;
}

/** Complete row content, histories, sequence positions and scoped effective
 * database/schema/table/sequence rights for the two synthetic application roles.
 * Not an exhaustive cluster ACL, membership, owner or routine privilege audit.
 * Counts are ancillary: an edit at constant cardinality changes the SHA. */
export function rollbackSnapshot(sql, database, roles, selectedTables) {
  const tables = selectedTables ?? JSON.parse(sql(database, "SELECT COALESCE(jsonb_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'"));
  const rows = tables.map(table => `jsonb_build_object('table','${table}','rows',(SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY to_jsonb(item)::text),'[]') FROM public.${identifier(table)} item))`);
  const sequenceNames = JSON.parse(sql(database, "SELECT COALESCE(jsonb_agg(sequencename ORDER BY sequencename),'[]') FROM pg_sequences WHERE schemaname='public'"));
  // WAL/cache bookkeeping (log_cnt) is not a logical sequence position and is
  // not restored by pg_dump; compare only the actual cursor and called state.
  const sequences = sequenceNames.map(sequence => `jsonb_build_object('sequence','${sequence}','state',(SELECT jsonb_build_object('lastValue',last_value,'isCalled',is_called) FROM public.${identifier(sequence)}))`);
  const privileges = roles.map(role => {
    identifier(role);
    return `jsonb_build_object('role','${role}','schema',jsonb_build_object('usage',has_schema_privilege('${role}','public','USAGE'),'create',has_schema_privilege('${role}','public','CREATE')),
      'database',jsonb_build_object('connect',has_database_privilege('${role}',current_database(),'CONNECT'),'create',has_database_privilege('${role}',current_database(),'CREATE'),'temporary',has_database_privilege('${role}',current_database(),'TEMPORARY')),
      'sequences',${jsonArray(sequenceNames.map(sequence => `jsonb_build_object('sequence','${sequence}','usage',has_sequence_privilege('${role}','public.${sequence}','USAGE'),'select',has_sequence_privilege('${role}','public.${sequence}','SELECT'),'update',has_sequence_privilege('${role}','public.${sequence}','UPDATE'))`))},
      'tables',${jsonArray(tables.map(table => `jsonb_build_object('table','${table}',
      'select',has_table_privilege('${role}','public.${table}','SELECT'),'insert',has_table_privilege('${role}','public.${table}','INSERT'),
      'update',has_table_privilege('${role}','public.${table}','UPDATE'),'delete',has_table_privilege('${role}','public.${table}','DELETE'),
      'truncate',has_table_privilege('${role}','public.${table}','TRUNCATE'),'references',has_table_privilege('${role}','public.${table}','REFERENCES'),'trigger',has_table_privilege('${role}','public.${table}','TRIGGER'))`))})`;
  });
  // One SQL snapshot for all table contents and privileges: no inter-table gap
  // and no hundreds of Docker round trips for a small synthetic qualification.
  const canonicalJson = sql(database, `SELECT jsonb_build_object('rows',${jsonArray(rows)}, 'sequences',${jsonArray(sequences)}, 'privileges',${jsonArray(privileges)})`);
  const snapshot = JSON.parse(canonicalJson);
  // Hash PostgreSQL's canonical JSONB text, not JS-parsed numbers: bigint values
  // beyond Number.MAX_SAFE_INTEGER must not collapse to the same observation.
  return { ...snapshot, canonicalJson, sha256: hash(canonicalJson), tables, rowCounts: snapshot.rows.map(item => ({ table: item.table, count: item.rows.length })) };
}

export function createInitialRollbackProof({ docker, ownedContainer, image, container, nonce, database, proofDirectory, sql }) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/u.test(nonce) || database !== "crmy63_cutover_synthetic") throw new Error("cutover_rollback_scope_invalid");
  const suffix = nonce.replaceAll("-", ""), restoredDatabase = `crmy63_restore_${suffix}`;
  const roles = [`crmy63_rw_${suffix}`, `crmy63_ro_${suffix}`], leadId = randomUUID(), ownerId = randomUUID(), activityId = randomUUID();
  const archive = `/tmp/crmy63-initial-${nonce}.dump`, hostArchive = join(proofDirectory, "initial-synthetic.custom.dump");
  let baseline, baselineWindow, backup, previousConfiguration;
  const own = () => { ownedContainer(image); };
  const query = (db, statement) => { own(); return sql(db, statement); };
  const save = (name, value) => writeFileSync(join(proofDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const marker = db => assert.equal(query(db, "SELECT nonce FROM crmy63_test_identity.marker WHERE purpose='cutover-synthetic-qualification'"), nonce, "Synthetic nonce marker must match before backup or restore");
  const observation = () => {
    marker(database);
    const catalog = JSON.parse(query("postgres", `SELECT jsonb_build_object('connectionLimit',datconnlimit,'readOnlyDefault',COALESCE((SELECT 'default_transaction_read_only=on'=ANY(setconfig) FROM pg_db_role_setting WHERE setdatabase=d.oid AND setrole=0),false)) FROM pg_database d WHERE datname='${database}'`));
    return { baselineSha256: baseline.sha256, currentSha256: rollbackSnapshot(query, database, roles, baseline.tables).sha256,
      windowOpenedAt: JSON.parse(query(database, `SELECT COALESCE(to_jsonb(opened_at),'null'::jsonb) FROM crmy63_test_identity.rollback_window WHERE nonce='${nonce}'`)),
      activeClients: JSON.parse(query("postgres", `SELECT COALESCE(jsonb_agg(jsonb_build_object('pid',pid,'application',application_name,'state',state) ORDER BY pid),'[]') FROM pg_stat_activity WHERE datname='${database}' AND backend_type='client backend'`)),
      database: catalog, applicationRoles: JSON.parse(query("postgres", `SELECT jsonb_agg(jsonb_build_object('superuser',rolsuper,'bypassRls',rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('${roles[0]}','${roles[1]}')`)) };
  };
  return {
    prepare() {
      marker(database);
      assert.equal(query(database, "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"), "47");
      query(database, `INSERT INTO collaborators(id,professional_email,roles,campus_id,active,first_login_required,updated_at) VALUES ('${ownerId}','rollback-${suffix}@example.invalid',ARRAY['MANAGER'],'SYNTHETIC-ROLLBACK',true,false,CURRENT_TIMESTAMP);
        INSERT INTO leads(id,lead_code,first_name,last_name,email,campus,campaign,education_level,program,source,assigned_to_id,updated_at) VALUES ('${leadId}','ROLLBACK-${suffix.slice(0, 8)}','Synthetic','Pre-migration','lead-${suffix}@example.invalid','SYNTHETIC-ROLLBACK','SYNTHETIC','BAC','SYNTHETIC','MANUAL','${ownerId}',CURRENT_TIMESTAMP);
        INSERT INTO lead_activities(id,lead_id,type,result,author_id,correlation_id) VALUES ('${activityId}','${leadId}','LEAD_CREATED','Synthetic pre-migration history','${ownerId}','rollback-${suffix}');
        CREATE TABLE crmy63_test_identity.rollback_window(nonce text PRIMARY KEY, sealed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, opened_at timestamptz);
        INSERT INTO crmy63_test_identity.rollback_window(nonce) VALUES ('${nonce}');
        CREATE ROLE ${identifier(roles[0])} LOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE ROLE ${identifier(roles[1])} LOGIN NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE ON SCHEMA public TO ${identifier(roles[0])},${identifier(roles[1])};
        GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${identifier(roles[0])};
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${identifier(roles[1])};`);
      baseline = rollbackSnapshot(query, database, roles);
      baselineWindow = JSON.parse(query(database, `SELECT to_jsonb(item) FROM crmy63_test_identity.rollback_window item WHERE nonce='${nonce}'`));
      save("rollback-pre-state.json", baseline);
      previousConfiguration = JSON.parse(query("postgres", `SELECT jsonb_build_object('connectionLimit',datconnlimit,'settings',COALESCE((SELECT to_jsonb(setconfig) FROM pg_db_role_setting WHERE setdatabase=d.oid AND setrole=0),'[]'::jsonb)) FROM pg_database d WHERE datname='${database}'`));
      if (previousConfiguration.settings.some(setting => setting.startsWith("default_transaction_read_only="))) throw new Error("cutover_rollback_unexpected_database_setting");
      query("postgres", `ALTER DATABASE ${identifier(database)} CONNECTION LIMIT 0`);
      query("postgres", `ALTER DATABASE ${identifier(database)} SET default_transaction_read_only=on`);
      for (const role of roles) {
        let refused = false;
        try { docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", "SELECT 1"]); }
        catch (error) { refused = /too many connections for database/u.test(String(error.stderr ?? "")); }
        assert.equal(refused, true, "The synthetic non-superuser application connection must actually be refused");
      }
      const closed = observation(); assert.deepEqual(initialRestoreRefusals(closed), []);
      save("rollback-closed-window.json", { ...closed, nonSuperuserConnectionsActuallyRefused: true,
        limitation: "OWNED_SYNTHETIC_PRODUCERS_ONLY_NOT_A_PRODUCTION_FENCE; superusers bypass connection limits and can override default read-only" });
      if (existsSync(hostArchive)) throw new Error("cutover_rollback_archive_already_exists");
      own(); docker(["exec", "--env", "PGAPPNAME=crmy63-initial-backup-admin", container, "pg_dump", "-h", "127.0.0.1", "-U", "postgres", "-d", database, "--format=custom", "--file", archive]);
      const containerSha256 = docker(["exec", container, "sha256sum", archive]).trim().split(/\s+/u)[0];
      const containerSize = Number(docker(["exec", container, "stat", "-c", "%s", archive]).trim());
      docker(["cp", `${container}:${archive}`, hostArchive]);
      const bytes = readFileSync(hostArchive), size = statSync(hostArchive).size;
      assert.ok(size > 0 && size <= 64 * 1024 * 1024); assert.equal(size, containerSize); assert.equal(hash(bytes), containerSha256);
      const listing = docker(["exec", container, "pg_restore", "--list", archive]); assert.match(listing, /TABLE DATA public leads/u); assert.match(listing, /TABLE DATA public _prisma_migrations/u);
      writeFileSync(join(proofDirectory, "initial-synthetic.pg_restore-list.log"), listing, { flag: "wx" });
      const afterDump = observation(); assert.deepEqual(initialRestoreRefusals(afterDump), []);
      backup = { archive: hostArchive, size, sha256: hash(bytes), containerSha256, copiedAndConcordant: true, readableArchiveOnlyAtThisStage: true, createdAt: new Date().toISOString() };
      save("rollback-initial-backup.json", backup);
      // Opening is an actual database event and is never silently cleared. From
      // this point a global rewind is refused, even if counts still match P0.
      query("postgres", `ALTER DATABASE ${identifier(database)} RESET default_transaction_read_only`);
      query("postgres", `ALTER DATABASE ${identifier(database)} CONNECTION LIMIT ${previousConfiguration.connectionLimit}`);
      query(database, `UPDATE crmy63_test_identity.rollback_window SET opened_at=CURRENT_TIMESTAMP WHERE nonce='${nonce}' AND opened_at IS NULL`);
      const opened = observation(); assert.ok(initialRestoreRefusals(opened).includes("WINDOW_REOPENED"));
      query(database, `UPDATE leads SET first_name='Synthetic later edit',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id='${leadId}'`);
      const edited = observation(); assert.ok(initialRestoreRefusals(edited).includes("BUSINESS_STATE_CHANGED"));
      assert.equal(query(database, "SELECT count(*) FROM leads"), String(baseline.rowCounts.find(item => item.table === "leads").count));
      save("rollback-global-refusals.json", { opened: initialRestoreRefusals(opened), editedAtConstantCardinality: initialRestoreRefusals(edited), actualSourceWasNotRestored: true });
      return backup;
    },
    restoreAndVerify() {
      if (!backup || !baseline) throw new Error("cutover_rollback_backup_required");
      own(); marker(database);
      const late = observation(), reasons = initialRestoreRefusals(late);
      assert.ok(reasons.includes("WINDOW_REOPENED") && reasons.includes("BUSINESS_STATE_CHANGED"));
      assert.deepEqual(late.activeClients, [], "All harness applications must be closed before clone restoration");
      const completeSourceBeforeRestore = rollbackSnapshot(query, database, roles);
      assert.equal(hash(readFileSync(hostArchive)), backup.sha256);
      assert.equal(docker(["exec", container, "sha256sum", archive]).trim().split(/\s+/u)[0], backup.sha256);
      assert.equal(Number(docker(["exec", container, "stat", "-c", "%s", archive]).trim()), backup.size);
      assert.equal(query("postgres", `SELECT count(*) FROM pg_database WHERE datname='${restoredDatabase}'`), "0", "Restore target must not already exist");
      docker(["exec", container, "createdb", "-h", "127.0.0.1", "-U", "postgres", restoredDatabase]);
      assert.equal(query(restoredDatabase, "SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");
      const restored = docker(["exec", "--env", "PGAPPNAME=crmy63-initial-restore-admin", container, "pg_restore", "-h", "127.0.0.1", "-U", "postgres", "--dbname", restoredDatabase, "--exit-on-error", "--single-transaction", archive]);
      writeFileSync(join(proofDirectory, "initial-synthetic.restore.log"), restored, { flag: "wx" });
      marker(restoredDatabase);
      assert.deepEqual(JSON.parse(query(restoredDatabase, `SELECT to_jsonb(item) FROM crmy63_test_identity.rollback_window item WHERE nonce='${nonce}'`)), baselineWindow);
      const actual = rollbackSnapshot(query, restoredDatabase, roles); assert.deepEqual(actual, baseline);
      assert.equal(query(restoredDatabase, "SELECT count(*) FROM _prisma_migrations"), "47");
      for (const role of roles) assert.equal(docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", role, "-d", restoredDatabase, "-v", "ON_ERROR_STOP=1", "-Atc", "SELECT count(*) FROM leads"]).trim(), "1");
      let readonlyDenied = false;
      try { docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", roles[1], "-d", restoredDatabase, "-v", "ON_ERROR_STOP=1", "-Atc", `UPDATE leads SET first_name='Forbidden' WHERE id='${leadId}'`]); }
      catch (error) { readonlyDenied = /permission denied for table leads/u.test(String(error.stderr ?? "")); }
      assert.equal(readonlyDenied, true);
      docker(["exec", container, "psql", "-h", "127.0.0.1", "-U", roles[0], "-d", restoredDatabase, "-v", "ON_ERROR_STOP=1", "-Atc", `BEGIN; UPDATE leads SET first_name=first_name WHERE id='${leadId}'; ROLLBACK;`]);
      assert.deepEqual(rollbackSnapshot(query, restoredDatabase, roles), baseline);
      assert.equal(rollbackSnapshot(query, database, roles, baseline.tables).sha256, late.currentSha256);
      const completeSourceAfterRestore = rollbackSnapshot(query, database, roles);
      assert.equal(completeSourceAfterRestore.sha256, completeSourceBeforeRestore.sha256, "Every current source table, including subsequent effects and runtime ledgers, must remain untouched");
      const result = { status: "PASSED", restoredDatabase, sourceDatabase: database, sourcePreserved: true, backup, baselineSha256: baseline.sha256,
        sourceBeforeRestorationSha256: completeSourceBeforeRestore.sha256, sourceAfterRestorationSha256: completeSourceAfterRestore.sha256,
        restoredSha256: actual.sha256, restoredStateActuallyTested: true, tablesCompared: baseline.tables.length, exactRowsHistoriesSequencesPrisma: true,
        expectedRolePrivilegesRestored: true, rolePrivilegeScope: "Two pre-existing synthetic roles: database CONNECT/CREATE/TEMPORARY, public schema USAGE/CREATE, every public table SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER and public sequence USAGE/SELECT/UPDATE; not exhaustive cluster ACLs, roles, memberships, owners or routines",
        oldMigrationCount: 47, readonlyRoleWriteActuallyRefused: true, readWriteRoleTransactionActuallyAllowedThenRolledBack: true,
        globalRestoreRefused: reasons, noCleanDropResetOrProductionRestore: true, productionMaintenanceFenceQualified: false, cloudSqlRestoreClaimed: false };
      save("rollback-restoration-proof.json", result); return result;
    },
  };
}
