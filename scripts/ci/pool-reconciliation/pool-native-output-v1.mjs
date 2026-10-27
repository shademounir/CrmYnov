// Source-bound output checks and a bounded official read path. No create/run API.
// Injected fixture responses are not native acceptance; provenance is acquired by
// executing the reviewed reader, preserving its actual receipts, not by JSON types.
import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';
import {openSealedReadOnlyOutput,hashBytes} from './pool-sealed-output-v1.mjs';
import {validatePoolRuntimeBundle} from './pool-runtime-entry-v1.mjs';
import {QUERY_CONTRACT_SHA256 as POOL_QUERY_HASH} from './pool-read-only-collector-v1.mjs';
import {POOL_BOOTSTRAP} from './pool-runtime-bundle-v1.mjs';
export const POOL_IMAGE='europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:d2b2f6b0cf0ed9d9eb1cb15b70924af38be7ca4c4a824b6b406bb62caf88cd8f';
import {validateReadOnlyRuntimeBundle} from './readonly-runtime-entry-v1.mjs';
import {READONLY_BOOTSTRAP} from './readonly-runtime-bundle-v1.mjs';
import {QUERY_CONTRACT_SHA256 as GENERAL_QUERY_HASH} from './general-preservation-read-only-collector-v1.mjs';
import {QUERY_CONTRACT_SHA256 as LEDGER_QUERY_HASH} from './schema-ledger-read-only-collector-v1.mjs';
import {digest as generalSnapshotDigest} from '../readonly-probe/rc47-select-only-probe-core-v1.mjs';
const PROFILES=Object.freeze({
  POOL_RECONCILIATION_READ_ONLY_V1:Object.freeze({prefix:'crm-prod-pool-reconcile-',role:'crm_runtime',serviceAccount:'crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com',secret:'crm-prod-runtime-database-url',envPrefix:'CRM_POOL',bootstrap:POOL_BOOTSTRAP,queryHash:POOL_QUERY_HASH,kind:'SEALED_POOL_OUTPUT_V1'}),
  GENERAL_PRESERVATION_READ_ONLY_V1:Object.freeze({prefix:'crm-prod-preservation-',role:'crm_runtime',serviceAccount:'crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com',secret:'crm-prod-runtime-database-url',envPrefix:'CRM_READONLY',bootstrap:READONLY_BOOTSTRAP,queryHash:GENERAL_QUERY_HASH,kind:'SEALED_GENERAL_PRESERVATION_OUTPUT_V1'}),
  SCHEMA_LEDGER_READ_ONLY_V1:Object.freeze({prefix:'crm-prod-schema-ledger-',role:'crm_migrator',serviceAccount:'crm-prod-migrator@crmynov-prod-n7x4q2.iam.gserviceaccount.com',secret:'crm-prod-migrator-database-url',envPrefix:'CRM_READONLY',bootstrap:READONLY_BOOTSTRAP,queryHash:LEDGER_QUERY_HASH,kind:'SEALED_SCHEMA_LEDGER_OUTPUT_V1'}),
});
function profile(purpose){assert.equal(typeof purpose,'string');assert(Object.hasOwn(PROFILES,purpose),'EXPLICIT_READONLY_PURPOSE');return PROFILES[purpose];}
export const readOnlyPurposeConfiguration=purpose=>profile(purpose);
const ROOT='projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/';
const H=/^[a-f0-9]{64}$/u;
function time(value){const n=Date.parse(value);assert(Number.isFinite(n),'NATIVE_TIME');return n;}
function normalizedTask(task){const value=structuredClone(task);assert(['1','1000m'].includes(value.containers?.[0]?.resources?.limits?.cpu),'REVIEWED_NATIVE_CPU_REQUIRED');value.maxRetries??=0;value.containers[0].resources.limits.cpu='1000m';return value;}
export function poolPrivateNetwork(){return {egress:'PRIVATE_RANGES_ONLY',networkInterfaces:[{network:'projects/crmynov-prod-n7x4q2/global/networks/crm-ynov-prod',subnetwork:'projects/crmynov-prod-n7x4q2/regions/europe-west1/subnetworks/crm-ynov-prod-run-ew1'}]};}
export function validateReadOnlyObjective(objective){
  assert.equal(objective.schemaVersion,1);const p=profile(objective.purpose);
  assert.equal(objective.main,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(objective.image,POOL_IMAGE);
  assert.equal(typeof objective.jobName,'string');assert(objective.jobName.startsWith(ROOT));
  const name=objective.jobName.slice(ROOT.length);assert(name.startsWith(p.prefix));assert(/^[a-z0-9-]+$/u.test(name.slice(p.prefix.length)));assert(name.length<=63);
  assert.equal(objective.serviceAccount,p.serviceAccount);
  for(const key of ['objectiveSha256','sourceSha256','bundleSha256','bootstrapSha256','databaseBindingSha256','publicKeySha256','taskTemplateSha256'])assert(H.test(objective[key]??''),key);
  const task=objective.taskTemplate,c=task.containers[0];
  assert.equal(task.serviceAccount,objective.serviceAccount);assert.equal(task.maxRetries,0);assert.equal(task.timeout,'120s');assert.equal(task.executionEnvironment,'EXECUTION_ENVIRONMENT_GEN2');assert.equal(task.containers.length,1);
  assert(Object.keys(task).every(k=>['containers','volumes','vpcAccess','maxRetries','timeout','serviceAccount','executionEnvironment'].includes(k)));
  assert(Object.keys(c).every(k=>['image','command','args','env','resources','volumeMounts'].includes(k)));
  assert.deepEqual(task.vpcAccess,poolPrivateNetwork(),'EXISTING_PRIVATE_NETWORK_REQUIRED');
  assert.equal(task.volumes,undefined);assert.equal(c.volumeMounts,undefined);
  assert.equal(c.image,POOL_IMAGE);assert.deepEqual(c.command,['/nodejs/bin/node']);assert.equal(c.args.length,3);assert.deepEqual(c.args.slice(0,2),['--input-type=module','--eval']);assert.equal(c.args[2],p.bootstrap);assert.equal(hashBytes(c.args[2]),objective.bootstrapSha256);
  assert.equal(c.resources.limits.memory,'512Mi');assert(['1','1000m'].includes(c.resources.limits.cpu));
  assert.deepEqual(Object.keys(c.resources),['limits']);assert.deepEqual(Object.keys(c.resources.limits).sort((a,b)=>a.localeCompare(b,'en')),['cpu','memory']);
  const env=Object.fromEntries(c.env.map(e=>[e.name,e])),envHash=p.envPrefix+'_BUNDLE_SHA256',envData=p.envPrefix+'_BUNDLE_BASE64';assert.equal(c.env.length,4);assert.equal(Object.keys(env).length,4);
  assert.deepEqual(Object.keys(env).sort((a,b)=>a.localeCompare(b,'en')),[envData,envHash,'DATABASE_URL','GOOGLE_CLOUD_PROJECT'].sort((a,b)=>a.localeCompare(b,'en')));
  assert.deepEqual(env.GOOGLE_CLOUD_PROJECT,{name:'GOOGLE_CLOUD_PROJECT',value:'crmynov-prod-n7x4q2'});
  assert.deepEqual(env.DATABASE_URL,{name:'DATABASE_URL',valueSource:{secretKeyRef:objective.databaseSecretRef}});
  assert.equal(objective.databaseSecretRef.secret,p.secret);assert(/^[1-9]\d*$/u.test(objective.databaseSecretRef.version));
  assert.deepEqual(env[envHash],{name:envHash,value:objective.bundleSha256});
  const encoded=env[envData].value;assert.equal(typeof encoded,'string');assert(encoded.length<=32768);const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded);assert.equal(hashBytes(bytes),objective.bundleSha256);
  assert.equal(digest(normalizedTask(task)),objective.taskTemplateSha256);time(objective.intentAt);return objective;
}
export function validateReadOnlyNativeJob(job,objective){
  validateReadOnlyObjective(objective);assert.equal(job.name,objective.jobName);assert.equal(typeof job.uid,'string');assert(job.uid.length>8&&job.uid.length<=256);
  assert.equal(job.labels?.['crmynov-probe-objective'],objective.objectiveSha256.slice(0,63));
  assert.equal(job.reconciling??false,false);assert.equal(job.deleteTime,undefined);
  assert.equal(job.template.taskCount,1);assert.equal(job.template.parallelism,1);
  assert.equal(digest(normalizedTask(job.template.template)),objective.taskTemplateSha256,'ACTUAL_TASK_BYTES');return job;
}
export function validateReadOnlyNativeExecution(job,execution,objective){
  validateReadOnlyNativeJob(job,objective);const prefix=objective.jobName+'/executions/';
  assert(execution.name.startsWith(prefix));assert(/^[a-z0-9-]+$/u.test(execution.name.slice(prefix.length)));
  assert.equal(job.executionCount,1,'ONE_NATIVE_EXECUTION_REQUIRED');
  assert.equal(job.latestCreatedExecution?.name,execution.name,'LATEST_EXECUTION_MUST_MATCH');
  assert.equal(job.latestCreatedExecution.deleteTime,undefined,'LATEST_EXECUTION_NOT_DELETED');
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
export function verifyReadOnlyOutputClaims({job,execution,logs,bundle,objective,privateKeyPem,now}){
  const p=profile(objective.purpose),isPool=objective.purpose==='POOL_RECONCILIATION_READ_ONLY_V1',binding=isPool?validatePoolRuntimeBundle(bundle):validateReadOnlyRuntimeBundle(bundle);validateReadOnlyNativeExecution(job,execution,objective);
  assert.equal(bundle.request.purpose,objective.purpose,'PURPOSE_BINDING');
  assert.equal(binding.sourceSha256,objective.sourceSha256);assert.equal(binding.publicKeySha256,objective.publicKeySha256);
  assert.equal(bundle.databaseBindingSha256,objective.databaseBindingSha256);assert.equal(ROOT+bundle.jobName,objective.jobName);
  assert.equal(logs.nextPageToken??'', '');assert(Array.isArray(logs.entries));assert.equal(logs.entries.length,1,'ONE_UNAMBIGUOUS_OUTPUT');
  const record=validateLog(logs.entries[0],execution,objective);
  const context={purpose:bundle.request.purpose,phase:bundle.request.phase,job:job.name,execution:execution.name,sourceSha256:binding.sourceSha256,nonce:bundle.nonce};
  const output=openSealedReadOnlyOutput(record,{privateKeyPem,context}),o=output.observation;
  assert.equal(output.schemaVersion,1);assert.equal(output.databaseBindingSha256,objective.databaseBindingSha256);assert.equal(output.sourceSha256,binding.sourceSha256);
  assert.deepEqual(output.runtime,{job:job.name,execution:execution.name,taskIndex:0,attempt:0});
  assert.equal(o.schemaVersion,1);assert.equal(o.purpose,bundle.request.purpose);assert.equal(o.phase,bundle.request.phase);assert.equal(o.queryContractSha256,p.queryHash);
  assert.deepEqual(o.identity,{database:'crmynov_prod',role:p.role,readOnly:'on',isolation:'repeatable read'});
  assert.equal(o.sourceClaimsOnly,true);for(const field of ['nativeEvidenceAuthenticated','activationAuthorized'])assert.equal(o[field],false);
  let falseFields=['sameSnapshotAsPool','schemaCompatibilityProved','fullProductionPreflight'];
  if(isPool){falseFields=['historicalRawHashRecovered','fullProductionPreflight','migrationLedgerObserved'];}
  else if(objective.purpose==='GENERAL_PRESERVATION_READ_ONLY_V1'){falseFields=['historicalRawPoolHashRecovered','fullPreservationValidated','migrationLedgerObserved','sameSnapshotAsLedger','sameSnapshotAsPool'];}
  for(const field of falseFields){assert.equal(o[field],false);}
  if(objective.purpose==='GENERAL_PRESERVATION_READ_ONLY_V1'){assert.equal(o.separateLedgerRequired,true);}
  if(objective.purpose==='GENERAL_PRESERVATION_READ_ONLY_V1'){
    assert(!Object.hasOwn(o.snapshot,'migrations'),'SEPARATE_LEDGER_REQUIRED');assert.equal(o.snapshotSha256,generalSnapshotDigest(o.snapshot),'GENERAL_SNAPSHOT_BYTES');
  }
  if(objective.purpose==='SCHEMA_LEDGER_READ_ONLY_V1'){
    assert.deepEqual(Object.keys(o.snapshot).sort((a,b)=>a.localeCompare(b,'en')),['columns','constraints','indexes','migrations']);assert(Array.isArray(o.snapshot.migrations)&&o.snapshot.migrations.length>0&&o.snapshot.migrations.length<=100);assert.equal(new Set(o.snapshot.migrations.map(r=>r.migration_name)).size,o.snapshot.migrations.length);
    for(const row of o.snapshot.migrations){assert.equal(typeof row.migration_name,'string');assert(/^\w+$/u.test(row.migration_name));assert(typeof row.checksum==='string'&&H.test(row.checksum));assert.equal(row.finished,true);assert.equal(row.rolled_back,false);}
    assert.equal(o.ledgerSha256,hashBytes(JSON.stringify(o.snapshot.migrations)),'LEDGER_BYTES');assert.equal(o.schemaSurfaceSha256,hashBytes(JSON.stringify({columns:o.snapshot.columns,indexes:o.snapshot.indexes,constraints:o.snapshot.constraints})),'SCHEMA_SURFACE_BYTES');
  }
  assert(Number.isSafeInteger(now));assert(time(o.transactionStartedAt)>=time(execution.startTime)-1000);assert(time(o.transactionCompletedAt)<=time(logs.entries[0].timestamp)+1000);
  assert(time(o.transactionCompletedAt)>=time(o.transactionStartedAt));assert(time(o.transactionCompletedAt)-time(o.transactionStartedAt)<=25000);
  assert(now>=time(execution.completionTime)&&now-time(o.transactionCompletedAt)<=300000,'FRESH_NATIVE_OUTPUT_REQUIRED');
  return {output,metadataSha256:digest({job,execution,logs}),sealedOutputSha256:digest(record),sourceBoundClaimsChecked:true,officialOriginAuthenticatedByThisPureFunction:false,nativeAcceptance:false,activationAuthorized:false};
}
export function readOnlyOutputReadRequests(objective,executionName,now){
  validateReadOnlyObjective(objective);const prefix=objective.jobName+'/executions/';assert(executionName.startsWith(prefix));assert(/^[a-z0-9-]+$/u.test(executionName.slice(prefix.length)));
  assert(Number.isSafeInteger(now)&&now>=time(objective.intentAt));const execution=executionName.split('/').at(-1),job=objective.jobName.slice(ROOT.length);
  const p=profile(objective.purpose);const filter=['resource.type="cloud_run_job"','resource.labels.project_id="crmynov-prod-n7x4q2"','resource.labels.location="europe-west1"','resource.labels.job_name="'+job+'"','labels."run.googleapis.com/execution_name"="'+execution+'"','labels."run.googleapis.com/task_index"="0"','labels."run.googleapis.com/task_attempt"="0"','logName="projects/crmynov-prod-n7x4q2/logs/run.googleapis.com%2Fstdout"','jsonPayload.kind="'+p.kind+'"','timestamp>="'+objective.intentAt+'"','timestamp<="'+new Date(now).toISOString()+'"'].join(' AND ');
  return [{method:'GET',url:'https://run.googleapis.com/v2/'+objective.jobName},{method:'GET',url:'https://run.googleapis.com/v2/'+executionName},{method:'POST',url:'https://logging.googleapis.com/v2/entries:list',body:{resourceNames:['projects/crmynov-prod-n7x4q2'],filter,pageSize:2,orderBy:'timestamp asc'}}];
}


// Historical pool API remains strict; extension is explicit, never silent retargeting.
function requirePool(objective){assert.equal(objective?.purpose,'POOL_RECONCILIATION_READ_ONLY_V1');}
export function validatePoolObjective(objective){requirePool(objective);return validateReadOnlyObjective(objective);}
export function validatePoolNativeJob(job,objective){requirePool(objective);return validateReadOnlyNativeJob(job,objective);}
export function validatePoolNativeExecution(job,execution,objective){requirePool(objective);return validateReadOnlyNativeExecution(job,execution,objective);}
export function verifyPoolOutputClaims(input){requirePool(input.objective);return verifyReadOnlyOutputClaims(input);}
export function poolOutputReadRequests(objective,execution,now){requirePool(objective);return readOnlyOutputReadRequests(objective,execution,now);}
