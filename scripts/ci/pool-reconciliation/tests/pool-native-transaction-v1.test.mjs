import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fixture,sources,request,jobName,env,keys} from './pool-operational-transport-v1.test.mjs';
import {buildPoolJobDossier,validateLocalPoolDossier} from '../pool-job-dossier-v1.mjs';
import {poolDatabaseBinding} from '../pool-runtime-entry-v1.mjs';
import {openPoolTransactionJournal,dispatchPoolOnce,observePoolOperation,createPoolNativeTransport} from '../pool-native-transaction-v1.mjs';
const dossier=()=>buildPoolJobDossier({sources,request,jobName,nonce:'c'.repeat(64),databaseBindingSha256:poolDatabaseBinding(env.DATABASE_URL),publicKeyPem:keys.publicKey,cloudSqlConnectionName:'crmynov-prod-n7x4q2:europe-west1:synthetic-instance',databaseSecretVersion:'1',intentAt:'2026-10-27T09:00:00.000Z'});
const now=Date.parse('2026-10-27T09:00:00.100Z');
const authority=()=>({receipt:{verifiedAt:new Date(now-100).toISOString(),expiresAt:new Date(now+600000).toISOString()}});
const op='projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/synthetic-op';
function journalFixture(t){const d=dossier(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'crm-pool-journal-synthetic-'));const journal=openPoolTransactionJournal({directory,objective:d.objective,initialize:true});t.after(()=>journal.close());return {d,directory,journal};}
test('dossier uses exact protected source bytes, existing runtime secret version and one read-only task',()=>{
  const d=dossier();validateLocalPoolDossier(d,file=>fs.readFileSync(new URL('../'+file,import.meta.url)));assert.equal(d.job.template.taskCount,1);assert.equal(d.job.template.template.maxRetries,0);assert.equal(d.job.template.template.serviceAccount,'crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com');
  d.bundle.modules.entry.source+=' ';assert.throws(()=>validateLocalPoolDossier(d,file=>fs.readFileSync(new URL('../'+file,import.meta.url))));
});
test('create intent durable before POST and occupied across reopen',async t=>{
  const {d,directory,journal}=journalFixture(t);let posts=0,auth=0,absence=0;
  const transport={requireAbsent:async()=>{absence++;},create:async()=>{posts++;assert.equal(journal.inspect('CREATE').state,'INTENT');return {name:op};}};
  const result=await dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>{auth++;return authority();},transport,journal,clock:()=>now});assert.equal(result.state,'OPERATION');assert.equal(posts,1);assert.equal(auth,2);assert.equal(absence,2);journal.close();
  const reopened=openPoolTransactionJournal({directory,objective:d.objective});t.after(()=>reopened.close());assert.equal(reopened.inspect('CREATE').operation,op);await assert.rejects(dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal:reopened,clock:()=>now}),/CONSUMED_INTENT/u);assert.equal(posts,1);
});
for(const response of ['throw','bad-operation'])test('unknown create '+response+' cannot be replayed',async t=>{
  const {d,journal}=journalFixture(t);let posts=0;const transport={requireAbsent:async()=>{},create:async()=>{posts++;if(response==='throw')throw Error('lost');return {name:'https://other/operation'};}};
  const result=await dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now});assert.equal(result.state,'UNKNOWN');await assert.rejects(dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now}));assert.equal(posts,1);
});
test('failed second absence or expired authority sends zero POST',async t=>{
  const {d,journal}=journalFixture(t);let absence=0,posts=0;const transport={requireAbsent:async()=>{if(++absence===2)throw Error('exists');},create:async()=>{posts++;}};
  await assert.rejects(dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now}));assert.equal(posts,0);assert.equal(journal.inspect('CREATE'),null);
  transport.requireAbsent=async()=>{};await assert.rejects(dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now+600001}));assert.equal(posts,0);assert.equal(journal.inspect('CREATE'),null);
});
test('unreviewed create body refused before native read',async t=>{const {d,journal}=journalFixture(t);d.job.template.taskCount=2;let calls=0;await assert.rejects(dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>{calls++;return authority();},transport:{},journal,clock:()=>now}),/REVIEWED_CREATE_BODY/u);assert.equal(calls,0);});
async function createReconciled(d,journal){const f=fixture(),job={...f.job,labels:structuredClone(d.job.labels),template:structuredClone(d.job.template),etag:'synthetic-etag'};const transport={requireAbsent:async()=>{},create:async()=>({name:op}),operation:async()=>({name:op,done:true,response:{name:d.objective.jobName,uid:job.uid}}),getJob:async()=>job};await dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now});await observePoolOperation({objective:d.objective,stage:'CREATE',transport,journal});return {job,transport};}
test('run uses reconciled UID/latest etag and consumes before one POST',async t=>{
  const {d,journal}=journalFixture(t),{job,transport}=await createReconciled(d,journal);let posts=0;
  transport.listExecutions=async()=>{};transport.run=async(name,etag)=>{posts++;assert.equal(name,d.objective.jobName);assert.equal(etag,job.etag);assert.equal(journal.inspect('RUN').state,'INTENT');return {name:op+'-run'};};
  const result=await dispatchPoolOnce({dossier:d,stage:'RUN',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now});assert.equal(result.state,'OPERATION');assert.equal(posts,1);await assert.rejects(dispatchPoolOnce({dossier:d,stage:'RUN',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now}));
});
for(const [name,change] of [['old execution',j=>j.executionCount=1],['unknown latest execution',j=>j.latestCreatedExecution={}],['UID changed',j=>j.uid='different-uid'],['missing etag',j=>delete j.etag]])test('run blocks '+name,async t=>{const {d,journal}=journalFixture(t),{job,transport}=await createReconciled(d,journal);change(job);transport.listExecutions=async()=>{};let posts=0;transport.run=async()=>{posts++;};await assert.rejects(dispatchPoolOnce({dossier:d,stage:'RUN',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now}));assert.equal(posts,0);assert.equal(journal.inspect('RUN'),null);});
test('creation reconciliation refuses operation UID mismatch and remains occupied',async t=>{const {d,journal}=journalFixture(t),f=fixture();const transport={requireAbsent:async()=>{},create:async()=>({name:op}),operation:async()=>({name:op,done:true,response:{name:d.objective.jobName,uid:'different-uid'}}),getJob:async()=>({...f.job,labels:d.job.labels,template:d.job.template})};await dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now});await assert.rejects(observePoolOperation({objective:d.objective,stage:'CREATE',transport,journal}));assert.equal(journal.inspect('CREATE').state,'OPERATION');});
test('only journal-known operation accepted; pending is read-only',async t=>{const {d,journal}=journalFixture(t);let reads=0;const transport={requireAbsent:async()=>{},create:async()=>({name:op}),operation:async name=>{reads++;assert.equal(name,op);return {name,done:false};}};await assert.rejects(observePoolOperation({objective:d.objective,stage:'CREATE',transport,journal}));assert.equal(reads,0);await dispatchPoolOnce({dossier:d,stage:'CREATE',authorizeFresh:async()=>authority(),transport,journal,clock:()=>now});assert.equal((await observePoolOperation({objective:d.objective,stage:'CREATE',transport,journal})).state,'PENDING');assert.equal(journal.inspect('CREATE').state,'OPERATION');});
test('native HTTP run allows etag only, fixed scope, and fresh guard after token',async()=>{
  const d=dossier();let requests=[];const live={receipt:{verifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}};
  const transport=createPoolNativeTransport({accessToken:async()=> 'synthetic-token',getAuthority:()=>live,fetchImpl:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({name:op}),{status:200,headers:{'content-type':'application/json'}});}});
  await transport.run(d.objective.jobName,'etag');assert.deepEqual(JSON.parse(requests[0].options.body),{etag:'etag'});assert.equal(requests[0].options.redirect,'error');assert(requests[0].url.startsWith('https://run.googleapis.com/v2/projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-pool-reconcile-'));
  live.receipt.expiresAt=new Date(Date.now()-1).toISOString();await assert.rejects(transport.run(d.objective.jobName,'etag'));assert.equal(requests.length,1);await assert.rejects(transport.run('projects/other/locations/x/jobs/no','etag'));assert.equal(requests.length,1);
});
test('native absence requires official 404 plus deleted-resource inventory',async()=>{const d=dossier();let n=0;const transport=createPoolNativeTransport({accessToken:async()=> 'synthetic-token',getAuthority:()=>authority(),fetchImpl:async()=>{n++;return n===1?new Response(JSON.stringify({error:{code:404,status:'NOT_FOUND'}}),{status:404,headers:{'content-type':'application/json'}}):new Response(JSON.stringify({jobs:[{name:d.objective.jobName,deleteTime:'synthetic'}]}),{status:200,headers:{'content-type':'application/json'}});}});await assert.rejects(transport.requireAbsent(d.objective.jobName));assert.equal(n,2);});
