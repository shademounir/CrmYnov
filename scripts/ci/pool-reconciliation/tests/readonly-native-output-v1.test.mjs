// Entirely synthetic metadata and encrypted observations. Not native acceptance.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateLocalReadOnlyDossier} from '../pool-job-dossier-v1.mjs';
import {sealReadOnlyOutput,sealPoolOutput} from '../pool-sealed-output-v1.mjs';
import {validatePoolObjective,validateReadOnlyNativeExecution,verifyReadOnlyOutputClaims,verifyPoolOutputClaims,readOnlyOutputReadRequests} from '../pool-native-output-v1.mjs';
import {createReadOnlyOutputReader,createPoolOutputReader} from '../pool-output-reader-v1.mjs';
import {fixture,keys} from './readonly-native-output-fixture-v1.mjs';
for(const kind of ['general','ledger']){
  test(kind+' full and canonical job-local references bind the same fetched execution without rewriting metadata',()=>{
    for(const short of [false,true]){
      const f=fixture(kind);if(short)f.job.latestCreatedExecution.name=f.execution.name.split('/').at(-1);
      const before=structuredClone({job:f.job,execution:f.execution});
      assert.equal(validateReadOnlyNativeExecution(f.job,f.execution,f.objective),f.execution);
      assert.equal(verifyReadOnlyOutputClaims(f).sourceBoundClaimsChecked,true);
      assert.deepEqual({job:f.job,execution:f.execution},before);
      f.now+=400000;assert.throws(()=>verifyReadOnlyOutputClaims(f),/FRESH_NATIVE_OUTPUT_REQUIRED/u);
    }
  });
  for(const [name,change]of [
    ['suffix only',f=>f.job.latestCreatedExecution.name='abc123'],
    ['different execution',f=>f.job.latestCreatedExecution.name=f.execution.name.split('/').at(-1)+'-other'],
    ['foreign job short name',f=>f.job.latestCreatedExecution.name='other-job-abc123'],
    ['foreign full URI',f=>f.job.latestCreatedExecution.name=f.execution.name.replace('/jobs/','/foreign/')],
    ['null reference',f=>f.job.latestCreatedExecution=null],
    ['missing reference',f=>delete f.job.latestCreatedExecution],
    ['deleted short reference',f=>{f.job.latestCreatedExecution.name=f.execution.name.split('/').at(-1);f.job.latestCreatedExecution.deleteTime=f.execution.completionTime;}],
    ['matching ambiguous leaf',f=>{f.execution.name=f.objective.jobName+'/executions/abc123';f.job.latestCreatedExecution.name='abc123';}],
    ['matching empty suffix',f=>{f.execution.name=f.objective.jobName+'/executions/'+f.execution.job+'-';f.job.latestCreatedExecution.name=f.execution.name.split('/').at(-1);}],
    ['matching repeated separator',f=>{f.execution.name=f.objective.jobName+'/executions/'+f.execution.job+'--abc123';f.job.latestCreatedExecution.name=f.execution.name.split('/').at(-1);}],
  ])test(kind+' canonical reference rejects '+name,()=>{const f=fixture(kind);change(f);assert.throws(()=>validateReadOnlyNativeExecution(f.job,f.execution,f.objective));});
  test(kind+' dossier and decrypted claims remain source-only, not business/native acceptance',()=>{const f=fixture(kind);validateLocalReadOnlyDossier(f.dossier,p=>fs.readFileSync(new URL('../'+p,import.meta.url)));const r=verifyReadOnlyOutputClaims(f);assert.equal(r.sourceBoundClaimsChecked,true);assert.equal(r.nativeAcceptance,false);assert.equal(r.officialOriginAuthenticatedByThisPureFunction,false);assert.equal(r.activationAuthorized,false);assert.equal(r.output.observation.identity.role,f.p.role);assert.equal(f.objective.serviceAccount,f.p.serviceAccount);assert.equal(f.objective.databaseSecretRef.secret,f.p.secret);assert.throws(()=>validatePoolObjective(f.objective));assert.throws(()=>verifyPoolOutputClaims(f));assert.throws(()=>sealPoolOutput({}, {publicKeyPem:keys.publicKey,context:f.context}));});
  for(const [name,change]of [['CPU',f=>f.job.template.template.containers[0].resources.limits.cpu='8'],['second execution',f=>f.job.executionCount=2],['UID missing',f=>delete f.job.uid],['foreign image',f=>f.execution.template.containers[0].image='other'],['retry',f=>f.execution.retriedCount=1],['ledger/runtime secret swap',f=>f.objective.databaseSecretRef.secret=f.kind==='ledger'?'crm-prod-runtime-database-url':'crm-prod-migrator-database-url'],['service account swap',f=>f.objective.serviceAccount='other'],['stderr',f=>f.logs.entries[0].logName=f.logs.entries[0].logName.replace('stdout','stderr')],['duplicate stdout',f=>f.logs.entries.push(structuredClone(f.logs.entries[0]))],['pagination',f=>f.logs.nextPageToken='more'],['attempt',f=>f.logs.entries[0].labels['run.googleapis.com/task_attempt']='1'],['old evidence',f=>f.now+=400000],['phase replay',f=>f.bundle.request.phase='POST']])test(kind+' output rejects '+name,()=>{const f=fixture(kind);change(f);assert.throws(()=>verifyReadOnlyOutputClaims(f));});
  test(kind+' log-list is a bounded purpose-specific read',()=>{const f=fixture(kind),r=readOnlyOutputReadRequests(f.objective,f.execution.name,f.now);assert.deepEqual(r.map(v=>v.method),['GET','GET','POST']);assert.equal(r[2].url,'https://logging.googleapis.com/v2/entries:list');assert.equal(r[2].body.pageSize,2);assert(r[2].body.filter.includes(f.p.kind));assert(r[2].body.filter.includes('task_attempt'));assert.throws(()=>readOnlyOutputReadRequests(f.objective,f.execution.name+'?injection',f.now));});
}
test('changed decrypted claims never bypass identity, digest or separate-ledger reservations',()=>{for(const kind of ['general','ledger'])for(const change of [o=>o.identity.role='other',o=>o.activationAuthorized=true,o=>o.nativeEvidenceAuthenticated=true,o=>o.phase='POST',o=>{if(kind==='general')o.snapshotSha256='b'.repeat(64);else o.ledgerSha256='b'.repeat(64);},o=>{if(kind==='general')o.separateLedgerRequired=false;else o.schemaCompatibilityProved=true;}]){const f=fixture(kind);change(f.payload.observation);f.logs.entries[0].jsonPayload=sealReadOnlyOutput(f.payload,{publicKeyPem:keys.publicKey,context:f.context});assert.throws(()=>verifyReadOnlyOutputClaims(f));}});
test('generic reader reuses sequential durable GET/GET/log-list, historical facade remains pool-only',async()=>{const f=fixture('ledger'),writes=[],calls=[],authority={entry:{scope:f.objective.purpose},receipt:{verifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}},reader=createReadOnlyOutputReader({accessToken:async()=> 'synthetic-token',getAuthority:()=>authority,fetchImpl:async(url,options)=>{calls.push({url,method:options.method});const value=[f.job,f.execution,f.logs][calls.length-1];return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});}});const r=await reader({dossier:f.dossier,execution:f.execution.name,privateKeyPem:keys.privateKey,clock:()=>f.now,save:async(n,v)=>writes.push({n,v})});assert.equal(r.nativeAcceptance,false);assert.equal(r.officialReadPathExecuted,true);assert.equal(calls.length,3);assert.deepEqual(writes.map(w=>w.n),['NATIVE-OUTPUT-0-INTENT','NATIVE-OUTPUT-0-RESULT','NATIVE-OUTPUT-1-INTENT','NATIVE-OUTPUT-1-RESULT','NATIVE-OUTPUT-2-INTENT','NATIVE-OUTPUT-2-RESULT']);const poolReader=createPoolOutputReader({accessToken:async()=>{throw Error('must not ask token');},getAuthority:()=>authority});await assert.rejects(poolReader({dossier:f.dossier}));});
