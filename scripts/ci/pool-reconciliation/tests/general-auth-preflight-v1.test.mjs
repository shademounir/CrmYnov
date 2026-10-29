// SYNTHETIC ONLY: real immutable factory with fake child processes/timers.
// No SDK, credential store, GCP, Jira, SQL, Docker or native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {simulateOfficialSdkAuthPreflight,AUTH_ACCOUNT,AUTH_PYTHON,AUTH_GCLOUD,AUTH_FACTORY_SHA256} from '../../readonly-probe/official-sdk-auth-preflight-v1.mjs';
import {AUTH_NEW_FILES,AUTH_PREFLIGHT_DRIVER_INPUTS,AUTH_HUMAN_SHA256,AUTH_SDK_CACHE_HUMAN_SHA256,validateSdkCacheClarification,validateAuthOnlyRecord,validateAuthHumanAndQualification,authorizeAuthOnlyPreflight,simulateAuthOnlyGovernance} from '../general-auth-preflight-authority-v1.mjs';
import {validateAuthSourceQualification,runProspectiveAuthPreflightV2,runProspectiveGeneralPreV2,simulateProspectivePreclaimBoundary,simulateAuthOnlySession} from '../general-prospective-pre-session-v2.mjs';
import {byteHash,digest} from '../controlled-pool-contract-v1.mjs';
import {NATIVE_JIRA_BINDING} from '../general-prospective-pre-authority-v1.mjs';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,scopeDigest} from '../../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH} from '../../../pr-policy/github-code-review.mjs';
const NOW=Date.parse('2026-10-29T17:00:00.000Z'),H='a'.repeat(64),SECRET='DEADBEEF'.repeat(8),TOKEN='SYNTHETIC_TOKEN_'+SECRET;
function sdk(options={}){
  let now=NOW,guardCalls=0,invoked=0,guardRefused=false;const calls=[],children=[],timerCaps=[],timerCallbacks=[],environment={SYNTHETIC_PRIVATE:SECRET,...options.environment};
  const clock=()=>now;
  const schedule=(callback,ms)=>{const handle={at:now+ms,cancelled:false};timerCaps.push(ms);timerCallbacks.push(callback);setImmediate(()=>{if(!handle.cancelled){now=Math.max(now,handle.at);callback();}});return handle;};
  const cancel=handle=>{if(handle)handle.cancelled=true;};
  const guard=()=>{guardCalls++;if(guardRefused||options.guardAt===guardCalls)throw new Error(SECRET);now+=options.guardAdvance?.(guardCalls)??options.guardCost??0;};
  const invoke=(file,args,config,callback)=>{
    const index=invoked++,step=options.steps?.[index]??{};calls.push({file,args,timeout:config.timeout,env:structuredClone(config.env)});
    if(step.throw){const error=new Error(SECRET);error.code=step.code??SECRET;throw error;}
    const child=new EventEmitter();children.push(child);
    config.signal.addEventListener('abort',()=>{if(step.abortClose!==false)queueMicrotask(()=>{callback(Object.assign(new Error(SECRET),{code:'ABORT_ERR'}),'');child.emit('close',null,'SIGTERM');});},{once:true});
    queueMicrotask(()=>{
      if(!step.noSpawn)child.emit('spawn');
      if(step.hang){return;}
      now+=step.duration??100;
      if(step.mutateEnvironment)environment.SYNTHETIC_MUTATION='changed';
      if(step.refuseGuard)guardRefused=true;
      const output=Object.hasOwn(step,'stdout')?step.stdout:index===0?'{}':index===1?'\x7b"auth":{"token_host":"https://oauth2.googleapis.com/token"}}':TOKEN;
      const error=step.error?Object.assign(new Error(SECRET),{code:step.code??'EACCES'}):null;
      const close=()=>child.emit('close',Object.hasOwn(step,'exit')?step.exit:error?1:0,step.signal??null);
      if(step.closeFirst&&!step.noClose)close();
      callback(error,output);
      if(!step.closeFirst&&!step.noClose)close();
    });
    return child;
  };
  const input={syntheticOnly:true,environment,platform:options.platform??'win32',clock,invoke,schedule,cancel,guard,
    leaseExpiresAt:NOW+(options.leaseMs??600000),requestDeadline:NOW+(options.requestMs??15000)};
  return{calls,children,timerCaps,timerCallbacks,input,run:()=>simulateOfficialSdkAuthPreflight(input),get guardCalls(){return guardCalls;}};
}
test('immutable official factory bytes are unchanged and new imports never execute SDK',()=>{
  const bytes=fs.readFileSync(new URL('../../readonly-probe/rc47-probe-official-auth-v1.mjs',import.meta.url));assert.equal(byteHash(bytes),AUTH_FACTORY_SHA256);
  assert.equal(AUTH_NEW_FILES.length,6);assert.equal(AUTH_PREFLIGHT_DRIVER_INPUTS.length,new Set(AUTH_PREFLIGHT_DRIVER_INPUTS).size);
});
for(const[platform,caps]of[['win32',[5000,3000,6000]],['linux',[3000,3000,6000]],['darwin',[3000,3000,6000]]])test('complete official chain '+platform+' is sequential with fixed caps/account/endpoint and no token projection',async()=>{
  const f=sdk({platform}),r=await f.run();assert.equal(r.state,'AUTHENTICATION_CHAIN_VALIDATED');assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(c=>c.timeout),caps);
  assert(f.calls.every(c=>c.file===AUTH_PYTHON&&c.args[0]==='-I'&&c.args[1]===AUTH_GCLOUD));assert.deepEqual(f.calls[2].args,['-I',AUTH_GCLOUD,'auth','print-access-token','--account',AUTH_ACCOUNT,'--quiet']);
  assert.equal(f.calls[1].env.CLOUDSDK_CORE_ACCOUNT,AUTH_ACCOUNT);assert.equal(f.calls[2].env.CLOUDSDK_AUTH_TOKEN_HOST,'https://oauth2.googleapis.com/token');
  assert(r.stages.every(s=>s.processClosed&&s.configurationOrTokenValidated));assert.equal(r.tokenReferencesReleased,true);assert.equal(r.physicalStringErasureAsserted,false);
  assert.equal(r.iamPermissionsObserved,false);assert.equal(r.tokenExpirationKnown,false);assert.equal(r.accountIdentityIndependentlyProved,false);assert.equal(r.runPosts,0);
  assert.equal(r.tokenReferenceReleaseScope,'ADAPTER_JAVASCRIPT_ONLY');assert.equal(r.officialSdkMemoryOnlyGuaranteed,false);assert.equal(r.officialSdkCacheBehavior,'NOT_OBSERVED_STANDARD_INTERNAL_CACHE_MAY_WRITE');
  assert(!JSON.stringify(r).includes(SECRET));assert(!JSON.stringify(r).includes(TOKEN));
});
test('callback-after-close is accepted only with both events and no late deadline',async()=>{const f=sdk({steps:[{closeFirst:true},{closeFirst:true},{closeFirst:true}]});assert.equal((await f.run()).authenticationChainValidated,true);});
for(const[index,name]of['initial','pinned','token'].entries())test('first '+name+' causal timeout stops with no next command and observed SIGTERM cleanup',async()=>{
  const steps=[];steps[index]={hang:true};const f=sdk({steps}),r=await f.run();assert.equal(r.state,'AUTH_DEADLINE_TRIGGERED');assert.equal(f.calls.length,index+1);
  const s=r.stages[index];assert.equal(s.deadlineTriggered,true);assert.equal(s.abortIssued,true);assert.equal(s.spawnObserved,true);assert.equal(s.processClosed,true);assert.equal(s.terminationSignal,'SIGTERM');
  assert.equal(r.authenticationChainValidated,false);assert.equal(r.canRetry,false);assert.equal(r.sdkCommandsInvoked,index+1);
});
test('deadline exceeded by late callback is not mislabelled as an actually fired timer',async()=>{
  const f=sdk({steps:[{duration:5000}]}),r=await f.run();assert.equal(r.state,'AUTH_DEADLINE_EXCEEDED');assert.equal(r.stages[0].deadlineTriggered,false);assert.equal(r.stages[0].observedDeadlineExceeded,true);assert.equal(f.calls.length,1);
});
test('source/lease guard refusal is not a causal timeout',async()=>{
  const f=sdk({steps:[{refuseGuard:true}]}),r=await f.run();assert.equal(r.state,'AUTH_PRECONDITION_REFUSED');assert.equal(r.stages[0].deadlineTriggered,false);assert.equal(r.stages[0].observedDeadlineExceeded,false);assert.equal(f.calls.length,1);
});
test('unconfirmed process close is visible, bounded cleanup cannot enable another command, result is immutable-by-snapshot',async()=>{
  const f=sdk({steps:[{hang:true,abortClose:false}]}),r=await f.run(),before=JSON.stringify(r);assert.equal(r.stages[0].processClosed,false);assert.equal(r.cleanupElapsedMs,500);assert.equal(f.calls.length,1);
  f.children[0].emit('close',0,null);assert.equal(JSON.stringify(r),before);assert.equal(r.authenticationChainValidated,false);
});
for(const[name,options]of[
  ['no spawn',{steps:[{noSpawn:true}]}],['no close',{steps:[{noClose:true,abortClose:false}]}],['nonzero exit',{steps:[{exit:1}]}],
  ['signal termination',{steps:[{signal:'SIGTERM'}]}],['unknown exit',{steps:[{exit:null}]}],
])test('cannot continue when process proof is ambiguous: '+name,async()=>{const f=sdk(options),r=await f.run();assert.equal(r.authenticationChainValidated,false);assert.equal(f.calls.length,1);});
for(const code of ['ENOENT','EACCES','EPERM','EINVAL','ENOMEM','EAGAIN','ABORT_ERR','ERR_CHILD_PROCESS_STDIO_MAXBUFFER',SECRET])test('process OS class '+(code===SECRET?'unknown':code)+' is closed and expurgated',async()=>{
  const f=sdk({steps:[{throw:true,code}]}),r=await f.run();assert.equal(r.state,'AUTH_PROCESS_START_FAILED');assert.equal(f.calls.length,1);assert.equal(r.stages[0].processErrorClass,code===SECRET?'OTHER':code);assert(!JSON.stringify(r).includes(SECRET));
});
for(const index of [0,1,2])test('nonzero process at stage'+index+' stops before all later stages',async()=>{const steps=[];steps[index]={error:true};const f=sdk({steps}),r=await f.run();assert.equal(r.state,'AUTH_PROCESS_EXIT_ERROR');assert.equal(f.calls.length,index+1);assert(!JSON.stringify(r).includes(SECRET));});
for(const[index,stdout,state]of[
  [0,'{broken '+SECRET,'AUTH_JSON_REFUSED'],[0,'[]','AUTH_CONFIGURATION_REFUSED'],[0,'{"auth":{"access_token":"'+SECRET+'"}}','AUTH_CONFIGURATION_REFUSED'],
  [1,'{}','AUTH_CONFIGURATION_REFUSED'],[1,'{"auth":{"token_host":"https://invalid.example"}}','AUTH_CONFIGURATION_REFUSED'],[1,'{broken','AUTH_JSON_REFUSED'],
  [2,'','AUTH_TOKEN_VALIDATION_REFUSED'],[2,'a b','AUTH_TOKEN_VALIDATION_REFUSED'],[2,'x'.repeat(8193),'AUTH_TOKEN_VALIDATION_REFUSED'],
])test('factory validation stage'+index+' rejects '+state+' without raw output',async()=>{
  const steps=[];steps[index]={stdout};const f=sdk({steps}),r=await f.run();assert.equal(r.state,state);assert.equal(f.calls.length,index+1);assert(!JSON.stringify(r).includes(SECRET));
});
for(const stdout of ['x'.repeat(16385),null,{},Buffer.from('private')])test('SDK output bound/type refuses before continuation '+typeof stdout,async()=>{
  const f=sdk({steps:[{stdout}]}),r=await f.run();assert.equal(r.state,'AUTH_OUTPUT_BOUND_REFUSED');assert.equal(f.calls.length,1);
});
for(const[key,value]of[['CLOUDSDK_AUTH_ACCESS_TOKEN',SECRET],['cloudsdk_auth_token_host','https://bad.example'],['GOOGLE_APPLICATION_CREDENTIALS','private-path']])test('ambient authentication override refuses before first process '+key,async()=>{
  const f=sdk({environment:{[key]:value}}),r=await f.run();assert.equal(r.state,'AUTH_AMBIENT_OVERRIDE_REFUSED');assert.equal(f.calls.length,0);assert(!JSON.stringify(r).includes(SECRET));
});
test('empty ambient properties do not relax protected configuration checks',async()=>{const f=sdk({environment:{CLOUDSDK_AUTH_ACCESS_TOKEN:'',GOOGLE_APPLICATION_CREDENTIALS:null}});assert.equal((await f.run()).authenticationChainValidated,true);});
test('mutated incoming environment between stages fails closed before second invocation',async()=>{const f=sdk({steps:[{mutateEnvironment:true}]}),r=await f.run();assert.equal(r.state,'AUTH_PRECONDITION_REFUSED');assert.equal(f.calls.length,1);});
for(const[leaseMs,requestMs,expected]of[[800,1000,800],[1000,700,700],[600000,900,900]])test('effective budget min lease/request '+leaseMs+'/'+requestMs,async()=>{
  const f=sdk({leaseMs,requestMs,steps:[{hang:true}]}),r=await f.run();assert.equal(f.calls[0].timeout,expected);assert.equal(r.state,'AUTH_DEADLINE_TRIGGERED');assert.equal(f.calls.length,1);
});
for(const[leaseMs,requestMs]of[[0,15000],[1000,0],[-1,15000]])test('expired pre-first-stage boundary cannot spawn '+leaseMs+'/'+requestMs,async()=>{
  const f=sdk({leaseMs,requestMs}),r=await f.run();assert.equal(f.calls.length,0);assert.equal(r.authenticationChainValidated,false);
});
test('validation/guard overhead consumes actual remaining budget, not prevalidation remaining',async()=>{
  const f=sdk({requestMs:1000,guardCost:100,steps:[{hang:true}]}),r=await f.run();assert(f.calls[0].timeout>0&&f.calls[0].timeout<1000);assert.equal(f.calls[0].timeout,600);assert.equal(r.authenticationChainValidated,false);
});
test('near-deadline validation leaves precisely1ms, not a fresh5s process cap',async()=>{
  const f=sdk({requestMs:1000,guardAdvance:n=>n===4?999:0,steps:[{hang:true}]}),r=await f.run();assert.equal(f.calls[0].timeout,1);assert.equal(r.stages[0].deadlineTriggered,true);assert.equal(f.calls.length,1);
});
test('guard crossing local stage deadline is elapsed refusal without invented timer trigger',async()=>{
  const f=sdk({steps:[{duration:4990}],guardAdvance:n=>n===5?20:0}),r=await f.run();assert.equal(r.state,'AUTH_DEADLINE_EXCEEDED');assert.equal(r.stages[0].observedDeadlineExceeded,true);assert.equal(r.stages[0].deadlineTriggered,false);assert.equal(f.calls.length,1);
});
test('cancelled timer invoked late cannot flip an accepted stage or returned facts',async()=>{
  const f=sdk(),r=await f.run(),before=JSON.stringify(r);for(const cb of f.timerCallbacks)cb();assert.equal(JSON.stringify(r),before);assert(r.stages.every(s=>s.deadlineTriggered===false));
});
test('common absolute envelope is not reset at each stage even when all stage caps fit arithmetically',async()=>{
  const f=sdk({guardCost:1300}),r=await f.run();assert.equal(r.authenticationChainValidated,false);assert(f.calls.length<=3);assert.equal(r.absoluteEnvelopeMs,15000);
});
test('final post-token guard refusal is not token expiry or a process timeout',async()=>{
  const normal=sdk();await normal.run();const f=sdk({guardAt:normal.guardCalls}),r=await f.run();assert.equal(r.state,'AUTH_POSTCHECK_REFUSED');assert.equal(f.calls.length,3);assert(r.stages.every(s=>s.deadlineTriggered===false));
});
test('synthetic interface has explicit synthetic marker and refuses unsupported OS',async()=>{
  const f=sdk();await assert.rejects(simulateOfficialSdkAuthPreflight({...f.input,syntheticOnly:false}));await assert.rejects(sdk({platform:'other'}).run());assert.equal(f.calls.length,0);
});
function authRecord(){return{schemaVersion:1,kind:'GENERAL_COMPLETE_AUTH_PREFLIGHT_AUTHORITY_V1',mode:'AUTH_ONLY',humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,
  validFrom:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),qualificationSha256:H,
  source:{commit:'2'.repeat(40),tree:'3'.repeat(40),head:'1'.repeat(40),pr:301,files:AUTH_PREFLIGHT_DRIVER_INPUTS.map(p=>({path:p,sha256:byteHash('// synthetic '+p)}))}};}
