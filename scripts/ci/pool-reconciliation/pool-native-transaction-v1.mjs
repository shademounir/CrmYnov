// Pool-only specialization. Reuses the protected official token/authority guards;
// immutable RC47 executor and its job namespace remain untouched.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {digest} from './controlled-pool-contract-v1.mjs';
import {validatePoolNativeJob,validatePoolNativeExecution,validatePoolObjective} from './pool-native-output-v1.mjs';
import {assertAuthorityCurrent,createAuthorityBoundFetch} from '../readonly-probe/probe-driver-authority-v1.mjs';
const PARENT='projects/crmynov-prod-n7x4q2/locations/europe-west1';
const API='https://run.googleapis.com/v2/'+PARENT;
const OP=new RegExp('^'+PARENT+'/operations/[A-Za-z0-9_-]+$','u');
const JOB=new RegExp('^'+PARENT+'/jobs/crm-prod-pool-reconcile-[a-z0-9-]+$','u');
export function openPoolTransactionJournal({directory,objective,initialize=false}){
  validatePoolObjective(objective);assert(path.isAbsolute(directory));assert.equal(fs.realpathSync(directory),path.resolve(directory));assert(fs.statSync(directory).isDirectory());assert(!fs.lstatSync(directory).isSymbolicLink());
  const file=path.join(directory,'pool-native-transactions.sqlite');
  if(initialize){const fd=fs.openSync(file,'wx');fs.closeSync(fd);}else assert(fs.existsSync(file),'EXISTING_JOURNAL_REQUIRED');
  assert(!fs.lstatSync(file).isSymbolicLink());const db=new DatabaseSync(file);let closed=false;
  try{
    db.exec('PRAGMA busy_timeout=5000;PRAGMA synchronous=FULL;PRAGMA journal_mode=DELETE;');
    if(initialize)db.exec('BEGIN IMMEDIATE;PRAGMA application_id=1129467989;PRAGMA user_version=1;CREATE TABLE events(stage TEXT NOT NULL,ordinal INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,sha TEXT NOT NULL,PRIMARY KEY(stage,ordinal));COMMIT;');
    assert.equal(db.prepare('PRAGMA application_id').get().application_id,1129467989);assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }catch(error){db.close();throw error;}
  function inspect(stage){
    assert.equal(closed,false);assert(['CREATE','RUN'].includes(stage));const events=db.prepare('SELECT * FROM events WHERE stage=? ORDER BY ordinal').all(stage);
    for(const [i,event] of events.entries()){assert.equal(event.ordinal,i);assert.equal(digest(JSON.parse(event.payload)),event.sha);const p=JSON.parse(event.payload);assert.equal(p.job,objective.jobName);assert.equal(p.objectiveSha256,objective.objectiveSha256);}
    return events.length?JSON.parse(events.at(-1).payload):null;
  }
  function append(stage,payload){
    db.exec('BEGIN IMMEDIATE');try{
      const old=inspect(stage),allowed={INTENT:['UNKNOWN','OPERATION'],OPERATION:['FAILED','RECONCILED']};
      if(old)assert(allowed[old.state]?.includes(payload.state),'NO_REPLAY_OR_ILLEGAL_TRANSITION');else assert.equal(payload.state,'INTENT');
      assert.equal(payload.canRetry,false);assert.equal(payload.job,objective.jobName);assert.equal(payload.objectiveSha256,objective.objectiveSha256);
      if(old?.operation)assert.equal(payload.operation,old.operation);
      if(payload.operation)assert(OP.test(payload.operation));
      const n=db.prepare('SELECT count(*) AS n FROM events WHERE stage=?').get(stage).n;
      db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(stage,n,payload.state,JSON.stringify(payload),digest(payload));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return Object.freeze({inspect,append,close(){if(!closed){db.close();closed=true;}}});
}
async function boundedJson(response){
  assert([200,404].includes(response.status));assert.equal(response.redirected,false);assert(/^application\/json(?:;|$)/iu.test(response.headers.get('content-type')??''));assert(response.body);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;assert(size<=1048576,'NATIVE_RESPONSE_BOUND');chunks.push(part.value);}}
  finally{await reader.cancel();reader.releaseLock();}
  const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));assert(value&&Object.getPrototypeOf(value)===Object.prototype);return {status:response.status,value};
}
export function createPoolNativeTransport({accessToken,getAuthority,fetchImpl=fetch}){
  assert.equal(typeof accessToken,'function');const guarded=createAuthorityBoundFetch({fetchImpl,getAuthority});
  async function request(resource,{method='GET',body,query=''}={}){
    assert(resource==='/jobs'||/^\/jobs\/crm-prod-pool-reconcile-[a-z0-9-]+(?::run|\/executions(?:\/[a-z0-9-]+)?)?$/u.test(resource)||/^\/operations\/[A-Za-z0-9_-]+$/u.test(resource));
    assert(['GET','POST'].includes(method));if(method==='POST')assert(resource==='/jobs'||resource.endsWith(':run'));else{assert.equal(body,undefined);assert(!resource.endsWith(':run'));}
    const controller=new AbortController();let timer;
    try{
      return await Promise.race([(async()=>{const token=await accessToken({signal:controller.signal});assert(!controller.signal.aborted);assert(typeof token==='string'&&token.length>0&&!/\s/u.test(token));
      const response=await guarded(API+resource+query,{method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return boundedJson(response);})(),new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('POOL_NATIVE_DEADLINE'));},15000);})]);
    }catch{throw Error('POOL_NATIVE_EXCHANGE_UNKNOWN_NO_RETRY');}finally{clearTimeout(timer);}
  }
  const local=name=>{assert(JOB.test(name));return name.slice(PARENT.length);};
  async function absent(name){
    const result=await request(local(name));assert.equal(result.status,404);assert.equal(result.value.error?.status,'NOT_FOUND');assert.equal(result.value.error?.code,404);
    let token='';const seen=new Set();
    for(let n=0;n<100;n++){
      assert(!seen.has(token));seen.add(token);const query=new URLSearchParams({pageSize:'100',showDeleted:'true',fields:'jobs(name,uid,deleteTime),nextPageToken',...(token?{pageToken:token}:{})});
      const result=await request('/jobs',{query:'?'+query});assert.equal(result.status,200);const rows=result.value.jobs??[];assert(Array.isArray(rows)&&rows.length<=100);assert(rows.every(r=>r.name!==name));
      token=result.value.nextPageToken??'';assert.equal(typeof token,'string');assert(token.length<=8192);if(!token)return;
    }throw Error('JOB_INVENTORY_BOUND');
  }
  return Object.freeze({
    requireAbsent:absent,
    async getJob(name){const r=await request(local(name));assert.equal(r.status,200);assert.equal(r.value.name,name);return r.value;},
    async listExecutions(name){let token='';const seen=new Set();for(let n=0;n<100;n++){assert(!seen.has(token));seen.add(token);const q=new URLSearchParams({pageSize:'100',showDeleted:'true',...(token?{pageToken:token}:{})});const r=await request(local(name)+'/executions',{query:'?'+q});assert.equal(r.status,200);const rows=r.value.executions??[];assert(Array.isArray(rows));assert.equal(rows.length,0,'PREEXISTING_EXECUTION');token=r.value.nextPageToken??'';assert.equal(typeof token,'string');assert(token.length<=8192);if(!token)return;}throw Error('EXECUTION_INVENTORY_BOUND');},
    async create(name,body){assert(JOB.test(name));const r=await request('/jobs',{method:'POST',body,query:'?'+new URLSearchParams({jobId:name.slice((PARENT+'/jobs/').length)})});assert.equal(r.status,200);return r.value;},
    async run(name,etag){assert.equal(typeof etag,'string');assert(etag.length>0&&etag.length<=256);const r=await request(local(name)+':run',{method:'POST',body:{etag}});assert.equal(r.status,200);return r.value;},
    async operation(name){assert(OP.test(name));const r=await request(name.slice(PARENT.length));assert.equal(r.status,200);assert.equal(r.value.name,name);return r.value;},
    async execution(name,job){assert(JOB.test(job));assert(name.startsWith(job+'/executions/'));assert(/^[a-z0-9-]+$/u.test(name.slice((job+'/executions/').length)));const r=await request(name.slice(PARENT.length));assert.equal(r.status,200);assert.equal(r.value.name,name);return r.value;}
  });
}
function record(objective,state,extra={}){return {job:objective.jobName,objectiveSha256:objective.objectiveSha256,state,canRetry:false,...extra};}
export async function dispatchPoolOnce({dossier,stage,authorizeFresh,transport,journal,clock=Date.now}){
  const target=structuredClone(dossier),e=target.objective;validatePoolObjective(e);assert(['CREATE','RUN'].includes(stage));assert.equal(typeof authorizeFresh,'function');assert.equal(journal.inspect(stage),null,'CONSUMED_INTENT');
  assert.deepEqual(target.job,{labels:{'crmynov-probe-objective':e.objectiveSha256.slice(0,63)},template:{taskCount:1,parallelism:1,template:e.taskTemplate}},'REVIEWED_CREATE_BODY');
  await authorizeFresh();let job;
  if(stage==='CREATE'){await transport.requireAbsent(e.jobName);}else{assert.equal(journal.inspect('CREATE')?.state,'RECONCILED');job=await transport.getJob(e.jobName);validatePoolNativeJob(job,e);assert.equal(job.uid,journal.inspect('CREATE').uid);assert.equal(job.executionCount??0,0);assert.equal(job.latestCreatedExecution,undefined);await transport.listExecutions(e.jobName);}
  const authority=await authorizeFresh();
  if(stage==='CREATE'){await transport.requireAbsent(e.jobName);}else{const latest=await transport.getJob(e.jobName);validatePoolNativeJob(latest,e);assert.equal(latest.uid,job.uid);assert.equal(latest.etag,job.etag);assert.equal(latest.executionCount??0,0);assert.equal(latest.latestCreatedExecution,undefined);job=latest;}
  if(job){assert.equal(typeof job.etag,'string');assert(job.etag.length>0&&job.etag.length<=256);}
  const now=clock();assertAuthorityCurrent(authority,now);const intent=record(e,'INTENT',{at:new Date(now).toISOString(),...(job?{uid:job.uid,etag:job.etag}:{bodySha256:digest(target.job)})});journal.append(stage,intent);
  let operation;try{operation=stage==='CREATE'?await transport.create(e.jobName,target.job):await transport.run(e.jobName,job.etag);}catch{const unknown=record(e,'UNKNOWN');journal.append(stage,unknown);return unknown;}
  if(!OP.test(operation?.name??'')){const unknown=record(e,'UNKNOWN');journal.append(stage,unknown);return unknown;}
  const result=record(e,'OPERATION',{operation:operation.name,responseSha256:digest(operation),...(job?{uid:job.uid,etag:job.etag}:{})});journal.append(stage,result);return result;
}
export async function observePoolOperation({objective,stage,transport,journal}){
  const e=structuredClone(objective);validatePoolObjective(e);const saved=journal.inspect(stage);assert.equal(saved?.state,'OPERATION','ONLY_DURABLY_KNOWN_OPERATION');
  const operation=await transport.operation(saved.operation);if(operation.done!==true)return record(e,'PENDING');
  if(operation.error){const result=record(e,'FAILED',{operation:saved.operation});journal.append(stage,result);return result;}
  const job=await transport.getJob(e.jobName);validatePoolNativeJob(job,e);let execution;
  if(stage==='CREATE'){assert.equal(operation.response?.name,e.jobName);assert.equal(operation.response.uid,job.uid);assert.equal(job.executionCount??0,0);assert.equal(job.latestCreatedExecution,undefined);}
  else{assert.equal(job.uid,saved.uid);execution=await transport.execution(operation.response.name,e.jobName);validatePoolNativeExecution(job,execution,e);}
  const result=record(e,'RECONCILED',{operation:saved.operation,uid:job.uid,etag:job.etag,...(execution?{execution:execution.name,metadataSha256:digest({job,execution})}:{})});journal.append(stage,result);return result;
}
