// Additive operational transport. A durable reservation precedes every native
// request; no retry, RUN, arbitrary URL, IAM mutation or token persistence.
import assert from 'node:assert/strict';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {imageJournalDigest as digest,IMAGE_SESSION_LIMITS_V2} from './journal.mjs';
import {PROJECT,LOCATION} from './plan.mjs';
import {imagePlanScope,isImageRollback} from './plan-mode.mjs';
import {IMAGE_PROJECT_PERMISSIONS_V2,IMAGE_SERVICE_PERMISSIONS_V2,IMAGE_GENERAL_JOB_PERMISSIONS_V2,IMAGE_PERMISSION_EVIDENCE_LIMITS_V2} from './operational-permissions-v2.mjs';
import {IMAGE_OPERATIONAL_RESOURCES_V2} from './late-binding-v2.mjs';
const REGION='europe-west1',ACCOUNT='casablancaynovcampus@gmail.com';
const RUN='https://run.googleapis.com/v2/',SQL='https://sqladmin.googleapis.com/sql/v1beta4/',SCHEDULER='https://cloudscheduler.googleapis.com/v1/';
const INSTANCE='crm-ynov-prod-pg17',SQL_RESOURCE='projects/'+PROJECT+'/instances/'+INSTANCE;
const GENERAL=LOCATION+'/jobs/crm-prod-preservation-pre-20261028-147f390728';
const BINDING=['sessionId','authorityRecordSha256','resourceBindingSha256','scope','windowStart','windowEnd','sourceCommit','project','region'];
const SERVICE_PERMISSIONS=IMAGE_SERVICE_PERMISSIONS_V2,JOB_PERMISSIONS=IMAGE_GENERAL_JOB_PERMISSIONS_V2;
const CODES=new Set(['IMAGE_OPERATIONAL_AUTHORITY_REFUSED','IMAGE_OPERATIONAL_REQUEST_REFUSED','IMAGE_OPERATIONAL_DEADLINE','IMAGE_OPERATIONAL_RESPONSE_BOUND','IMAGE_OPERATIONAL_HTTP_REFUSED','IMAGE_OPERATIONAL_JSON_REFUSED','IMAGE_OPERATIONAL_RESPONSE_HEADERS_REFUSED','IMAGE_OPERATIONAL_NATIVE_UNKNOWN_NO_RETRY','IMAGE_OPERATIONAL_RESPONSE_SHAPE_REFUSED','IMAGE_OPERATIONAL_PAGINATION_REFUSED','IMAGE_OPERATIONAL_PERMISSIONS_MISSING','IMAGE_SESSION_CAPACITY_EXHAUSTED','IMAGE_SESSION_EXPIRED','RESPONSE_BYTES_LIMIT','REQUEST_DEADLINE_EXCEEDED','SESSION_STOPPED_OR_REQUEST_UNKNOWN_NO_RETRY']);
function exact(v,keys){assert(v&&Object.getPrototypeOf(v)===Object.prototype);const d=Object.getOwnPropertyDescriptors(v);assert(Reflect.ownKeys(d).every(k=>typeof k==='string'&&Object.hasOwn(d[k],'value')));assert.deepEqual(Object.keys(d).sort(),[...keys].sort());}
function iso(v){assert.equal(typeof v,'string');const n=Date.parse(v);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===v);return n;}
function opaque(v){assert.equal(typeof v,'string');assert.match(v,/^[A-Za-z0-9_-]{1,256}$/u);return v;}
function page(v){assert.equal(typeof v,'string');assert(v.length<=8192&&!/[\u0000-\u001f\u007f]/u.test(v));return v;}
function plainJson(v,depth=0){assert(depth<=64);if(v===null||typeof v==='boolean'||typeof v==='string'){return;}if(typeof v==='number'){assert(Number.isFinite(v));return;}assert(v&&typeof v==='object');if(Array.isArray(v)){for(const item of v){plainJson(item,depth+1);}return;}assert(Object.getPrototypeOf(v)===Object.prototype);for(const [key,d]of Object.entries(Object.getOwnPropertyDescriptors(v))){assert(key!=='__proto__'&&key!=='constructor'&&key!=='prototype'&&Object.hasOwn(d,'value'));plainJson(d.value,depth+1);}}
function fail(code){throw new Error(code);}
export function createImageOperationalTransport({binding,plan,accessToken,getAuthority,sessionBudget,fetchImpl=fetch,clock=Date.now,schedule=setTimeout,cancel=clearTimeout}){
  exact(binding,BINDING);binding=structuredClone(binding);assert.match(binding.sessionId,/^local:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  assert.equal(binding.project,PROJECT);assert.equal(binding.region,REGION);assert.match(binding.sourceCommit,/^[a-f0-9]{40}$/u);
  for(const k of ['authorityRecordSha256','resourceBindingSha256']){assert.match(binding[k],/^[a-f0-9]{64}$/u);}
  const windowStart=iso(binding.windowStart),windowEnd=iso(binding.windowEnd);assert(windowEnd>windowStart&&windowEnd-windowStart<=900000);
  const inventory=binding.scope==='READ_ONLY_INVENTORY';assert(inventory||['RC48_SERVICE_IMAGE_ONLY_V1','RC48_SERVICE_IMAGE_ROLLBACK_V1'].includes(binding.scope));
  if(inventory){assert.equal(plan,undefined);}else{plan=structuredClone(plan);assert.equal(imagePlanScope(plan),binding.scope);assert(isImageRollback(plan)?plan.patches.length>=1&&plan.patches.length<=2:plan.patches.length===2);}
  const planSha256=plan?digest(plan):null;for(const fn of [accessToken,getAuthority,fetchImpl,clock,schedule,cancel]){assert.equal(typeof fn,'function');}
  for(const name of ['inspect','reserveRequest','recordResponse','stop']){assert.equal(typeof sessionBudget?.[name],'function');}
  assert.equal(sessionBudget.inspect().bindingSha256,digest(binding),'SESSION_BUDGET_BINDING_MISMATCH');
  let lastClock,terminal=false;const observations=[],nativePages=new Map(),permissionReads=new Map();
  function now(){const n=clock();assert(Number.isSafeInteger(n)&&(lastClock===undefined||n>=lastClock));lastClock=n;return n;}
  function stop(code){terminal=true;try{sessionBudget.stop(code);}catch{/* Never replace a refusal with raw persistence output. */}}
  function authority(action){
    try{
      assert(!terminal);const n=now(),a=getAuthority();assert.equal(a?.entry?.schemaVersion,2);assert.equal(a.receipt?.schemaVersion,2);
      assert.equal(a.entry.scope,binding.scope);assert.equal(a.entry.googleAccount,ACCOUNT);assert.equal(a.entry.project,PROJECT);assert.equal(a.entry.region,REGION);
      assert.equal(a.entry.authorityRecordSha256,binding.authorityRecordSha256);assert.equal(a.receipt.authorityRecordSha256,binding.authorityRecordSha256);
      assert.equal(a.entry.resourceBindingSha256,binding.resourceBindingSha256);assert.equal(a.receipt.resourceBindingSha256,binding.resourceBindingSha256);assert.equal(digest(a.entry.resourceBindings),binding.resourceBindingSha256);
      assert.equal(a.receipt.driverCommit,binding.sourceCommit);assert.equal(a.entry.driver.mergeCommit,binding.sourceCommit);
      assert(a.entry.actions.includes(action));assertAuthorityCurrent(a,n);assert(n>=windowStart&&n<windowEnd);
      assert(iso(a.entry.validFrom)<=windowStart&&windowEnd<=iso(a.entry.expiresAt));
      if(inventory){assert.equal(a.entry.preparationMode,'READ_ONLY_INVENTORY');assert.equal(a.entry.preparationPhase,'READ_ONLY_INVENTORY');assert(['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'].includes(action));}
      else{assert.equal(a.entry.preparationMode,'LATE_BOUND_V2');assert.equal(a.entry.planSha256,planSha256);assert(['BACKUP_READY','FORWARD_FINAL'].includes(a.entry.preparationPhase));assert(Array.isArray(a.receipt.authorizedActions)&&a.receipt.authorizedActions.includes(action));assert(Array.isArray(a.receipt.allowedPreparationPhases)&&a.receipt.allowedPreparationPhases.includes(a.entry.preparationPhase));if(action.startsWith('PATCH_')){assert.equal(a.entry.preparationPhase,'FORWARD_FINAL');}}
      assert.deepEqual(a.entry.resourceBindings,IMAGE_OPERATIONAL_RESOURCES_V2);return a;
    }catch{fail('IMAGE_OPERATIONAL_AUTHORITY_REFUSED');}
  }
  async function body(response,exchangeBoundary,controller,onBytes){
    assert.equal(typeof response?.headers?.get,'function');const declared=response.headers.get('content-length');
    if(declared!==null){assert.match(declared,/^(?:0|[1-9]\d*)$/u);if(Number(declared)>IMAGE_SESSION_LIMITS_V2.maxResponseBytes){fail('IMAGE_OPERATIONAL_RESPONSE_BOUND');}}
    assert.equal(typeof response?.body?.getReader,'function');const reader=response.body.getReader(),chunks=[];let length=0;
    try{
      while(true){
        exchangeBoundary();if(controller.signal.aborted){fail('IMAGE_OPERATIONAL_DEADLINE');}
        const result=await reader.read();exchangeBoundary();if(controller.signal.aborted){fail('IMAGE_OPERATIONAL_DEADLINE');}
        if(result.done){break;}assert(result.value instanceof Uint8Array);length+=result.value.byteLength;onBytes(length);
        if(length>IMAGE_SESSION_LIMITS_V2.maxResponseBytes||length>sessionBudget.inspect().remainingResponseBytes){fail('IMAGE_OPERATIONAL_RESPONSE_BOUND');}
        chunks.push(result.value);
      }
      const bytes=Buffer.concat(chunks,length);let value;
      try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));plainJson(value);}catch{fail('IMAGE_OPERATIONAL_JSON_REFUSED');}
      return{value,bytes:bytes.length};
    }finally{try{await reader.cancel();}catch{/* Deadline is already terminal; never retry cleanup. */}reader.releaseLock();}
  }
  async function exchange(url,action,requestBody,method='GET'){
    let ticket,responseBytes=0,recorded=false,requestStartedAt,controller,timer,deadline,responseStatus=null,responseDigest=null,requestProjection,observationRecorded=false,rejectDeadline;
    function armTimer(){cancel(timer);const remaining=deadline-now();if(remaining<=0){fail('IMAGE_OPERATIONAL_DEADLINE');}timer=schedule(()=>{controller.abort();rejectDeadline(new Error('IMAGE_OPERATIONAL_DEADLINE'));},remaining);}
    function exchangeBoundary(){
      const current=authority(action),n=now(),next=Math.min(deadline,iso(current.receipt.expiresAt));
      if(n>=next||controller.signal.aborted){fail('IMAGE_OPERATIONAL_DEADLINE');}if(next<deadline){deadline=next;if(rejectDeadline){armTimer();}}
    }
    function retainObservation(outcome){
      if(!ticket||observationRecorded){return;}observationRecorded=true;
      const began=Number.isSafeInteger(requestStartedAt)?requestStartedAt:lastClock??windowStart;
      observations.push(Object.freeze({schemaVersion:2,kind:'EXPURGATED_IMAGE_NATIVE_EXCHANGE_OBSERVATION_V2',sessionId:binding.sessionId,ordinal:ticket.ordinal,
        request:requestProjection,requestStartedAt:new Date(began).toISOString(),responseObservedAt:new Date(lastClock??began).toISOString(),
        status:responseStatus,responseBytes,responseSha256:responseDigest,responseProjectionNotRawPayload:true,outcome,
        authorityRecordSha256:binding.authorityRecordSha256,resourceBindingSha256:binding.resourceBindingSha256}));
    }
    try{
      assert(!terminal);assert(['GET','POST','PATCH'].includes(method));assert(method!=='GET'||requestBody===undefined);const a=authority(action);
      const request={method,url,...(requestBody===undefined?{}:{body:requestBody})};plainJson(request);const requestSha256=digest(request);requestProjection={method,url,sha256:requestSha256,...(requestBody===undefined?{}:{bodySha256:digest(requestBody)})};
      ticket=sessionBudget.reserveRequest({method,resource:url,requestSha256});requestStartedAt=now();deadline=Math.min(ticket.deadlineAt,iso(a.receipt.expiresAt));assert(requestStartedAt<deadline);
      controller=new AbortController();
      return await Promise.race([(async()=>{
        let token=await accessToken({signal:controller.signal});assert.equal(typeof token,'string');assert(token.length>0&&token.length<=8192&&!/\s/u.test(token));exchangeBoundary();let response;
        try{response=await fetchImpl(url,{method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(requestBody===undefined?{}:{'content-type':'application/json'})},...(requestBody===undefined?{}:{body:JSON.stringify(requestBody)})});}finally{token=undefined;}
        exchangeBoundary();assert(Number.isSafeInteger(response.status)&&response.status>=100&&response.status<=599);responseStatus=response.status;
        if(response.redirected!==false||typeof response.headers?.get!=='function'||!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/iu.test(response.headers.get('content-type')??'')){fail('IMAGE_OPERATIONAL_RESPONSE_HEADERS_REFUSED');}
        const result=await body(response,exchangeBoundary,controller,n=>{responseBytes=n;});responseBytes=result.bytes;responseDigest=digest(result.value);
        sessionBudget.recordResponse(ticket,{responseBytes});recorded=true;
        if(response.status!==200){fail('IMAGE_OPERATIONAL_HTTP_REFUSED');}exchangeBoundary();
        retainObservation('HTTP_200_RECEIVED_NOT_SEMANTIC_ACCEPTANCE');
        return result.value;
      })(),new Promise((resolve,reject)=>{rejectDeadline=reject;armTimer();})]);
    }catch(error){
      if(controller){controller.abort();}if(ticket&&!recorded){try{sessionBudget.recordResponse(ticket,{responseBytes});}catch{/* Durable pending/STOP still prevents any replay. */}}
      const code=CODES.has(error?.message)?error.message:'IMAGE_OPERATIONAL_NATIVE_UNKNOWN_NO_RETRY';retainObservation(code);stop(code);fail(code);
    }finally{cancel(timer);}
  }
  function service(kind){assert(['api','web'].includes(kind));return LOCATION+'/services/crm-prod-'+kind;}
  async function listPage(family,url,token,params){
    page(token);const allowed=nativePages.get(family)??new Set();assert(!token||allowed.has(token),'ONLY_NATIVE_PREVIOUS_PAGE_TOKEN');if(token){allowed.delete(token);}
    const value=await exchange(url+'?'+new URLSearchParams({...params,...(token?{pageToken:token}:{})}),'READ_METADATA');const next=value.nextPageToken??'';page(next);
    if(next){assert(next!==token&&!allowed.has(next),'PAGINATION_CYCLE_REFUSED');allowed.add(next);}nativePages.set(family,allowed);return value;
  }
  async function shaped(callback){try{return await callback();}catch(error){const code=CODES.has(error?.message)?error.message:'IMAGE_OPERATIONAL_RESPONSE_SHAPE_REFUSED';stop(code);fail(code);}}
  async function collection(list,key){return shaped(async()=>{const items=[],seen=new Set();let token='';for(let index=0;index<20;index++){
    const value=await list(token);assert(value&&typeof value==='object');const rows=value[key]??[];assert(Array.isArray(rows)&&rows.length<=100);items.push(...rows);assert(items.length<=2000);
    const next=value.nextPageToken??'';page(next);if(!next){return items;}assert(!seen.has(next));seen.add(next);token=next;
  }fail('IMAGE_OPERATIONAL_PAGINATION_REFUSED');});}
  async function permissions(key,url,requested){
    const value=await exchange(url,'TEST_PERMISSIONS',{permissions:[...requested]},'POST');exact(value,Object.hasOwn(value,'permissions')?['permissions']:[]);const returned=value.permissions??[];
    assert(Array.isArray(returned)&&returned.length<=requested.length);assert(new Set(returned).size===returned.length&&returned.every(p=>requested.includes(p)));
    permissionReads.set(key,{requested:[...requested],returned:[...returned],observedAt:new Date(now()).toISOString(),requestObservation:structuredClone(observations.at(-1))});
    if(requested.some(p=>!returned.includes(p))){fail('IMAGE_OPERATIONAL_PERMISSIONS_MISSING');}return value;
  }
  function permissionEvidence(){
    const rows=[['PROJECT',IMAGE_PROJECT_PERMISSIONS_V2],['SERVICE_API',SERVICE_PERMISSIONS],['SERVICE_WEB',SERVICE_PERMISSIONS],['GENERAL_JOB',JOB_PERMISSIONS]].map(([key,requested])=>{
      const row=permissionReads.get(key);return{key,missing:requested.filter(p=>!row?.returned.includes(p)),observation:row?structuredClone(row):null};
    });
    return{schemaVersion:2,kind:'IMAGE_NATIVE_PERMISSION_OBSERVATIONS_V2',sessionId:binding.sessionId,authorityRecordSha256:binding.authorityRecordSha256,
      resourceBindingSha256:binding.resourceBindingSha256,rows,allDeclaredRequestedPermissionsReturned:rows.every(row=>row.missing.length===0),limits:structuredClone(IMAGE_PERMISSION_EVIDENCE_LIMITS_V2)};
  }
  function assertPermissionsReady(){
    assert(!terminal);const evidence=permissionEvidence();assert(evidence.allDeclaredRequestedPermissionsReturned,'ACTUAL_DECLARED_PERMISSIONS_MISSING');const n=now();
    for(const row of evidence.rows){const at=iso(row.observation.observedAt);assert(at<=n&&n-at<600000,'NATIVE_PERMISSION_OBSERVATION_EXPIRED');}return evidence;
  }
  const api={
    async getService(kind){return shaped(async()=>{const name=service(kind),value=await exchange(RUN+name,'READ_METADATA');assert.equal(value.name,name);const expected=getAuthority().entry.resourceBindings.services.find(s=>s.name===name);assert.equal(value.uid,expected.uid);return value;});},
    async getRevision(kind,revision){return shaped(async()=>{const name=service(kind);assert.equal(typeof revision,'string');assert(revision.startsWith('crm-prod-'+kind+'-'));opaque(revision);const full=name+'/revisions/'+revision,value=await exchange(RUN+full,'READ_METADATA');assert.equal(value.name,full);return value;});},
    async listJobs(token=''){return shaped(()=>listPage('JOBS',RUN+LOCATION+'/jobs',token,{pageSize:'100',showDeleted:'true'}));},
    async listSchedulers(token=''){return shaped(()=>listPage('SCHEDULERS',SCHEDULER+LOCATION+'/jobs',token,{pageSize:'100'}));},
    async getSqlInstance(){return shaped(async()=>{const value=await exchange(SQL+SQL_RESOURCE,'READ_METADATA');assert.equal(value.project,PROJECT);assert.equal(value.name,INSTANCE);return value;});},
    async listBackups(token=''){return shaped(()=>listPage('BACKUPS',SQL+SQL_RESOURCE+'/backupRuns',token,{maxResults:'100'}));},
    async getBackup(id){return shaped(async()=>{assert.match(id,/^[1-9]\d{0,19}$/u);const value=await exchange(SQL+SQL_RESOURCE+'/backupRuns/'+id,'READ_METADATA');assert.equal(String(value.id),id);assert.equal(value.instance,INSTANCE);return value;});},
    async createBackup(){return shaped(async()=>{assert(!inventory);const a=authority('CREATE_BACKUP');assertPermissionsReady();assert.match(a.entry.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);return exchange(SQL+SQL_RESOURCE+'/backupRuns','CREATE_BACKUP',{description:'CRMY-63 '+a.entry.objectiveId+' '+planSha256.slice(0,16)},'POST');});},
    async patchServiceImage(kind){return shaped(async()=>{assert(!inventory);const name=service(kind),patch=plan.patches.find(p=>p.resource===name);authority('PATCH_'+kind.toUpperCase());assertPermissionsReady();assert(patch&&patch.method==='PATCH'&&patch.updateMask==='template.containers');assert.equal(patch.body.name,name);assert.equal(patch.body.etag,patch.expectedEtag);exact(patch.body,['name','etag','template']);exact(patch.body.template,['containers']);return exchange(RUN+name+'?'+new URLSearchParams({updateMask:'template.containers'}),'PATCH_'+kind.toUpperCase(),patch.body,'PATCH');});},
    async getRunOperation(name){return shaped(async()=>{const prefix=LOCATION+'/operations/';assert.equal(typeof name,'string');assert(name.startsWith(prefix));opaque(name.slice(prefix.length));const value=await exchange(RUN+name,'OBSERVE_OPERATION');assert.equal(value.name,name);return value;});},
    async getSqlOperation(name){return shaped(async()=>{opaque(name);const value=await exchange(SQL+'projects/'+PROJECT+'/operations/'+name,'OBSERVE_OPERATION');assert.equal(value.name,name);assert.equal(value.targetProject,PROJECT);assert.equal(value.targetId,INSTANCE);return value;});},
    async getJob(){return shaped(async()=>{const value=await exchange(RUN+GENERAL,'READ_METADATA');assert.equal(value.name,GENERAL);assert.equal(value.uid,'6333afa0-3af3-4916-9aa1-e1093ce0bea0');return value;});},
    async listExecutions(token=''){return shaped(()=>listPage('EXECUTIONS',RUN+GENERAL+'/executions',token,{pageSize:'100',showDeleted:'true'}));},
    async testServicePermissions(kind){return shaped(()=>permissions('SERVICE_'+kind.toUpperCase(),RUN+service(kind)+':testIamPermissions',SERVICE_PERMISSIONS));},
    async testJobPermissions(){return shaped(()=>permissions('GENERAL_JOB',RUN+GENERAL+':testIamPermissions',JOB_PERMISSIONS));},
    async testProjectPermissions(){return shaped(()=>permissions('PROJECT','https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':testIamPermissions',IMAGE_PROJECT_PERMISSIONS_V2));},
    permissionEvidence,
    assertGeneralPermissionsReady(){return assertPermissionsReady();},
    assertMutationReady(action){assert(['CREATE_BACKUP','PATCH_API','PATCH_WEB'].includes(action));authority(action);return assertPermissionsReady();},
    observations:()=>structuredClone(observations),
    close(){stop('IMAGE_OPERATIONAL_SESSION_CLOSED');}
  };
  api.collectJobs=()=>collection(api.listJobs,'jobs');api.collectSchedulers=()=>collection(api.listSchedulers,'jobs');api.collectBackups=()=>collection(api.listBackups,'items');api.collectExecutions=()=>collection(api.listExecutions,'executions');
  return Object.freeze(api);
}
