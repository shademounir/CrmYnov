// OFFLINE preparation only. Reuses the unchanged protected metadata validators.
// No CLI, transport, credential/key capability, journal handle/transition or output reader.
import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';
import {validateReadOnlyObjective,validateReadOnlyNativeJob,validateReadOnlyNativeExecution} from './pool-native-output-v1.mjs';
const parent='projects/crmynov-prod-n7x4q2/locations/europe-west1',operationPattern=new RegExp('^'+parent+'/operations/[A-Za-z0-9_-]+$','u'),hash=/^[a-f0-9]{64}$/u;
const demand=(ok,code)=>assert(ok,'GENERAL_PREPARATION_'+code);
function plain(value){return value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;}
function utc(value){demand(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value),'UTC_TIME_REQUIRED');const n=Date.parse(value);demand(Number.isFinite(n),'UTC_TIME_REQUIRED');return n;}
export function assessRecoveredGeneralRunCandidate(input){
  demand(plain(input),'PLAIN_INPUT');demand(Object.keys(input).every(k=>['objective','journalSnapshotSha256','events','recovered'].includes(k)),'NO_EXECUTION_CAPABILITIES');
  const v=structuredClone(input);demand(Buffer.byteLength(JSON.stringify(v))<=262144,'INPUT_BOUND');
  const e=v.objective;validateReadOnlyObjective(e);demand(e.purpose==='GENERAL_PRESERVATION_READ_ONLY_V1','GENERAL_PURPOSE_ONLY');demand(hash.test(v.journalSnapshotSha256??''),'SNAPSHOT_HASH');
  demand(Array.isArray(v.events)&&v.events.length===5,'EXACT_UNKNOWN_CHAIN_REQUIRED');
  const expected=[['CREATE',0,'INTENT'],['CREATE',1,'OPERATION'],['CREATE',2,'RECONCILED'],['RUN',0,'INTENT'],['RUN',1,'UNKNOWN']];
  for(const [index,row]of v.events.entries()){
    const [stage,ordinal,state]=expected[index];demand(plain(row)&&plain(row.payload),'EVENT_SHAPE');demand(row.stage===stage&&row.ordinal===ordinal&&row.payload.state===state,'EXACT_UNKNOWN_CHAIN_REQUIRED');
    demand(hash.test(row.sha??'')&&digest(row.payload)===row.sha,'EVENT_DIGEST');demand(row.payload.job===e.jobName&&row.payload.objectiveSha256===e.objectiveSha256,'EVENT_OBJECTIVE');demand(row.payload.canRetry===false,'NO_RETRY');
  }
  const created=v.events[2].payload,intent=v.events[3].payload,unknown=v.events[4].payload;
  demand(typeof created.uid==='string'&&created.uid.length>8&&created.uid===intent.uid,'INTENT_UID');demand(operationPattern.test(created.operation??'')&&v.events[1].payload.operation===created.operation,'CREATE_OPERATION');
  demand(hash.test(v.events[0].payload.bodySha256??'')&&hash.test(v.events[1].payload.responseSha256??''),'CREATE_RECEIPT_DIGESTS');
  demand(typeof intent.etag==='string'&&intent.etag.length>0&&intent.etag.length<=256,'INTENT_ETAG');demand(!Object.hasOwn(unknown,'operation'),'UNKNOWN_MUST_REMAIN_UNKNOWN');
  const began=utc(intent.at);demand(utc(v.events[0].payload.at)<=began,'CREATE_BEFORE_RUN');const r=v.recovered;demand(plain(r)&&Object.keys(r).every(k=>['operation','job','execution','taskNetwork','observedAt'].includes(k)),'RECOVERED_METADATA_REQUIRED');
  const op=r.operation;demand(plain(op)&&operationPattern.test(op.name??''),'RECOVERED_OPERATION_REQUIRED');demand(op.name!==created.operation,'NOT_CREATE_OPERATION');
  demand(op.done===true&&!Object.hasOwn(op,'error'),'SUCCESSFUL_OPERATION_REQUIRED');demand(plain(r.job)&&plain(r.execution)&&plain(op.response),'POSITIVE_NATIVE_FACTS_REQUIRED');
  validateReadOnlyNativeJob(r.job,e);demand(r.job.uid===intent.uid,'RECOVERED_JOB_UID');
  demand(typeof r.execution.uid==='string'&&r.execution.uid.length>8&&r.execution.uid.length<=256,'EXECUTION_UID');
  demand(op.response.name===r.execution.name&&op.response.uid===r.execution.uid,'OPERATION_EXECUTION_BINDING');
  if(Object.hasOwn(op,'metadata')){demand(plain(op.metadata)&&op.metadata.name===r.execution.name&&op.metadata.uid===r.execution.uid,'OPERATION_METADATA_BINDING');}
  validateReadOnlyNativeExecution(r.job,r.execution,e,r.taskNetwork);
  demand(utc(r.execution.startTime)>=began,'EXECUTION_AFTER_RUN_INTENT');demand(utc(r.execution.completionTime)<=utc(r.observedAt),'OBSERVATION_AFTER_COMPLETION');
  return Object.freeze({status:'METADATA_COHERENT_FOR_FUTURE_PROTECTED_REVIEW_ONLY',purpose:e.purpose,objectiveSha256:e.objectiveSha256,sourceSha256:e.sourceSha256,journalSnapshotSha256:v.journalSnapshotSha256,eventChainSha256:digest(v.events.map(row=>row.sha)),job:e.jobName,uid:intent.uid,proposedOperation:op.name,proposedExecution:r.execution.name,metadataSha256:digest(r),originalRunState:'UNKNOWN',originalUnknownPreserved:true,canRetry:false,readOnlyMetadataValidationReused:true,sourceOrNativeOriginAuthenticated:false,originalRequestAttributionProved:false,journalReconciliationImplemented:false,outputVerified:false,nativeAcceptance:false,nativeExecutionAuthorized:false,activationAuthorized:false,futureProtectedSourceAndSpecificAuthorityRequired:true});
}

