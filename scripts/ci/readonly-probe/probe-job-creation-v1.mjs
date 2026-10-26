// Narrow read-only probe job creation only. No run, update, delete or retry.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {digest,validateEnvelope} from './rc47-select-only-probe-core-v1.mjs';
import {validateProbeObjective,validateNativeJob} from './rc47-probe-native-guards-v1.mjs';
const PARENT='projects/crmynov-prod-n7x4q2/locations/europe-west1',ROOT='https://run.googleapis.com/v2/'+PARENT;
const OP=new RegExp('^'+PARENT+'/operations/[a-zA-Z0-9_-]+$','u'),HASH=/^[a-f0-9]{64}$/u;
const byteHash=b=>createHash('sha256').update(b).digest('hex');
const keys=(v,expected)=>{assert(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...expected].sort());};
export function validateCreationDossier(dossier) {
  keys(dossier,['schemaVersion','objective','job','preservation']);assert.equal(dossier.schemaVersion,1);
  const e=dossier.objective;validateProbeObjective(e);validateEnvelope(dossier.preservation);
  assert.equal(dossier.preservation.main,e.main);assert.equal(dossier.preservation.imageDigest,e.image.split('@')[1]);
  assert.equal(dossier.preservation.compiledInventorySha256,e.compiledInventorySha256);
  keys(dossier.job,['labels','template']);assert.deepEqual(dossier.job.labels,{'crmynov-probe-objective':e.objectiveSha256.slice(0,63)});
  keys(dossier.job.template,['taskCount','parallelism','template']);assert.equal(dossier.job.template.taskCount,1);assert.equal(dossier.job.template.parallelism,1);
  const task=dossier.job.template.template;assert(Object.keys(task).every(k=>['containers','volumes','maxRetries','timeout','serviceAccount','executionEnvironment','vpcAccess'].includes(k)));
  assert.equal(task.maxRetries,0);assert.equal(task.timeout,'120s');assert.equal(task.serviceAccount,e.serviceAccount);assert.equal(task.executionEnvironment,'EXECUTION_ENVIRONMENT_GEN2');
  assert.equal(task.containers.length,1);const container=task.containers[0];keys(container,['image','command','args','env','resources']);
  assert.equal(container.image,e.image);assert.deepEqual(container.command,['/nodejs/bin/node']);assert.equal(container.args.length,3);assert.deepEqual(container.args.slice(0,2),['--input-type=module','--eval']);assert.equal(byteHash(container.args[2]),e.bootstrapSha256);
  keys(container.resources,['limits']);keys(container.resources.limits,['cpu','memory']);assert(['1','1000m'].includes(container.resources.limits.cpu));assert.equal(container.resources.limits.memory,'512Mi');
  assert.equal(container.env.length,4);assert.equal(new Set(container.env.map(v=>v.name)).size,4);
  const env=Object.fromEntries(container.env.map(v=>[v.name,v]));assert.deepEqual(Object.keys(env).sort(),['CRM_PROBE_BUNDLE_BASE64','CRM_PROBE_BUNDLE_SHA256','DATABASE_URL','GOOGLE_CLOUD_PROJECT']);
  assert.deepEqual(env.DATABASE_URL,{name:'DATABASE_URL',valueSource:{secretKeyRef:e.databaseSecretRef}});assert.deepEqual(env.GOOGLE_CLOUD_PROJECT,{name:'GOOGLE_CLOUD_PROJECT',value:e.project});assert.deepEqual(env.CRM_PROBE_BUNDLE_SHA256,{name:'CRM_PROBE_BUNDLE_SHA256',value:e.bundleSha256});
  keys(env.CRM_PROBE_BUNDLE_BASE64,['name','value']);const bundle=env.CRM_PROBE_BUNDLE_BASE64.value;assert.equal(typeof bundle,'string');assert.equal(Buffer.from(bundle,'base64').toString('base64'),bundle);assert.equal(byteHash(Buffer.from(bundle,'base64')),e.bundleSha256);
  for(const v of container.env)if(Object.hasOwn(v,'value')){assert.equal(typeof v.value,'string');assert(Buffer.byteLength(v.value)<=32768);}
  const normalized=structuredClone(task);normalized.containers[0].resources.limits.cpu='1000m';assert.equal(digest(normalized),e.taskTemplateSha256);
  return dossier;
}
export function openCreationJournal({directory,jobName,dossierSha256,initialize=false}) {
  assert(path.isAbsolute(directory));assert.equal(fs.realpathSync(directory),path.resolve(directory));assert(!fs.lstatSync(directory).isSymbolicLink());assert(HASH.test(dossierSha256));
  const file=path.join(directory,'create-job.sqlite');if(initialize){const fd=fs.openSync(file,'wx');fs.closeSync(fd);}else assert(fs.existsSync(file),'existing creation journal required');
  assert(!fs.lstatSync(file).isSymbolicLink());const db=new DatabaseSync(file);let closed=false;
  try{db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    if(initialize)db.exec('BEGIN IMMEDIATE; PRAGMA application_id=1129467988; PRAGMA user_version=1; CREATE TABLE creation(job TEXT PRIMARY KEY, dossier TEXT NOT NULL, state TEXT NOT NULL, intent TEXT NOT NULL, intent_sha TEXT NOT NULL, receipt TEXT, receipt_sha TEXT); COMMIT;');
    assert.equal(db.prepare('PRAGMA application_id').get().application_id,1129467988);assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  }catch(error){db.close();throw error;}
  function inspect(){assert(!closed);const row=db.prepare('SELECT * FROM creation WHERE job=?').get(jobName);if(!row)return null;assert.equal(row.dossier,dossierSha256);assert.equal(byteHash(row.intent),row.intent_sha);if(row.receipt)assert.equal(byteHash(row.receipt),row.receipt_sha);return{state:row.state,intent:JSON.parse(row.intent),receipt:row.receipt?JSON.parse(row.receipt):null,canRetry:false};}
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  return Object.freeze({
    inspect,
    consume(intent){assert(!closed);return tx(()=>{assert.equal(inspect(),null,'creation already consumed; never retry');assert.equal(intent.job,jobName);assert.equal(intent.dossierSha256,dossierSha256);assert(Number.isFinite(Date.parse(intent.at)));const text=JSON.stringify(intent);db.prepare('INSERT INTO creation VALUES(?,?,?,?,?,NULL,NULL)').run(jobName,dossierSha256,'CREATE_INTENT_CONSUMED',text,byteHash(text));});},
    record(receipt){assert(!closed);return tx(()=>{const old=inspect();assert(old);const allowed={CREATE_INTENT_CONSUMED:['CREATE_OUTCOME_UNKNOWN','CREATE_OPERATION_OBSERVED'],CREATE_OPERATION_OBSERVED:['CREATE_FAILED','NATIVE_JOB_RECONCILED']};assert(allowed[old.state]?.includes(receipt.state));assert.equal(receipt.canRetry,false);if(receipt.state==='CREATE_OPERATION_OBSERVED')assert(OP.test(receipt.operation));if(old.receipt?.operation)assert.equal(receipt.operation,old.receipt.operation);if(receipt.state==='NATIVE_JOB_RECONCILED'){assert.equal(receipt.job,jobName);assert.equal(typeof receipt.uid,'string');assert(receipt.uid.length>8);}
      const text=JSON.stringify(receipt);db.prepare('UPDATE creation SET state=?,receipt=?,receipt_sha=? WHERE job=?').run(receipt.state,text,byteHash(text),jobName);});},
    close(){if(!closed){db.close();closed=true;}}
  });
}
export function createJobCreationTransport({dossier,accessToken,fetchImpl=fetch}) {
  assert.equal(typeof accessToken,'function');
  const target=structuredClone(dossier);validateCreationDossier(target);
  async function request(resource,{method='GET',body,query=''}={}) {
    assert(resource==='/jobs'||/^\/jobs\/crm-prod-rc47-readonly-probe-[a-z0-9-]+$/u.test(resource)||/^\/operations\/[a-zA-Z0-9_-]+$/u.test(resource));
    assert(['GET','POST'].includes(method));if(method==='POST')assert.equal(resource,'/jobs');else assert.equal(body,undefined);
    const serializedBody=body?JSON.stringify(body):undefined;
    const controller=new AbortController();let timer;
    try{return await Promise.race([(async()=>{
      const token=await accessToken({signal:controller.signal});assert.equal(controller.signal.aborted,false);assert(typeof token==='string'&&token.length>0&&!/\s/u.test(token));
      const response=await fetchImpl(ROOT+resource+query,{method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(serializedBody?{'content-type':'application/json'}:{})},...(serializedBody?{body:serializedBody}:{})});
      assert.equal(response.redirected,false);assert([200,...(method==='GET'&&resource.startsWith('/jobs/')?[404]:[])].includes(response.status));assert(/^application\/json(?:;|$)/iu.test(response.headers.get('content-type')??''));assert(response.body);
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;assert(size<=1048576);chunks.push(part.value);}}finally{await reader.cancel();reader.releaseLock();}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));assert(value&&typeof value==='object'&&!Array.isArray(value));return{status:response.status,value};
    })(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},15000);})]);}
    catch{throw Error('NATIVE_CREATE_EXCHANGE_UNKNOWN_NO_RETRY');}finally{clearTimeout(timer);}
  }
  return Object.freeze({
    async requireAbsent(jobName){assert.equal(jobName,target.objective.jobName);const id=jobName.split('/').at(-1),actual=await request('/jobs/'+id);assert.equal(actual.status,404,'existing/unknown job forbids creation');assert.equal(actual.value.error?.code,404);assert.equal(actual.value.error?.status,'NOT_FOUND','only official NOT_FOUND permits absence');
      const seen=new Set();let token='';for(let page=0;page<100;page++){assert(!seen.has(token));seen.add(token);const query=new URLSearchParams({pageSize:'100',showDeleted:'true',fields:'jobs(name,uid,deleteTime),nextPageToken',...(token?{pageToken:token}:{})});const {value}=await request('/jobs',{query:'?'+query});assert(Object.keys(value).every(k=>['jobs','nextPageToken'].includes(k)));const rows=value.jobs??[];assert(Array.isArray(rows)&&rows.length<=100);for(const row of rows){assert(Object.keys(row).every(k=>['name','uid','deleteTime'].includes(k)));assert.notEqual(row.name,jobName,'existing/deleted resource forbids creation');}token=value.nextPageToken??'';assert.equal(typeof token,'string');assert(token.length<=8192);if(!token)return;}
      throw Error('NATIVE_JOB_INVENTORY_BOUND');},
    async create(jobName,body){assert.equal(jobName,target.objective.jobName);assert.deepEqual(body,target.job);const id=jobName.split('/').at(-1);assert(/^crm-prod-rc47-readonly-probe-[a-z0-9-]+$/u.test(id));return(await request('/jobs',{method:'POST',body,query:'?'+new URLSearchParams({jobId:id})})).value;},
    async operation(name){assert(OP.test(name));const reply=await request(name.slice(PARENT.length));assert.equal(reply.value.name,name);return reply.value;},
    async job(name){assert.equal(name,target.objective.jobName);const reply=await request(name.slice(PARENT.length));assert.equal(reply.status,200);assert.equal(reply.value.name,name);return reply.value;}
  });
}
export async function createJobOnce({dossier,authorizeFresh,transport,journal,now=()=>new Date().toISOString()}) {
  dossier=structuredClone(dossier);validateCreationDossier(dossier);assert.equal(typeof authorizeFresh,'function');assert.equal(journal.inspect(),null,'creation already consumed');
  await authorizeFresh();await transport.requireAbsent(dossier.objective.jobName);await authorizeFresh();await transport.requireAbsent(dossier.objective.jobName);
  const intent={at:now(),job:dossier.objective.jobName,dossierSha256:digest(dossier),bodySha256:digest(dossier.job)};journal.consume(intent);
  let operation;try{operation=await transport.create(intent.job,dossier.job);}catch{journal.record({state:'CREATE_OUTCOME_UNKNOWN',canRetry:false});return{state:'CREATE_OUTCOME_UNKNOWN',canRetry:false};}
  if(typeof operation.name!=='string'||!OP.test(operation.name)){journal.record({state:'CREATE_OUTCOME_UNKNOWN',canRetry:false});return{state:'CREATE_OUTCOME_UNKNOWN',canRetry:false};}
  const receipt={state:'CREATE_OPERATION_OBSERVED',operation:operation.name,operationResponseSha256:digest(operation),canRetry:false};journal.record(receipt);return receipt;
}
export async function observeJobCreation({dossier,transport,journal}) {
  dossier=structuredClone(dossier);validateCreationDossier(dossier);const saved=journal.inspect();assert(saved&&saved.state==='CREATE_OPERATION_OBSERVED','known creation operation required');
  const operation=await transport.operation(saved.receipt.operation);if(operation.done!==true)return{state:'CREATE_PENDING',canRetry:false};
  if(operation.error){const result={state:'CREATE_FAILED',operation:operation.name,canRetry:false};journal.record(result);return result;}
  assert.equal(operation.response?.name,dossier.objective.jobName);assert(typeof operation.response.uid==='string'&&operation.response.uid.length>8,'create operation native UID required');const job=await transport.job(dossier.objective.jobName);validateNativeJob(job,dossier.objective);assert.equal(job.uid,operation.response.uid,'created operation UID differs from actual job GET');assert.equal(job.executionCount??0,0);assert.equal(job.latestCreatedExecution,undefined);
  const result={state:'NATIVE_JOB_RECONCILED',operation:operation.name,job:job.name,uid:job.uid,etag:job.etag,nativeGetValidated:true,canRetry:false};assert(typeof job.etag==='string'&&job.etag.length>0);journal.record(result);return result;
}
