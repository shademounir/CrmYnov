import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {MAIN,IMAGE,digest,validateEnvelope} from './rc47-select-only-probe-core-v1.mjs';
import {runReadOnlyProbe} from './rc47-select-only-probe-adapter-v1.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const INVENTORY='723cdbacb94a95b55094b663135ba5763fc56cde8754767491dc428938139dfc';
const names=['adapter','core','entry'];
const invariantKeys=['configuration','memberships','roster','permissions','scopes','leads','followups','booking','pool','migrations'];
export function preflightPayload(bundle,readBytes=fs.readFileSync){
 assert.equal(bundle.schemaVersion,1);
 assert.deepEqual(Object.keys(bundle).sort((a,b)=>a.localeCompare(b,'en')),['compiledInventory','envelope','expectedPreservation','modules','policy','schemaVersion']);
 validateEnvelope(bundle.envelope);
 assert.equal(bundle.envelope.main,MAIN);assert.equal(bundle.envelope.imageDigest,IMAGE);
 assert.equal(bundle.envelope.compiledInventorySha256,INVENTORY);
 assert.equal(bundle.compiledInventory.length,277);assert.equal(digest(bundle.compiledInventory),INVENTORY);
 assert.equal(new Set(bundle.compiledInventory.map(r=>r.path)).size,277);
 for(const r of bundle.compiledInventory){assert(/^\/workspace\/(apps\/api\/dist|node_modules\/\.prisma\/client)\//u.test(r.path));assert(r.path.slice(1).split('/').every(p=>!['.','..',''].includes(p)));assert.equal(hash(readBytes(r.path)),r.sha256,'image byte drift');}
 assert.deepEqual(Object.keys(bundle.modules).sort((a,b)=>a.localeCompare(b,'en')),names);
 const helpers=names.map(name=>{const m=bundle.modules[name];assert.deepEqual(Object.keys(m).sort((a,b)=>a.localeCompare(b,'en')),['sha256','source']);assert.equal(typeof m.source,'string');assert.equal(hash(m.source),m.sha256,'helper drift');return{name,sha256:m.sha256};});
 assert.equal(digest(helpers),bundle.envelope.helperSha256);
 const p=bundle.policy;assert.deepEqual(Object.keys(p).sort((a,b)=>a.localeCompare(b,'en')),['jobName','mode','nativeContractSha256']);
 assert(/^crm-prod-rc47-readonly-probe-[a-z0-9-]+$/u.test(p.jobName));assert(['PRE','POST'].includes(p.mode));assert.equal(p.nativeContractSha256,bundle.envelope.nativeExecutionEnvelopeSha256);
 if(p.mode==='PRE')assert.equal(bundle.expectedPreservation,null);else assert(bundle.expectedPreservation&&bundle.expectedPreservation.main===MAIN);
 return {main:MAIN,imageDigest:IMAGE,compiledFiles:277,helpers:3,mode:p.mode};
}
export function validateJobEnvironment(env,policy){
 assert.equal(env.GOOGLE_CLOUD_PROJECT,'crmynov-prod-n7x4q2');assert.equal(env.CLOUD_RUN_JOB,policy.jobName);
 assert(new RegExp('^'+policy.jobName+'-[a-z0-9]+$','u').test(env.CLOUD_RUN_EXECUTION??''));
 assert.equal(env.CLOUD_RUN_TASK_COUNT,'1');assert.equal(env.CLOUD_RUN_TASK_INDEX,'0');assert.equal(env.CLOUD_RUN_TASK_ATTEMPT,'0');assert.equal(env.K_SERVICE,undefined);assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
 const url=new URL(env.DATABASE_URL??'');assert.equal(url.protocol,'postgresql:');assert.equal(decodeURIComponent(url.username),'crm_runtime');assert.equal(url.pathname,'/crmynov_prod');
 return {job:env.CLOUD_RUN_JOB,execution:env.CLOUD_RUN_EXECUTION,task:0,attempt:0};
}
export function preservationProof(snapshot){
 const hashes=Object.fromEntries(invariantKeys.map(k=>[k,digest(snapshot[k])]));
 const journal=snapshot.journal.map(row=>({keyHash:digest(row.key),status:row.status,sha256:digest(row),identitySha256:digest({key:row.key,event_type:row.event_type,fingerprint:row.fingerprint,recipients_sha256:row.recipients_sha256,sending_at:row.sending_at})}));
 const counters=snapshot.counters.map(row=>({keyHash:digest([row.campus_id,row.version,row.rule_id,row.user_id]),count:row.assigned_count}));
 return {schemaVersion:1,main:MAIN,imageDigest:IMAGE,hashes,journal,counters};
}
export function comparePreservation(current,prior){
 assert.equal(prior.schemaVersion,1);assert.equal(prior.main,MAIN);assert.equal(prior.imageDigest,IMAGE);assert.deepEqual(current.hashes,prior.hashes,'preservation hash divergence');
 assert(prior.journal.length<=1000&&prior.counters.length<=1000);
 for(const old of prior.journal){const row=current.journal.find(x=>x.keyHash===old.keyHash);assert(row,'journal row lost');assert.equal(row.identitySha256,old.identitySha256);if(['ACCEPTED','UNCERTAIN'].includes(old.status))assert.equal(row.sha256,old.sha256);else assert.equal(old.status,'SENDING');}
 for(const old of prior.counters){const row=current.counters.find(x=>x.keyHash===old.keyHash);assert(row&&Number.isSafeInteger(row.count)&&row.count>=old.count,'counter lost/decreased');}
 return true;
}
export async function executeControlledProbe(bundle){
 const byteProof=preflightPayload(bundle);
 const runtime=validateJobEnvironment(process.env,bundle.policy);
 assert.equal(process.versions.node,'22.23.3');assert.equal(process.getuid(),65532);assert.equal(process.getgid(),65532);
 const require=createRequire('/workspace/package.json'),{PrismaClient}=require('@prisma/client');
 const client=new PrismaClient({log:[],errorFormat:'minimal'});
 try{
  const {snapshot,report}=await runReadOnlyProbe(client,bundle.envelope);
  const preservation=preservationProof(snapshot);
  if(bundle.policy.mode==='POST')comparePreservation(preservation,bundle.expectedPreservation);
  return {status:'FIN',readOnly:true,providerCalled:false,byteProof,runtime,report:{...report,postCompared:bundle.policy.mode==='POST'},preservation};
 }finally{await client.$disconnect();}
}
