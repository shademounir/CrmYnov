// All native envelopes, tokens and authority callbacks below are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {digest} from '../rc47-select-only-probe-core-v1.mjs';
import {openCreationJournal,createJobOnce,observeJobCreation,createJobCreationTransport} from '../probe-job-creation-v1.mjs';
import {dossierFixture} from './probe-driver-fixtures-v1.mjs';
const OP='projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/synthetic-create';
function fixture(mode='success') {
 const {dossier,job:sourceJob}=dossierFixture(),job=structuredClone(sourceJob);job.etag='SYNTHETIC_ETAG';
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'probe-driver-create-unit-')));
 const options={directory,jobName:dossier.objective.jobName,dossierSha256:digest(dossier)};
 let journal=openCreationJournal({...options,initialize:true}),posts=0,absences=0,authorities=0;
 const createdUid=job.uid;
 const transport={requireAbsent:async()=>{absences++;if(mode==='existing')throw Error('existing');},create:async()=>{posts++;if(mode==='unknown')throw Error('SYNTHETIC_LOSS');return{name:mode==='foreign'?'projects/other/operations/synthetic':OP};},operation:async()=>({name:OP,done:mode!=='pending',...(mode==='failed'?{error:{code:13}}:{response:{name:job.name,uid:createdUid}})}),job:async()=>job};
 const authorizeFresh=async()=>{authorities++;if(mode==='denied')throw Error('SYNTHETIC_DENIAL');};
 return{dossier,job,directory,options,transport,authorizeFresh,get journal(){return journal;},posts:()=>posts,absences:()=>absences,authorities:()=>authorities,reopen(){journal.close();journal=openCreationJournal(options);},close(){journal.close();}};
}
test('creation consumes durable intent before exactly one POST and recovers only known native operation',async()=>{
 const f=fixture();try{const original=f.transport.create;f.transport.create=async(...args)=>{assert.equal(f.journal.inspect().state,'CREATE_INTENT_CONSUMED');return original(...args);};
 assert.equal((await createJobOnce(f)).state,'CREATE_OPERATION_OBSERVED');assert.equal(f.posts(),1);assert.equal(f.absences(),2);assert.equal(f.authorities(),2);
 f.reopen();const done=await observeJobCreation(f);assert.equal(done.state,'NATIVE_JOB_RECONCILED');assert.equal(done.uid,f.job.uid);await assert.rejects(createJobOnce(f));assert.equal(f.posts(),1);
 }finally{f.close();}
});
for(const mode of ['unknown','foreign'])test('uncertain creation is never replayable after reopen: '+mode,async()=>{const f=fixture(mode);try{assert.equal((await createJobOnce(f)).state,'CREATE_OUTCOME_UNKNOWN');f.reopen();await assert.rejects(createJobOnce(f));await assert.rejects(observeJobCreation(f));assert.equal(f.posts(),1);}finally{f.close();}});
for(const mode of ['denied','existing'])test('preflight refusal never consumes intent or posts: '+mode,async()=>{const f=fixture(mode);try{await assert.rejects(createJobOnce(f));assert.equal(f.journal.inspect(),null);assert.equal(f.posts(),0);}finally{f.close();}});
test('pending operation remains readable and cannot cause a second creation',async()=>{const f=fixture('pending');try{await createJobOnce(f);assert.equal((await observeJobCreation(f)).state,'CREATE_PENDING');assert.equal(f.journal.inspect().state,'CREATE_OPERATION_OBSERVED');await assert.rejects(createJobOnce(f));}finally{f.close();}});
test('native operation error is terminal with no retry',async()=>{const f=fixture('failed');try{await createJobOnce(f);assert.equal((await observeJobCreation(f)).state,'CREATE_FAILED');await assert.rejects(observeJobCreation(f));await assert.rejects(createJobOnce(f));}finally{f.close();}});
for(const [name,change]of[
 ['actual executionCount',f=>f.job.executionCount=1],['latest execution object',f=>f.job.latestCreatedExecution={}],['wrong actualUID',f=>f.job.uid=''],['replaced native UID',f=>f.job.uid='synthetic-replaced-native-uid'],['wrong image',f=>f.job.template.template.containers[0].image+='bad'],['foreign operationresponse',f=>f.transport.operation=async()=>({name:OP,done:true,response:{name:'projects/other/jobs/other'}})]
])test('native creation reconciliation refuses '+name,async()=>{const f=fixture();try{await createJobOnce(f);change(f);await assert.rejects(observeJobCreation(f));assert.equal(f.journal.inspect().state,'CREATE_OPERATION_OBSERVED');}finally{f.close();}});
test('omitted and explicit zero executionCount both accepted only with latestCreatedExecution absent',async()=>{for(const count of [undefined,0]){const f=fixture();try{if(count!==undefined)f.job.executionCount=count;await createJobOnce(f);assert.equal((await observeJobCreation(f)).state,'NATIVE_JOB_RECONCILED');}finally{f.close();}}});
test('caller mutation during authority callback cannot retarget detached create intent/body',async()=>{const f=fixture();try{const expected=f.dossier.objective.jobName;f.authorizeFresh=async()=>{f.dossier.objective.jobName+='-changed';};f.transport.create=async(name)=>{assert.equal(name,expected);return{name:OP};};await createJobOnce(f);}finally{f.close();}});
test('fresh journal cannot replace an existing or missing journal implicitly',()=>{const f=fixture();try{assert.throws(()=>openCreationJournal({...f.options,initialize:true}));assert.throws(()=>openCreationJournal({...f.options,directory:fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'probe-driver-missing-unit-')))}));}finally{f.close();}});
test('two processes race for exactly one durable creation claim',async()=>{
 const f=fixture();f.close();const intent={at:'2026-10-26T18:00:00Z',job:f.options.jobName,dossierSha256:f.options.dossierSha256,bodySha256:digest(f.dossier.job)};
 const module=new URL('../probe-job-creation-v1.mjs',import.meta.url).href;
 const code=`import{openCreationJournal}from ${JSON.stringify(module)};const j=openCreationJournal(${JSON.stringify(f.options)});try{j.consume(${JSON.stringify(intent)});process.stdout.write('CONSUMED');}catch{process.stdout.write('REFUSED');}finally{j.close();}`;
 const run=promisify(execFile);const results=await Promise.all([1,2].map(()=>run(process.execPath,['--input-type=module','-e',code],{windowsHide:true,timeout:10000})));
 assert.deepEqual(results.map(r=>r.stdout).sort(),['CONSUMED','REFUSED']);const reopened=openCreationJournal(f.options);try{assert.equal(reopened.inspect().state,'CREATE_INTENT_CONSUMED');}finally{reopened.close();}
});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function transportFixture(reply) {const{dossier}=dossierFixture();let posts=0,tokens=0;const transport=createJobCreationTransport({dossier,accessToken:async()=>{tokens++;return'SYNTHETIC_ONLY';},fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');if(options.method==='POST')posts++;return reply(url,options,dossier);}});return{dossier,transport,posts:()=>posts,tokens:()=>tokens};}
test('creation transport proves official404 plus bounded metadata-only deleted inventory',async()=>{let calls=0;const f=transportFixture(url=>{calls++;const u=new URL(url);if(u.pathname.endsWith('/jobs')){assert.equal(u.searchParams.get('fields'),'jobs(name,uid,deleteTime),nextPageToken');assert.equal(u.searchParams.get('showDeleted'),'true');return json({});}return json({error:{code:404,status:'NOT_FOUND'}},404);});await f.transport.requireAbsent(f.dossier.objective.jobName);assert.equal(calls,2);assert.equal(f.posts(),0);});
for(const body of [{},{error:{code:403,status:'PERMISSION_DENIED'}},{error:{code:404,status:'UNKNOWN'}}])test('malformed404 cannot prove absence '+JSON.stringify(body),async()=>{const f=transportFixture(()=>json(body,404));await assert.rejects(f.transport.requireAbsent(f.dossier.objective.jobName));assert.equal(f.posts(),0);});
test('deleted resource blocks creation',async()=>{const f=transportFixture((url,o,d)=>new URL(url).pathname.endsWith('/jobs')?json({jobs:[{name:d.objective.jobName,uid:'synthetic-deleted',deleteTime:'2026-10-20T00:00:00Z'}]}):json({error:{code:404,status:'NOT_FOUND'}},404));await assert.rejects(f.transport.requireAbsent(f.dossier.objective.jobName));});
test('creation transport refuses body drift or foreign parent before token',async()=>{const f=transportFixture(()=>json({name:OP}));await assert.rejects(f.transport.create(f.dossier.objective.jobName,{...f.dossier.job,overrides:{}}));await assert.rejects(f.transport.create('projects/other/jobs/other',f.dossier.job));assert.equal(f.tokens(),0);});
for(const name of ['redirect','oversize','nonJSON','HTTP403','invalidJSON'])test('bounded create transport refuses '+name,async()=>{const f=transportFixture(()=>{if(name==='redirect'){const r=json({});Object.defineProperty(r,'redirected',{value:true});return r;}if(name==='oversize')return json({payload:'x'.repeat(1048577)});if(name==='nonJSON')return new Response('{}',{headers:{'content-type':'text/html'}});if(name==='HTTP403')return json({error:{}},403);return new Response('{',{headers:{'content-type':'application/json'}});});await assert.rejects(f.transport.create(f.dossier.objective.jobName,f.dossier.job),/NATIVE_CREATE_EXCHANGE_UNKNOWN_NO_RETRY/u);assert.equal(f.posts(),1);});
test('create transport has a15second deadline including token acquisition and does not POST afterwards',async t=>{t.mock.timers.enable({apis:['setTimeout']});const{dossier}=dossierFixture();let posts=0;const transport=createJobCreationTransport({dossier,accessToken:()=>new Promise(()=>{}),fetchImpl:async()=>{posts++;return json({});}});const rejected=assert.rejects(transport.create(dossier.objective.jobName,dossier.job),/NATIVE_CREATE_EXCHANGE_UNKNOWN_NO_RETRY/u);t.mock.timers.tick(15000);await rejected;assert.equal(posts,0);});
test('body is detached before awaiting token; caller cannot change submitted configuration',async()=>{const{dossier}=dossierFixture();const expected=JSON.stringify(dossier.job);let release;const transport=createJobCreationTransport({dossier,accessToken:()=>new Promise(resolve=>{release=resolve;}),fetchImpl:async(url,options)=>{assert.equal(options.body,expected);return json({name:OP});}});const pending=transport.create(dossier.objective.jobName,dossier.job);dossier.job.template.taskCount=10;release('SYNTHETIC_ONLY');await pending;});
