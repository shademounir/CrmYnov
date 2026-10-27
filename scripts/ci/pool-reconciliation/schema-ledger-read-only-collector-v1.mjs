// Separate existing-identity schema/ledger observation. Never changes crm_runtime,
// imports application bootstrap, constructs a client, or executes a native job.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {QUERIES as POOL_QUERIES, SESSION_SETTINGS} from './pool-read-only-collector-v1.mjs';

export const PURPOSE = 'SCHEMA_LEDGER_READ_ONLY_V1';
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const QUERIES = Object.freeze({
  identity: POOL_QUERIES.identity,
  migrations: 'SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY migration_name COLLATE "C" LIMIT 101',
  columns: `SELECT c.relname AS table_name, a.attname AS column_name, a.attnum::integer AS position, pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type, a.attnotnull AS not_null, a.attidentity::text AS identity_kind, a.attgenerated::text AS generated_kind, c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname COLLATE "C",a.attnum LIMIT 3001`,
  indexes: `SELECT t.relname AS table_name, c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready, pg_catalog.pg_get_indexdef(i.indexrelid) AS definition FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname COLLATE "C",c.relname COLLATE "C" LIMIT 1001`,
  constraints: `SELECT c.relname AS table_name, k.conname AS constraint_name, k.contype::text AS kind, k.convalidated AS validated, pg_catalog.pg_get_constraintdef(k.oid) AS definition FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname COLLATE "C",k.conname COLLATE "C" LIMIT 1001`,
});
const LIMITS = Object.freeze({migrations:100, columns:3000, indexes:1000, constraints:1000});
const FIELDS = Object.freeze({
  migrations:['migration_name','checksum','finished','rolled_back'],
  columns:['table_name','column_name','position','data_type','not_null','identity_kind','generated_kind','row_security','force_row_security','default_expression'],
  indexes:['table_name','index_name','valid','ready','definition'],
  constraints:['table_name','constraint_name','kind','validated','definition'],
});
export const QUERY_CONTRACT_SHA256 = sha256(JSON.stringify({purpose:PURPOSE,role:'crm_migrator',queries:QUERIES,settings:SESSION_SETTINGS,limits:LIMITS,fields:FIELDS}));
function exactKeys(value, expected) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, 'OBJECT_REQUIRED');
  assert.deepEqual(Object.keys(value).sort((a,b)=>a.localeCompare(b,'en')), [...expected].sort((a,b)=>a.localeCompare(b,'en')), 'EXACT_FIELDS');
}
export function validateSchemaLedgerRequest(request) {
  exactKeys(request, ['schemaVersion','purpose','phase','queryContractSha256']);
  assert.equal(request.schemaVersion,1);
  assert.equal(request.purpose,PURPOSE);
  assert(['PRE','POST'].includes(request.phase));
  assert.equal(request.queryContractSha256,QUERY_CONTRACT_SHA256);
  return request;
}
function timestamp(value) {
  assert.equal(typeof value,'string');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value));
  const millis = Date.parse(value);
  assert(Number.isFinite(millis));
  assert.equal(new Date(millis).toISOString(),value.slice(0,23)+'Z');
  return millis;
}
function identity(rows) {
  assert(Array.isArray(rows) && rows.length===1,'ONE_IDENTITY_REQUIRED');
  const row=rows[0];exactKeys(row,['database','role','read_only','isolation','transaction_started_at','observed_at']);
  assert.equal(row.database,'crmynov_prod');
  assert.equal(row.role,'crm_migrator','SEPARATE_EXISTING_ROLE_REQUIRED');
  assert.equal(row.read_only,'on');assert.equal(row.isolation,'repeatable read');
  const elapsed=timestamp(row.observed_at)-timestamp(row.transaction_started_at);
  assert(row.observed_at>=row.transaction_started_at && elapsed<=25000,'TRANSACTION_TIME');
  return row;
}
function checkedRows(name,rows) {
  assert(Array.isArray(rows) && rows.length<=LIMITS[name],'ROW_BOUND_'+name);
  const text=JSON.stringify(rows);assert(Buffer.byteLength(text)<=524288,'BYTE_BOUND');
  const safe=JSON.parse(text);
  for(const row of safe)exactKeys(row,FIELDS[name]);
  return safe;
}
function validateLedger(rows) {
  assert(rows.length>0,'LEDGER_REQUIRED');
  assert.equal(new Set(rows.map(r=>r.migration_name)).size,rows.length,'UNIQUE_LEDGER');
  for(const row of rows) {
    assert(/^\w+$/u.test(row.migration_name));
    assert(/^[a-f0-9]{64}$/u.test(row.checksum));
    assert.equal(row.finished,true,'FINISHED_LEDGER_REQUIRED');
    assert.equal(row.rolled_back,false,'NO_ROLLED_BACK_LEDGER');
  }
}
export async function collectSchemaLedgerObservation(select,request) {
  validateSchemaLedgerRequest(request);assert.equal(typeof select,'function');
  const initial=identity(await select('identity',QUERIES.identity,[]));
  const snapshot={};
  const names=Object.keys(LIMITS);
  async function readTable(index) {
    if(index===names.length){return;}
    const name=names[index];snapshot[name]=checkedRows(name,await select(name,QUERIES[name],[]));
    return readTable(index+1);
  }
  await readTable(0);
  validateLedger(snapshot.migrations);
  assert(snapshot.columns.length>0 && snapshot.indexes.length>0 && snapshot.constraints.length>0,'SCHEMA_SURFACE_REQUIRED');
  assert(Buffer.byteLength(JSON.stringify(snapshot))<=524288,'SNAPSHOT_BYTE_BOUND');
  const final=identity(await select('identity-final',QUERIES.identity,[]));
  assert.equal(final.transaction_started_at,initial.transaction_started_at,'SAME_TRANSACTION_REQUIRED');
  assert(final.observed_at>=initial.observed_at,'CLOCK_REVERSED');
  return {schemaVersion:1,purpose:PURPOSE,phase:request.phase,queryContractSha256:QUERY_CONTRACT_SHA256,
    identity:{database:final.database,role:final.role,readOnly:final.read_only,isolation:final.isolation},
    transactionStartedAt:final.transaction_started_at,transactionCompletedAt:final.observed_at,snapshot,
    ledgerSha256:sha256(JSON.stringify(snapshot.migrations)),schemaSurfaceSha256:sha256(JSON.stringify({columns:snapshot.columns,indexes:snapshot.indexes,constraints:snapshot.constraints})),
    sourceClaimsOnly:true,nativeEvidenceAuthenticated:false,sameSnapshotAsPool:false,
    schemaCompatibilityProved:false,fullProductionPreflight:false,activationAuthorized:false};
}
export async function runSchemaLedgerReadOnlyCollection(client,request) {
  validateSchemaLedgerRequest(request);assert.equal(typeof client?.$transaction,'function');
  return client.$transaction(async tx=>{
    assert.equal(typeof tx?.$executeRawUnsafe,'function');assert.equal(typeof tx?.$queryRawUnsafe,'function');
    async function applySetting(index) {
      if(index===SESSION_SETTINGS.length){return;}
      await tx.$executeRawUnsafe(SESSION_SETTINGS[index]);
      return applySetting(index+1);
    }
    await applySetting(0);
    return collectSchemaLedgerObservation((_name,sql,parameters)=>tx.$queryRawUnsafe(sql,...parameters),request);
  },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:25000});
}
