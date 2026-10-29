// SYNTHETIC protocol/authority data only. No SDK, API, SQL, Docker or acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BINDING,CONSUMER_PINS,PROSPECTIVE_DRIVER_INPUTS,validateProspectiveAuthorityRecord,validateProspectiveDossier,authorizeProspectiveGeneralPre} from '../general-prospective-pre-authority-v1.mjs';
import {openProspectiveEvidenceStore,createProspectiveSessionBudget,executeProspectiveGeneralPreProtocol,validateProspectiveConsumerInputs,runProspectiveGeneralPre,validateConsumerIndex,semanticFailureCode,comparisonAge,buildProspectiveCutoverDossier,protocolFailureCode} from '../general-prospective-pre-session-v1.mjs';
import {createReadOnlyNativeTransport} from '../pool-native-transaction-v2.mjs';
import {byteHash,digest} from '../controlled-pool-contract-v1.mjs';
import {fixture} from './readonly-native-output-fixture-v1.mjs';
import {authorityFixture} from '../../readonly-probe/tests/probe-driver-fixtures-v1.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH} from '../../../pr-policy/github-code-review.mjs';
import {grantDigest} from '../../../pr-policy/delegation.mjs';
const NOW=Date.parse('2026-10-29T15:00:00.000Z'),H='a'.repeat(64),CAP='11111111-1111-4111-8111-111111111111';
function record(){return{schemaVersion:1,kind:'GENERAL_PROSPECTIVE_PRE_SINGLE_OBSERVATION_AUTHORITY_V1',
  proposalSha256:BINDING.proposalSha256,humanAuthorityReceiptSha256:BINDING.humanAuthorityReceiptSha256,binding:{...BINDING},
  validFrom:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+900000).toISOString(),explicitWindowRenewal:true,
  originalExpiresAt:BINDING.originalExpiresAt,source:{commit:'a'.repeat(40),tree:'b'.repeat(40),head:'c'.repeat(40),pr:270,
    files:PROSPECTIVE_DRIVER_INPUTS.map(p=>({path:p,sha256:H}))},directorySha256:H,consumerSha256:digest(CONSUMER_PINS),capabilityId:BINDING.capabilityId};}