test('AUTH_ONLY record has no old catalogue/capability/directory/RUN renewal requirement',()=>{const r=authRecord();assert.equal(validateAuthOnlyRecord(r,NOW),r);assert(!Object.hasOwn(r,'capabilityId'));assert(!Object.hasOwn(r,'binding'));});
for(const[name,mutate]of[
  ['RUN mode',r=>r.mode='RUN'],['expired',r=>r.expiresAt=new Date(NOW).toISOString()],['future',r=>r.validFrom=new Date(NOW+1).toISOString()],
  ['unbounded',r=>r.expiresAt=new Date(NOW+86400001).toISOString()],['old human',r=>r.humanAuthorityReceiptSha256=H],['cache clarification absent',r=>delete r.sdkCacheClarificationSha256],['wrong cache clarification',r=>r.sdkCacheClarificationSha256=H],['zero qualification',r=>r.qualificationSha256='0'.repeat(64)],
  ['missing source',r=>r.source.files.pop()],['old capability',r=>r.capabilityId='0d48bd85-8b95-f624-e32c-560406e6ddd8'],['source accessor',r=>Object.defineProperty(r.source,'commit',{get(){throw Error(SECRET);},enumerable:true})],
])test('AUTH-only local record refuses '+name,()=>{const r=authRecord();mutate(r);assert.throws(()=>validateAuthOnlyRecord(r,NOW));});
function qFixture(source=authRecord().source){return{status:'LOCAL_AUTH_ONLY_WINDOWS_BUDGET_AND_PRECLAIM_BOUNDARY_ROOT_STATIC_PASS_NOT_NATIVE_ACCEPTANCE',base:'fd9127d8a7bb04ca191caf4ba83a512aa542004b',
  sourceFrozen:true,allOldSourcesUnchanged:true,sdkCalls:0,nativeCalls:0,productionSqlQueries:0,dockerCalls:0,oldUnknownAndClosedClaimsUnchanged:true,newRunCapacityArmed:false,
  humanAuthority:{sha256:AUTH_HUMAN_SHA256},humanSdkStandardCacheClarification:{sha256:AUTH_SDK_CACHE_HUMAN_SHA256},sources:source.files.map(f=>({...f})),sourceCount:source.files.length,
  rootTotals:{pass:2000,fail:0,cancelled:0,skipped:3},targetedTests:{pass:100,fail:0,cancelled:0,skipped:0},
  stages:['ROOT-SYNTHETIC','REPOSITORY-STATIC-lint','REPOSITORY-STATIC-type-check','REPOSITORY-STATIC-build'].map(name=>({name,exitCode:0,errorCode:null}))};}
