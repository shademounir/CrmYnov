// Wholly synthetic transports and RSA fixtures. No Cloud, DB, credentials or calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {digest} from '../controlled-pool-contract-v1.mjs';
import {QUERY_CONTRACT_SHA256} from '../pool-read-only-collector-v1.mjs';
import {sealPoolOutput,openSealedPoolOutput,publicKeyFingerprint,hashBytes} from '../pool-sealed-output-v1.mjs';
import {executePoolWithClient,poolDatabaseBinding,validatePoolRuntimeBundle} from '../pool-runtime-entry-v1.mjs';
import {buildPoolRuntimeBundle} from '../pool-runtime-bundle-v1.mjs';
import {POOL_IMAGE,validatePoolObjective,validatePoolNativeJob,verifyPoolOutputClaims,poolOutputReadRequests,poolPrivateNetwork} from '../pool-native-output-v1.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const clone=structuredClone;
const request={schemaVersion:1,purpose:'POOL_RECONCILIATION_READ_ONLY_V1',phase:'PRE',campusId:'00000000-0000-0000-0000-000000000001',campaignId:'00000000-0000-0000-0000-000000000002',queryContractSha256:QUERY_CONTRACT_SHA256};
const jobName='crm-prod-pool-reconcile-synthetic-v1';
const sources=Object.fromEntries([['collector','pool-read-only-collector-v1.mjs'],['entry','pool-runtime-entry-v1.mjs'],['output','pool-sealed-output-v1.mjs']].map(([name,file])=>[name,fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')]));
const env={GOOGLE_CLOUD_PROJECT:'crmynov-prod-n7x4q2',CLOUD_RUN_JOB:jobName,CLOUD_RUN_EXECUTION:jobName+'-abc123',CLOUD_RUN_TASK_COUNT:'1',CLOUD_RUN_TASK_INDEX:'0',CLOUD_RUN_TASK_ATTEMPT:'0',DATABASE_URL:'postgresql://crm_runtime:synthetic@localhost:5432/crmynov_prod'};
const transport=buildPoolRuntimeBundle({sources,request,jobName,nonce:'c'.repeat(64),databaseBindingSha256:poolDatabaseBinding(env.DATABASE_URL),publicKeyPem:keys.publicKey});
const context={purpose:request.purpose,phase:'PRE',job:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/'+jobName,execution:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/'+jobName+'/executions/'+env.CLOUD_RUN_EXECUTION,sourceSha256:transport.sourceSha256,nonce:'c'.repeat(64)};
export {sources,request,jobName,env,transport,keys,context};
function fixture(){
  const task={serviceAccount:'crm-prod-api@crmynov-prod-n7x4q2.iam.gserviceaccount.com',maxRetries:0,timeout:'120s',executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',containers:[{image:POOL_IMAGE,command:['/nodejs/bin/node'],args:['--input-type=module','--eval',transport.bootstrap],resources:{limits:{cpu:'1',memory:'512Mi'}},env:[{name:'GOOGLE_CLOUD_PROJECT',value:'crmynov-prod-n7x4q2'},{name:'DATABASE_URL',valueSource:{secretKeyRef:{secret:'crm-prod-runtime-database-url',version:'1'}}},{name:'CRM_POOL_BUNDLE_SHA256',value:transport.bundleSha256},{name:'CRM_POOL_BUNDLE_BASE64',value:transport.base64}]}]};
  task.vpcAccess=poolPrivateNetwork();
  const normalized=clone(task);normalized.containers[0].resources.limits.cpu='1000m';
  const objective={schemaVersion:1,purpose:request.purpose,main:'8253024ea35cee6be5636cc6b10a88ae7e177377',image:POOL_IMAGE,jobName:context.job,serviceAccount:task.serviceAccount,objectiveSha256:'a'.repeat(64),sourceSha256:transport.sourceSha256,bundleSha256:transport.bundleSha256,bootstrapSha256:transport.bootstrapSha256,databaseBindingSha256:transport.bundle.databaseBindingSha256,publicKeySha256:transport.publicKeySha256,taskTemplateSha256:digest(normalized),taskTemplate:task,databaseSecretRef:{secret:'crm-prod-runtime-database-url',version:'1'},intentAt:'2026-10-27T09:00:00.000Z'};
  const job={name:context.job,uid:'synthetic-job-uid',labels:{'crmynov-probe-objective':objective.objectiveSha256.slice(0,63)},template:{taskCount:1,parallelism:1,template:clone(task)}};
  const execution={name:context.execution,job:jobName,taskCount:1,parallelism:1,succeededCount:1,template:clone(task),conditions:[{type:'Completed',state:'CONDITION_SUCCEEDED'}],startTime:'2026-10-27T09:00:00.500Z',completionTime:'2026-10-27T09:00:03.000Z'};
  job.executionCount=1;job.latestCreatedExecution={name:execution.name};
  const observation={schemaVersion:1,purpose:request.purpose,phase:'PRE',queryContractSha256:QUERY_CONTRACT_SHA256,identity:{database:'crmynov_prod',role:'crm_runtime',readOnly:'on',isolation:'repeatable read'},transactionStartedAt:'2026-10-27T09:00:01.000000Z',transactionCompletedAt:'2026-10-27T09:00:02.000000Z',snapshot:{configuration:[],currentPool:[],versions:[],audits:[],counters:[],references:[]},sourceClaimsOnly:true,nativeEvidenceAuthenticated:false,historicalRawHashRecovered:false,fullProductionPreflight:false,migrationLedgerObserved:false,activationAuthorized:false};
  const plaintext={schemaVersion:1,observation,databaseBindingSha256:objective.databaseBindingSha256,sourceSha256:transport.sourceSha256,runtime:{job:job.name,execution:execution.name,taskIndex:0,attempt:0}};
  const record=sealPoolOutput(plaintext,{publicKeyPem:keys.publicKey,context});
  const logs={entries:[{resource:{type:'cloud_run_job',labels:{project_id:'crmynov-prod-n7x4q2',location:'europe-west1',job_name:jobName}},logName:'projects/crmynov-prod-n7x4q2/logs/run.googleapis.com%2Fstdout',labels:{'run.googleapis.com/execution_name':env.CLOUD_RUN_EXECUTION,'run.googleapis.com/task_index':'0','run.googleapis.com/task_attempt':'0'},insertId:'synthetic-insert-1',timestamp:'2026-10-27T09:00:02.100Z',jsonPayload:record}]};
  return {job,execution,logs,bundle:clone(transport.bundle),objective,privateKeyPem:keys.privateKey,now:Date.parse('2026-10-27T09:00:04.000Z')};
}
export {fixture};
