// Synthetic injected transports only. No credentials, Prisma client, SQL server or native job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPoolObservation, runPoolReadOnlyCollection, validateCollectionRequest, PURPOSE, QUERIES, SESSION_SETTINGS, QUERY_CONTRACT_SHA256} from '../pool-read-only-collector-v1.mjs';
const uuid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const request = () => ({schemaVersion: 1, purpose: PURPOSE, phase: 'PRE', campusId: uuid(1), campaignId: uuid(2), queryContractSha256: QUERY_CONTRACT_SHA256});
const identity = () => ({database: 'crmynov_prod', role: 'crm_runtime', read_only: 'on', isolation: 'repeatable read', transaction_started_at: '2026-10-27T08:00:00.000000Z', observed_at: '2026-10-27T08:00:00.000001Z'});
function fixture() {
  const calls = [], rows = {identity: [identity()], configuration: [], currentPool: [], versions: [], audits: [], counters: [], references: [], 'identity-final': [{...identity(), observed_at: '2026-10-27T08:00:00.500000Z'}]};
  return {calls, rows, select: async (key, sql, parameters) => {calls.push({key, sql, parameters});return rows[key];}};
}

test('fixed SELECT inventory and settings contain no executable caller SQL or implicit ledger omission claim', () => {
  assert.equal(Object.keys(QUERIES).length, 7);
  for (const sql of Object.values(QUERIES)) {assert(sql.startsWith('SELECT '));assert(!sql.includes(';'));assert(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT)\b|\b(?:pg_advisory[a-z_]*|txid_current)\s*\(/iu.test(sql));}
  assert.equal(SESSION_SETTINGS[0], 'SET TRANSACTION READ ONLY');assert(Object.isFrozen(QUERIES));assert(Object.isFrozen(SESSION_SETTINGS));assert.equal(QUERY_CONTRACT_SHA256.length, 64);
});
test('pool scope is not filtered by expected actor/version/window, hiding mismatches', () => {
  assert(!QUERIES.audits.includes('actor_id='));assert(!QUERIES.audits.includes('occurred_at>'));assert(!QUERIES.versions.includes('version='));assert(!QUERIES.counters.includes('version='));
  assert(QUERIES.audits.includes('minimized_ip IS NULL AND session_id IS NULL'));assert(!QUERIES.audits.includes('session_id,'));assert(!QUERIES.audits.includes('minimized_ip,'));
});
for (const phase of ['PRE', 'POST']) test('collect bounded ' + phase + ' transport without semantic/native acceptance', async () => {
  const f = fixture(), r = request();r.phase = phase;const result = await collectPoolObservation(f.select, r);
  assert.deepEqual(f.calls.map(c=>c.key), ['identity','configuration','currentPool','versions','audits','counters','references','identity-final']);
  for (const c of f.calls) assert.deepEqual(c.parameters, c.key.startsWith('identity') ? [] : c.key==='references' ? [r.campusId,r.campaignId] : [r.campusId]);
  assert.equal(result.phase,phase);for (const key of ['nativeEvidenceAuthenticated','historicalRawHashRecovered','fullProductionPreflight','migrationLedgerObserved','activationAuthorized']) assert.equal(result[key],false);
  assert.equal(result.sourceClaimsOnly,true);assert.deepEqual(Object.keys(result.snapshot),['configuration','currentPool','versions','audits','counters','references']);
});
for (const [name, change] of [
  ['unknown field', r=>r.sql='SELECT 1'],['purpose reuse',r=>r.purpose='RC47_READONLY_PROBE'],['schema',r=>r.schemaVersion=2],['phase',r=>r.phase='APPLY'],['bad campus',r=>r.campusId="x' OR 1=1"],['bad campaign',r=>r.campaignId='ROOT'],['scope collision',r=>r.campaignId=r.campusId],['digest drift',r=>r.queryContractSha256='a'.repeat(64)],['nonstring campus',r=>r.campusId=42],['uppercase uuid',r=>r.campusId='AAAAAAAA-0000-0000-0000-000000000001']
]) test('refuse request '+name+' before select',async()=>{const f=fixture(),r=request();change(r);await assert.rejects(collectPoolObservation(f.select,r));assert.equal(f.calls.length,0);});
for (const [name, change] of [
  ['database',i=>i.database='other'],['role',i=>i.role='crm_migrator'],['writable',i=>i.read_only='off'],['isolation',i=>i.isolation='read committed'],['unknown identity field',i=>i.secret='unexpected'],['missing identity field',i=>delete i.role],['invalid calendar',i=>i.transaction_started_at='2026-02-31T08:00:00.000000Z'],['wrong time precision',i=>i.observed_at='2026-10-27T08:00:00.000Z'],['clock before tx',i=>i.observed_at='2026-10-27T07:59:59.999999Z'],['microsecond before tx',i=>{i.transaction_started_at='2026-10-27T08:00:00.000002Z';i.observed_at='2026-10-27T08:00:00.000001Z';}],['expired transaction',i=>i.observed_at='2026-10-27T08:00:26.000000Z']
]) test('refuse identity '+name+' before business queries',async()=>{const f=fixture();change(f.rows.identity[0]);await assert.rejects(collectPoolObservation(f.select,request()));assert.deepEqual(f.calls.map(c=>c.key),['identity']);});
for (const [key,limit] of Object.entries({identity:1,configuration:1,currentPool:1,versions:1,audits:1,counters:8,references:2})) test('refuse limit sentinel '+key,async()=>{const f=fixture();f.rows[key]=Array.from({length:limit+1},()=>({}));await assert.rejects(collectPoolObservation(f.select,request()),new RegExp('ROW_BOUND_'+key));assert(!f.calls.some(c=>c.key==='identity-final'));});
test('refuse missing identity',async()=>{const f=fixture();f.rows.identity=[];await assert.rejects(collectPoolObservation(f.select,request()),/IDENTITY_MISSING/u);});
test('refuse table-shaped object, not silently accept empty table',async()=>{const f=fixture();f.rows.counters={length:0};await assert.rejects(collectPoolObservation(f.select,request()),/ROW_BOUND_counters/u);});
test('refuse oversized row bytes and never return partial snapshot',async()=>{const f=fixture();f.rows.configuration=[{rules:'x'.repeat(131072)}];await assert.rejects(collectPoolObservation(f.select,request()),/BYTE_BOUND_configuration/u);assert(!f.calls.some(c=>c.key==='identity-final'));});
test('refuse aggregate bound even when individual tables fit',async()=>{const f=fixture();for(const key of ['configuration','currentPool','versions','audits','counters'])f.rows[key]=[{padding:'x'.repeat(110000)}];await assert.rejects(collectPoolObservation(f.select,request()),/SNAPSHOT_BYTE_BOUND/u);});
test('refuse changed transaction',async()=>{const f=fixture();f.rows['identity-final'][0].transaction_started_at='2026-10-27T08:00:00.001000Z';await assert.rejects(collectPoolObservation(f.select,request()),/TRANSACTION_CHANGED/u);});
test('refuse reversed clock at microsecond precision',async()=>{const f=fixture();f.rows.identity[0].observed_at='2026-10-27T08:00:00.000002Z';f.rows['identity-final'][0].observed_at='2026-10-27T08:00:00.000001Z';await assert.rejects(collectPoolObservation(f.select,request()),/CLOCK_REVERSED/u);});
test('propagate SELECT permission error once; no retry or partial result',async()=>{const f=fixture();let attempts=0;await assert.rejects(collectPoolObservation(async(...args)=>{if(args[0]==='audits'){attempts++;throw Error('permission denied');}return f.select(...args);},request()),/permission denied/u);assert.equal(attempts,1);assert(!f.calls.some(c=>c.key==='counters'));});
test('returned snapshot detached from injected transport arrays',async()=>{const f=fixture();f.rows.counters=[{assigned_count:7}];const result=await collectPoolObservation(f.select,request());f.rows.counters[0].assigned_count=99;assert.equal(result.snapshot.counters[0].assigned_count,7);});
test('adapter sets readonly and bounded local timeouts first; all reads in one repeatable-read callback',async()=>{
  const f=fixture(),commands=[];let transactions=0;const client={$transaction:async(callback,options)=>{transactions++;assert.deepEqual(options,{isolationLevel:'RepeatableRead',maxWait:5000,timeout:25000});return callback({$executeRawUnsafe:async sql=>{commands.push(sql);},$queryRawUnsafe:async(sql,...parameters)=>{assert.deepEqual(commands,[...SESSION_SETTINGS]);const key=f.calls.length===7?'identity-final':Object.keys(QUERIES).find(k=>QUERIES[k]===sql);return f.select(key,sql,parameters);}});}};
  const result=await runPoolReadOnlyCollection(client,request());assert.equal(transactions,1);assert.equal(result.migrationLedgerObserved,false);assert.equal(f.calls.length,8);
});
test('adapter fails readonly setup without issuing a read or retry',async()=>{let reads=0,txs=0;const client={$transaction:async callback=>{txs++;return callback({$executeRawUnsafe:async()=>{throw Error('readonly setup denied');},$queryRawUnsafe:async()=>{reads++;return[];}});}};await assert.rejects(runPoolReadOnlyCollection(client,request()),/readonly setup denied/u);assert.equal(reads,0);assert.equal(txs,1);});
test('invalid request cannot open a transaction',async()=>{let calls=0;await assert.rejects(runPoolReadOnlyCollection({$transaction:()=>{calls++;}}, {...request(),phase:'DEPLOY'}));assert.equal(calls,0);});
test('no implicit client or execution authority',async()=>{assert.throws(()=>validateCollectionRequest(null));await assert.rejects(runPoolReadOnlyCollection(null,request()));await assert.rejects(collectPoolObservation(null,request()));});
