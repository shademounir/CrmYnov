// Synthetic transport, authority, body streams and journals only. Never a real token or native service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fixture} from './readonly-native-output-fixture-v1.mjs';
import {digest} from '../controlled-pool-contract-v1.mjs';
import {createReadOnlyNativeTransport,dispatchReadOnlyOnce,openReadOnlyTransactionJournal} from '../pool-native-transaction-v2.mjs';
import {DIAGNOSTIC_FIELDS,diagnosticContext,sanitizedDiagnostic,diagnosticOf,ReadOnlyNativeDiagnosticError,commandResult} from '../readonly-native-diagnostics-v1.mjs';
const OP='projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/synthetic-run';
const now=Date.parse('2026-10-29T12:00:00.000Z'),secret='SYNTHETIC_SECRET_DO_NOT_PERSIST';
const f=fixture('general');
const context=stage=>({correlationId:'01234567-89ab-cdef-0123-456789abcdef',objectiveId:'synthetic-general',objectiveSha256:f.objective.objectiveSha256,stage});
const authority=()=>({entry:{scope:f.objective.purpose},receipt:{verifiedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()}});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function transport(options={}) {
  const records=[],calls={token:0,http:0};
  const value=createReadOnlyNativeTransport({purpose:f.objective.purpose,diagnostic:context('RUN'),getAuthority:authority,clock:()=>now,
    accessToken:async()=>{calls.token++;return'synthetic-token';},fetchImpl:async()=>{calls.http++;return response({name:OP});},saveDiagnostic:async record=>{records.push(record);},...options});
  return{value,records,calls};
}
async function failed(options,reason,phase) {
  const t=transport(options);let caught;
  await assert.rejects(t.value.run(f.objective.jobName,'synthetic-etag'),error=>{caught=diagnosticOf(error);return Boolean(caught);});
  assert.equal(caught.reason,reason);assert.equal(caught.phase,phase);
  assert.deepEqual(Object.keys(caught).sort(),[...DIAGNOSTIC_FIELDS].sort());
  assert(!JSON.stringify(caught).includes(secret));assert.equal(caught.canRetry,false);
  assert.equal(caught.operationAcceptance,'NOT_ESTABLISHED');return {...t,diagnostic:caught};
}
test('initial scope refusal is distinct and does not request a token or invoke HTTP',async()=>{
  const t=await failed({getAuthority:()=>({...authority(),entry:{scope:'SCHEMA_LEDGER_READ_ONLY_V1'}})},'AUTHORITY_REFUSED','AUTHORITY');
  assert.equal(t.calls.token,0);assert.equal(t.calls.http,0);assert.equal(t.diagnostic.transportInvoked,false);
});
test('token acquisition failure retains only a permitted code, never its message or custom fields',async()=>{
  const t=await failed({accessToken:async()=>{throw Object.assign(Error(secret),{code:'ENOTFOUND',authorization:secret,environment:{SECRET:secret}});}},'TOKEN_ACQUISITION_FAILED','TOKEN');
  assert.equal(t.diagnostic.networkCode,'ENOTFOUND');assert.equal(t.diagnostic.httpStatus,null);assert.equal(t.diagnostic.transportInvoked,false);
});
test('invalid token is classified without persisting token bytes',async()=>{await failed({accessToken:async()=>secret+' forbidden whitespace'},'TOKEN_INVALID','TOKEN');});
test('authority is checked after token and before actual POST',async()=>{
  const a=authority();let invoked=0;
  const t=await failed({getAuthority:()=>a,accessToken:async()=>{a.receipt.expiresAt=new Date(now-1).toISOString();return secret;},fetchImpl:async()=>{invoked++;return response({name:OP});}},'AUTHORITY_REFUSED','AUTHORITY');
  assert.equal(invoked,0);assert.equal(t.diagnostic.transportInvoked,false);
});
test('network error preserves invocation and whitelisted code but not unknown acceptance',async()=>{
  const t=await failed({fetchImpl:async()=>{throw Object.assign(Error(secret),{code:'ECONNRESET',body:secret});}},'HTTP_EXCHANGE_FAILED','HTTP');
  assert.equal(t.diagnostic.transportInvoked,true);assert.equal(t.diagnostic.networkCode,'ECONNRESET');
});
test('HTTP 403 retains status and permitted Google code, not raw error body',async()=>{
  const t=await failed({fetchImpl:async()=>response({error:{status:'PERMISSION_DENIED',code:403,message:secret,details:[secret]}},403)},'HTTP_ERROR','DECODE');
  assert.equal(t.diagnostic.httpStatus,403);assert.equal(t.diagnostic.googleCode,'PERMISSION_DENIED');
});
test('unknown provider codes are omitted rather than copied',async()=>{
  const t=await failed({fetchImpl:async()=>response({error:{status:secret,code:secret,message:secret}},500)},'HTTP_ERROR','DECODE');
  assert.equal(t.diagnostic.googleCode,null);assert.equal(t.diagnostic.httpStatus,500);
});
test('lost response after simulated acceptance remains uncertain and never retries',async()=>{
  let accepted=0;
  const t=await failed({timeoutMs:5,fetchImpl:async()=>{accepted++;return new Promise(()=>{});}},'DEADLINE_EXCEEDED','HTTP');
  assert.equal(accepted,1);assert.equal(t.diagnostic.transportInvoked,true);assert.equal(t.diagnostic.operationReference,null);
});
test('token deadline does not permit a later token resolution to invoke HTTP',async()=>{
  let finish,requests=0;
  const t=await failed({timeoutMs:5,accessToken:()=>new Promise(resolve=>{finish=resolve;}),fetchImpl:async()=>{requests++;return response({name:OP});}},'DEADLINE_EXCEEDED','TOKEN');
  finish(secret);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(requests,0);assert.equal(t.diagnostic.transportInvoked,false);
});
test('truncated response is distinct from JSON decoding and retains status',async()=>{
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));controller.error(Object.assign(Error(secret),{code:'UND_ERR_SOCKET'}));}});
  const t=await failed({fetchImpl:async()=>new Response(stream,{status:200,headers:{'content-type':'application/json'}})},'RESPONSE_READ_FAILED','READ');
  assert.equal(t.diagnostic.networkCode,'UND_ERR_SOCKET');assert.equal(t.diagnostic.httpStatus,200);
});
test('malformed UTF8 is a decoding error with no raw bytes in evidence',async()=>{
  await failed({fetchImpl:async()=>new Response(new Uint8Array([0xc3,0x28]),{status:200,headers:{'content-type':'application/json'}})},'RESPONSE_DECODE_FAILED','DECODE');
});
test('invalid JSON is recorded separately',async()=>{await failed({fetchImpl:async()=>new Response('{'+secret,{status:200,headers:{'content-type':'application/json'}})},'RESPONSE_JSON_INVALID','DECODE');});
test('JSON null does not become an operation',async()=>{await failed({fetchImpl:async()=>response(null)},'RESPONSE_SHAPE_INVALID','DECODE');});
test('missing response body is classified without asserting nonacceptance',async()=>{await failed({fetchImpl:async()=>new Response(null,{status:200,headers:{'content-type':'application/json'}})},'RESPONSE_BODY_MISSING','VALIDATION');});
test('wrong response content type is explicit',async()=>{await failed({fetchImpl:async()=>new Response(secret,{status:200,headers:{'content-type':'text/plain'}})},'RESPONSE_CONTENT_TYPE','VALIDATION');});
test('redirected response is refused',async()=>{await failed({fetchImpl:async()=>({status:200,redirected:true})},'RESPONSE_REDIRECTED','VALIDATION');});
test('body bounds remain one MiB and no content enters diagnostic',async()=>{await failed({fetchImpl:async()=>new Response('x'.repeat(1048577),{status:200,headers:{'content-type':'application/json'}})},'RESPONSE_TOO_LARGE','READ');});
test('post-response name validation retains the measured HTTP status',async()=>{
  const t=transport({fetchImpl:async()=>response({name:'wrong',extra:secret})});
  await assert.rejects(t.value.getJob(f.objective.jobName),error=>{const d=diagnosticOf(error);assert.equal(d.phase,'VALIDATION');assert.equal(d.httpStatus,200);assert.equal(d.transportInvoked,true);return true;});
});
test('operation reference callback occurs once before transport returns',async()=>{
  const t=transport();let recorded=false;
  const result=await t.value.run(f.objective.jobName,'etag',{onOperationReference:(name,hash)=>{assert.equal(name,OP);assert.match(hash,/^[a-f0-9]{64}$/u);assert.equal(recorded,false);recorded=true;}});
  assert(recorded);assert.equal(result.name,OP);assert.equal(t.records.length,0);
});
test('arbitrary invocation options cannot override method, body or headers',async()=>{
  const t=transport();for(const key of ['method','body','headers','query'])await assert.rejects(t.value.run(f.objective.jobName,'etag',{[key]:secret}));
  assert.equal(t.calls.http,0);assert.equal(t.calls.token,0);
});
test('deadline may be shorter for qualification but cannot exceed the fixed production bound',()=>{assert.throws(()=>transport({timeoutMs:15001}));assert.throws(()=>transport({timeoutMs:0}));});
test('diagnostic persistence failure is visible and never masks the exchange reason',async()=>{
  const t=await failed({saveDiagnostic:async()=>{throw Error(secret);},fetchImpl:async()=>response({error:{status:'UNAVAILABLE'}},503)},'HTTP_ERROR','DECODE');
  assert.equal(t.diagnostic.diagnosticPersisted,false);assert.equal(t.diagnostic.diagnosticPersistenceFailed,true);
});
function memoryJournal(createState) {
  const rows=[],current=new Map(createState?[['CREATE',createState]]:[]);
  return {rows,inspect:stage=>current.get(stage)??null,append(stage,payload){rows.push({stage,payload:structuredClone(payload)});current.set(stage,structuredClone(payload));}};
}
function runInput(options={}){
  const j=memoryJournal({state:'RECONCILED',uid:f.job.uid});const job={...structuredClone(f.job),executionCount:0,etag:'synthetic-etag'};delete job.latestCreatedExecution;
  const t={getJob:async()=>job,listExecutions:async()=>{},run:async()=>({name:OP})};
  return{dossier:f.dossier,stage:'RUN',authorizeFresh:async()=>authority(),transport:t,journal:j,clock:()=>now,diagnostic:context('RUN'),...options};
}
test('dispatch authority refusal is a completed command with refused operation and no intent',async()=>{
  const input=runInput({authorizeFresh:async()=>{throw Error(secret);}}),r=await dispatchReadOnlyOnce(input);
  assert.equal(r.state,'REFUSED');assert.equal(r.operationOutcome,'REFUSED');assert.equal(r.commandCompleted,true);assert.equal(r.diagnostic.phase,'AUTHORITY');assert.equal(input.journal.rows.length,0);assert(!JSON.stringify(r).includes(secret));
});
for(const [name,operation,reason]of [['absent',{},'OPERATION_NAME_ABSENT'],['invalid',{name:'https://wrong.invalid/'+secret},'OPERATION_NAME_INVALID']])test('dispatch '+name+' operation stays UNKNOWN without retry',async()=>{
  const input=runInput();let posts=0;input.transport.run=async()=>{posts++;return operation;};
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'UNKNOWN');assert.equal(r.operationOutcome,'INDETERMINATE');assert.equal(r.diagnostic.reason,reason);assert.equal(r.canRetry,false);assert.equal(posts,1);assert.equal(input.journal.rows.at(-1).payload.state,'UNKNOWN');
  await dispatchReadOnlyOnce(input);assert.equal(posts,1);assert.equal(input.journal.rows.length,2);
});
test('real V2 missing operation preserves HTTP200 but never claims acceptance',async()=>{
  const t=transport({fetchImpl:async()=>response({arbitrary:secret})}),input=runInput();
  input.transport.run=t.value.run;input.transport.exchangeObservation=t.value.exchangeObservation;
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'UNKNOWN');assert.equal(r.diagnostic.httpStatus,200);assert.equal(r.diagnostic.transportInvoked,true);assert.equal(r.diagnostic.operationAcceptance,'NOT_ESTABLISHED');assert(!JSON.stringify(r).includes(secret));
});
test('diagnostic is durable in UNKNOWN record before returning, with no repeated exchange',async()=>{
  const t=transport({fetchImpl:async()=>{throw Object.assign(Error(secret),{code:'ECONNRESET'});}}),input=runInput();input.transport.run=t.value.run;
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'UNKNOWN');assert.equal(input.journal.rows.at(-1).payload.diagnostic.networkCode,'ECONNRESET');assert.equal(r.diagnostic.diagnosticPersisted,true);assert.equal(t.records.length,1);
});
test('valid operation is journaled before returning and is not mistaken for completed execution',async()=>{
  const input=runInput(),t=transport();input.transport.run=t.value.run;
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'OPERATION');assert.equal(r.operationOutcome,'ACKNOWLEDGED_PENDING');assert.equal(r.operationSucceeded,false);assert.equal(r.requestAcceptance,'ACKNOWLEDGED_OPERATION_REFERENCE');assert.equal(r.transportInvoked,true);assert.equal(r.nativeAcceptance,false);assert.equal(input.journal.rows.at(-1).payload.operation,OP);
});
test('failure after persisted reference never changes it to UNKNOWN',async()=>{
  const input=runInput();let posts=0;
  input.transport.run=async(name,etag,{onOperationReference})=>{posts++;onOperationReference(OP,'a'.repeat(64));throw Error(secret);};
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'OPERATION');assert.equal(r.knownOperationReference,OP);assert.equal(r.operationReferencePersistence,'PERSISTED');assert.equal(input.journal.rows.length,2);assert.equal(posts,1);assert.equal(r.diagnostic.operationAcceptance,'ACKNOWLEDGED_OPERATION_REFERENCE');
});
test('failed operation reference append is never retried and remains an occupied intent',async()=>{
  const input=runInput(),base=input.journal.append;let attempts=0;
  input.journal.append=function(stage,payload){if(payload.state==='OPERATION'){attempts++;throw Error(secret);}return base.call(this,stage,payload);};
  input.transport.run=async(name,etag,{onOperationReference})=>{onOperationReference(OP,'a'.repeat(64));return{name:OP};};
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'UNKNOWN');assert.equal(r.knownOperationReference,OP);assert.equal(r.operationReferencePersistence,'FAILED');assert.equal(attempts,1);assert.equal(input.journal.inspect('RUN').state,'INTENT');assert.equal(r.automaticRetryAllowed,false);
});
test('UNKNOWN append I/O failure is never retried automatically',async()=>{
  const input=runInput(),base=input.journal.append;let attempts=0;
  input.journal.append=function(stage,payload){if(payload.state==='UNKNOWN'){attempts++;throw Error(secret);}return base.call(this,stage,payload);};input.transport.run=async()=>({});
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,'UNKNOWN');assert.equal(r.journalOutcomePersistence,'FAILED');assert.equal(attempts,1);assert.equal(r.automaticRetryAllowed,false);
});
test('an already UNKNOWN journal is refused without native invocation or mutation',async()=>{
  const input=runInput();input.journal.append('RUN',{state:'UNKNOWN',canRetry:false});const prior=JSON.stringify(input.journal.rows);let calls=0;
  input.transport.run=async()=>{calls++;return{name:OP};};const result=await dispatchReadOnlyOnce(input);assert.equal(result.state,'REFUSED');assert.equal(calls,0);assert.equal(JSON.stringify(input.journal.rows),prior);assert.equal(result.canRetry,false);
});
test('diagnostic constructor and extraction project forged or decorated instances at output',()=>{
  const clean=sanitizedDiagnostic(diagnosticContext(context('RUN')),{phase:'HTTP',reason:'HTTP_EXCHANGE_FAILED',startedMs:now,endedMs:now+1,transportInvoked:true});
  const source={...clean,Authorization:secret,token:secret,environment:{SECRET:secret},rawBody:secret};let getterCalls=0;
  Object.defineProperty(source,'privateKey',{get(){getterCalls++;throw Error(secret);},enumerable:true});
  const error=new ReadOnlyNativeDiagnosticError(source);assert.equal(getterCalls,0);assert.equal(diagnosticOf(error).token,undefined);assert.deepEqual(Object.keys(error.diagnostic).sort(),[...DIAGNOSTIC_FIELDS].sort());
  assert.throws(()=>{error.diagnostic=source;},TypeError);
  const forged=Object.create(ReadOnlyNativeDiagnosticError.prototype);Object.defineProperty(forged,'diagnostic',{value:source});assert(!JSON.stringify(diagnosticOf(forged)).includes(secret));
  const malformed=Object.create(ReadOnlyNativeDiagnosticError.prototype);Object.defineProperty(malformed,'diagnostic',{get(){getterCalls++;return source;}});assert.equal(diagnosticOf(malformed),null);assert.equal(getterCalls,0);
});
test('machine result cannot leak a decorated diagnostic or invoke its accessors',()=>{
  const d=sanitizedDiagnostic(context('RUN'),{phase:'TOKEN',reason:'TOKEN_ACQUISITION_FAILED',startedMs:now,endedMs:now});
  const result=commandResult({state:'UNKNOWN',diagnostic:{...d,Authorization:secret}});assert(!JSON.stringify(result).includes(secret));assert.equal(result.diagnosticAvailable,true);
  let calls=0;const untrusted={state:'UNKNOWN'};Object.defineProperty(untrusted,'diagnostic',{get(){calls++;return d;},enumerable:true});assert.throws(()=>commandResult(untrusted),/ACCESSORS_REFUSED/u);assert.equal(calls,0);
});
test('machine output projects business metadata and never exports etag, token, environment or raw body',()=>{
  const result=commandResult({state:'UNKNOWN',objectiveSha256:'a'.repeat(64),job:f.objective.jobName,token:secret,etag:secret,rawBody:{secret},environment:{SECRET:secret},Authorization:secret});
  assert.equal(result.job,f.objective.jobName);assert.equal(result.objectiveSha256,'a'.repeat(64));assert(!JSON.stringify(result).includes(secret));
  for(const key of ['token','etag','rawBody','environment','Authorization'])assert.equal(Object.hasOwn(result,key),false);
  assert.throws(()=>commandResult({state:'UNKNOWN',job:{rawBody:secret}}),/PRIMITIVES_ONLY/u);
  assert.equal(result.requestAcceptance,'NOT_ESTABLISHED');assert.equal(result.transportInvoked,null);
});
for(const [state,outcome,success]of [['UNKNOWN','INDETERMINATE',false],['OPERATION','ACKNOWLEDGED_PENDING',false],['RECONCILED','SUCCEEDED',true],['REFUSED','REFUSED',false],['FAILED','FAILED',false]])test('machine contract distinguishes '+state,()=>{
  const result=commandResult({state});assert.equal(result.commandCompleted,true);assert.equal(result.operationOutcome,outcome);assert.equal(result.operationSucceeded,success);assert.equal(result.resumeAuthorized,false);assert.equal(result.automaticRetryAllowed,false);assert.equal(result.diagnosticAvailable,false);
});
for(const failure of [false,true])test('V2 '+(failure?'UNKNOWN diagnostic':'operation reference')+' survives actual synthetic SQLite close/reopen without a second POST',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crm-v2-diagnostic-synthetic-'));
  let journal=openReadOnlyTransactionJournal({directory,objective:f.objective,initialize:true});t.after(()=>journal.close());
  let posts=0;const tr=transport({diagnostic:context('CREATE'),fetchImpl:async()=>{posts++;if(failure)throw Object.assign(Error(secret),{code:'ECONNRESET'});return response({name:OP});}});
  const input={dossier:f.dossier,stage:'CREATE',authorizeFresh:async()=>authority(),transport:{...tr.value,requireAbsent:async()=>{}},journal,clock:()=>now,diagnostic:context('CREATE')};
  const r=await dispatchReadOnlyOnce(input);assert.equal(r.state,failure?'UNKNOWN':'OPERATION');assert.equal(posts,1);
  journal.close();journal=openReadOnlyTransactionJournal({directory,objective:f.objective});
  const saved=journal.inspect('CREATE');assert.equal(saved.state,r.state);
  if(failure)assert.equal(saved.diagnostic.networkCode,'ECONNRESET');else assert.equal(saved.operation,OP);
  const repeated=await dispatchReadOnlyOnce({...input,journal});assert.equal(repeated.state,'REFUSED');assert.equal(posts,1);assert.equal(journal.inspect('CREATE').state,saved.state);
});
