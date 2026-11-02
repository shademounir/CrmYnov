// STRICT SYNTHETIC: portable repository test, no operational entry.
// Historical output-only provenance is retained and raw-inverted by the mapper.
import test from 'node:test';
// Match the default UTF-16/code-unit order without locale-dependent hashes.
const codeUnitOrder=(left,right)=>{if(left<right)return -1;if(left>right)return 1;return 0;};
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildApiSheetReaderPlanDraftV1 as build,validateApiSheetReaderPlanDraftV1 as validate,validateApiSheetReaderCurrentCasV1 as cas,validateApiSheetReaderServedV1 as served} from './sheets-api-reader-contract-v1.mjs';
import * as J from './journal.mjs';
const {imageJournalDigest:digest}=J;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalRef={sha256:'11d759e869649e96ca1b6276cf9b716e4955f8408d8c8654b255dae8690baacb'};
import {preSonarReaderContractBytesV1} from './source-before-sonar-v1.test-fixture.mjs';
const inputsContractBytes=preSonarReaderContractBytesV1(fs.readFileSync(new URL('./sheets-api-reader-contract-v1.mjs',import.meta.url)));
assert.equal(sha(inputsContractBytes),'afaf72194869b558c598c5e651efded2de4017d160e541884989fdfaa35f1750');
const inheritedReaderBytes=inputsContractBytes.subarray(0,9004);
assert.equal(sha(inheritedReaderBytes),'f7197e8ebc73809d656f0b25b1d38099f1a216bc234a0e3b081d99f347271daf');
assert.equal(sha(inputsContractBytes.subarray(9004)),'7be75eafe1740db7ce7d88f3ecb176dfecb68dd7572fd6f332ea483df1e7bebf');
const adapted=inheritedReaderBytes.toString('utf8');
const correction=" assert.deepEqual(revision.containers,plan.patch.body.template.containers,'READER_SERVED_CONTAINER_CONFIGURATION_DRIFT');\n";
assert.equal(adapted.split(correction).length,2);let reversed=adapted.replace(correction,'');
const metadataCorrection=[
 " assert.equal(typeof service.latestReadyRevision,'string');const prefix=RESOURCE+'/revisions/',ready=service.latestReadyRevision.startsWith(prefix)?service.latestReadyRevision.slice(prefix.length):service.latestReadyRevision;",
 String.raw` assert.match(ready,/^crm-prod-api-[a-z0-9-]+$/u);assert.match(service.generation,/^[1-9]\d*$/u);assert.equal(service.observedGeneration,service.generation);`,
 " assert(Array.isArray(service.trafficStatuses)&&service.trafficStatuses.length===1);const traffic=service.trafficStatuses[0];assert.equal(traffic.type,'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST');assert.equal(traffic.percent,100);assert.equal(typeof traffic.revision,'string');",
 " assert.equal(traffic.revision.startsWith(prefix)?traffic.revision.slice(prefix.length):traffic.revision,ready,'READER_BASELINE_READY_REVISION_REQUIRED');"
].join('\n')+'\n';
assert.equal(reversed.split(metadataCorrection).length,2);reversed=reversed.replace(metadataCorrection,'');
const NAME='projects/crmynov-prod-n7x4q2/locations/europe-west1/services/crm-prod-api';
const UID='a45fd6a6-f0d7-40e2-a9e5-da8a6f5fba81';
const IMAGE='europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:d2b2f6b0cf0ed9d9eb1cb15b70924af38be7ca4c4a824b6b406bb62caf88cd8f';
const FLAG='CRM_GOOGLE_SHEETS_ENABLED';
const OTHER=['SHEETS_ENABLED','SHEET_ROW_APPEND_ENABLED','CRM_SHEET_APPEND_POLICY_QUALIFIED','SHEET_CUTOVER_ENABLED','FORMINATOR_WEBHOOK_ENABLED'];
const NOW=Date.parse('2026-10-30T23:30:00.000Z'),ISO=new Date(NOW).toISOString();
const copy=structuredClone;
function env(container,name){const found=container.env.find(row=>row.name===name);assert(found);return found;}
function fixture(direction='ENABLE_READER'){
 const old=NAME+'/revisions/crm-prod-api-00028-synthetic';
 const before={name:NAME,uid:UID,etag:'synthetic-current-etag',generation:'28',observedGeneration:'28',latestReadyRevision:old,latestCreatedRevision:old,reconciling:false,terminalCondition:{state:'CONDITION_SUCCEEDED'},
  description:'SYNTHETIC realistic metadata, no actual resource observation',labels:{environment:'prod'},annotations:{'synthetic/qualified':'true'},client:'synthetic-qualified',clientVersion:'1',ingress:'INGRESS_TRAFFIC_ALL',launchStage:'GA',invokerIamDisabled:false,defaultUriDisabled:false,
  template:{revision:'crm-prod-api-00028-synthetic',serviceAccount:'synthetic-runtime@crmynov-prod-n7x4q2.iam.gserviceaccount.com',timeout:'300s',maxInstanceRequestConcurrency:80,scaling:{minInstanceCount:1,maxInstanceCount:4},
   vpcAccess:{egress:'PRIVATE_RANGES_ONLY',networkInterfaces:[{network:'synthetic-network',subnetwork:'synthetic-subnet'}]},
   volumes:[{name:'reader-config',secret:{secret:'synthetic-reader-config',items:[{version:'1',path:'allowlist.json',mode:256}]}}],
   containers:[{name:'api',image:IMAGE,args:['node','apps/api/dist/main.js'],ports:[{containerPort:8080}],resources:{limits:{cpu:'1',memory:'512Mi'},cpuIdle:true,startupCpuBoost:true},
    env:[...OTHER.map(name=>({name,value:'false'})),{name:FLAG,value:direction==='ENABLE_READER'?'false':'true'},{name:'CRM_BACKGROUND_WORKERS',value:'external'},
     {name:'CRM_GOOGLE_SHEETS_ALLOWLIST_FILE',value:'/var/run/sheets/allowlist.json'},{name:'CRM_GOOGLE_SHEETS_ALLOWLIST_SHA256',value:'a'.repeat(64)},
     {name:'CRM_GOOGLE_SHEETS_AUTH_MODE',value:'ADC_IMPERSONATION'},{name:'CRM_GOOGLE_SHEETS_IMPERSONATE_SERVICE_ACCOUNT',value:'synthetic-reader@crmynov-prod-n7x4q2.iam.gserviceaccount.com'},
     {name:'DATABASE_URL',valueSource:{secretKeyRef:{secret:'synthetic-database-url',version:'1'}}},{name:'LOG_LEVEL',value:'info'}],volumeMounts:[{name:'reader-config',mountPath:'/var/run/sheets'}]}]},
  traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}],trafficStatuses:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100,revision:old}]};
 const plan=build({direction,before,baselineObservedAt:ISO});
 return {direction,before,plan,now:NOW};
}
function observation(f){return{schemaVersion:2,kind:'NATIVE_GCP_JSON_GET_OBSERVATION_V2',requestStartedAt:new Date(f.now-100).toISOString(),responseReceivedAt:new Date(f.now-10).toISOString(),request:{method:'GET',url:'https://run.googleapis.com/v2/'+NAME},response:{status:200,finalUrl:'https://run.googleapis.com/v2/'+NAME,redirected:false,bodySha256:digest(f.before),hashMeaning:'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES',projection:copy(f.before)}};}
function casFixture(){const f=fixture();return{...f,observation:observation(f)};}
function rehash(f){f.observation.response.bodySha256=digest(f.observation.response.projection);}
function servedFixture(direction='ENABLE_READER'){
 const f=fixture(direction),service=copy(f.before),next=NAME+'/revisions/crm-prod-api-00029-synthetic';
 service.etag='synthetic-new-etag';service.generation='29';service.observedGeneration='29';service.latestReadyRevision=next;service.latestCreatedRevision=next;service.trafficStatuses[0].revision=next;service.template.revision='crm-prod-api-00029-synthetic';service.template.containers=copy(f.plan.patch.body.template.containers);
 const revision={name:next,reconciling:false,conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}],containers:copy(service.template.containers),serviceAccount:service.template.serviceAccount,volumes:copy(service.template.volumes)};
 return{...f,service,revision,observedAt:ISO};
}
test('current repository contract bytes retain both strict corrections and reverse exactly to the qualified historical contract',()=>{assert.equal(sha(reversed),originalRef.sha256);assert.notEqual(sha(adapted),originalRef.sha256);});
for(const direction of ['ENABLE_READER','DISABLE_READER']){
 test('SYNTHETIC '+direction+' draft/validate change exactly one existing literal value, preserving realistic containers/refs',()=>{
  const f=fixture(direction),before=copy(f.before);assert.deepEqual(validate(f.plan,f.before),f.plan);assert.deepEqual(f.before,before);
  const containers=copy(f.plan.patch.body.template.containers);env(containers[0],FLAG).value=env(f.before.template.containers[0],FLAG).value;assert.deepEqual(containers,f.before.template.containers);
  assert.deepEqual(Object.keys(f.plan.patch.body).sort(codeUnitOrder),['etag','name','template']);assert.equal(f.plan.patch.updateMask,'template.containers');assert.equal(f.plan.nativeAuthority,false);assert.equal(f.plan.ingestionActivation,false);
 });
 test('SYNTHETIC '+direction+' served accepts genuine new etag/generation/revision metadata without granting source/Google/SQL authority',()=>{
  const f=servedFixture(direction),before=copy(f),r=served(f);assert.deepEqual(f,before);assert.equal(r.readerEnabled,direction==='ENABLE_READER');
  for(const key of ['nativeOriginAuthenticated','httpRuntimeServedVerified','googleSourceReadVerified','connectorStoppedVerified','globalReadOnlyProved','sheetsActivated','activationAuthorized']){assert.equal(r[key],false);}
 });
}
for(const [name,mutate]of [
 ['unknown-direction',f=>f.direction='PATCH_API'],['Web resource substituted',f=>f.before.name=f.before.name.replace('crm-prod-api','crm-prod-web')],['wrong UID',f=>f.before.uid='synthetic-wrong-uid'],['wrong image',f=>f.before.template.containers[0].image+='-other'],
 ['second container',f=>f.before.template.containers.push(copy(f.before.template.containers[0]))],['reader missing',f=>f.before.template.containers[0].env=f.before.template.containers[0].env.filter(e=>e.name!==FLAG)],
 ['reader duplicate',f=>f.before.template.containers[0].env.push({name:FLAG,value:'false'})],['reader secret-backed',f=>{const e=env(f.before.template.containers[0],FLAG);delete e.value;e.valueSource={secretKeyRef:{secret:'synthetic-reader-flag',version:'1'}};}],
 ['reader nonliteral',f=>env(f.before.template.containers[0],FLAG).value=true],['workers inline',f=>env(f.before.template.containers[0],'CRM_BACKGROUND_WORKERS').value='inline'],['reconciling',f=>f.before.reconciling=true],
 ['deleted',f=>f.before.deleteTime=ISO],['failed service condition',f=>f.before.terminalCondition.state='CONDITION_FAILED'],['created not ready revision',f=>f.before.latestCreatedRevision+='-pending'],['invalid ISO baseline',f=>f.baselineObservedAt='2026-10-30T23:30:00Z']
]){test('draft refuses '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>build({direction:f.direction,before:f.before,baselineObservedAt:f.baselineObservedAt??ISO}));});}
for(const flag of OTHER){test('draft refuses enabled other gate '+flag,()=>{const f=fixture();env(f.before.template.containers[0],flag).value='true';assert.throws(()=>build({direction:f.direction,before:f.before,baselineObservedAt:ISO}));});}
for(const [name,mutate]of [
 ['different scope',f=>f.plan.scope='RC48_SERVICE_IMAGE_ONLY_V1'],['different action',f=>f.plan.action='PATCH_API'],['different stage',f=>f.plan.stage='API_IMAGE'],['different direction',f=>f.plan.direction='DISABLE_READER'],
 ['extra field',f=>f.plan.other=true],['arbitrary updateMask',f=>f.plan.patch.updateMask='template'],['API body becomes Web',f=>f.plan.patch.body.name=f.plan.patch.body.name.replace('crm-prod-api','crm-prod-web')],
 ['other env patched',f=>env(f.plan.patch.body.template.containers[0],'LOG_LEVEL').value='debug'],['mount patched',f=>f.plan.patch.body.template.containers[0].volumeMounts[0].mountPath='/other'],
 ['image patched',f=>f.plan.patch.body.template.containers[0].image+='-other'],['args patched',f=>f.plan.patch.body.template.containers[0].args.push('other')],['resource limits patched',f=>f.plan.patch.body.template.containers[0].resources.limits.cpu='2']
]){test('full plan rebuild refuses '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>validate(f.plan,f.before));});}
test('synthetic current CAS invokes the actual parser/comparator; false native-origin and claim status remain explicit',()=>{const f=casFixture(),before=copy(f),r=cas(f);assert.deepEqual(f,before);assert.equal(r.planSha256,digest(f.plan));assert.equal(r.nativeGetReceiptSha256,digest(f.observation));assert.equal(r.nativeOriginAuthenticated,false);assert.equal(r.claimArmed,false);assert.equal(r.activationAuthorized,false);});
for(const [name,mutate]of [
 ['wrong URL',f=>f.observation.request.url+='?other=true'],['wrong final URL',f=>f.observation.response.finalUrl+='?other=true'],['wrong method',f=>f.observation.request.method='POST'],['403 is a refusal, not token-expiry diagnosis',f=>f.observation.response.status=403],
 ['redirected',f=>f.observation.response.redirected=true],['not canonical parsed hash meaning',f=>f.observation.response.hashMeaning='WIRE_BYTES'],['wrong hash',f=>f.observation.response.bodySha256='b'.repeat(64)],
 ['extra raw payload',f=>f.observation.response.rawPayload='synthetic-not-retained'],['wrong schema',f=>f.observation.schemaVersion=1],['wrong observation kind',f=>f.observation.kind='SHAPE_ONLY'],
 ['age600000',f=>{f.observation.requestStartedAt=new Date(f.now-600000).toISOString();f.observation.responseReceivedAt=new Date(f.now-599999).toISOString();}],
 ['exchange15001',f=>{f.observation.requestStartedAt=new Date(f.now-15001).toISOString();f.observation.responseReceivedAt=ISO;}],['future end',f=>f.observation.responseReceivedAt=new Date(f.now+1).toISOString()],
 ['end before start',f=>f.observation.responseReceivedAt=new Date(f.now-101).toISOString()],['noncanonical time',f=>f.observation.requestStartedAt='2026-10-30T23:30:00Z'],['NaN clock',f=>f.now=Number.NaN]
]){test('fresh CAS refuses '+name,()=>{const f=casFixture();mutate(f);assert.throws(()=>cas(f));});}
for(const [name,mutate]of [
 ['UID',s=>s.uid='synthetic-other-uid'],['etag',s=>s.etag+='-new'],['image',s=>s.template.containers[0].image+='-other'],['other env',s=>env(s.template.containers[0],'LOG_LEVEL').value='debug'],
 ['mount',s=>s.template.containers[0].volumeMounts[0].mountPath='/other'],['volume identity',s=>s.template.volumes[0].secret.secret='synthetic-other-ref'],['service identity',s=>s.template.serviceAccount='synthetic-other@crmynov-prod-n7x4q2.iam.gserviceaccount.com'],
 ['workers',s=>env(s.template.containers[0],'CRM_BACKGROUND_WORKERS').value='inline'],['generation',s=>s.generation='29'],['observedGeneration',s=>s.observedGeneration='29'],
 ['latest revision',s=>{s.latestReadyRevision+='-other';s.latestCreatedRevision=s.latestReadyRevision;}],['traffic percent',s=>s.trafficStatuses[0].percent=50],['traffic revision',s=>s.trafficStatuses[0].revision+='-other'],['Web substitution',s=>s.name=s.name.replace('crm-prod-api','crm-prod-web')]
]){test('correctly rehashed fresh CAS still refuses semantic drift '+name,()=>{const f=casFixture();mutate(f.observation.response.projection);rehash(f);assert.throws(()=>cas(f));});}
test('CAS accepts age599999 and exchange15000 at their actual separate limits, not an invented global baseline300k TTL',()=>{
 const f=casFixture();f.observation.requestStartedAt=new Date(f.now-599999).toISOString();f.observation.responseReceivedAt=new Date(f.now-584999).toISOString();assert.equal(cas(f).claimArmed,false);
});
test('canonical old baseline ISO is metadata, not a fresh observation; only a genuine fresh CAS can be composed later',()=>{
 const f=fixture();f.plan=build({direction:f.direction,before:f.before,baselineObservedAt:'2025-10-30T23:30:00.000Z'});assert.equal(validate(f.plan,f.before).baselineObservedAt,'2025-10-30T23:30:00.000Z');f.observation=observation(f);assert.equal(cas(f).nativeOriginAuthenticated,false);
});
for(const [name,mutate]of [
 ['old generation',f=>f.service.generation='28'],['generation not observed',f=>f.service.observedGeneration='28'],['old etag empty',f=>f.service.etag=''],['old revision',f=>f.service.latestReadyRevision=f.before.latestReadyRevision],
 ['created revision differs',f=>f.service.latestCreatedRevision+='-other'],['traffic split',f=>f.service.trafficStatuses[0].percent=99],['traffic not latest',f=>f.service.trafficStatuses[0].type='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'],
 ['wrong traffic revision',f=>f.service.trafficStatuses[0].revision+='-other'],['wrong UID',f=>f.service.uid='synthetic-other-uid'],['Web substituted',f=>f.service.name=f.service.name.replace('crm-prod-api','crm-prod-web')],
 ['service image drift',f=>f.service.template.containers[0].image+='-other'],['revision image drift',f=>f.revision.containers[0].image+='-other'],['other service env',f=>env(f.service.template.containers[0],'LOG_LEVEL').value='debug'],
 ['service mount drift',f=>f.service.template.containers[0].volumeMounts[0].mountPath='/other'],['service volume drift',f=>f.service.template.volumes[0].secret.secret='synthetic-other-ref'],['service identity drift',f=>f.service.template.serviceAccount='synthetic-other@crmynov-prod-n7x4q2.iam.gserviceaccount.com'],
 ['service network drift',f=>f.service.template.vpcAccess.egress='ALL_TRAFFIC'],['served reader remains false',f=>env(f.revision.containers[0],FLAG).value='false'],['served workers inline',f=>env(f.revision.containers[0],'CRM_BACKGROUND_WORKERS').value='inline'],
 ['revision not Ready',f=>f.revision.conditions=[]],['revision name mismatch',f=>f.revision.name+='-other'],['service not Ready',f=>f.service.terminalCondition.state='CONDITION_FAILED'],['served observation too old',f=>f.now+=300001],['served observation future',f=>f.now-=1]
]){test('served comparator refuses '+name,()=>{const f=servedFixture();mutate(f);assert.throws(()=>served(f));});}
for(const flag of OTHER){test('served revision refuses enabled other gate '+flag,()=>{const f=servedFixture();env(f.revision.containers[0],flag).value='true';assert.throws(()=>served(f));});}
test('served age300000 is an actual metadata limit independent of the CAS600000 and PRE SQL freshness',()=>{const f=servedFixture();f.now+=300000;assert.equal(served(f).sheetsActivated,false);});
test('external Web preservation is outside these API-only seam inputs, not a fabricated verified boolean',()=>{
 const f=servedFixture(),web={name:NAME.replace('crm-prod-api','crm-prod-web'),etag:'synthetic-web-drift'};assert.equal(Object.hasOwn(f,'web'),false);assert.equal(Object.hasOwn(served(f),'webPreservationVerified'),false);assert.equal(web.etag,'synthetic-web-drift');
});
for(const [name,mutate]of [
 ['other environment',f=>env(f.revision.containers[0],'LOG_LEVEL').value='debug'],
 ['allowlist environment',f=>env(f.revision.containers[0],'CRM_GOOGLE_SHEETS_ALLOWLIST_SHA256').value='b'.repeat(64)],
 ['container mount',f=>f.revision.containers[0].volumeMounts[0].mountPath='/other'],
 ['container args',f=>f.revision.containers[0].args.push('other')],
 ['resource limits',f=>f.revision.containers[0].resources.limits.cpu='2']
]){test('served full containers refuse independent actual revision drift '+name,()=>{const f=servedFixture();mutate(f);assert.throws(()=>served(f));});}
const missingMetadata=[
 ['both revision pointers absent',s=>{delete s.latestReadyRevision;delete s.latestCreatedRevision;}],
 ['both revision pointers null',s=>{s.latestReadyRevision=null;s.latestCreatedRevision=null;}],
 ['both revision pointers empty',s=>{s.latestReadyRevision='';s.latestCreatedRevision='';}],
 ['generation pair absent',s=>{delete s.generation;delete s.observedGeneration;}],
 ['traffic statuses absent',s=>{delete s.trafficStatuses;}]
];
for(const [name,mutate]of missingMetadata){
 test('draft refuses incomplete metadata '+name,()=>{const f=fixture();mutate(f.before);assert.throws(()=>build({direction:f.direction,before:f.before,baselineObservedAt:ISO}));});
 test('fresh CAS refuses matching incomplete metadata '+name,()=>{const f=fixture();mutate(f.before);f.observation=observation(f);assert.throws(()=>cas(f));});
}
for(const [name,mutate]of [
 ['generation zero',s=>{s.generation='0';s.observedGeneration='0';}],['observed generation differs',s=>s.observedGeneration='27'],
 ['nonAPI revision',s=>{s.latestReadyRevision='crm-prod-web-00028-synthetic';s.latestCreatedRevision=s.latestReadyRevision;}],
 ['split traffic',s=>s.trafficStatuses[0].percent=50],['notlatest traffic',s=>s.trafficStatuses[0].type='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'],
 ['unbound traffic revision',s=>s.trafficStatuses[0].revision+='-other']
]){test('baseline Ready metadata refuses '+name,()=>{const f=fixture();mutate(f.before);assert.throws(()=>build({direction:f.direction,before:f.before,baselineObservedAt:ISO}));});}