test('explicit additive window is valid after old catalogue expiry without editing historical values',()=>{
  const r=record(),before=structuredClone(r);assert.equal(validateProspectiveAuthorityRecord(r,NOW),r);assert.deepEqual(r,before);assert.equal(r.originalExpiresAt,BINDING.originalExpiresAt);
});
for(const[name,mutate]of[
  ['no renewal',r=>r.explicitWindowRenewal=false],['new objective',r=>r.binding.objectiveId='substitute'],
  ['wrong UID',r=>r.binding.uid='other'],['retargeted source',r=>r.binding.sourceSha256=H],['retargeted bundle',r=>r.binding.bundleSha256=H],
  ['renamed old expiry',r=>r.originalExpiresAt='2026-10-30T14:35:01.178Z'],['expired additive window',r=>r.expiresAt=new Date(NOW).toISOString()],
  ['future authority',r=>r.validFrom=new Date(NOW+1).toISOString()],['unbounded authority',r=>r.expiresAt=new Date(NOW+86400001).toISOString()],
  ['missing source',r=>r.source.files.pop()],['wrong proposal',r=>r.proposalSha256=H],['no consumer inputs',r=>r.consumerSha256=H],
  ['unknown authority switch',r=>r.allowReplay=true],['zero human receipt hash',r=>r.humanAuthorityReceiptSha256='0'.repeat(64)],
])test('local authority refuses '+name,()=>{const r=record();mutate(r);assert.throws(()=>validateProspectiveAuthorityRecord(r,NOW));});
test('dossier and consumer evidence must match exact sealed bytes before any authority/network',async()=>{
  assert.throws(()=>validateProspectiveDossier(Buffer.from('{}')),/SEALED_DOSSIER_BYTES/u);
  assert.throws(()=>validateProspectiveConsumerInputs({historicalBaselineBytes:Buffer.from('{}'),cutoverIndexBytes:Buffer.from('{}'),evidence:{configuration:Buffer.from('{}'),decision:Buffer.from('{}'),currentComparison:Buffer.from('{}')}}),/CUTOVER_EVIDENCE_INDEX_BYTES/u);
  let calls=0;await assert.rejects(authorizeProspectiveGeneralPre({github:{get(){calls++;}},record:record(),localSource:{},clock:()=>NOW}));assert.equal(calls,0);
  await assert.rejects(runProspectiveGeneralPre({record:{}}));
});
function governance(){
  const f=authorityFixture(),r=record(),s=f.localSource;
  r.source={commit:s.commit,tree:s.tree,head:'1'.repeat(40),pr:301,files:PROSPECTIVE_DRIVER_INPUTS.map(p=>({path:p,sha256:byteHash('// synthetic '+p)}))};
  const revision='6'.repeat(40),base=f.base;
  f.responses.set(base+'branches/develop/protection',{enforce_admins:{enabled:true},required_status_checks:{strict:true,contexts:['pr-policy']},required_conversation_resolution:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}});
  f.responses.set(base+'contents/'+GITHUB_CODE_REVIEW_POLICY_PATH+'?ref='+revision,f.blob(JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/github-code-review-policy.json',import.meta.url)))));
  f.responses.set(base+'git/commits/'+s.commit,{tree:{sha:s.tree}});
  for(const file of r.source.files)f.responses.set(base+'contents/'+file.path+'?ref='+s.commit,f.blob('// synthetic '+file.path));
  f.responses.get(base+'commits/'+'1'.repeat(40)+'/check-runs').push({id:999999,name:'simulate',status:'completed',conclusion:'success',head_sha:'1'.repeat(40)});
  f.responses.set(base+'contents/docs/governance/readonly-probe-objectives-v1.json?ref='+revision,f.blob({entries:[{id:BINDING.objectiveId,scope:BINDING.purpose,status:'approved',businessMutation:false,ticket:'CRMY-63',expiresAt:BINDING.originalExpiresAt,dossierSha256:BINDING.catalogueDossierSha256}]}));
  const jira=JSON.parse(f.jiraBytes);jira.observedAt=new Date(NOW-1000).toISOString();const jiraBytes=Buffer.from(JSON.stringify(jira));
  const marker={schemaVersion:1,executor:'Codex',capabilityId:r.capabilityId,authorityRecordSha256:digest(r),driverCommit:s.commit,grantDigest:grantDigest(f.grant),jiraObservationSha256:byteHash(jiraBytes),expiresAt:new Date(NOW+60000).toISOString(),businessMutation:false};
  f.responses.get(base+'issues/301/comments').push({id:999,user:{login:'shademounir',type:'User'},created_at:new Date(NOW-1000).toISOString().replace('.000Z','Z'),body:'<!-- codex-general-prospective-pre-authorization:v1 '+JSON.stringify(marker)+' -->'});
  return{...f,r,jiraBytes,localSource:{...r.source,clean:true},run:()=>authorizeProspectiveGeneralPre({github:f.github,record:r,jiraBytes,localSource:{...r.source,clean:true},clock:()=>NOW})};
}
test('real governance adapter verifies protected merge/grant/CI/Jira and fresh exact capability without requiring bot review',async()=>{
  const g=governance(),result=await g.run();assert.equal(result.receipt.capabilityId,BINDING.capabilityId);assert.equal(result.receipt.gitHubCodeReviewRequired,false);assert.equal(result.receipt.businessMutationAuthorized,false);
  assert(g.calls.some(c=>c.includes('/check-runs')));assert(g.calls.filter(c=>c.includes('/contents/')).length>=PROSPECTIVE_DRIVER_INPUTS.length);
});
for(const[name,change]of[
  ['unprotected develop',g=>g.responses.get(g.base+'branches/develop').protected=false],
  ['protection weakened',g=>g.responses.get(g.base+'branches/develop/protection').enforce_admins.enabled=false],
  ['conversation protection weakened',g=>g.responses.get(g.base+'branches/develop/protection').required_conversation_resolution.enabled=false],
  ['force push permitted',g=>g.responses.get(g.base+'branches/develop/protection').allow_force_pushes.enabled=true],
  ['branch deletion permitted',g=>g.responses.get(g.base+'branches/develop/protection').allow_deletions.enabled=true],
  ['different merge',g=>g.responses.get(g.base+'pulls/301').merge_commit_sha='f'.repeat(40)],
  ['failing exact check',g=>g.responses.get(g.base+'commits/'+'1'.repeat(40)+'/check-runs')[0].conclusion='failure'],
  ['auto-merge history',g=>g.responses.set(g.base+'issues/301/timeline',[{event:'auto_merge_enabled'}])],
  ['source body changed',g=>g.responses.set(g.base+'contents/'+PROSPECTIVE_DRIVER_INPUTS[0]+'?ref='+'2'.repeat(40),g.blob('changed'))],
  ['old expiry changed',g=>{const route=g.base+'contents/docs/governance/readonly-probe-objectives-v1.json?ref='+'6'.repeat(40),v=JSON.parse(Buffer.from(g.responses.get(route).content,'base64'));v.entries[0].expiresAt='2027-01-01T00:00:00.000Z';g.responses.set(route,g.blob(v));}],
])test('real governance adapter refuses '+name,async()=>{const g=governance();change(g);await assert.rejects(g.run());});
test('durable independent claim/append are exclusive and cannot overwrite a consumed capability',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crm-prospective-synthetic-'));
  try{const store=openProspectiveEvidenceStore({directory:dir,capabilityId:CAP,authorityRecordSha256:H});
    const a=store.append('PROSPECTIVE-RUN-INTENT',{state:'INTENT'});assert.equal(byteHash(fs.readFileSync(a.path)),a.sha256);
    assert.throws(()=>openProspectiveEvidenceStore({directory:dir,capabilityId:CAP,authorityRecordSha256:H}),/EEXIST/u);
    assert.throws(()=>store.append('../escape',{}));assert.equal(fs.readdirSync(dir).length,2);
  }finally{for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
function protocol(options={}){
  const f=fixture('general'),events=[],calls=[];let now=f.now-4000,posted=false,tokens=0,consumers=0,refreshes=0,logReads=0;
  f.job.etag='synthetic-etag';f.execution.uid='synthetic-execution-uid';f.execution.createTime='2026-10-27T14:00:00.200Z';
  const pre=structuredClone(f.job);pre.executionCount=0;pre.latestCreatedExecution={};
  const binding={...BINDING,job:f.job.name,uid:f.job.uid,objective:f.objective};
  const op=BINDING.knownCreateOperation.replace(/[^/]+$/u,'synthetic-new-run');
  const done={name:op,done:true,response:{name:f.execution.name,uid:f.execution.uid}};
  const leaf=f.execution.name.split('/').at(-1),tasks={tasks:[{name:f.execution.name+'/tasks/'+leaf+'-task0',index:0,
    serviceAccount:f.objective.serviceAccount,timeout:'120s',conditions:[{type:'Completed',state:'CONDITION_SUCCEEDED'}],
    containers:[{image:f.objective.image,resources:{limits:{cpu:'1000m',memory:'512Mi'}}}],vpcAccess:structuredClone(f.objective.taskTemplate.vpcAccess)}]};
  const authority={entry:{scope:f.objective.purpose},receipt:{verifiedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString()}};
  const store={append(kind,value){if(options.appendFail===kind)throw Error('SYNTHETIC_SAVE_FAILED');events.push({kind,value:structuredClone(value)});return{path:'synthetic',sha256:H};}};
  const fetchImpl=async(url,init)=>{
    calls.push({url,method:init.method,body:init.body});let value;
    if(options.httpAt===calls.length)return new Response('{"error":{"status":"PERMISSION_DENIED","message":"SYNTHETIC_SECRET"}}',{status:403,headers:{'content-type':'application/json'}});
    if(options.malformedAt===calls.length)return new Response('{truncated',{status:200,headers:{'content-type':'application/json'}});
    if(url.includes(':run')){
      assert(events.some(e=>e.kind==='PROSPECTIVE-RUN-INTENT'),'INTENT_DURABLE_BEFORE_POST');posted=true;now=f.now;
      if(options.lostPost)throw Error('SYNTHETIC_SECRET_LOST_RESPONSE');
      if(options.timeoutPost)return new Promise(()=>{});
      value=options.pending?{name:op,done:false}:structuredClone(done);
      if(options.postValue)value=options.postValue;
    }else if(url.includes('/operations/'))value=structuredClone(done);
    else if(url.endsWith('/tasks?'+new URL(url).searchParams.toString()))value=tasks;
    else if(new URL(url).pathname.endsWith('/tasks'))value=tasks;
    else if(new URL(url).pathname.endsWith('/executions'))value=options.inventory??{};
    else if(url==='https://logging.googleapis.com/v2/entries:list'){logReads++;value=options.emptyAlways||logReads<=(options.emptyCount??0)?{}:f.logs;}
    else if(url.endsWith(f.execution.name))value=f.execution;
    else value=posted?f.job:pre;
    if(options.changeResponse)options.changeResponse(value,{url,posted,pre,f,events});
    return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  };
  const budget=createProspectiveSessionBudget({binding,assertCurrent:()=>{if(options.guardFails)throw Error('AUTHORITY_REFUSED');},save:(k,v)=>store.append(k,v),fetchImpl,clock:()=>now});
  const accessToken=async()=>{tokens++;if(options.tokenFailure)throw Error(options.tokenFailure);return'SYNTHETIC_TOKEN_NEVER_SAVE';};
  const native=createReadOnlyNativeTransport({purpose:f.objective.purpose,accessToken,getAuthority:()=>authority,fetchImpl:budget.fetch,clock:()=>now,
    diagnostic:{objectiveId:BINDING.objectiveId,objectiveSha256:f.objective.objectiveSha256,stage:'RUN'},timeoutMs:options.timeoutPost?5:15000});
  const run=()=>executeProspectiveGeneralPreProtocol({dossier:f.dossier,binding,store,native,budget,accessToken,readPrivateKey:async()=>{if(options.keyFailure)throw Error(options.keyFailure);return f.privateKeyPem;},
    refreshAuthority:async()=>{refreshes++;if(options.refreshFailAt===refreshes)throw Error('AUTHORITY_REFUSED');return authority;},
    consume:checked=>{consumers++;assert.equal(checked.output.observation.identity.role,'crm_runtime');if(options.staleConsumer)now+=400000;return options.semanticRefusal?{status:'GENERAL_SEMANTIC_REFUSED',semanticAccepted:false,failureCode:'PERMISSIONS_CHANGED'}:{status:'SYNTHETIC_COMPARISON'};},
    clock:()=>now,pause:async()=>{now+=options.emptyDeadline?300001:1000;}});
  return{f,pre,events,calls,binding,budget,run,metrics:()=>({tokens,consumers,refreshes}),setClock:v=>{now=v;}};
}
test('synthetic full path uses REAL transport/verifier, durably saves reference before any subsequent read and never persists plaintext',async()=>{
  const p=protocol({pending:true}),r=await p.run();assert.equal(r.state,'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED');
  assert.equal(p.calls.filter(c=>c.url.endsWith(':run')).length,1);assert.equal(p.metrics().consumers,1);
  assert.deepEqual(JSON.parse(p.calls.find(c=>c.url.endsWith(':run')).body),{etag:'synthetic-etag'});
  const names=p.events.map(e=>e.kind);assert(names.indexOf('NEW-RUN-OPERATION')<names.lastIndexOf('NATIVE-READ-INTENT'));
  assert(names.includes('VERIFIED-NEW-ENCRYPTED-OUTPUT'));assert.equal(r.nativeAcceptance,false);assert.equal(r.originalRunState,'UNKNOWN');assert.equal(r.globalPreProved,false);
  const text=JSON.stringify(p.events);assert(!text.includes('SYNTHETIC_TOKEN_NEVER_SAVE'));assert(!text.includes('PRIVATE KEY'));assert(!text.includes('snapshot"'));assert(!text.includes('DATABASE_URL'));
  assert(!text.includes('SYNTHETIC_SECRET'));assert.equal(p.budget.close().runPosts,1);
});
for(const[name,options]of[
  ['authority before first native',{refreshFailAt:1}],['authority before prospective INTENT',{refreshFailAt:2}],
  ['HTTP 403 metadata',{httpAt:1}],['nonempty execution inventory',{inventory:{executions:[{name:'existing'}]}}],
  ['pre-count one',{changeResponse:(v,c)=>{if(!c.posted&&v.name===c.f.job.name)v.executionCount=1;}}],
  ['malformed null counter',{changeResponse:(v,c)=>{if(!c.posted&&v.name===c.f.job.name)v.executionCount=null;}}],
  ['malformed JSON',{malformedAt:1}],
  ['missing latest fields',{changeResponse:(v,c)=>{if(!c.posted&&v.name===c.f.job.name)v.latestCreatedExecution={name:'old'};}}],
  ['wrong UID',{changeResponse:(v,c)=>{if(!c.posted&&v.name===c.f.job.name)v.uid='other-valid-uid';}}],
])test('preflight refusal has zero POST: '+name,async()=>{const p=protocol(options),r=await p.run();assert.equal(r.state,'PROSPECTIVE_PREFLIGHT_REFUSED');assert(!p.calls.some(c=>c.url.endsWith(':run')));assert(!p.events.some(e=>e.kind==='PROSPECTIVE-RUN-INTENT'));assert.equal(p.metrics().consumers,0);});
for(const[name,options]of[
  ['lost POST response',{lostPost:true}],['POST HTTP403',{httpAt:5}],
  ['POST timeout',{timeoutPost:true}],
  ['known CREATE returned',{postValue:{name:BINDING.knownCreateOperation,done:true}}],
  ['pending operation carrying an error',{postValue:{name:BINDING.knownCreateOperation.replace(/[^/]+$/u,'synthetic-new-run'),done:false,error:{code:7}}}],
  ['reference persistence failure',{appendFail:'NEW-RUN-OPERATION'}],['foreign execution',{postValue:{name:BINDING.knownCreateOperation.replace(/[^/]+$/u,'new'),done:true,response:{name:'foreign',uid:'synthetic-uid'}}}],
  ['wrong count after POST',{changeResponse:(v,c)=>{if(c.posted&&v.name===c.f.job.name)v.executionCount=2;}}],
  ['different execution UID',{changeResponse:(v,c)=>{if(v.name===c.f.execution.name)v.uid='wrong-execution-uid';}}],
  ['retry task',{changeResponse:(v)=>{if(v.tasks)v.tasks[0].retried=1;}}],
  ['ambiguous output',{changeResponse:(v)=>{if(v.entries)v.entries.push(structuredClone(v.entries[0]));}}],
  ['stale consumer',{staleConsumer:true}],
])test('post-intent failure is consumed with no second POST: '+name,async()=>{const p=protocol(options),r=await p.run();assert.equal(r.state,'PROSPECTIVE_CAPABILITY_CONSUMED_INCOMPLETE');assert.equal(p.calls.filter(c=>c.url.endsWith(':run')).length,1);assert.equal(r.canRetry,false);assert.equal(r.originalRunState,'UNKNOWN');assert(!JSON.stringify(p.events).includes('SYNTHETIC_SECRET'));});
test('failure writing initial INTENT prevents POST and permanent claim is not automatically reopened',async()=>{
  const p=protocol({appendFail:'PROSPECTIVE-RUN-INTENT'}),r=await p.run();assert.equal(r.state,'PROSPECTIVE_PREFLIGHT_REFUSED');assert(!p.calls.some(c=>c.url.endsWith(':run')));
});
test('budget rejects unapproved URLs/verbs/project/operations BEFORE transport',async()=>{
  const p=protocol();for(const[url,method,body]of[
    ['https://run.googleapis.com/v2/'+p.binding.job,'DELETE'],['https://run.googleapis.com/v2/projects/foreign/locations/europe-west1/jobs/nope','GET'],
    ['https://run.googleapis.com/v2/projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/unseen','GET'],
    ['https://run.googleapis.com/v2/'+p.binding.job+':run','POST',{overrides:{}}],['https://run.googleapis.com/v2/projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs','POST',{}],
  ])await assert.rejects(p.budget.fetch(url,{method,redirect:'error',...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal(p.calls.length,0);
});
test('900 seconds and monotone clock bounds stop without another request',async()=>{
  const p=protocol();const response=await p.budget.fetch('https://run.googleapis.com/v2/'+p.binding.job,{method:'GET',redirect:'error'});await response.arrayBuffer();
  const first=p.f.now-4000;p.setClock(first+900000);await assert.rejects(p.budget.fetch('https://run.googleapis.com/v2/'+p.binding.job,{method:'GET',redirect:'error'}));assert.equal(p.calls.length,1);
  const q=protocol();q.budget.check();q.setClock(q.f.now-5000);assert.throws(()=>q.budget.check(),/MONOTONIC_CLOCK_REQUIRED/u);
});
test('200 request cap and 20 collection page cap are global, with no fallback request',async()=>{
  const p=protocol(),url='https://run.googleapis.com/v2/'+p.binding.job;
  for(let i=0;i<200;i++){const response=await p.budget.fetch(url,{method:'GET',redirect:'error'});await response.arrayBuffer();}
  await assert.rejects(p.budget.fetch(url,{method:'GET',redirect:'error'}),/REQUEST_COUNT_BOUND/u);assert.equal(p.calls.length,200);
  const q=protocol();for(let i=0;i<20;i++){const response=await q.budget.fetch('https://run.googleapis.com/v2/'+q.binding.job+'/executions?pageSize=100&showDeleted=true&pageToken='+i,{method:'GET',redirect:'error'});await response.arrayBuffer();}
  await assert.rejects(q.budget.fetch('https://run.googleapis.com/v2/'+q.binding.job+'/executions?pageSize=100&showDeleted=true&pageToken=20',{method:'GET',redirect:'error'}),/COLLECTION_PAGE_BOUND/u);assert.equal(q.calls.length,20);
});
test('empty inventory page with next token is followed; pagination cycle refuses before POST',async()=>{
  const p=protocol({inventory:{nextPageToken:'cycle'}}),r=await p.run();assert.equal(r.state,'PROSPECTIVE_PREFLIGHT_REFUSED');
  assert.equal(p.calls.filter(c=>new URL(c.url).pathname.endsWith('/executions')).length,2);assert(!p.calls.some(c=>c.url.endsWith(':run')));
});
test('strict response byte caps stop a body and do not persist its contents',async()=>{
  const events=[],binding={...BINDING},url='https://run.googleapis.com/v2/'+BINDING.job;
  let calls=0;const make=size=>createProspectiveSessionBudget({binding,assertCurrent:()=>{},save:(k,v)=>events.push({k,v}),fetchImpl:async()=>{calls++;return new Response('x'.repeat(size),{headers:{'content-type':'application/json'}});},clock:()=>NOW});
  const one=make(1048577),response=await one.fetch(url,{method:'GET',redirect:'error'});await assert.rejects(response.arrayBuffer(),/RESPONSE_VOLUME_BOUND/u);
  const all=make(1048576);for(let i=0;i<20;i++){const next=await all.fetch(url,{method:'GET',redirect:'error'});await next.arrayBuffer();}
  const next=await all.fetch(url,{method:'GET',redirect:'error'});await assert.rejects(next.arrayBuffer(),/RESPONSE_VOLUME_BOUND/u);
  assert.equal(calls,22);assert(!JSON.stringify(events).includes('xxxxx'));
});
test('closed session and already-used run capability refuse further native calls',async()=>{
  const p=protocol();await p.run();const count=p.calls.length;p.budget.close();await assert.rejects(p.budget.fetch('https://run.googleapis.com/v2/'+p.binding.job,{method:'GET',redirect:'error'}),/PROSPECTIVE_SESSION_CLOSED/u);assert.equal(p.calls.length,count);
});
test('only 200-empty output reads poll ingestion lag, producing one RUN and then one verified record',async()=>{
  const p=protocol({emptyCount:2}),r=await p.run();assert.equal(r.state,'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED');
  assert.equal(p.calls.filter(c=>c.url==='https://logging.googleapis.com/v2/entries:list').length,3);
  assert.equal(p.calls.filter(c=>c.url.endsWith(':run')).length,1);assert.equal(p.metrics().consumers,1);
});
test('200-empty output polling stops at freshness window without recollection',async()=>{
  const p=protocol({emptyAlways:true,emptyDeadline:true}),r=await p.run();assert.equal(r.state,'PROSPECTIVE_CAPABILITY_CONSUMED_INCOMPLETE');
  assert.equal(r.failureCode,'OUTPUT_READ_FRESHNESS_WINDOW_EXHAUSTED');assert.equal(p.calls.filter(c=>c.url==='https://logging.googleapis.com/v2/entries:list').length,1);
  assert.equal(p.calls.filter(c=>c.url.endsWith(':run')).length,1);assert.equal(p.metrics().consumers,0);
});
test('semantic refusal retains verified observation but never claims preservation acceptance',async()=>{
  const p=protocol({semanticRefusal:true}),r=await p.run();assert.equal(r.state,'FRESH_GENERAL_OBSERVED_SEMANTIC_REFUSED');
  assert(p.events.some(e=>e.kind==='VERIFIED-NEW-ENCRYPTED-OUTPUT'));assert.equal(r.globalPreProved,false);assert.equal(r.canRetry,false);
});
test('remaining lease deadline applies to delayed HTTP and a stalled response body',async()=>{
  const binding={...BINDING},url='https://run.googleapis.com/v2/'+BINDING.job;
  const slowFetch=createProspectiveSessionBudget({binding,assertCurrent:()=>{},save:()=>{},clock:()=>NOW,leaseRemainingMs:()=>5,fetchImpl:async()=>new Promise(()=>{})});
  await assert.rejects(slowFetch.fetch(url,{method:'GET',redirect:'error'}),/NATIVE_READ_DEADLINE/u);
  const body=new ReadableStream({pull(){return new Promise(()=>{});}});
  const slowBody=createProspectiveSessionBudget({binding,assertCurrent:()=>{},save:()=>{},clock:()=>NOW,leaseRemainingMs:()=>5,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json'}})});
  const response=await slowBody.fetch(url,{method:'GET',redirect:'error'});await assert.rejects(response.arrayBuffer(),/NATIVE_READ_DEADLINE/u);
});
test('comparison freshness is a precise point-in-time fact, never an operator renewal',()=>{
  const observation={transactionCompletedAt:new Date(NOW-300000).toISOString()};
  assert.equal(comparisonAge(observation,NOW).freshAtComparison,true);assert.equal(comparisonAge(observation,NOW+1).freshAtComparison,false);
  assert.equal(comparisonAge({transactionCompletedAt:new Date(NOW+1).toISOString()},NOW).freshAtComparison,false);
  assert.deepEqual(comparisonAge({transactionCompletedAt:'invalid'},NOW),{comparisonAt:new Date(NOW).toISOString(),comparisonAgeMs:null,freshAtComparison:false});
});
test('semantic refusal projection retains only whitelisted codes, not assertion values or exception contents',()=>{
  assert.equal(semanticFailureCode(Error('PERMISSIONS_CHANGED\nSYNTHETIC_PRIVATE_ROWS')), 'PERMISSIONS_CHANGED');
  for(const error of [Error('SYNTHETIC_PRIVATE_DETAIL'),{},Error('Expected values to be equal: private@example.invalid')])assert.equal(semanticFailureCode(error),'GENERAL_SEMANTIC_VALIDATION_REFUSED');
});
test('useful concrete dossier keeps reused evidence and missing prerequisites separate on semantic PASS or REFUSED',()=>{
  const index={kind:'CRM_PROD_CUTOVER_REUSABLE_EVIDENCE_INDEX_V1',globalPreSufficient:false,commonSqlSnapshot:false,productionDeploymentAuthorized:false,sheetsActivationAuthorized:false,
    references:Array.from({length:19},(_,i)=>({id:'SYNTHETIC_'+i,sha256:H,reuse:true,currentProdFreshnessClaim:false})),
    globalImagePreparationRequiredFamilies:['POOL','LEDGER','GENERAL','PERMISSIONS','JOB_INVENTORY','RECOVERABILITY','ROLLBACK'],stillMissingBeforeRuntime:['SYNTHETIC_RECOVERABILITY'],stillMissingAfterCompatibleRuntimeBeforeSheetsOn:['SYNTHETIC_SOURCE_BOUNDARY']};
  assert.equal(validateConsumerIndex(index),index);
  const observation={transactionCompletedAt:new Date(NOW-1000).toISOString()},timing=comparisonAge(observation,NOW);
  for(const semanticAccepted of [true,false]){const comparison={semanticAccepted,failureCode:'PERMISSIONS_CHANGED'};
    const result=buildProspectiveCutoverDossier({comparison,observation,index,timing});
    assert.equal(result.globalPreSufficient,false);assert.equal(result.productionDeploymentAuthorized,false);assert.equal(result.commonSqlSnapshot,false);
    assert.equal(result.freshAtComparison,true);assert.equal(result.additionalCurrentBlocker,semanticAccepted?null:'PERMISSIONS_CHANGED');assert.deepEqual(result.reusableEvidence,index.references);}
  assert.throws(()=>validateConsumerIndex({...index,globalPreSufficient:true}));assert.throws(()=>validateConsumerIndex({...index,references:[]}));
});
test('a request begun in the last millisecond of 900s cannot overrun in headers or body',async()=>{
  for(const stallBody of [false,true]){
    let now=NOW,calls=0;
    const budget=createProspectiveSessionBudget({binding:{...BINDING},assertCurrent:()=>{},save:()=>{},clock:()=>now,fetchImpl:async()=>{
      calls++;if(calls===1)return new Response('{}',{headers:{'content-type':'application/json'}});
      if(!stallBody)return new Promise(()=>{});
      return new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
    }});
    const url='https://run.googleapis.com/v2/'+BINDING.job;
    const initial=await budget.fetch(url,{method:'GET',redirect:'error'});await initial.arrayBuffer();now=NOW+899999;
    if(stallBody){const response=await budget.fetch(url,{method:'GET',redirect:'error'});await assert.rejects(response.arrayBuffer(),/NATIVE_READ_DEADLINE/u);}
    else await assert.rejects(budget.fetch(url,{method:'GET',redirect:'error'}),/NATIVE_READ_DEADLINE/u);
    assert.equal(calls,2);
  }
});
test('progressive body chunks check request elapsed time even when the event loop timer has not fired',async()=>{
  let now=NOW,chunks=0;
  const body=new ReadableStream({pull(controller){if(chunks++===0)controller.enqueue(new TextEncoder().encode('{'));else{now=NOW+15000;controller.enqueue(new TextEncoder().encode('}'));controller.close();}}});
  const budget=createProspectiveSessionBudget({binding:{...BINDING},assertCurrent:()=>{},save:()=>{},clock:()=>now,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json'}})});
  const url='https://run.googleapis.com/v2/'+BINDING.job;
  try{const response=await budget.fetch(url,{method:'GET',redirect:'error'});await assert.rejects(response.arrayBuffer(),/NATIVE_READ_DEADLINE/u);}
  catch(error){assert.match(error.message,/NATIVE_READ_DEADLINE/u);}
});
test('closed protocol-code projection rejects arbitrary uppercase messages, canaries and accessor getters',()=>{
  const secret='DEADBEEF'.repeat(8);assert.equal(protocolFailureCode(Error(secret)),'PROSPECTIVE_VALIDATION_REFUSED');
  assert.equal(protocolFailureCode(Error('SYNTHETIC_UPPERCASE_SECRET')),'PROSPECTIVE_VALIDATION_REFUSED');
  assert.equal(protocolFailureCode(Error('OUTPUT_READ_FRESHNESS_WINDOW_EXHAUSTED\nSYNTHETIC_PRIVATE_ARRAY')),'OUTPUT_READ_FRESHNESS_WINDOW_EXHAUSTED');
  let touched=0;const error={get message(){touched++;return secret;},actual:{secret},expected:secret};
  assert.equal(protocolFailureCode(error),'PROSPECTIVE_VALIDATION_REFUSED');assert.equal(touched,0);
});
for(const capability of ['keyFailure','tokenFailure'])test('uppercase secret from '+capability+' never reaches any receipt or result',async()=>{
  const secret='DEADBEEF'.repeat(8),p=protocol({[capability]:secret}),result=await p.run();
  const text=JSON.stringify({events:p.events,result,calls:p.calls});assert(!text.includes(secret));assert(!text.includes('SYNTHETIC_UPPERCASE_SECRET'));
  assert.equal(result.failureCode,'PROSPECTIVE_VALIDATION_REFUSED');assert.equal(result.canRetry,false);
});
test('expired lease at final dispatch check records zero invoked POST while preserving the consumed boundary',async()=>{
  let calls=0,remainingChecks=0;
  const binding={...BINDING,expectedEtag:'synthetic-etag'};
  const budget=createProspectiveSessionBudget({binding,assertCurrent:()=>{},save:()=>{},clock:()=>NOW,
    leaseRemainingMs:()=>++remainingChecks===1?1000:0,fetchImpl:async()=>{calls++;return new Response('{}');}});
  await assert.rejects(budget.fetch('https://run.googleapis.com/v2/'+BINDING.job+':run',{method:'POST',redirect:'error',body:JSON.stringify({etag:'synthetic-etag'})}),/NATIVE_READ_DEADLINE/u);
  const stats=budget.close();assert.equal(calls,0);assert.equal(stats.runPosts,0);assert.equal(stats.runBoundaryAttempts,1);assert.equal(stats.nativeRequestsInvoked,0);
});