test('qualification actually binds all protected closure bytes, not only its external hash',()=>{const source=authRecord().source,q=qFixture(source);assert.equal(validateAuthSourceQualification(Buffer.from(JSON.stringify(q)),source).sourceCount,source.files.length);});
for(const[name,change]of[
  ['foreign status',q=>q.status='PASS'],['foreign base',q=>q.base='f'.repeat(40)],['unfrozen',q=>q.sourceFrozen=false],['old mutated',q=>q.allOldSourcesUnchanged=false],
  ['native called',q=>q.nativeCalls=1],['SDK called',q=>q.sdkCalls=1],['sql called',q=>q.productionSqlQueries=1],['docker called',q=>q.dockerCalls=1],
  ['closed changed',q=>q.oldUnknownAndClosedClaimsUnchanged=false],['RUN armed',q=>q.newRunCapacityArmed=true],['human wrong',q=>q.humanAuthority.sha256=H],
  ['count wrong',q=>q.sourceCount++],['duplicate path',q=>q.sources[1].path=q.sources[0].path],['wrong bytes',q=>q.sources[0].sha256=H],['absent input',q=>{q.sources.pop();q.sourceCount--;}],
  ['failed root',q=>q.rootTotals.fail=1],['skipped target',q=>q.targetedTests.skipped=1],['failed static',q=>q.stages[1].exitCode=1],['missing static',q=>q.stages.pop()],
])test('qualification refuses '+name,()=>{const r=authRecord(),q=qFixture(r.source);change(q);assert.throws(()=>validateAuthSourceQualification(Buffer.from(JSON.stringify(q)),r.source));});
test('human/qualification hash mismatch refuses before any governance call',async()=>{
  const record=authRecord();assert.throws(()=>validateAuthHumanAndQualification({humanAuthorityBytes:Buffer.from('{}'),qualificationBytes:Buffer.from('{}'),record}));
  let calls=0;await assert.rejects(authorizeAuthOnlyPreflight({github:{get(){calls++;}},record,jiraBytes:Buffer.from('{}'),humanAuthorityBytes:Buffer.from('{}'),qualificationBytes:Buffer.from('{}'),localSource:{...record.source,clean:true},clock:()=>NOW}));assert.equal(calls,0);
});
test('SDK standard cache needs the exact additive human clarification, not a synthetic permission',()=>{
  assert.equal(AUTH_SDK_CACHE_HUMAN_SHA256,'58ed93bdeee323b5dd0ad0e3e8d15ee4509042f31c2773f214ea00db3897c3a1');
  assert.throws(()=>validateSdkCacheClarification(Buffer.from('{}')),/EXACT_NARROW_SDK_CACHE_CLARIFICATION/u);
  assert.throws(()=>validateSdkCacheClarification('not bytes'));
});
function boundary({mode='SYNTHETIC_FUTURE_RUN',failAt,coverage='COMPLETE_PROTECTED_AND_OBSERVED',validated=true}={}){
  const events=[],names=['inputsSourceJiraLease','authentication','rightsAndResourceChecks','revalidation','claimAndDurableIntent','singlePost'];
  const stages=Object.fromEntries(names.map(name=>[name,async()=>{events.push(name);if(name===failAt)throw new Error(SECRET);return name==='authentication'?{validated}:name==='rightsAndResourceChecks'?{coverage}:{};}]));
  return{events,run:()=>simulateProspectivePreclaimBoundary({syntheticOnly:true,mode,stages})};
}
test('AUTH_ONLY integration exits before rights/resources/client construction/RUN arming',async()=>{
  const f=boundary({mode:'AUTH_ONLY'}),r=await f.run();assert.deepEqual(f.events,['inputsSourceJiraLease','authentication']);assert.equal(r.armed,false);assert.equal(r.runPosts,0);
});
test('synthetic future seam order puts full AUTH+rights+resource+revalidation before durable CLAIM/INTENT and one POST',async()=>{
  const f=boundary(),r=await f.run();assert.deepEqual(f.events,['inputsSourceJiraLease','authentication','rightsAndResourceChecks','revalidation','claimAndDurableIntent','singlePost']);assert.equal(r.runPosts,1);assert.equal(r.canRetry,false);
});
for(const name of ['inputsSourceJiraLease','authentication','rightsAndResourceChecks','revalidation','claimAndDurableIntent','singlePost'])test('future seam stops at first '+name+' refusal, no retry/fallback',async()=>{
  const f=boundary({failAt:name}),r=await f.run();assert.equal(f.events.at(-1),name);assert.equal(f.events.filter(n=>n==='singlePost').length,name==='singlePost'?1:0);assert.equal(r.canRetry,false);assert.equal(r.armed,name==='singlePost');assert(!JSON.stringify(r).includes(SECRET));
});
for(const coverage of ['DOCUMENTARY_ONLY','NOT_OBSERVED','INCOMPLETE',true,null])test('documentary/unknown/fake rights cannot arm '+coverage,async()=>{const f=boundary({coverage}),r=await f.run();assert.equal(r.armed,false);assert(!f.events.includes('claimAndDurableIntent'));});
test('partial auth cannot reach rights or claim',async()=>{const f=boundary({validated:false}),r=await f.run();assert.equal(r.armed,false);assert.deepEqual(f.events,['inputsSourceJiraLease','authentication']);});
test('concrete future entry refuses current AUTH-only authority without SDK/GCP or caller callbacks',async()=>{await assert.rejects(runProspectiveGeneralPreV2({mode:'AUTH_ONLY',authorize:()=>true}),/SEPARATE_RUN_AUTHORITY_AND_QUALIFIED_RIGHTS_RESOURCE_ADAPTER_REQUIRED/u);});
test('concrete actual entry rejects invalid/noop/auth/mode injections before SDK/governance and projects no secrets',async()=>{
  for(const input of [{},{record:{mode:'RUN'},secret:SECRET},{root:'x',record:authRecord(),jiraBytes:Buffer.from('{}'),humanAuthorityBytes:Buffer.from('{}'),qualificationBytes:Buffer.from('{}'),consumerInputs:{},execute(){throw Error(SECRET);}}]){
    const result=await runProspectiveAuthPreflightV2(input);assert.equal(result.state,'AUTH_ONLY_REFUSED_BEFORE_ATTEMPT');assert.equal(result.runPosts,0);assert.equal(result.runClaimsCreated,0);assert.equal(result.canRetry,false);assert(!JSON.stringify(result).includes(SECRET));
  }
});
function authSession({failAt,validated=true,stopFailure=false}={}){
  const events=[],steps=Object.fromEntries(['prepare','intent','authenticate','revalidate','finish','stop'].map(name=>[name,()=>{
    events.push(name);if(failAt===name||(name==='stop'&&stopFailure))throw new Error(SECRET);
    return name==='prepare'?{receipt:{expiresAt:new Date(NOW+1000).toISOString()}}:name==='authenticate'?{authenticationChainValidated:validated,tokenReferencesReleased:true}:undefined;
  }]));return{events,run:()=>simulateAuthOnlySession({syntheticOnly:true,steps})};
}
test('actual AUTH-only orchestration shared synthetic layer persists intent before SDK and FIN after revalidation, without RUN clients',async()=>{
  const f=authSession(),r=await f.run();assert.deepEqual(f.events,['prepare','intent','authenticate','revalidate','finish']);assert.equal(r.state,'AUTH_ONLY_COMPLETE_NO_RUN_AUTHORITY');assert.equal(r.nativeAuthority,false);assert.equal(r.syntheticOnly,true);assert.equal(r.runClaimsCreated,0);
});
for(const failAt of ['prepare','intent','authenticate','revalidate','finish'])test('shared AUTH-only orchestration '+failAt+' refusal is terminal without retry',async()=>{
  const f=authSession({failAt}),r=await f.run();assert.equal(r.canRetry,false);assert.equal(r.runPosts,0);assert.equal(f.events.filter(e=>e==='authenticate').length,['authenticate','revalidate','finish'].includes(failAt)?1:0);
  assert.equal(r.state,['prepare','intent'].includes(failAt)?'AUTH_ONLY_REFUSED_BEFORE_ATTEMPT':'AUTH_ONLY_ATTEMPT_CLOSED_INCOMPLETE');assert(!JSON.stringify(r).includes(SECRET));
});
test('SDK refusal has explicit auth result and permanent AUTH-only stop, never RUN',async()=>{const f=authSession({validated:false}),r=await f.run();assert.equal(r.state,'AUTH_ONLY_TERMINAL_STOP');assert.equal(r.authentication.authenticationChainValidated,false);assert.equal(r.runPosts,0);});
test('STOP evidence failure is visible and cannot restart SDK',async()=>{const f=authSession({failAt:'authenticate',stopFailure:true}),r=await f.run();assert.equal(r.evidencePersistenceFailed,true);assert.equal(f.events.filter(e=>e==='authenticate').length,1);});
// The fixed human receipt itself is confidential-source-bound external data;
// positive native governance fixtures are composed by root without adding PROD
// evidence or a falsified substitute human hash to this repository.
test('production human receipt is a fixed nonzero pin; tests never re-label synthetic human authority',()=>{assert.match(AUTH_HUMAN_SHA256,/^[a-f0-9]{64}$/u);assert.notEqual(AUTH_HUMAN_SHA256,H);});
function governance(){
  const record=authRecord(),source=record.source,base='/repos/shademounir/CrmYnov/',revision='6'.repeat(40),responses=new Map(),calls=[];let current=NOW;
  const grant=JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/codex-delegation.json',import.meta.url))),gd=grantDigest(grant);
  const blob=value=>({encoding:'base64',content:Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64')});
  const put=(route,value)=>responses.set(route,value),user={login:'shademounir',type:'User'};
  put('/user',user);put(base+'branches/develop',{protected:true,commit:{sha:revision}});
  put(base+'branches/develop/protection',{enforce_admins:{enabled:true},required_status_checks:{strict:true,contexts:['pr-policy']},required_conversation_resolution:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}});
  for(const ref of [source.head,revision])put(base+'contents/'+GRANT_PATH+'?ref='+ref,blob(grant));
  put(base+'contents/'+GITHUB_CODE_REVIEW_POLICY_PATH+'?ref='+revision,blob(JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/github-code-review-policy.json',import.meta.url)))));
  put(base+'compare/'+source.commit+'...'+revision,{merge_base_commit:{sha:source.commit},status:'ahead'});put(base+'git/commits/'+source.commit,{tree:{sha:source.tree}});
  for(const file of source.files)put(base+'contents/'+file.path+'?ref='+source.commit,blob('// synthetic '+file.path));
  const changed=[...AUTH_NEW_FILES],checks=DELEGATED_CHECKS.map((name,i)=>({id:30100+i,name,status:'completed',conclusion:'success',head_sha:source.head}));
  checks.push({id:30199,name:'pr-policy',status:'completed',conclusion:'success',head_sha:source.head},{id:30200,name:'simulate',status:'completed',conclusion:'success',head_sha:source.head});
  const decision={schemaVersion:1,executor:'Codex',decision:'approved',grantId:grant.id,grantDigest:gd,pullRequest:301,headSha:source.head,scopeDigest:scopeDigest(changed),
    checks:checks.filter(c=>!['pr-policy','simulate'].includes(c.name)).map(c=>({name:c.name,id:c.id})),evidence:['https://example.test/synthetic'],reservations:[],rollback:'New protected revert preserving all data.',personalVisualAcceptance:false,productionDeploymentAuthorized:false};
  const jira={observedAt:new Date(NOW-1000).toISOString(),source:NATIVE_JIRA_BINDING.source,executor:'Codex',observedBy:'shademounir',grantDigest:gd,
    accountId:NATIVE_JIRA_BINDING.accountId,cloudId:NATIVE_JIRA_BINDING.cloudId,invocationId:'f7e770cf-9b1c-49c0-8d20-529f0b8708be',url:NATIVE_JIRA_BINDING.url,
    ticket:{key:'CRMY-63',id:'10681',issueType:'Task',status:'In Review',labels:['codex-ready'],codexReady:true,blocked:false,links:[{id:'11388',type:'Blocks',inward:{key:'CRMY-61',status:'Done'},outward:null}]},
    sourceReadinessOnly:true,notPersonalHumanApproval:true,productionDeploymentAuthorized:false,noJiraMutation:true};
  const jiraBytes=Buffer.from(JSON.stringify(jira)),marker={schemaVersion:1,executor:'Codex',mode:'AUTH_ONLY',authorityRecordSha256:digest(record),driverCommit:source.commit,
    humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,qualificationSha256:record.qualificationSha256,grantDigest:gd,jiraObservationSha256:byteHash(jiraBytes),expiresAt:new Date(NOW+60000).toISOString(),businessMutation:false,runAuthorized:false};
  const comments=[{id:100,user,created_at:'2026-10-29T16:00:00Z',body:'<!-- codex-delegated-decision\n'+JSON.stringify(decision)+'\n-->'},
    {id:102,user,created_at:new Date(NOW-1000).toISOString(),body:'<!-- codex-general-auth-preflight-authorization:v1 '+JSON.stringify(marker)+' -->'}];
  put(base+'pulls/301',{number:301,head:{sha:source.head,repo:{full_name:'shademounir/CrmYnov'}},base:{ref:'develop',repo:{full_name:'shademounir/CrmYnov'}},merge_commit_sha:source.commit,
    merged:true,draft:false,auto_merge:null,user,merged_by:user,merged_at:'2026-10-29T16:30:00Z',labels:[{name:'codex-delegated-approved'}]});
  put(base+'pulls/301/files',changed.map(filename=>({filename})));put(base+'commits/'+source.head+'/check-runs',checks);put(base+'issues/301/comments',comments);put(base+'issues/301/timeline',[]);
  const read=route=>{calls.push(route);assert(responses.has(route));return structuredClone(responses.get(route));};
  const github={get:async route=>read(route),pages:async route=>read(route),reviewThreads:async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]},reviews:{nodes:[]}})};
  return{record,responses,calls,base,blob,github,marker,jiraBytes,advance(ms){current+=ms;},run:()=>simulateAuthOnlyGovernance({syntheticOnly:true,github,record,jiraBytes,localSource:{...source,clean:true},clock:()=>current}),refreshMarker(){comments[1].body='<!-- codex-general-auth-preflight-authorization:v1 '+JSON.stringify(marker)+' -->';}};
}
test('shared governance algorithm verifies source/grant/CI/native Jira/current policy and marker without old catalogue or bot',async()=>{
  const g=governance(),result=await g.run();assert.equal(result.syntheticOnly,true);assert.equal(result.nativeAuthority,false);assert.equal(result.receipt.runAuthorized,false);
  assert.equal(result.receipt.gcpResourceAccessAuthorized,false);assert.equal(result.receipt.gitHubCodeReviewRequired,false);assert.equal(result.receipt.jiraEvidenceSource,NATIVE_JIRA_BINDING.source);
  assert(g.calls.some(c=>c.includes('/check-runs')));assert(!g.calls.some(c=>c.includes('readonly-probe-objectives')));
});
for(const[name,change]of[
  ['unprotected branch',g=>g.responses.get(g.base+'branches/develop').protected=false],['admin enforcement',g=>g.responses.get(g.base+'branches/develop/protection').enforce_admins.enabled=false],
  ['conversation protection',g=>g.responses.get(g.base+'branches/develop/protection').required_conversation_resolution.enabled=false],['force pushes',g=>g.responses.get(g.base+'branches/develop/protection').allow_force_pushes.enabled=true],
  ['deletions',g=>g.responses.get(g.base+'branches/develop/protection').allow_deletions.enabled=true],['wrong merge',g=>g.responses.get(g.base+'pulls/301').merge_commit_sha='f'.repeat(40)],
  ['wrong exact SHA check',g=>g.responses.get(g.base+'commits/'+g.record.source.head+'/check-runs')[0].head_sha='f'.repeat(40)],['failed check',g=>g.responses.get(g.base+'commits/'+g.record.source.head+'/check-runs')[0].conclusion='failure'],
  ['unresolved conversation',g=>g.github.reviewThreads=async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[{isResolved:false}]},reviews:{nodes:[]}})],
  ['auto merge history',g=>g.responses.set(g.base+'issues/301/timeline',[{event:'auto_merge_enabled'}])],['source byte drift',g=>g.responses.set(g.base+'contents/'+g.record.source.files[1].path+'?ref='+g.record.source.commit,g.blob('changed'))],
  ['RUN marker',g=>{g.marker.runAuthorized=true;g.refreshMarker();}],['wrong qualification marker',g=>{g.marker.qualificationSha256='b'.repeat(64);g.refreshMarker();}],
  ['old human marker',g=>{g.marker.humanAuthorityReceiptSha256='b'.repeat(64);g.refreshMarker();}],['wrong record marker',g=>{g.marker.authorityRecordSha256='b'.repeat(64);g.refreshMarker();}],
  ['expired lease',g=>{g.marker.expiresAt=new Date(NOW).toISOString();g.refreshMarker();}],['no operational marker',g=>g.responses.get(g.base+'issues/301/comments').pop()],
  ['connector bytes mismatch',g=>g.jiraBytes[0]=0],
])test('shared governance refuses '+name,async()=>{const g=governance();change(g);await assert.rejects(g.run());});
test('protected auth closure reads are sequential and a refused source stops further reads',async()=>{
  const g=governance(),routes=g.record.source.files.map(f=>g.base+'contents/'+f.path+'?ref='+g.record.source.commit),seen=[];let active=0,maximum=0;const old=g.github.get;
  g.github.get=async route=>{if(!routes.includes(route))return old(route);active++;maximum=Math.max(maximum,active);seen.push(route);await Promise.resolve();try{return await old(route);}finally{active--;}};
  await g.run();assert.equal(maximum,1);assert.deepEqual(seen,routes);
  const bad=governance();bad.responses.set(routes[1],bad.blob('changed'));await assert.rejects(bad.run());assert(!bad.calls.includes(routes[2]));
});
test('the final provider read is inside60s collection bound, exact60s refuses before SDK or intent',async()=>{
  const delayed=delay=>{const g=governance(),get=g.github.get;let branchReads=0;
    g.github.get=async route=>{const result=await get(route);if(route===g.base+'branches/develop'&&++branchReads===2){g.advance(delay);}return result;};return g;};
  await assert.rejects(delayed(60000).run(),/AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND/u);
  const accepted=await delayed(59999).run();assert.equal(accepted.receipt.verifiedAt,new Date(NOW+59999).toISOString());assert.equal(accepted.nativeAuthority,false);
});
