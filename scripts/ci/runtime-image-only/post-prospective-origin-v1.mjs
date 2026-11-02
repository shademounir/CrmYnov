// Explicit prospective resource acceptance. Pure validation, never an issuer.
// The original CREATE remains UNKNOWN; no provider attribution is inferred.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imageJournalDigest as digest} from './journal.mjs';
import {validateReadOnlyNativeJob,assertNoReadOnlyExecutionMetadataV1} from '../pool-reconciliation/pool-native-output-v1.mjs';
export {assertNoReadOnlyExecutionMetadataV1};
import {validateImageInventoryPublicProjection as publicData} from './operational-cli-v2.mjs';
export const POST_PROSPECTIVE_ORIGIN_MODE_V1='PROSPECTIVE_QUALIFIED_CURRENT_RESOURCE_WITH_CREATE_HISTORY_UNKNOWN';
export const POST_PROSPECTIVE_ORIGIN_PATH_V1='scripts/ci/runtime-image-only/post-prospective-origin-v1.mjs';
export const POST_PROSPECTIVE_RUN_DIRECTORY_V1='C:/Crm Ynov/output/casablanca-pilot-20261022/post-prospective-run-native-20261031-v1';
export const POST_PROSPECTIVE_GLOBAL_RUN_CLAIM_V1='C:/Crm Ynov/output/casablanca-pilot-20261022/rc48-post-operational-native-20261030-v1/POST-RUN-CAPABILITY.json';
export const POST_PROSPECTIVE_PINS_V1=Object.freeze({
 job:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-post-20261030-op-v1',uid:'5822363b-9c71-4ea6-b920-5d656150ebc4',
 objectiveId:'rc48-general-post-20261030-operational-v1',objectiveSha256:'143d2890fc04d312a55e2a947fe51407b132be980e60fb5183d56df8aea68e5c',
 dossierSha256:'484692845e99a828190e6b5232a9ea552d8bcf9b84f6573bda599c0f702723d0',
 n02Sha256:'bd9fd6d95a5328bc792cae15cb714203482084166dda2cd17784cf82471b4056',pureValidationSha256:'09d48962f1ce57b3524987150370e3966399f30b0ac0b4b784059968fc69fafb',
 unknownObservationSha256:'ad69c3a4c988701a2282780294918210e6341628a8b31eddde6eafb22ed01a75',unknownJournalSha256:'c2f5e2b8b2b338e78e3ad182aa95a354df00d80a9cf44b023a7bc16a27b987e2',
 originalCreateEntrySha256:'7d4701bcc815f402d91de38ed631e72dd9ec474950f1023671b555a19a1ff795',
 sourceSha256:'f2bdf90d80078a428a5a50bdf4d993592e9bac07dea798c13877c40030c71051',bundleSha256:'f89d4f72c7976af74fbfc025c8d0ea4e62c2609ec3f5dd8f143c33de1826de46',
 taskTemplateSha256:'20747811418bcb78105e7932a9ee1b3478e281d456b8e8593c79e7cb612c66c8',humanAuthoritySha256:'64b91382c47403e88dedfa3a3c9241a3231a99d636312ae2a888619c65729fe6'
});
const P=POST_PROSPECTIVE_PINS_V1,H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u,RUN='https://run.googleapis.com/v2/';
const alphabetical=(a,b)=>a.localeCompare(b,'en');
const hash=value=>createHash('sha256').update(value).digest('hex');
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);const d=Object.getOwnPropertyDescriptors(value);assert(Reflect.ownKeys(d).every(k=>typeof k==='string'&&Object.hasOwn(d[k],'value')));assert.deepEqual(Object.keys(d).toSorted(alphabetical),keys.toSorted(alphabetical));}
function time(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value);return n;}
function parsed(bytes,expected){assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);assert.equal(hash(bytes),expected,'POST_ORIGIN_PINNED_BYTES');return JSON.parse(bytes);}
function ready(job){assertNoReadOnlyExecutionMetadataV1(job);assert.equal(job.reconciling??false,false);assert.equal(job.deleteTime,undefined);assert.match(job.generation,/^[1-9]\d*$/u);assert.equal(job.observedGeneration,job.generation);assert.equal(job.terminalCondition?.state,'CONDITION_SUCCEEDED');}
export function validatePostProspectiveBaselineV1({n02Bytes,pureValidationBytes,unknownObservationBytes,dossierBytes}){
 const n=parsed(n02Bytes,P.n02Sha256),v=parsed(pureValidationBytes,P.pureValidationSha256),u=parsed(unknownObservationBytes,P.unknownObservationSha256),d=parsed(dossierBytes,P.dossierSha256);
 assert.equal(n.kind,'NATIVE_READ_ONLY_INVENTORY_OBSERVATION_V2');assert.equal(n.state,'FIN_READ_ONLY_INVENTORY_NOT_BASELINE_OR_PRE');assert.equal(n.source.commit,'d6b9124d013a739ccce239815f2035a19440e6b1');
 const rows=n.observations.jobs.filter(j=>j.name===P.job);assert.equal(rows.length,1);const job=rows[0],exchange=n.exchanges.find(e=>e.ordinal===9);
 assert.equal(exchange.request.url,RUN+P.job.split('/jobs/')[0]+'/jobs?pageSize=100&showDeleted=true');assert.equal(exchange.status,200);assert.equal(digest({jobs:n.observations.jobs}),exchange.responseSha256,'COMPLETE_NATIVE_N02_LIST_BODY_REQUIRED');
 assert.equal(v.nativeInventory.sha256,P.n02Sha256);assert.equal(v.qualifiedTaskValidatorAccepted,true);assert.equal(v.notIndependentCreateAttribution,true);assert.equal(v.nativeJob.uid,P.uid);
 assert.equal(u.journal.sha256,P.unknownJournalSha256);assert.deepEqual(u.events.map(e=>[e.stage,e.state]),[['CREATE','INTENT'],['CREATE','UNKNOWN']]);assert(u.events.every(e=>e.job===P.job&&e.objectiveSha256===P.objectiveSha256&&e.operation===null&&e.uid===null));
 for(const key of ['objectiveSha256','sourceSha256','bundleSha256','taskTemplateSha256']){assert.equal(d.objective[key],P[key]);}assert.equal(d.objective.jobName,P.job);assert.equal(d.bundle.request.phase,'POST');
 validateReadOnlyNativeJob(job,d.objective);assert.equal(job.uid,P.uid);ready(job);
 return Object.freeze({schemaVersion:1,kind:'POST_PROSPECTIVE_BASELINE_V1',mode:POST_PROSPECTIVE_ORIGIN_MODE_V1,job:P.job,uid:P.uid,objectiveSha256:P.objectiveSha256,dossierSha256:P.dossierSha256,n02Sha256:P.n02Sha256,pureValidationSha256:P.pureValidationSha256,unknownObservationSha256:P.unknownObservationSha256,unknownJournalSha256:P.unknownJournalSha256,jobSha256:digest(job),createTime:job.createTime,creator:job.creator,taskTemplateSha256:P.taskTemplateSha256,historicalCreateState:'UNKNOWN',independentCreateAttribution:false});
}
function checkedFrame(frame,now){
 exact(frame,['schemaVersion','kind','requestStartedAt','responseReceivedAt','request','response']);assert.equal(frame.schemaVersion,2);assert.equal(frame.kind,'NATIVE_GCP_JSON_GET_OBSERVATION_V2');const start=time(frame.requestStartedAt),end=time(frame.responseReceivedAt);assert(start<=end&&end<=now&&end-start<=15000&&now-start<600000);
 exact(frame.request,['method','url']);assert.equal(frame.request.method,'GET');exact(frame.response,['status','finalUrl','redirected','bodySha256','hashMeaning','projection']);assert.equal(frame.response.status,200);assert.equal(frame.response.finalUrl,frame.request.url);assert.equal(frame.response.redirected,false);assert.equal(frame.response.hashMeaning,'CANONICAL_PARSED_JSON_NOT_WIRE_BYTES');assert.equal(frame.response.bodySha256,digest(frame.response.projection));return start;
}

