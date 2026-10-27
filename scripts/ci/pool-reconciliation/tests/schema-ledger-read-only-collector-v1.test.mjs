import test from 'node:test';
import assert from 'node:assert/strict';
import {PURPOSE,QUERIES,QUERY_CONTRACT_SHA256,validateSchemaLedgerRequest,collectSchemaLedgerObservation,runSchemaLedgerReadOnlyCollection} from '../schema-ledger-read-only-collector-v1.mjs';
const request=()=>({schemaVersion:1,purpose:PURPOSE,phase:'PRE',queryContractSha256:QUERY_CONTRACT_SHA256});
function fixture() {
  const identity={database:'crmynov_prod',role:'crm_migrator',read_only:'on',isolation:'repeatable read',transaction_started_at:'2026-10-27T10:00:00.000000Z',observed_at:'2026-10-27T10:00:00.000001Z'};
  const snapshot={migrations:[{migration_name:'20260101000000_synthetic',checksum:'a'.repeat(64),finished:true,rolled_back:false}],
    columns:[{table_name:'synthetic',column_name:'id',position:1,data_type:'text',not_null:true,identity_kind:'',generated_kind:'',row_security:false,force_row_security:false,default_expression:null}],
    indexes:[{table_name:'synthetic',index_name:'synthetic_pkey',valid:true,ready:true,definition:'CREATE UNIQUE INDEX synthetic_pkey ON public.synthetic USING btree (id)'}],
    constraints:[{table_name:'synthetic',constraint_name:'synthetic_pkey',kind:'p',validated:true,definition:'PRIMARY KEY (id)'}]};
  const final={...identity,observed_at:'2026-10-27T10:00:00.000002Z'},calls=[];
  const select=async(name,sql,parameters)=>{calls.push(name);assert.equal(sql,QUERIES[name==='identity-final'?'identity':name]);assert.deepEqual(parameters,[]);return name==='identity'?[identity]:name==='identity-final'?[final]:snapshot[name];};
  return {identity,final,snapshot,calls,select};
}
test('separate existing-role observation reports claims not native or pool snapshot',async()=>{const f=fixture(),r=await collectSchemaLedgerObservation(f.select,request());assert.equal(f.calls.length,6);assert.equal(r.identity.role,'crm_migrator');assert.equal(r.nativeEvidenceAuthenticated,false);assert.equal(r.sameSnapshotAsPool,false);assert.equal(r.schemaCompatibilityProved,false);assert.equal(r.activationAuthorized,false);assert.equal(r.ledgerSha256.length,64);});
for(const [name,change] of [
  ['runtime identity',f=>f.identity.role='crm_runtime'],['foreign database',f=>f.identity.database='other'],['write transaction',f=>f.identity.read_only='off'],['weak isolation',f=>f.identity.isolation='read committed'],['missing identity',f=>delete f.identity.role],['extra identity field',f=>f.identity.other=true],['bad timestamp',f=>f.identity.observed_at='2026-02-31T10:00:00.000001Z'],['expired transaction',f=>f.final.observed_at='2026-10-27T10:00:26.000000Z'],['transaction changed',f=>f.final.transaction_started_at='2026-10-27T10:00:00.000001Z'],['clock reversed',f=>f.final.observed_at='2026-10-27T10:00:00.000000Z'],['ledger absent',f=>f.snapshot.migrations=[]],['unfinished migration',f=>f.snapshot.migrations[0].finished=false],['rolled back',f=>f.snapshot.migrations[0].rolled_back=true],['wrong checksum',f=>f.snapshot.migrations[0].checksum='x'],['duplicate migration',f=>f.snapshot.migrations.push({...f.snapshot.migrations[0]})],['missing schema surface',f=>f.snapshot.columns=[]],['unexpected metadata',f=>f.snapshot.columns[0].private=true],['row bound',f=>f.snapshot.migrations=Array(101).fill(f.snapshot.migrations[0])],['byte bound',f=>f.snapshot.indexes[0].definition='x'.repeat(524289)]
])test('schema/ledger refuses '+name,async()=>{const f=fixture();change(f);await assert.rejects(collectSchemaLedgerObservation(f.select,request()));});
test('request cannot supply SQL, role or connection',()=>{for(const value of [{...request(),role:'crm_runtime'},{...request(),sql:'SELECT 1'},{...request(),purpose:'POOL_RECONCILIATION_READ_ONLY_V1'},{...request(),queryContractSha256:'b'.repeat(64)},{...request(),phase:'REPAIR'}])assert.throws(()=>validateSchemaLedgerRequest(value));});
test('transaction settings precede every fixed SELECT and permission failure is not omitted',async()=>{
  const commands=[],f=fixture();const client={$transaction:async(callback,options)=>{assert.deepEqual(options,{isolationLevel:'RepeatableRead',maxWait:5000,timeout:25000});return callback({$executeRawUnsafe:async sql=>commands.push(sql),$queryRawUnsafe:async sql=>{assert.equal(commands.length,4);assert(sql.startsWith('SELECT '));assert(!sql.includes(';'));if(sql===QUERIES.migrations)throw Error('synthetic permission denied');return [f.identity];}});}};
  await assert.rejects(runSchemaLedgerReadOnlyCollection(client,request()),/permission denied/u);assert.equal(commands[0],'SET TRANSACTION READ ONLY');assert(commands.every(c=>c.startsWith('SET ')));
});
