// Source-bound output checks and a bounded official read path. No create/run API.
// Injected fixture responses are not native acceptance; provenance is acquired by
// executing the reviewed reader, preserving its actual receipts, not by JSON types.
import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';
import {openSealedPoolOutput,hashBytes} from './pool-sealed-output-v1.mjs';
import {validatePoolRuntimeBundle} from './pool-runtime-entry-v1.mjs';
import {QUERY_CONTRACT_SHA256} from './pool-read-only-collector-v1.mjs';
import {POOL_BOOTSTRAP} from './pool-runtime-bundle-v1.mjs';
export const POOL_IMAGE='europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:d2b2f6b0cf0ed9d9eb1cb15b70924af38be7ca4c4a824b6b406bb62caf88cd8f';
const ROOT='projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/';
const H=/^[a-f0-9]{64}$/u;
function time(value){const n=Date.parse(value);assert(Number.isFinite(n),'NATIVE_TIME');return n;}
function normalizedTask(task){const value=structuredClone(task);value.maxRetries??=0;value.containers[0].resources.limits.cpu='1000m';return value;}
export function validatePoolObjective(objective){
  assert.equal(objective.schemaVersion,1);assert.equal(objective.purpose,'POOL_RECONCILIATION_READ_ONLY_V1');
  assert.equal(objective.main,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(objective.image,POOL_IMAGE);
  assert.equal(typeof objective.jobName,'string');assert(objective.jobName.startsWith(ROOT));
  assert(/^crm-prod-pool-reconcile-[a-z0-9-]+$/u.test(objective.jobName.slice(ROOT.length)));
  assert.equal(objective.serviceAccount,'crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com');
  for(const key of ['objectiveSha256','sourceSha256','bundleSha256','bootstrapSha256','databaseBindingSha256','publicKeySha256','taskTemplateSha256'])assert(H.test(objective[key]??''),key);
  const task=objective.taskTemplate,c=task.containers[0];
  assert.equal(task.serviceAccount,objective.serviceAccount);assert.equal(task.maxRetries,0);assert.equal(task.timeout,'120s');assert.equal(task.executionEnvironment,'EXECUTION_ENVIRONMENT_GEN2');assert.equal(task.containers.length,1);
  assert(Object.keys(task).every(k=>['containers','volumes','vpcAccess','maxRetries','timeout','serviceAccount','executionEnvironment'].includes(k)));
  assert(Object.keys(c).every(k=>['image','command','args','env','resources','volumeMounts'].includes(k)));
  assert.equal(c.image,POOL_IMAGE);assert.deepEqual(c.command,['/nodejs/bin/node']);assert.equal(c.args.length,3);assert.deepEqual(c.args.slice(0,2),['--input-type=module','--eval']);assert.equal(c.args[2],POOL_BOOTSTRAP);assert.equal(hashBytes(c.args[2]),objective.bootstrapSha256);
  assert.equal(c.resources.limits.memory,'512Mi');assert(['1','1000m'].includes(c.resources.limits.cpu));
  assert.deepEqual(Object.keys(c.resources),['limits']);assert.deepEqual(Object.keys(c.resources.limits).sort(),['cpu','memory']);
  const env=Object.fromEntries(c.env.map(e=>[e.name,e]));assert.equal(c.env.length,4);assert.equal(Object.keys(env).length,4);
  assert.deepEqual(Object.keys(env).sort(),['CRM_POOL_BUNDLE_BASE64','CRM_POOL_BUNDLE_SHA256','DATABASE_URL','GOOGLE_CLOUD_PROJECT']);
  assert.deepEqual(env.GOOGLE_CLOUD_PROJECT,{name:'GOOGLE_CLOUD_PROJECT',value:'crmynov-prod-n7x4q2'});
  assert.deepEqual(env.DATABASE_URL,{name:'DATABASE_URL',valueSource:{secretKeyRef:objective.databaseSecretRef}});
  assert.equal(objective.databaseSecretRef.secret,'crm-prod-runtime-database-url');assert(/^[1-9][0-9]*$/u.test(objective.databaseSecretRef.version));
  assert.deepEqual(env.CRM_POOL_BUNDLE_SHA256,{name:'CRM_POOL_BUNDLE_SHA256',value:objective.bundleSha256});
  const encoded=env.CRM_POOL_BUNDLE_BASE64.value;assert.equal(typeof encoded,'string');assert(encoded.length<=32768);const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded);assert.equal(hashBytes(bytes),objective.bundleSha256);
  assert.equal(digest(normalizedTask(task)),objective.taskTemplateSha256);time(objective.intentAt);return objective;
}
export function validatePoolNativeJob(job,objective){
  validatePoolObjective(objective);assert.equal(job.name,objective.jobName);assert.equal(typeof job.uid,'string');assert(job.uid.length>8&&job.uid.length<=256);
  assert.equal(job.labels?.['crmynov-probe-objective'],objective.objectiveSha256.slice(0,63));
  assert.equal(job.reconciling??false,false);assert.equal(job.deleteTime,undefined);
  assert.equal(job.template.taskCount,1);assert.equal(job.template.parallelism,1);
  assert.equal(digest(normalizedTask(job.template.template)),objective.taskTemplateSha256,'ACTUAL_TASK_BYTES');return job;
}
export function validatePoolNativeExecution(job,execution,objective){
  validatePoolNativeJob(job,objective);const prefix=objective.jobName+'/executions/';
  assert(execution.name.startsWith(prefix));assert(/^[a-z0-9-]+$/u.test(execution.name.slice(prefix.length)));
  assert([objective.jobName,objective.jobName.slice(ROOT.length)].includes(execution.job));
  assert.equal(execution.taskCount,1);assert.equal(execution.parallelism,1);assert.equal(execution.succeededCount,1);
  for(const field of ['failedCount','cancelledCount','runningCount','retriedCount'])assert.equal(execution[field]??0,0);
  assert.equal(digest(normalizedTask(execution.template)),objective.taskTemplateSha256,'EXECUTION_TASK_BYTES');
  assert(execution.conditions.some(c=>c.type==='Completed'&&c.state==='CONDITION_SUCCEEDED'));
  assert(time(execution.startTime)>=time(objective.intentAt));assert(time(execution.completionTime)>=time(execution.startTime));return execution;
}
function validateLog(entry,execution,objective){
  assert.equal(entry.resource.type,'cloud_run_job');assert.equal(entry.resource.labels.project_id,'crmynov-prod-n7x4q2');assert.equal(entry.resource.labels.location,'europe-west1');assert.equal(entry.resource.labels.job_name,objective.jobName.slice(ROOT.length));
  assert.equal(entry.logName,'projects/crmynov-prod-n7x4q2/logs/run.googleapis.com%2Fstdout');
  assert.equal(entry.labels['run.googleapis.com/execution_name'],execution.name.split('/').at(-1));
  assert.equal(entry.labels['run.googleapis.com/task_index'],'0');assert.equal(entry.labels['run.googleapis.com/task_attempt'],'0');
  assert.equal(typeof entry.insertId,'string');assert(entry.insertId.length>0&&entry.insertId.length<=256);
  assert(time(entry.timestamp)>=time(execution.startTime)-1000);assert(time(entry.timestamp)<=time(execution.completionTime)+1000);
  assert.equal(entry.textPayload,undefined);assert(entry.jsonPayload);return entry.jsonPayload;
}
export function verifyPoolOutputClaims({job,execution,logs,bundle,objective,privateKeyPem,now}){
  const binding=validatePoolRuntimeBundle(bundle);validatePoolNativeExecution(job,execution,objective);
  assert.equal(binding.sourceSha256,objective.sourceSha256);assert.equal(binding.publicKeySha256,objective.publicKeySha256);
  assert.equal(bundle.databaseBindingSha256,objective.databaseBindingSha256);assert.equal(ROOT+bundle.jobName,objective.jobName);
  assert.equal(logs.nextPageToken??'', '');assert(Array.isArray(logs.entries));assert.equal(logs.entries.length,1,'ONE_UNAMBIGUOUS_OUTPUT');
  const record=validateLog(logs.entries[0],execution,objective);
  const context={purpose:bundle.request.purpose,phase:bundle.request.phase,job:job.name,execution:execution.name,sourceSha256:binding.sourceSha256,nonce:bundle.nonce};
  const output=openSealedPoolOutput(record,{privateKeyPem,context}),o=output.observation;
  assert.equal(output.schemaVersion,1);assert.equal(output.databaseBindingSha256,objective.databaseBindingSha256);assert.equal(output.sourceSha256,binding.sourceSha256);
  assert.deepEqual(output.runtime,{job:job.name,execution:execution.name,taskIndex:0,attempt:0});
  assert.equal(o.schemaVersion,1);assert.equal(o.purpose,bundle.request.purpose);assert.equal(o.phase,bundle.request.phase);assert.equal(o.queryContractSha256,QUERY_CONTRACT_SHA256);
  assert.deepEqual(o.identity,{database:'crmynov_prod',role:'crm_runtime',readOnly:'on',isolation:'repeatable read'});
  assert.equal(o.sourceClaimsOnly,true);for(const field of ['nativeEvidenceAuthenticated','historicalRawHashRecovered','fullProductionPreflight','migrationLedgerObserved','activationAuthorized'])assert.equal(o[field],false);
  assert(Number.isSafeInteger(now));assert(time(o.transactionStartedAt)>=time(execution.startTime)-1000);assert(time(o.transactionCompletedAt)<=time(logs.entries[0].timestamp)+1000);
  assert(time(o.transactionCompletedAt)>=time(o.transactionStartedAt));assert(time(o.transactionCompletedAt)-time(o.transactionStartedAt)<=25000);
  assert(now>=time(execution.completionTime)&&now-time(o.transactionCompletedAt)<=300000,'FRESH_NATIVE_OUTPUT_REQUIRED');
  return {output,metadataSha256:digest({job,execution,logs}),sealedOutputSha256:digest(record),sourceBoundClaimsChecked:true,officialOriginAuthenticatedByThisPureFunction:false,nativeAcceptance:false,activationAuthorized:false};
}
export function poolOutputReadRequests(objective,executionName,now){
  validatePoolObjective(objective);const prefix=objective.jobName+'/executions/';assert(executionName.startsWith(prefix));assert(/^[a-z0-9-]+$/u.test(executionName.slice(prefix.length)));
  assert(Number.isSafeInteger(now)&&now>=time(objective.intentAt));const execution=executionName.split('/').at(-1),job=objective.jobName.slice(ROOT.length);
  const filter=['resource.type="cloud_run_job"','resource.labels.project_id="crmynov-prod-n7x4q2"','resource.labels.location="europe-west1"','resource.labels.job_name="'+job+'"','labels."run.googleapis.com/execution_name"="'+execution+'"','labels."run.googleapis.com/task_index"="0"','labels."run.googleapis.com/task_attempt"="0"','logName="projects/crmynov-prod-n7x4q2/logs/run.googleapis.com%2Fstdout"','jsonPayload.kind="SEALED_POOL_OUTPUT_V1"','timestamp>="'+objective.intentAt+'"','timestamp<="'+new Date(now).toISOString()+'"'].join(' AND ');
  return [{method:'GET',url:'https://run.googleapis.com/v2/'+objective.jobName},{method:'GET',url:'https://run.googleapis.com/v2/'+executionName},{method:'POST',url:'https://logging.googleapis.com/v2/entries:list',body:{resourceNames:['projects/crmynov-prod-n7x4q2'],filter,pageSize:2,orderBy:'timestamp asc'}}];
}
