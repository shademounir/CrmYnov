// Additive V2 of the existing executor. V1 journals, state guards and validators are reused unchanged.
import assert from 'node:assert/strict';
import {digest} from './controlled-pool-contract-v1.mjs';
import {validateReadOnlyNativeJob,validateReadOnlyObjective,readOnlyPurposeConfiguration,readOnlyTaskNetworkRequest} from './pool-native-output-v1.mjs';
import {assertAuthorityCurrent,createAuthorityBoundFetch} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {diagnosticContext,sanitizedDiagnostic,ReadOnlyNativeDiagnosticError,diagnosticOf,permittedNetworkCode,permittedGoogleCode,NATIVE_OPERATION_PATTERN,commandResult} from './readonly-native-diagnostics-v1.mjs';
export {openReadOnlyTransactionJournal,observeReadOnlyOperation} from './pool-native-transaction-v1.mjs';
const PARENT='projects/crmynov-prod-n7x4q2/locations/europe-west1';
const API='https://run.googleapis.com/v2/'+PARENT;

function assertFreshClock(clock,started) { const now=clock();assert(Number.isSafeInteger(now)&&now>=started,'DIAGNOSTIC_CLOCK_INVALID');return now; }
async function emitDiagnostic(context,state,saveDiagnostic) {
  let diagnostic=sanitizedDiagnostic(context,state);
  if(saveDiagnostic){
    try{await saveDiagnostic(diagnostic);diagnostic=sanitizedDiagnostic(context,{...state,diagnosticPersisted:true});}
    catch{diagnostic=sanitizedDiagnostic(context,{...state,diagnosticPersistenceFailed:true});}
  }
  return diagnostic;
}
async function responseValue(response,state,phase) {
  phase('VALIDATION');
  state.httpStatus=response.status;
  if(response.redirected!==false)throw Error('RESPONSE_REDIRECTED');
  if(!/^application\/json(?:;|$)/iu.test(response.headers.get('content-type')??''))throw Error('RESPONSE_CONTENT_TYPE');
  if(!response.body)throw Error('RESPONSE_BODY_MISSING');
  phase('READ');const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(let index=0;;index++){
      const part=await reader.read();if(part.done)break;
      size+=part.value.byteLength;if(size>1048576||index>=4096)throw Error('RESPONSE_TOO_LARGE');chunks.push(part.value);
    }
  } finally { await reader.cancel();reader.releaseLock(); }
  phase('DECODE');let text;
  try{text=new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw Error('RESPONSE_DECODE_FAILED');}
  let value;try{value=JSON.parse(text);}catch{throw Error('RESPONSE_JSON_INVALID');}
  if(value===null||Object.getPrototypeOf(value)!==Object.prototype)throw Error('RESPONSE_SHAPE_INVALID');
  state.googleCode=permittedGoogleCode(value);
  if(![200,404].includes(response.status))throw Error('HTTP_ERROR');
  return {status:response.status,value};
}
const boundaryReasons=new Set(['RESPONSE_REDIRECTED','RESPONSE_CONTENT_TYPE','RESPONSE_BODY_MISSING','RESPONSE_TOO_LARGE','RESPONSE_DECODE_FAILED','RESPONSE_JSON_INVALID','RESPONSE_SHAPE_INVALID','HTTP_ERROR','DEADLINE_EXCEEDED','TOKEN_INVALID','OPERATION_REFERENCE_PERSISTENCE_FAILED']);
function failureReason(error,phase){
  if(boundaryReasons.has(error?.message))return error.message;
  return {AUTHORITY:'AUTHORITY_REFUSED',TOKEN:'TOKEN_ACQUISITION_FAILED',HTTP:'HTTP_EXCHANGE_FAILED',READ:'RESPONSE_READ_FAILED',DECODE:'RESPONSE_DECODE_FAILED',JOURNAL_PERSISTENCE:'OPERATION_REFERENCE_PERSISTENCE_FAILED'}[phase]??'VALIDATION_REFUSED';
}
function validateRequestBoundary(resource,method,body,resourcePattern){
  assert(resource==='/jobs'||resourcePattern.test(resource)||/^\/operations\/[A-Za-z0-9_-]+$/u.test(resource)||(method==='GET'&&resource.endsWith('/tasks')&&resourcePattern.test(resource.slice(0,-6))));
  assert(['GET','POST'].includes(method));
  if(method==='POST')assert(resource==='/jobs'||resource.endsWith(':run'));
  else{assert.equal(body,undefined);assert(!resource.endsWith(':run'));}
}
async function performExchange({resource,method,body,query,phase,accessToken,controller,scopedAuthority,guarded,state,onOperationReference}){
  phase('TOKEN');const token=await accessToken({signal:controller.signal});
  phase('TOKEN');if(typeof token!=='string'||!token.length||/\s/u.test(token))throw Error('TOKEN_INVALID');
  scopedAuthority();
  const response=await guarded(API+resource+query,{method,redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+token,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const decoded=await responseValue(response,state,phase);
  if(method==='POST'&&decoded.status===200&&NATIVE_OPERATION_PATTERN.test(decoded.value.name??'')){
    state.operationReference=decoded.value.name;
    if(onOperationReference){phase('JOURNAL_PERSISTENCE');await onOperationReference(decoded.value.name,digest(decoded.value));}
  }
  return decoded;
}
export function createReadOnlyNativeTransport({purpose,accessToken,getAuthority,fetchImpl=fetch,diagnostic:contextInput,saveDiagnostic,clock=Date.now,timeoutMs=15000}) {
  assert.equal(typeof accessToken,'function');assert.equal(typeof getAuthority,'function');assert.equal(typeof fetchImpl,'function');
  assert(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000,'BOUNDED_NATIVE_DEADLINE');
  const context=diagnosticContext(contextInput),p=readOnlyPurposeConfiguration(purpose);
  const JOB=new RegExp('^'+PARENT+'/jobs/'+p.prefix+'[a-z0-9-]+$','u');
  const resourcePattern=new RegExp('^/jobs/'+p.prefix+'[a-z0-9-]+(?::run|/executions(?:/[a-z0-9-]+)?)?$','u');
  let lastExchange;
  async function request(resource,{method='GET',body,query='',onOperationReference}={}) {
    const started=clock();assert(Number.isSafeInteger(started));
    const state={startedMs:started,endedMs:started,phase:'VALIDATION',transportInvoked:false};
    const controller=new AbortController();let timer;
    const phase=value=>{if(controller.signal.aborted)throw Error('DEADLINE_EXCEEDED');state.phase=value;};
    const scopedAuthority=()=>{phase('AUTHORITY');const authority=getAuthority();assert.equal(authority?.entry?.scope,purpose,'AUTHORITY_PURPOSE');return authority;};
    const guarded=createAuthorityBoundFetch({getAuthority:scopedAuthority,clock,fetchImpl:(url,init)=>{phase('HTTP');state.transportInvoked=true;return fetchImpl(url,init);}});
    try {
      scopedAuthority();phase('VALIDATION');
      validateRequestBoundary(resource,method,body,resourcePattern);
      const work=performExchange({resource,method,body,query,phase,accessToken,controller,scopedAuthority,guarded,state,onOperationReference});
      return await Promise.race([work,new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('DEADLINE_EXCEEDED'));},timeoutMs);})]);
    } catch(error) {
      state.endedMs=assertFreshClock(clock,started);state.reason=failureReason(error,state.phase);state.networkCode=permittedNetworkCode(error);
      throw new ReadOnlyNativeDiagnosticError(await emitDiagnostic(context,state,saveDiagnostic));
    } finally {
      clearTimeout(timer);
      lastExchange=Object.freeze({startedMs:started,endedMs:assertFreshClock(clock,started),httpStatus:state.httpStatus??null,
        googleCode:state.googleCode??null,transportInvoked:state.transportInvoked,operationReference:state.operationReference??null});
    }
  }
  const local=name=>{assert(JOB.test(name));return name.slice(PARENT.length);};
  async function absent(name){
    const result=await request(local(name));assert.equal(result.status,404);assert.equal(result.value.error?.status,'NOT_FOUND');assert.equal(result.value.error?.code,404);
    let token='';const seen=new Set();
    for(let index=0;index<100;index++){
      assert(!seen.has(token));seen.add(token);const query=new URLSearchParams({pageSize:'100',showDeleted:'true',fields:'jobs(name,uid,deleteTime),nextPageToken',...(token?{pageToken:token}:{})});
      const page=await request('/jobs',{query:'?'+query});assert.equal(page.status,200);const rows=page.value.jobs??[];assert(Array.isArray(rows)&&rows.length<=100);assert(rows.every(row=>row.name!==name));
      token=page.value.nextPageToken??'';assert.equal(typeof token,'string');assert(token.length<=8192);if(!token)return;
    }throw Error('JOB_INVENTORY_BOUND');
  }
  const referenceOptions=options=>{
    if(options===undefined)return{};
    assert(options&&Object.getPrototypeOf(options)===Object.prototype&&Object.keys(options).every(key=>key==='onOperationReference'));
    assert(typeof options.onOperationReference==='function');return{onOperationReference:options.onOperationReference};
  };
  const methods={requireAbsent:absent,
    async getJob(name){const r=await request(local(name));assert.equal(r.status,200);assert.equal(r.value.name,name);return r.value;},
    async listExecutions(name){let token='';const seen=new Set();for(let n=0;n<100;n++){assert(!seen.has(token));seen.add(token);const q=new URLSearchParams({pageSize:'100',showDeleted:'true',...(token?{pageToken:token}:{})});const r=await request(local(name)+'/executions',{query:'?'+q});assert.equal(r.status,200);const rows=r.value.executions??[];assert(Array.isArray(rows));assert.equal(rows.length,0,'PREEXISTING_EXECUTION');token=r.value.nextPageToken??'';assert.equal(typeof token,'string');assert(token.length<=8192);if(!token)return;}throw Error('EXECUTION_INVENTORY_BOUND');},
    async create(name,body,options){assert(JOB.test(name));const r=await request('/jobs',{method:'POST',body,query:'?'+new URLSearchParams({jobId:name.slice((PARENT+'/jobs/').length)}),...referenceOptions(options)});assert.equal(r.status,200);return r.value;},
    async run(name,etag,options){assert.equal(typeof etag,'string');assert(etag.length>0&&etag.length<=256);const r=await request(local(name)+':run',{method:'POST',body:{etag},...referenceOptions(options)});assert.equal(r.status,200);return r.value;},
    async operation(name){assert(NATIVE_OPERATION_PATTERN.test(name));const r=await request(name.slice(PARENT.length));assert.equal(r.status,200);assert.equal(r.value.name,name);return r.value;},
    async execution(name,job){assert(JOB.test(job));assert(name.startsWith(job+'/executions/'));assert(/^[a-z0-9-]+$/u.test(name.slice((job+'/executions/').length)));const r=await request(name.slice(PARENT.length));assert.equal(r.status,200);assert.equal(r.value.name,name);return r.value;},
    async taskNetwork(objective,execution){const spec=readOnlyTaskNetworkRequest(objective,execution),url=new URL(spec.url);const r=await request(url.pathname.slice(('/v2/'+PARENT).length),{query:url.search});assert.equal(r.status,200);return r.value;}
  };
  const checked=handler=>async(...args)=>{
    const began=clock(),before=lastExchange;
    try{return await handler(...args);}
    catch(error){
      if(diagnosticOf(error))throw error;
      const facts=lastExchange!==before?lastExchange:{};
      const diagnostic=await emitDiagnostic(context,{...facts,startedMs:began,endedMs:assertFreshClock(clock,began),phase:'VALIDATION',reason:'VALIDATION_REFUSED'},saveDiagnostic);
      throw new ReadOnlyNativeDiagnosticError(diagnostic);
    }
  };
  return Object.freeze({exchangeObservation:()=>lastExchange,...Object.fromEntries(Object.entries(methods).map(([name,handler])=>[name,checked(handler)]))});
}
const record=(objective,state,extra={})=>({job:objective.jobName,objectiveSha256:objective.objectiveSha256,state,canRetry:false,...extra});
function noExecution(job){
  assert.equal(job.executionCount??0,0,'NO_NATIVE_EXECUTION_REQUIRED');
  const latest=job.latestCreatedExecution;
  assert(latest===undefined||(latest!==null&&Object.getPrototypeOf(latest)===Object.prototype&&Reflect.ownKeys(latest).length===0),'NO_LATEST_EXECUTION_FIELDS_ALLOWED');
}
async function dispatchPreflight({target,stage,authorizeFresh,transport,journal,clock,phase}) {
  const e=target.objective;
  phase('AUTHORITY');await authorizeFresh();phase('VALIDATION');let job;
  if(stage==='CREATE')await transport.requireAbsent(e.jobName);
  else{assert.equal(journal.inspect('CREATE')?.state,'RECONCILED');job=await transport.getJob(e.jobName);validateReadOnlyNativeJob(job,e);assert.equal(job.uid,journal.inspect('CREATE').uid);noExecution(job);await transport.listExecutions(e.jobName);}
  phase('AUTHORITY');const authority=await authorizeFresh();phase('VALIDATION');
  if(stage==='CREATE')await transport.requireAbsent(e.jobName);
  else{const latest=await transport.getJob(e.jobName);validateReadOnlyNativeJob(latest,e);assert.equal(latest.uid,job.uid);assert.equal(latest.etag,job.etag);noExecution(latest);await transport.listExecutions(e.jobName);job=latest;}
  if(job){assert.equal(typeof job.etag,'string');assert(job.etag.length>0&&job.etag.length<=256);}
  const now=clock();phase('AUTHORITY');assertAuthorityCurrent(authority,now);return {job,now};
}
async function invokeAndRecord(input){
  const {e,job,stage,transport,journal,context,state,clock,saveDiagnostic,target}=input;
  const persistReference=(operation,responseSha256)=>{
    assert.equal(state.referenceAttempted,false,'OPERATION_REFERENCE_ALREADY_ATTEMPTED');
    assert(NATIVE_OPERATION_PATTERN.test(operation)&&/^[a-f0-9]{64}$/u.test(responseSha256),'VALID_OPERATION_REFERENCE_REQUIRED');
    state.referenceAttempted=true;state.known=record(e,'OPERATION',{operation,responseSha256,correlationId:context.correlationId,...(job?{uid:job.uid,etag:job.etag}:{})});
    journal.append(stage,state.known);state.referencePersisted=true;
  };
  const options={onOperationReference:persistReference};
  const operation=stage==='CREATE'?await transport.create(e.jobName,target.job,options):await transport.run(e.jobName,job.etag,options);
  if(!NATIVE_OPERATION_PATTERN.test(operation?.name??'')){
    const facts=transport.exchangeObservation?.()??{};
    const diagnostic=await emitDiagnostic(context,{...facts,startedMs:state.began,endedMs:assertFreshClock(clock,state.began),phase:'OPERATION_VALIDATION',reason:Object.hasOwn(operation??{},'name')?'OPERATION_NAME_INVALID':'OPERATION_NAME_ABSENT'},saveDiagnostic);
    const unknown=record(e,'UNKNOWN',{diagnostic});state.finalAppendAttempted=true;journal.append(stage,unknown);return commandResult(unknown);
  }
  if(!state.referenceAttempted)persistReference(operation.name,digest(operation));
  return commandResult(state.known);
}
function dispatchFailureObservation(state,clock){
  let phase=state.dispatchPhase,reason=phase==='AUTHORITY'?'AUTHORITY_REFUSED':'VALIDATION_REFUSED';
  if(state.consumed){phase='HTTP';reason='DISPATCH_FAILED';}
  if((state.referenceAttempted&&!state.referencePersisted)||state.finalAppendAttempted){phase='JOURNAL_PERSISTENCE';reason='OPERATION_REFERENCE_PERSISTENCE_FAILED';}
  return{startedMs:state.began,endedMs:assertFreshClock(clock,state.began),phase,reason,operationReference:state.known?.operation};
}
function retainedReferenceResult(e,state,diagnostic){
  return commandResult({...record(e,state.referencePersisted?'OPERATION':'UNKNOWN'),...(state.referencePersisted?state.known:{}),diagnostic,
    knownOperationReference:state.known?.operation??diagnostic.operationReference,operationReferencePersistence:state.referencePersisted?'PERSISTED':'FAILED'});
}
async function finishDispatchFailure(error,{e,stage,journal,context,state,clock,saveDiagnostic}){
  const diagnostic=diagnosticOf(error)??await emitDiagnostic(context,dispatchFailureObservation(state,clock),saveDiagnostic);
  // Neither failed nor successful operation-reference appends are retried.
  if(state.referenceAttempted)return retainedReferenceResult(e,state,diagnostic);
  const result=record(e,state.consumed?'UNKNOWN':'REFUSED',{diagnostic});
  if(state.finalAppendAttempted)return commandResult({...result,journalOutcomePersistence:'FAILED'});
  if(!state.consumed)return commandResult(result);
  try{journal.append(stage,result);return commandResult(result);}
  catch{return commandResult({...result,journalOutcomePersistence:'FAILED'});}
}
export async function dispatchReadOnlyOnce({dossier,stage,authorizeFresh,transport,journal,clock=Date.now,diagnostic:contextInput,saveDiagnostic}) {
  const target=structuredClone(dossier),e=target.objective;
  const context=diagnosticContext({...contextInput,objectiveSha256:e?.objectiveSha256,stage});
  const state={began:clock(),consumed:false,referenceAttempted:false,referencePersisted:false,finalAppendAttempted:false,dispatchPhase:'VALIDATION'};
  assert(Number.isSafeInteger(state.began));
  const input={target,e,stage,transport,journal,context,state,clock,saveDiagnostic};
  try {
    validateReadOnlyObjective(e);assert(['CREATE','RUN'].includes(stage));assert.equal(typeof authorizeFresh,'function');assert.equal(journal.inspect(stage),null,'CONSUMED_INTENT');
    assert.deepEqual(target.job,{labels:{'crmynov-probe-objective':e.objectiveSha256.slice(0,63)},template:{taskCount:1,parallelism:1,template:e.taskTemplate}},'REVIEWED_CREATE_BODY');
    const {job,now}=await dispatchPreflight({target,stage,authorizeFresh,transport,journal,clock,phase:value=>{state.dispatchPhase=value;}});
    state.dispatchPhase='JOURNAL_PERSISTENCE';
    journal.append(stage,record(e,'INTENT',{at:new Date(now).toISOString(),correlationId:context.correlationId,...(job?{uid:job.uid,etag:job.etag}:{bodySha256:digest(target.job)})}));state.consumed=true;
    return await invokeAndRecord({...input,job});
  } catch(error) {return finishDispatchFailure(error,input);}
}
