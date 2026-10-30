// Durable session accounting shared across operational CLI phases. No network/SDK.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {imageJournalDigest as digest} from './journal.mjs';
export const IMAGE_SESSION_LIMITS_V2=Object.freeze({durationMs:900000,maxRequests:200,maxExchangeMs:15000,maxResponseBytes:1048576,maxTotalResponseBytes:20971520});
const H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u,U=/^local:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
function exact(v,keys){assert(v&&Object.getPrototypeOf(v)===Object.prototype);assert(Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,'value')));assert.deepEqual(Object.keys(v).toSorted((a,b)=>a.localeCompare(b,'en')),keys.toSorted((a,b)=>a.localeCompare(b,'en')));}
function time(v){assert.equal(typeof v,'string');const n=Date.parse(v);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===v);return n;}
function write(file,v){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function read(file){const st=fs.lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink()&&st.size<=16384);return JSON.parse(fs.readFileSync(file,'utf8'));}
function applicationOriginsFor(scope,origins){
 assert(Array.isArray(origins));if(origins.length===0){return [];}
 assert(['RC48_SERVICE_IMAGE_ONLY_V1','RC48_SERVICE_IMAGE_ROLLBACK_V1'].includes(scope),'APPLICATION_ORIGINS_REQUIRE_IMAGE_SCOPE');assert.equal(origins.length,2,'EXACT_NATIVE_API_AND_WEB_ORIGINS_REQUIRED');
 return ['api','web'].map((kind,index)=>{const value=origins[index];assert.equal(typeof value,'string');const u=new URL(value);assert.equal(u.protocol,'https:');assert.equal(u.origin,value);assert.equal(u.pathname,'/');assert.equal(u.username+u.password+u.search+u.hash,'');assert(new RegExp(String.raw`^crm-prod-${kind}-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$`,'u').test(u.hostname),'ONLY_PINNED_NATIVE_API_AND_WEB_ORIGINS');return value;});
}
function responseStopCode(responseBytes,totalResponseBytes,now,deadlineAt,limits){
 if(responseBytes>limits.maxResponseBytes||totalResponseBytes+responseBytes>limits.maxTotalResponseBytes){return 'RESPONSE_BYTES_LIMIT';}
 if(now>=deadlineAt){return 'REQUEST_DEADLINE_EXCEEDED';}
 return null;
}
export function createImageSessionBudget({directory,binding,limits=IMAGE_SESSION_LIMITS_V2,applicationOrigins=[],clock=Date.now}){
 assert(path.isAbsolute(directory)&&fs.realpathSync(directory)===path.resolve(directory)&&fs.lstatSync(directory).isDirectory());
 exact(binding,['sessionId','authorityRecordSha256','resourceBindingSha256','scope','windowStart','windowEnd','sourceCommit','project','region']);
 assert(U.test(binding.sessionId)&&H.test(binding.authorityRecordSha256)&&H.test(binding.resourceBindingSha256)&&S.test(binding.sourceCommit));
 assert(['READ_ONLY_INVENTORY','RC48_SERVICE_IMAGE_ONLY_V1','RC48_SERVICE_IMAGE_ROLLBACK_V1','POST_PRESERVATION_READ_ONLY_V2'].includes(binding.scope));
 assert.equal(binding.project,'crmynov-prod-n7x4q2');assert.equal(binding.region,'europe-west1');assert.deepEqual(limits,IMAGE_SESSION_LIMITS_V2);
 applicationOrigins=applicationOriginsFor(binding.scope,applicationOrigins);
 const start=time(binding.windowStart),end=time(binding.windowEnd);assert(end>start&&end-start<=limits.durationMs);binding=structuredClone(binding);
 const bindingSha256=digest(binding),descriptor=path.join(directory,'BINDING.json'),lock=path.join(directory,'SESSION.lock');
 function locked(fn){const fd=fs.openSync(lock,'wx',0o600);try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
 const descriptorValue={schemaVersion:2,kind:'IMAGE_NATIVE_SESSION_BINDING_V2',binding,limits,bindingSha256,...(applicationOrigins.length?{applicationOrigins}:{})};
 locked(()=>{if(fs.existsSync(descriptor)){assert.deepEqual(read(descriptor),descriptorValue);}else{assert(fs.readdirSync(directory).every(n=>n==='SESSION.lock'),'NEW_BUDGET_DIRECTORY_MUST_BE_EMPTY');write(descriptor,descriptorValue);}});
 function records(){
  const names=fs.readdirSync(directory).filter(n=>/^\d{4}\.json$/u.test(n)).sort();assert(names.length<=401);
  let previous=null,lastAt=start,firstNativeAt=null,pending=null,requestsReserved=0,totalResponseBytes=0,stopped=false,stopCode=null;
  const rows=names.map((name,index)=>{assert.equal(name,String(index+1).padStart(4,'0')+'.json');const r=read(path.join(directory,name));exact(r,['payload','sha256']);assert.equal(digest(r.payload),r.sha256);const p=r.payload;assert.equal(p.bindingSha256,bindingSha256);assert.equal(p.previousSha256,previous);assert(Number.isSafeInteger(p.at)&&p.at>=lastAt);lastAt=p.at;previous=r.sha256;assert(!stopped,'RECORD_AFTER_SESSION_STOP');
   if(p.kind==='REQUEST'){assert.equal(p.ordinal,requestsReserved+1);assert.equal(pending,null,'CONCURRENT_NATIVE_REQUEST');requestsReserved++;firstNativeAt??=p.at;pending=p;}
   else if(p.kind==='RESPONSE'){assert(pending&&p.ordinal===pending.ordinal);assert(Number.isSafeInteger(p.responseBytes)&&p.responseBytes>=0);totalResponseBytes+=p.responseBytes;pending=null;}
   else{assert.equal(p.kind,'STOP');assert(/^[A-Z][A-Z0-9_]{0,63}$/u.test(p.code));stopped=true;stopCode=p.code;}
   return r;
  });
  return{rows,previous,lastAt,firstNativeAt,pending,requestsReserved,totalResponseBytes,stopped,stopCode};
 }
 function current(s){const now=clock();assert(Number.isSafeInteger(now)&&now>=s.lastAt&&now>=start,'IMAGE_BUDGET_CLOCK_DRIFT');return now;}
 function append(s,kind,details,now){const payload={bindingSha256,previousSha256:s.previous,at:now,kind,...details};write(path.join(directory,String(s.rows.length+1).padStart(4,'0')+'.json'),{payload,sha256:digest(payload)});}
 function inspectUnlocked(){const s=records(),now=current(s),deadlineAt=Math.min(end,(s.firstNativeAt??now)+limits.durationMs);return{schemaVersion:2,kind:'IMAGE_NATIVE_SESSION_BUDGET_STATE_V2',bindingSha256,firstNativeAt:s.firstNativeAt,deadlineAt,requestsReserved:s.requestsReserved,remainingRequests:Math.max(0,limits.maxRequests-s.requestsReserved),totalResponseBytes:s.totalResponseBytes,remainingResponseBytes:Math.max(0,limits.maxTotalResponseBytes-s.totalResponseBytes),pendingOrdinal:s.pending?.ordinal??null,stopped:s.stopped,stopCode:s.stopCode,remainingMs:Math.max(0,deadlineAt-now),lastRecordSha256:s.previous};}
 function reserveRequest(request){return locked(()=>{
  exact(request,['method','resource','requestSha256']);assert(['GET','POST','PATCH'].includes(request.method)&&H.test(request.requestSha256));
  const url=new URL(request.resource);assert(!url.username&&!url.password&&!url.hash&&url.href===request.resource);
  if(applicationOrigins.includes(url.origin)){assert.equal(request.method,'GET','APPLICATION_READS_GET_ONLY');assert([applicationOrigins[0]+'/health/ready',applicationOrigins[1]+'/'].includes(request.resource),'ONLY_EXACT_PUBLIC_HEALTH_AND_WEB_ROOT_GET');}
  else{assert(['https://run.googleapis.com','https://logging.googleapis.com','https://sqladmin.googleapis.com','https://cloudscheduler.googleapis.com','https://cloudresourcemanager.googleapis.com'].includes(url.origin));assert(request.resource.includes(binding.project)||(request.method==='POST'&&request.resource==='https://logging.googleapis.com/v2/entries:list'),'BOUND_PROJECT_OR_EXACT_LOG_LIST_REQUIRED');}
  const s=records(),now=current(s);assert(!s.stopped&&!s.pending,'SESSION_STOPPED_OR_REQUEST_UNKNOWN_NO_RETRY');assert(s.requestsReserved<limits.maxRequests&&s.totalResponseBytes<limits.maxTotalResponseBytes,'IMAGE_SESSION_CAPACITY_EXHAUSTED');
  const deadlineAt=Math.min(end,(s.firstNativeAt??now)+limits.durationMs,now+limits.maxExchangeMs);assert(now<deadlineAt,'IMAGE_SESSION_EXPIRED');
  const ordinal=s.requestsReserved+1;append(s,'REQUEST',{ordinal,method:request.method,resource:request.resource,requestSha256:request.requestSha256,deadlineAt},now);
  const remainingMs=deadlineAt-clock();assert(remainingMs>0,'IMAGE_REQUEST_EXPIRED_DURING_RESERVATION');return Object.freeze({ordinal,deadlineAt,remainingMs});
 });}
 function recordResponse(ticket,response){return locked(()=>{
  exact(ticket,['ordinal','deadlineAt','remainingMs']);exact(response,['responseBytes']);assert(Number.isSafeInteger(response.responseBytes)&&response.responseBytes>=0);
  const s=records(),now=current(s);assert(!s.stopped&&s.pending&&s.pending.ordinal===ticket.ordinal&&s.pending.deadlineAt===ticket.deadlineAt,'UNMATCHED_OR_REPLAYED_IMAGE_RESPONSE');
  append(s,'RESPONSE',{ordinal:ticket.ordinal,responseBytes:response.responseBytes},now);
  const code=responseStopCode(response.responseBytes,s.totalResponseBytes,now,ticket.deadlineAt,limits);
  if(code){const next=records();append(next,'STOP',{code},now);throw new Error(code);}return inspectUnlocked();
 });}
 function stop(code){assert(/^[A-Z][A-Z0-9_]{0,63}$/u.test(code));return locked(()=>{const s=records();if(!s.stopped){append(s,'STOP',{code},current(s));}return inspectUnlocked();});}
 return Object.freeze({inspect:()=>locked(inspectUnlocked),reserveRequest,recordResponse,stop});
}
