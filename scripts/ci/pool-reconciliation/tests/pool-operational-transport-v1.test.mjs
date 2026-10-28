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
test('sealed output roundtrips but does not disclose the raw fixture',()=>{
  const secret={privateFixture:'NEVER_RAW_STDOUT',rows:[1,2,3]},record=sealPoolOutput(secret,{publicKeyPem:keys.publicKey,context});
  assert(!JSON.stringify(record).includes(secret.privateFixture));assert.deepEqual(openSealedPoolOutput(record,{privateKeyPem:keys.privateKey,context}),secret);assert.equal(record.keySha256,publicKeyFingerprint(keys.publicKey));
});
for(const [name,change] of [
  ['phase',r=>r.context.phase='POST'],['nonce',r=>r.context.nonce='d'.repeat(64)],['source',r=>r.context.sourceSha256='d'.repeat(64)],['key fingerprint',r=>r.keySha256='d'.repeat(64)],['tag',r=>r.tag=Buffer.alloc(16).toString('base64')],['iv',r=>r.iv=Buffer.alloc(12).toString('base64')],['ciphertext',r=>r.ciphertext=Buffer.alloc(20).toString('base64')],['unknown field',r=>r.extra=true],['version',r=>r.schemaVersion=2],['invalid base64',r=>r.encryptedKey+='!'],['oversized output',r=>r.ciphertext='A'.repeat(66000)]
])test('sealed transport rejects '+name,()=>{const r=sealPoolOutput({x:1},{publicKeyPem:keys.publicKey,context});change(r);assert.throws(()=>openSealedPoolOutput(r,{privateKeyPem:keys.privateKey,context}));});
test('plaintext and compressed bounds refuse instead of truncation',()=>{
  assert.throws(()=>sealPoolOutput({x:'x'.repeat(600000)},{publicKeyPem:keys.publicKey,context}),/PLAINTEXT_BOUND/u);
  assert.throws(()=>sealPoolOutput({x:randomBytes(40000).toString('base64')},{publicKeyPem:keys.publicKey,context}),/COMPRESSED_BOUND/u);
});
test('bundle is bounded and exact helper mutation fails',()=>{assert(transport.base64.length<32768);assert.equal(validatePoolRuntimeBundle(transport.bundle).sourceSha256,transport.sourceSha256);const b=clone(transport.bundle);b.modules.entry.source+=' ';assert.throws(()=>validatePoolRuntimeBundle(b),/HELPER_BYTES/u);});
test('native output fixture validates claims but never claims native acceptance',()=>{const r=verifyPoolOutputClaims(fixture());assert.equal(r.sourceBoundClaimsChecked,true);assert.equal(r.officialOriginAuthenticatedByThisPureFunction,false);assert.equal(r.nativeAcceptance,false);assert.equal(r.activationAuthorized,false);});
test('pool canonical job-local reference matches the full fetched execution and retains freshness refusal',()=>{
  const f=fixture();f.job.latestCreatedExecution.name=f.execution.name.split('/').at(-1);
  const before=clone(f.job);assert.equal(verifyPoolOutputClaims(f).sourceBoundClaimsChecked,true);assert.deepEqual(f.job,before);
  f.now+=400000;assert.throws(()=>verifyPoolOutputClaims(f),/FRESH_NATIVE_OUTPUT_REQUIRED/u);
});
for(const [name,change] of [
  ['missing execution count',f=>delete f.job.executionCount],
  ['additional execution',f=>f.job.executionCount=2],
  ['no latest reference',f=>delete f.job.latestCreatedExecution],
  ['foreign latest execution',f=>f.job.latestCreatedExecution.name+='-unexpected'],
  ['ambiguous suffix-only reference',f=>f.job.latestCreatedExecution.name='abc123'],
  ['deleted latest execution',f=>f.job.latestCreatedExecution.deleteTime='2026-10-27T09:00:03.000Z']
])test('single-use output refuses '+name,()=>{const f=fixture();change(f);assert.throws(()=>verifyPoolOutputClaims(f));});
for(const [name,change] of [
  ['foreign image',f=>f.objective.image='other'],['RC47 retarget',f=>f.objective.main='c5727e25c0ef8b90ff92fad3d07f99b2a0a68df3'],['job UID missing',f=>delete f.job.uid],['sidecar',f=>f.job.template.template.containers.push({})],['retry',f=>f.execution.retriedCount=1],['failure',f=>f.execution.failedCount=1],['not complete',f=>f.execution.conditions=[]],['foreign execution',f=>f.execution.name+='/' ],['writable task change',f=>f.execution.template.maxRetries=1],['duplicate output',f=>f.logs.entries.push(clone(f.logs.entries[0]))],['pagination',f=>f.logs.nextPageToken='more'],['empty output',f=>f.logs.entries=[]],['wrong task index',f=>f.logs.entries[0].labels['run.googleapis.com/task_index']='1'],['wrong attempt',f=>f.logs.entries[0].labels['run.googleapis.com/task_attempt']='1'],['foreign log project',f=>f.logs.entries[0].resource.labels.project_id='other'],['stderr substituted',f=>f.logs.entries[0].logName=f.logs.entries[0].logName.replace('stdout','stderr')],['outside execution time',f=>f.logs.entries[0].timestamp='2026-10-27T09:01:00Z'],['stale evidence',f=>f.now+=400000],['phase replay',f=>f.bundle.request.phase='POST'],['nonce replay',f=>f.bundle.nonce='e'.repeat(64)],['unprotected bootstrap',f=>{f.objective.taskTemplate.containers[0].args[2]='process.exit(0)';f.objective.bootstrapSha256=hashBytes('process.exit(0)');}]
])test('native source/output binding rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>verifyPoolOutputClaims(f));});
test('native request descriptors are narrow and logging list is read-only',()=>{const f=fixture(),requests=poolOutputReadRequests(f.objective,f.execution.name,f.now);assert.deepEqual(requests.map(r=>r.method),['GET','GET','POST']);assert.equal(requests[2].url,'https://logging.googleapis.com/v2/entries:list');assert.equal(requests[2].body.pageSize,2);assert(requests[2].body.filter.includes('SEALED_POOL_OUTPUT_V1'));assert.throws(()=>poolOutputReadRequests(f.objective,f.execution.name+'?x',f.now));});
test('Prisma callback is READ ONLY and raw snapshot leaves only as ciphertext',async()=>{
  const commands=[];let reads=0;const identity={database:'crmynov_prod',role:'crm_runtime',read_only:'on',isolation:'repeatable read',transaction_started_at:'2026-10-27T09:00:01.000000Z',observed_at:'2026-10-27T09:00:01.000001Z'};
  const client={$transaction:async(callback,options)=>{assert.deepEqual(options,{isolationLevel:'RepeatableRead',maxWait:5000,timeout:25000});return callback({$executeRawUnsafe:async sql=>commands.push(sql),$queryRawUnsafe:async sql=>{assert.equal(commands.length,4);reads++;return sql.includes('current_database()')?[identity]:[];}});}};
  const record=await executePoolWithClient(transport.bundle,{client,env,version:'22.23.3',uid:65532,gid:65532});assert.equal(reads,8);assert.equal(commands[0],'SET TRANSACTION READ ONLY');const p=openSealedPoolOutput(record,{privateKeyPem:keys.privateKey,context});assert.deepEqual(p.observation.snapshot.configuration,[]);assert.equal(p.observation.nativeEvidenceAuthenticated,false);
});
for(const [name,change] of [
  ['attempt',v=>v.env.CLOUD_RUN_TASK_ATTEMPT='1'],['role',v=>v.env.DATABASE_URL=v.env.DATABASE_URL.replace('crm_runtime','crm_migrator')],['db host',v=>v.env.DATABASE_URL=v.env.DATABASE_URL.replace('localhost','other')],['SDK credential override',v=>v.env.GOOGLE_APPLICATION_CREDENTIALS='x'],['ambient node injection',v=>v.env.NODE_OPTIONS='--require=x'],['root',v=>v.uid=0],['node version',v=>v.version='20.0.0']
])test('runtime refuses '+name+' before SELECT',async()=>{let txs=0;const value={env:clone(env),version:'22.23.3',uid:65532,gid:65532,client:{$transaction:()=>{txs++;}}};change(value);await assert.rejects(executePoolWithClient(transport.bundle,value));assert.equal(txs,0);});
test('CPU representation normalizes only the actual equivalent',()=>{const f=fixture();f.job.template.template.containers[0].resources.limits.cpu='1000m';validatePoolNativeJob(f.job,f.objective);f.job.template.template.timeout='121s';assert.throws(()=>validatePoolNativeJob(f.job,f.objective));});
for(const cpu of ['8','100m','0','',undefined,null])test('native CPU refuses unreviewed allocation '+String(cpu),()=>{
  const f=fixture();f.job.template.template.containers[0].resources.limits.cpu=cpu;assert.throws(()=>validatePoolNativeJob(f.job,f.objective),/REVIEWED_NATIVE_CPU_REQUIRED/u);
  const e=fixture();e.execution.template.containers[0].resources.limits.cpu=cpu;assert.throws(()=>verifyPoolOutputClaims(e),/REVIEWED_NATIVE_CPU_REQUIRED/u);
});
test('actual job and execution must retain the exact existing private network',()=>{
  const f=fixture();f.job.template.template.vpcAccess.egress='ALL_TRAFFIC';assert.throws(()=>validatePoolNativeJob(f.job,f.objective));
  const e=fixture();e.execution.template.vpcAccess.networkInterfaces[0].subnetwork+='-other';assert.throws(()=>verifyPoolOutputClaims(e));
  const o=fixture();delete o.objective.taskTemplate.vpcAccess;assert.throws(()=>validatePoolObjective(o.objective),/EXISTING_PRIVATE_NETWORK_REQUIRED/u);
});
test('objective requires versioned runtime reference and immutable RC48 bytes',()=>{const f=fixture();validatePoolObjective(f.objective);f.objective.databaseSecretRef.version='latest';assert.throws(()=>validatePoolObjective(f.objective));});