function checkedFrameOrderV2(frames,now){
 const starts=frames.map(frame=>checkedFrame(frame,now));
 for(let index=1;index<frames.length;index++){
  assert(time(frames[index-1].responseReceivedAt)<=starts[index],'POST_ORIGIN_READ_ORDER');
 }
 return starts;
}
function checkedCurrentJobV2(job,dossier,baseline,expectedUid=P.uid){
 validateReadOnlyNativeJob(job,dossier.objective);assert.equal(job.uid,expectedUid);
 assert.equal(job.createTime,baseline.createTime);assert.equal(job.creator,baseline.creator);
 ready(job);assert.equal(typeof job.etag,'string');assert(job.etag.length>0&&job.etag.length<=256);
}
export function validatePostProspectiveEmptyExecutionPageV1(value){ assert(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(key=>['executions','nextPageToken'].includes(key)));
 assert((!Object.hasOwn(value,'executions')||Array.isArray(value.executions))&&(value.executions??[]).length===0,'PREEXISTING_EXECUTION');
 assert(!Object.hasOwn(value,'nextPageToken')||typeof value.nextPageToken==='string','NATIVE_PAGE_TOKEN_TYPE');
 const next=value.nextPageToken??'';assert(typeof next==='string'&&next.length<=8192&&!/[\u0000-\u001f\u007f]/u.test(next));
 return next;
}
function checkedEmptyExecutionPageV2(frame,index,token,seen,jobName=P.job){
 const url=new URL(RUN+jobName+'/executions');url.searchParams.set('pageSize','100');url.searchParams.set('showDeleted','true');
 if(token){url.searchParams.set('pageToken',token);}
 assert.equal(frame.request.url,url.href);assert(index<20);const value=frame.response.projection;

 const next=validatePostProspectiveEmptyExecutionPageV1(value);
 assert(!next||!seen.has(next),'POST_ORIGIN_PAGE_CYCLE');if(next){seen.add(next);}
 assert(!index||token,'POST_ORIGIN_PAGE_AFTER_COMPLETION');return next;
}
function checkedEmptyExecutionPagesV2(frames,jobName=P.job){
 let token='';const seen=new Set();
 for(const [index,frame]of frames.slice(1,-1).entries()){token=checkedEmptyExecutionPageV2(frame,index,token,seen,jobName);}
 return token;
}

