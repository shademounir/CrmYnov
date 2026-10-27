// Dedicated RC48 pool observation. Never imports application bootstrap/providers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runPoolReadOnlyCollection,validateCollectionRequest} from './pool-read-only-collector-v1.mjs';
import {sealPoolOutput,hashBytes,publicKeyFingerprint} from './pool-sealed-output-v1.mjs';
const ROOT='projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/';
const H=/^[a-f0-9]{64}$/u;
const sorted=(a,b)=>a.localeCompare(b,'en');
export function validatePoolRuntimeBundle(bundle){
  assert(bundle&&Object.getPrototypeOf(bundle)===Object.prototype);
  assert.deepEqual(Object.keys(bundle).sort(sorted),['schemaVersion','request','jobName','nonce','databaseBindingSha256','publicKeyPem','modules'].sort(sorted));
  assert.equal(bundle.schemaVersion,1);validateCollectionRequest(bundle.request);
  assert(/^crm-prod-pool-reconcile-[a-z0-9-]+$/u.test(bundle.jobName));
  assert(H.test(bundle.nonce??''));assert(H.test(bundle.databaseBindingSha256??''));
  publicKeyFingerprint(bundle.publicKeyPem);
  assert.deepEqual(Object.keys(bundle.modules).sort(sorted),['collector','entry','output']);
  for(const value of Object.values(bundle.modules)){
    assert.deepEqual(Object.keys(value).sort(sorted),['sha256','source']);
    assert.equal(typeof value.source,'string');assert(value.source.length<=100000);
    assert.equal(hashBytes(value.source),value.sha256,'HELPER_BYTES');
  }
  const manifest=Object.keys(bundle.modules).sort(sorted).map(name=>({name,sha256:bundle.modules[name].sha256}));
  return {sourceSha256:hashBytes(JSON.stringify(manifest)),publicKeySha256:publicKeyFingerprint(bundle.publicKeyPem)};
}
export function poolDatabaseBinding(urlText){
  const url=new URL(urlText);assert.equal(url.protocol,'postgresql:');
  assert.equal(decodeURIComponent(url.username),'crm_runtime');assert.equal(url.pathname,'/crmynov_prod');
  const hosts=url.searchParams.getAll('host');assert(hosts.length<=1);
  const host=hosts[0]??url.hostname;assert(typeof host==='string'&&host.length>0&&host.length<=256);
  return hashBytes(JSON.stringify({role:'crm_runtime',database:'crmynov_prod',host,port:url.port||'5432'}));
}
export function validatePoolRuntimeEnvironment(env,bundle){
  assert.equal(env.GOOGLE_CLOUD_PROJECT,'crmynov-prod-n7x4q2');assert.equal(env.CLOUD_RUN_JOB,bundle.jobName);
  const prefix=bundle.jobName+'-';assert.equal(typeof env.CLOUD_RUN_EXECUTION,'string');
  assert(env.CLOUD_RUN_EXECUTION.startsWith(prefix));assert(/^[a-z0-9]+$/u.test(env.CLOUD_RUN_EXECUTION.slice(prefix.length)));
  for(const name of ['CLOUD_RUN_TASK_COUNT','CLOUD_RUN_TASK_INDEX','CLOUD_RUN_TASK_ATTEMPT']){
    assert.equal(env[name],name==='CLOUD_RUN_TASK_COUNT'?'1':'0');
  }
  for(const name of ['K_SERVICE','GOOGLE_APPLICATION_CREDENTIALS','NODE_OPTIONS','NODE_PATH'])assert.equal(env[name],undefined);
  assert.equal(poolDatabaseBinding(env.DATABASE_URL),bundle.databaseBindingSha256,'DATABASE_BINDING');
  return {job:ROOT+bundle.jobName,execution:ROOT+bundle.jobName+'/executions/'+env.CLOUD_RUN_EXECUTION};
}
export async function executePoolWithClient(bundle,{client,env,version,uid,gid}){
  const bytes=validatePoolRuntimeBundle(bundle),runtime=validatePoolRuntimeEnvironment(env,bundle);
  assert.equal(version,'22.23.3');assert.equal(uid,65532);assert.equal(gid,65532);
  const observation=await runPoolReadOnlyCollection(client,bundle.request);
  const context={purpose:bundle.request.purpose,phase:bundle.request.phase,...runtime,sourceSha256:bytes.sourceSha256,nonce:bundle.nonce};
  return sealPoolOutput({schemaVersion:1,observation,databaseBindingSha256:bundle.databaseBindingSha256,sourceSha256:bytes.sourceSha256,runtime:{...runtime,taskIndex:0,attempt:0}}, {publicKeyPem:bundle.publicKeyPem,context});
}
export async function executeNativePoolObservation(bundle){
  validatePoolRuntimeBundle(bundle);validatePoolRuntimeEnvironment(process.env,bundle);
  assert.equal(process.versions.node,'22.23.3');assert.equal(process.getuid(),65532);assert.equal(process.getgid(),65532);
  const require=createRequire('/workspace/package.json'),{PrismaClient}=require('@prisma/client');
  const client=new PrismaClient({log:[],errorFormat:'minimal'});
  try{return await executePoolWithClient(bundle,{client,env:process.env,version:process.versions.node,uid:process.getuid(),gid:process.getgid()});}
  finally{await client.$disconnect();}
}
