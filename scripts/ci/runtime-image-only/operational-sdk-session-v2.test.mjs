// SYNTHETIC ONLY. Fake process events and clocks; never SDK/cache/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {simulateOfficialSdkOperationalSession,simulateOfficialSdkAuthPreflight,AUTH_ACCOUNT} from '../readonly-probe/official-sdk-auth-preflight-v1.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
const NOW=Date.parse('2026-10-30T12:00:00.000Z'),H='a'.repeat(64),TOKEN='SYNTHETIC_PRIVATE_TOKEN_DO_NOT_PROJECT';
function fixture(options={}){
  let now=NOW,count=0,refused=false;const calls=[];
  const contract={schemaVersion:2,kind:'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2',sessionId:'local:12345678-1234-1234-1234-123456789abc',authorityRecordSha256:H,resourceBindingSha256:H,
    sourceCommit:'b'.repeat(40),sourceTree:'c'.repeat(40),scope:options.scope??'RC48_SERVICE_IMAGE_ONLY_V1',project:'crmynov-prod-n7x4q2',region:'europe-west1',windowStart:new Date(NOW-1000).toISOString(),windowEnd:new Date(NOW+899000).toISOString(),googleAccount:AUTH_ACCOUNT};
  const authority={entry:{schemaVersion:2,scope:contract.scope,googleAccount:AUTH_ACCOUNT,project:contract.project,region:contract.region,authorityRecordSha256:H,resourceBindingSha256:H,
    driver:{mergeCommit:contract.sourceCommit,tree:contract.sourceTree},preparationMode:contract.scope==='READ_ONLY_INVENTORY'?'READ_ONLY_INVENTORY':'LATE_BOUND_V2',preparationPhase:contract.scope==='READ_ONLY_INVENTORY'?'READ_ONLY_INVENTORY':'BACKUP_READY',
    actions:['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'],validFrom:contract.windowStart,expiresAt:contract.windowEnd},receipt:{schemaVersion:2,driverCommit:contract.sourceCommit,authorityRecordSha256:H,resourceBindingSha256:H,verifiedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+600000).toISOString()}};
  if(contract.scope==='POST_PRESERVATION_READ_ONLY_V2'){
    const resourceBindings={schemaVersion:2,kind:'POST_PRESERVATION_RESOURCE_BINDING_V2',project:contract.project,region:contract.region,objectiveId:'rc48-general-post-synthetic-0001',job:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-post-synthetic-0001',dossierSha256:H,sourceSha256:H,bundleSha256:H,image:'europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:d2b2f6b0cf0ed9d9eb1cb15b70924af38be7ca4c4a824b6b406bb62caf88cd8f',role:'crm_runtime',selectCount:13};
    Object.assign(contract,{resourceBindingSha256:digest(resourceBindings),preparationPhase:options.phase??'POST_RESOURCE_PREPARATION',commonSessionBindingSha256:H});
    Object.assign(authority.entry,{resourceBindings,resourceBindingSha256:contract.resourceBindingSha256,preparationMode:'POST_PRESERVATION_V2',preparationPhase:contract.preparationPhase,commonSessionBindingSha256:H,actions:['CREATE_POST_JOB','RUN_POST_JOB','READ_POST_OUTPUT','READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']});Object.assign(authority.receipt,{resourceBindingSha256:contract.resourceBindingSha256,commonSessionBindingSha256:H});
  }
  const schedule=(callback,ms)=>{const handle={cancelled:false};setImmediate(()=>{if(!handle.cancelled){now+=ms;callback();}});return handle;};
  const cancel=h=>{if(h){h.cancelled=true;}};
  const invoke=(file,args,config,callback)=>{
    const index=count++,child=new EventEmitter();calls.push({file,args,timeout:config.timeout});const step=options.steps?.[index]??{};
    config.signal.addEventListener('abort',()=>queueMicrotask(()=>{callback(Object.assign(new Error(TOKEN),{code:'ABORT_ERR'}),'');child.emit('close',null,'SIGTERM');}),{once:true});
    queueMicrotask(()=>{child.emit('spawn');if(step.hang){return;}now+=step.duration??100;
      callback(step.error?new Error(TOKEN):null,step.output??(index===0?'{}':index===1?'{"auth":{"token_host":"https://oauth2.googleapis.com/token"}}':TOKEN));child.emit('close',step.error?1:0,null);
    });return child;
  };
  const input={syntheticOnly:true,operationContract:contract,getAuthority:()=>authority,assertCurrent:()=>{if(refused){throw new Error(TOKEN);}},environment:options.environment??{},platform:options.platform??'win32',clock:()=>now,invoke,schedule,cancel};
  return{contract,authority,input,calls,open:()=>simulateOfficialSdkOperationalSession(input),advance:n=>{now+=n;},refuse:()=>{refused=true;}};
}
for(const scope of ['READ_ONLY_INVENTORY','RC48_SERVICE_IMAGE_ONLY_V1','RC48_SERVICE_IMAGE_ROLLBACK_V1']){
  test('operational '+scope+' acquires one official chain, reuses only in-memory provider, and releases',async()=>{
    const f=fixture({scope}),session=await f.open();assert.equal(session.report().authenticationChainValidated,true);assert.equal(session.report().tokenReferencesReleased,false);
    assert.deepEqual(f.calls.map(c=>c.timeout),[5000,3000,6000]);assert.equal(await session.accessToken(),TOKEN);assert.equal(await session.accessToken(),TOKEN);assert.equal(f.calls.length,3);
    f.advance(20000);assert.equal(await session.accessToken(),TOKEN);assert.equal(session.report().authElapsedMs,300);assert.equal(session.report().absoluteEnvelopeMs,15000);
    assert.equal(session.report().scope,'OPERATIONAL_AUTHENTICATION_ONLY_NOT_RESOURCE_RESULT');for(const field of ['cloudRunOrLoggingResourceCalls','runPosts','sqlQueries','runCapabilityCreated']){assert.equal(Object.hasOwn(session.report(),field),false);}
    assert(!JSON.stringify(session.report()).includes(TOKEN));session.close();session.close();assert.equal(session.report().tokenReferencesReleased,true);assert.equal(session.report().physicalStringErasureAsserted,false);
    await assert.rejects(session.accessToken(),/^Error: SDK_OPERATION_SESSION_CLOSED_OR_PRECONDITION_REFUSED$/u);assert.equal(f.calls.length,3);
  });
}
for(const [name,change]of [
  ['schema',f=>f.contract.schemaVersion=1],['scope',f=>f.contract.scope='GENERAL_RUN'],['account',f=>f.contract.googleAccount='wrong@example.invalid'],
  ['source',f=>f.contract.sourceCommit='d'.repeat(40)],['tree',f=>f.authority.entry.driver.tree='d'.repeat(40)],['authority hash',f=>f.authority.receipt.authorityRecordSha256='d'.repeat(64)],
  ['resource binding',f=>f.authority.entry.resourceBindingSha256='d'.repeat(64)],['wrong region',f=>f.contract.region='us-central1'],['legacy schema',f=>f.authority.entry.schemaVersion=1],
  ['expired',f=>f.advance(600001)],['future',f=>f.contract.windowStart=new Date(NOW+1).toISOString()],['wide window',f=>f.contract.windowEnd=new Date(NOW+900001).toISOString()],
  ['missing field',f=>delete f.contract.sessionId],['unexpected URL',f=>f.contract.url='https://private.invalid'],['getter',f=>Object.defineProperty(f.contract,'sourceCommit',{enumerable:true,get(){throw Error(TOKEN);}})],
  ['unprotected mode',f=>f.authority.entry.preparationMode='ANYTHING'],['wrong phase',f=>f.authority.entry.preparationPhase='RUN'],['source guard',f=>f.refuse()]
]){test('operational contract refuses before SDK: '+name,async()=>{const f=fixture();change(f);await assert.rejects(f.open(),/^Error: SDK_OPERATION_CONTRACT_REFUSED$/u);assert.equal(f.calls.length,0);});}
test('ambient override is distinguished without process or retained token',async()=>{const f=fixture({environment:{CLOUDSDK_AUTH_ACCESS_TOKEN:TOKEN}}),s=await f.open();assert.equal(s.report().state,'AUTH_AMBIENT_OVERRIDE_REFUSED');assert.equal(s.report().tokenReferencesReleased,true);assert.equal(f.calls.length,0);assert(!JSON.stringify(s.report()).includes(TOKEN));});
for(const index of [0,1,2]){test('operational stage timeout '+index+' closes once without fallback',async()=>{const steps=[];steps[index]={hang:true};const f=fixture({steps}),s=await f.open();assert.equal(s.report().state,'AUTH_DEADLINE_TRIGGERED');assert.equal(s.report().tokenReferencesReleased,true);assert.equal(f.calls.length,index+1);await assert.rejects(s.accessToken());assert.equal(f.calls.length,index+1);});}
test('late SDK result is not accepted even without fired timer',async()=>{const f=fixture({steps:[{duration:5000}]}),s=await f.open();assert.equal(s.report().authenticationChainValidated,false);assert.equal(s.report().state,'AUTH_DEADLINE_EXCEEDED');assert.equal(f.calls.length,1);});
test('consumer failure can be followed by guaranteed close, not a second auth',async()=>{const f=fixture(),s=await f.open();try{await s.accessToken();throw Error(TOKEN);}catch{}finally{s.close();}assert.equal(s.report().tokenReferencesReleased,true);assert.equal(f.calls.length,3);assert(!JSON.stringify(s.report()).includes(TOKEN));});
for(const [name,mutate]of [['lease',f=>f.advance(600001)],['source',f=>f.authority.receipt.driverCommit='d'.repeat(40)],['guard',f=>f.refuse()],['backwards clock',f=>f.advance(-1000)]]){
  test('provider refuses '+name+' drift, releases references, never reacquires',async()=>{const f=fixture(),s=await f.open();mutate(f);await assert.rejects(s.accessToken(),/^Error: SDK_OPERATION_SESSION_CLOSED_OR_PRECONDITION_REFUSED$/u);assert.equal(s.report().tokenReferencesReleased,true);assert.equal(f.calls.length,3);});
}
test('abort signal is terminal without a new SDK command',async()=>{const f=fixture(),s=await f.open(),c=new AbortController();c.abort();await assert.rejects(s.accessToken({signal:c.signal}));assert.equal(s.report().tokenReferencesReleased,true);assert.equal(f.calls.length,3);});
test('historical AUTH_ONLY synthetic surface cannot enable private operational retention by an extra property',async()=>{const f=fixture(),r=await simulateOfficialSdkAuthPreflight({...f.input,guard:()=>{},leaseExpiresAt:NOW+600000,requestDeadline:NOW+15000,retainOperationalToken:true});assert.equal(r.kind,'EXPURGATED_COMPLETE_OFFICIAL_SDK_AUTH_PREFLIGHT_V1');assert.equal(r.tokenReferencesReleased,true);assert(!Object.hasOwn(r,'retainedToken'));assert(!JSON.stringify(r).includes(TOKEN));});
for(const phase of ['POST_RESOURCE_PREPARATION','POST_EXECUTION']){test('POST SDK scope is explicit and bound to its own job/dossier/source/common session '+phase,async()=>{const f=fixture({scope:'POST_PRESERVATION_READ_ONLY_V2',phase}),s=await f.open();assert.equal(s.report().authenticationChainValidated,true);assert.equal(s.report().resourceAuthorityScope,'POST_PRESERVATION_READ_ONLY_V2');assert.equal(s.report().preparationPhase,phase);assert.equal(await s.accessToken(),TOKEN);s.close();assert.equal(s.report().tokenReferencesReleased,true);assert.equal(f.calls.length,3);});}
for(const [name,change]of [['resource changed',f=>f.authority.entry.resourceBindings.bundleSha256='d'.repeat(64)],['PRE substituted',f=>f.authority.entry.resourceBindings.job=f.authority.entry.resourceBindings.job.replace('-post-','-pre-')],['unknown action',f=>f.authority.entry.actions.push('DELETE_JOB')],['phase changed',f=>f.authority.entry.preparationPhase='POST_EXECUTION'],['missing common binding',f=>delete f.contract.commonSessionBindingSha256],['common binding mismatch',f=>f.authority.receipt.commonSessionBindingSha256='d'.repeat(64)],['image mode substituted',f=>f.authority.entry.preparationMode='LATE_BOUND_V2'],['role changed',f=>f.authority.entry.resourceBindings.role='crm_migrator']]){test('POST SDK refuses '+name+' before invoking SDK',async()=>{const f=fixture({scope:'POST_PRESERVATION_READ_ONLY_V2'});change(f);await assert.rejects(f.open(),/SDK_OPERATION_CONTRACT_REFUSED/u);assert.equal(f.calls.length,0);});}
