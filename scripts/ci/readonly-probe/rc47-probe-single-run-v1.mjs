// Candidate external executor component. Not an authorization or native qualification.
// Unit fixtures do not qualify native execution or authorize deployment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const PROJECT='crmynov-prod-n7x4q2',REGION='europe-west1';
const JOB_PREFIX=`projects/${PROJECT}/locations/${REGION}/jobs/crm-prod-rc47-readonly-probe-`;
const OP_PREFIX=`projects/${PROJECT}/locations/${REGION}/operations/`;
const HASH=/^[a-f0-9]{64}$/u;
function expectedObjective(e){assert.equal(e.project,PROJECT);assert.equal(e.region,REGION);assert(e.jobName.startsWith(JOB_PREFIX));assert.match(e.jobName.slice(JOB_PREFIX.length),/^[a-z0-9-]+$/u);assert(HASH.test(e.objectiveSha256));assert.equal(e.readOnly,true);assert.equal(e.providerCalls,false);assert.equal(e.ddl,false);}
function etag(job){assert.equal(typeof job.etag,'string');assert(job.etag.length>0&&job.etag.length<=256);return job.etag;}
function unused(job){assert.equal(job.executionCount??0,0,'job already executed');assert.equal(job.latestCreatedExecution,undefined,'prior execution exists');}
export async function dispatchOnce({objective,validateNativeJob,authorizeFresh,transport,journal,now=()=>new Date().toISOString()}){
 expectedObjective(objective);assert.equal(typeof authorizeFresh,'function','fresh protected authority verifier required');assert.equal(typeof validateNativeJob,'function');
 // This callback must later verify official protected merge/decision/grant/qualification receipts.
 // There is deliberately no default or boolean approval fallback in this draft.
 await authorizeFresh(objective);
 const first=await transport.getJob(objective.jobName);validateNativeJob(first,objective);unused(first);etag(first);
 const pages=new Set();let pageToken='';
 do{assert(!pages.has(pageToken),'pagination cycle');pages.add(pageToken);assert(pages.size<=100,'inventory pagination bound');const page=await transport.listExecutions(objective.jobName,pageToken);assert(Array.isArray(page.executions));assert.equal(page.executions.length,0,'pre-existing execution blocks dispatch');pageToken=page.nextPageToken??'';assert.equal(typeof pageToken,'string');}while(pageToken);
 const latest=await transport.getJob(objective.jobName);validateNativeJob(latest,objective);unused(latest);assert.equal(latest.uid,first.uid,'native job replacement');assert.equal(etag(latest),first.etag,'job changed during preflight');
 await authorizeFresh(objective);
 const intent={schemaVersion:1,at:now(),job:latest.name,uid:latest.uid,etag:latest.etag,objectiveSha256:objective.objectiveSha256};assert(Number.isFinite(Date.parse(intent.at)));assert.equal(intent.job,objective.jobName);
 // consumeOnce MUST be implemented as a durable create-exclusive record before any run request.
 // Failure or an occupied record prevents dispatch; never reclaim this record automatically.
 await journal.consumeOnce(intent);
 let operation;
 try{operation=await transport.run(objective.jobName,{etag:latest.etag});}
 catch{await journal.record({state:'RUN_OUTCOME_UNKNOWN',intent});return{state:'RUN_OUTCOME_UNKNOWN',intent,canRetry:false};}
 if(typeof operation?.name!=='string'||!operation.name.startsWith(OP_PREFIX)||!/^[a-zA-Z0-9_-]+$/u.test(operation.name.slice(OP_PREFIX.length))){await journal.record({state:'RUN_OUTCOME_UNKNOWN',intent});return{state:'RUN_OUTCOME_UNKNOWN',intent,canRetry:false};}
 const accepted={state:'OPERATION_OBSERVED',intent,operation:operation.name,operationResponseSha256:sha(operation),canRetry:false};await journal.record(accepted);return accepted;
}
export async function observeKnownOperation({receipt,objective,validateNativeExecution,transport,journal}){
 expectedObjective(objective);assert.equal(receipt.state,'OPERATION_OBSERVED');assert.equal(receipt.intent.job,objective.jobName);assert.equal(receipt.intent.objectiveSha256,objective.objectiveSha256);assert.equal(receipt.canRetry,false);assert(receipt.operation.startsWith(OP_PREFIX));
 const operation=await transport.getOperation(receipt.operation);assert.equal(operation.name,receipt.operation);if(operation.done!==true)return{state:'OPERATION_PENDING',canRetry:false};
 if(operation.error){const failed={state:'OPERATION_FAILED',operation:receipt.operation,canRetry:false};await journal.record(failed);return failed;}
 const name=operation.response?.name,prefix=objective.jobName+'/executions/';assert.equal(typeof name,'string');assert(name.startsWith(prefix));assert.match(name.slice(prefix.length),/^[a-z0-9-]+$/u);
 const execution=await transport.getExecution(name),job=await transport.getJob(objective.jobName);assert.equal(execution.name,name);assert.equal(job.uid,receipt.intent.uid);const evidence=validateNativeExecution(job,execution,objective);assert.equal(evidence.completed,true);assert.equal(evidence.nativeSourceBound,true);
 const result={state:'NATIVE_EXECUTION_RECONCILED',operation:receipt.operation,execution:name,objectiveSha256:objective.objectiveSha256,evidence,canRetry:false};await journal.record(result);return result;
}