function postOwnDataFieldV4(value,key){
 assert(value&&Object.getPrototypeOf(value)===Object.prototype);
 const descriptor=Object.getOwnPropertyDescriptor(value,key);assert(descriptor&&Object.hasOwn(descriptor,'value'),'POST_DOSSIER_OWN_DATA_REQUIRED');return descriptor.value;
}
function bindClosedPostDossierV4(dossier,baseline){
 const objective=postOwnDataFieldV4(dossier,'objective');
 const expected={objectiveSha256:P.objectiveSha256,sourceSha256:P.sourceSha256,bundleSha256:P.bundleSha256,taskTemplateSha256:P.taskTemplateSha256,jobName:P.job};
 for(const [key,value]of Object.entries(expected)){assert.equal(postOwnDataFieldV4(objective,key),value,'POST_DOSSIER_FIXED_BINDING_REQUIRED');}
 assert.equal(baseline.job,P.job);assert.equal(baseline.objectiveSha256,P.objectiveSha256);assert.equal(baseline.taskTemplateSha256,P.taskTemplateSha256);
}
export function validatePostReadOnlyCurrentStructureV1({baseline,dossier,frames,now}){
 publicData({baseline,frames});assert(Number.isSafeInteger(now));assert(Array.isArray(frames)&&frames.length>=3&&frames.length<=22);
 const objective=postOwnDataFieldV4(dossier,'objective'),jobName=postOwnDataFieldV4(objective,'jobName');assert.equal(baseline.job,jobName);
 const starts=checkedFrameOrderV2(frames,now),first=frames[0],last=frames.at(-1);assert.equal(first.request.url,RUN+jobName);assert.equal(last.request.url,RUN+jobName);
 const a=first.response.projection,b=last.response.projection;for(const job of [a,b]){checkedCurrentJobV2(job,dossier,baseline,baseline.uid);}
 assert.equal(a.etag,b.etag,'POST_PROSPECTIVE_ETAG_DRIFT');const token=checkedEmptyExecutionPagesV2(frames,jobName);assert.equal(token,'','COMPLETE_NATIVE_EXECUTION_LIST_REQUIRED');
 return Object.freeze({schemaVersion:1,kind:'READ_ONLY_CURRENT_RESOURCE_STRUCTURAL_ONLY_V1',nativeAuthority:false,prospectiveOriginIssued:false,job:jobName,uid:b.uid,etag:b.etag,
  objectiveSha256:objective.objectiveSha256,sourceSha256:objective.sourceSha256,bundleSha256:objective.bundleSha256,taskTemplateSha256:objective.taskTemplateSha256,
  framesSha256:digest(frames),earliestRequestAt:new Date(Math.min(...starts)).toISOString(),observedAt:new Date(Math.max(...frames.map(frame=>time(frame.responseReceivedAt)))).toISOString()});
}
export function validatePostProspectiveCurrentFramesV1({baseline,dossier,frames,source,authorityRecordSha256,authorityExpiresAt,commonSessionBindingSha256,now}){
 publicData({baseline,source});assert.equal(baseline.mode,POST_PROSPECTIVE_ORIGIN_MODE_V1);assert.equal(baseline.uid,P.uid);assert.equal(baseline.unknownJournalSha256,P.unknownJournalSha256);
 bindClosedPostDossierV4(dossier,baseline);
 assert(S.test(source.commit)&&S.test(source.tree)&&source.clean===true&&Array.isArray(source.files));assert(source.files.some(file=>file.path===POST_PROSPECTIVE_ORIGIN_PATH_V1));assert(H.test(authorityRecordSha256)&&H.test(commonSessionBindingSha256));
 const current=validatePostReadOnlyCurrentStructureV1({baseline,dossier,frames,now}),expires=Math.min(time(current.earliestRequestAt)+600000,time(authorityExpiresAt));assert(expires>now);
 return Object.freeze({schemaVersion:1,kind:'POST_PROSPECTIVE_CURRENT_RESOURCE_ORIGIN_V1',mode:POST_PROSPECTIVE_ORIGIN_MODE_V1,job:P.job,uid:P.uid,etag:current.etag,baselineSha256:digest(baseline),originalUnknownJournalSha256:P.unknownJournalSha256,originalUnknownObservationSha256:P.unknownObservationSha256,n02Sha256:P.n02Sha256,pureValidationSha256:P.pureValidationSha256,dossierSha256:P.dossierSha256,objectiveSha256:P.objectiveSha256,sourceSha256:P.sourceSha256,bundleSha256:P.bundleSha256,taskTemplateSha256:P.taskTemplateSha256,sourceCommit:source.commit,sourceTree:source.tree,sourceManifestSha256:digest(source.files),authorityRecordSha256,commonSessionBindingSha256,framesSha256:digest(frames),observedAt:current.observedAt,expiresAt:new Date(expires).toISOString(),historicalCreateState:'UNKNOWN',independentCreateAttribution:false,secondCreateAuthorized:false,nativeAuthorityAcquiredByPureValidator:false});
}
