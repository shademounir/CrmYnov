// Synthetic fetch/stream/clock/budget fixtures only: never network, SDK or SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {simulateImageForwardPublicHttpV2 as simulate} from './operational-forward-cli-v2.mjs';
import {imageJournalDigest as digest} from './journal.mjs';

const API='https://crm-prod-api-synthetic-ew.a.run.app/health/ready';
const WEB='https://crm-prod-web-synthetic-ew.a.run.app/';
const START=Date.parse('2026-10-30T15:00:00.000Z');
const HASH='b'.repeat(64);
const sha=value=>createHash('sha256').update(value).digest('hex');
const alphabetical=(left,right)=>left.localeCompare(right,'en');
const HEALTH=JSON.stringify({service:'api',status:'ok',database:'ready',timestamp:'2026-10-30T15:00:00.000Z'});
const HTML='<html><head><link href="/_next/static/css/main.a1.css"></head><body><script src="/_next/static/chunks/main.a2.js"></script><script src="/_next/static/chunks/main.a2.js"></script></body></html>';

function fixture(options={}){
 const kind=options.kind??'api',url=kind==='api'?API:WEB;
 const raw=options.raw??(kind==='api'?HEALTH:HTML);
 const chunks=options.chunks??[Buffer.from(raw)];
 const state={now:START,guards:0,fetches:0,reads:0,cancels:0,releases:0,stops:[],reserved:[],responses:[],saves:[],fetchInit:null};
 const ticket=Object.freeze({ordinal:1,deadlineAt:START+15000,remainingMs:options.remainingMs??1000});
 const budget={
  inspect:()=>({remainingResponseBytes:options.remainingResponseBytes??20971520,bindingSha256:HASH}),
  reserveRequest:r=>{state.reserved.push(structuredClone(r));if(options.reserveThrows){throw new Error('SYNTHETIC_RESERVATION_REFUSED');}return ticket;},
  recordResponse:(t,r)=>{assert.equal(t,ticket);state.responses.push(structuredClone(r));if(options.recordThrows){throw new Error('SYNTHETIC_DURABLE_RESPONSE_REFUSED');}},
  stop:code=>state.stops.push(code),
 };
 const guard=()=>{state.guards++;if(options.guardThrowsAt===state.guards){throw new Error('SYNTHETIC_GUARD_REFUSED');}};
 const reader={
  async read(){const at=state.reads++;state.now+=10;if(options.readThrowsAt===at){throw new Error('SYNTHETIC_PRIVATE_STREAM_FAILURE');}if(options.pendingRead){return new Promise((resolve,reject)=>state.fetchInit.signal.addEventListener('abort',()=>reject(new Error('SYNTHETIC_ABORTED_READ')),{once:true}));}return at<chunks.length?{done:false,value:new Uint8Array(chunks[at])}:{done:true,value:undefined};},
  async cancel(){state.cancels++;if(options.cancelThrows){throw new Error('SYNTHETIC_PRIVATE_CANCEL_FAILURE');}},
  releaseLock(){state.releases++;},
 };
 const response={
  url:options.finalUrl??url,redirected:options.redirected??false,status:options.status??200,
  headers:{get:name=>{assert.equal(name,'content-type');if(options.headersThrow){throw new Error('SYNTHETIC_PRIVATE_HEADER_FAILURE');}return options.contentType??(kind==='api'?'application/json; charset=utf-8':'text/html; charset=utf-8');}},
  body:{getReader(){if(options.getReaderThrows){throw new Error('SYNTHETIC_PRIVATE_READER_FAILURE');}return reader;}},
 };
 if(options.bodyGetterThrows){Object.defineProperty(response,'body',{get(){throw new Error('SYNTHETIC_PRIVATE_BODY_GETTER_FAILURE');}});}
 if(options.urlGetterThrows){Object.defineProperty(response,'url',{get(){throw new Error('SYNTHETIC_PRIVATE_URL_GETTER_FAILURE');}});}
 const fetchImpl=async(actualUrl,init)=>{state.fetches++;assert.equal(actualUrl,url);state.fetchInit=init;state.now+=40;if(options.fetchThrows){throw new Error('SYNTHETIC_PRIVATE_FETCH_FAILURE');}if(options.pendingFetch){return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('SYNTHETIC_ABORTED_FETCH')),{once:true}));}if(options.nullResponse){return null;}return response;};
 const save=(name,value)=>{state.saves.push({name,value:structuredClone(value)});if(options.saveThrows){throw new Error('SYNTHETIC_SAVE_REFUSED');}return{path:'C:/synthetic-public-http-receipt.json',sha256:'c'.repeat(64)};};
 const input={syntheticOnly:true,kind,url,budget,guard,save,fetchImpl,clock:()=>state.now};
 return{state,raw,chunks,input,run:overrides=>simulate({...input,...overrides})};
}

function assertReleased(f){assert.equal(f.state.cancels,1);assert.equal(f.state.releases,1);assert.equal(f.state.fetchInit.signal.aborted,true);}
function assertNoRawFailureSaved(f){assert(!JSON.stringify(f.state.saves).includes('SYNTHETIC_PRIVATE'));}

test('API health GET has measured dates, exact digest semantics and only an expurgated fixed projection',async()=>{
 const f=fixture(),r=await f.run();
 assert.equal(r.syntheticOnly,true);assert.equal(r.nativeAuthority,false);assert.equal(r.kind,'SOURCE_BOUND_PUBLIC_RUNTIME_GET_V2');
 assert.deepEqual(r.request,{method:'GET',url:API});assert.deepEqual(r.response.projection,{service:'api',status:'ok',database:'ready'});
 assert.equal(r.response.bodySha256,sha(f.raw));assert.equal(r.response.hashMeaning,'DECODED_FETCH_RESPONSE_BODY_NOT_WIRE_BYTES');assert.equal(r.credentialsSent,false);assert.equal(r.sessionBindingSha256,HASH);
 assert.equal(r.requestStartedAt,new Date(START).toISOString());assert.equal(r.responseReceivedAt,new Date(START+60).toISOString());
 assert.deepEqual(f.state.reserved,[{method:'GET',resource:API,requestSha256:digest({method:'GET',url:API})}]);
 assert.deepEqual(f.state.responses,[{responseBytes:Buffer.byteLength(f.raw)}]);assert.equal(f.state.guards,2);assertReleased(f);
});
test('Web HTML keeps only unique public static asset paths, never a raw document',async()=>{
 const f=fixture({kind:'web'}),r=await f.run();
 assert.deepEqual(r.response.projection,{documentKind:'HTML',assetPaths:['/_next/static/css/main.a1.css','/_next/static/chunks/main.a2.js']});
 assert(!JSON.stringify(r).includes('<html>'));assert.equal(r.response.bodySha256,sha(HTML));assertReleased(f);
});
test('GET fetch uses credentials omit, redirect error and only the non-authentication Accept header',async()=>{
 for(const kind of ['api','web']){const f=fixture({kind});await f.run();const i=f.state.fetchInit;if(!i){throw new Error('SYNTHETIC_FETCH_NOT_CALLED');}assert.deepEqual(Object.keys(i).sort(alphabetical),['credentials','headers','method','redirect','signal']);assert.equal(i.credentials,'omit');assert.equal(i.redirect,'error');assert.equal(i.method,'GET');assert.deepEqual(i.headers,{accept:kind==='api'?'application/json':'text/html'});assert.equal(i.signal instanceof AbortSignal,true);}
});
test('the only saved status receipt has explicit synthetic flags and never claims semantic acceptance',async()=>{
 const f=fixture();await f.run();assert.equal(f.state.saves.length,1);const saved=f.state.saves[0];if(!saved){throw new Error('SYNTHETIC_STATUS_NOT_SAVED');}assert.equal(saved.name,'POST-PUBLIC-HTTP-STATUS');
 assert.equal(saved.value.kind,'EXPURGATED_POST_PUBLIC_HTTP_STATUS_V2');assert.equal(saved.value.syntheticOnly,true);assert.equal(saved.value.nativeAuthority,false);assert.equal(saved.value.semanticAcceptance,false);assert.equal(saved.value.credentialsSent,false);assert.equal(saved.value.status,200);assert.equal(saved.value.responseReceivedAt,new Date(START+60).toISOString());assert.equal(saved.value.responseBytes,Buffer.byteLength(f.raw));assert(!Object.hasOwn(saved.value,'body'));
});
test('an initial local guard refusal sends no HTTP and reserves no request',async()=>{const f=fixture({guardThrowsAt:1});await assert.rejects(f.run());assert.equal(f.state.fetches,0);assert.equal(f.state.reserved.length,0);assert.equal(f.state.saves.length,0);});
test('request reservation refusal sends no HTTP',async()=>{const f=fixture({reserveThrows:true});await assert.rejects(f.run());assert.equal(f.state.fetches,0);assert.equal(f.state.saves.length,0);});
test('a final source or lease guard refusal cannot return accepted HTTP proof',async()=>{const f=fixture({guardThrowsAt:2});await assert.rejects(f.run());assert.equal(f.state.saves.length,1);assert.equal(f.state.saves[0].value.semanticAcceptance,false);assertReleased(f);});
test('synthetic entry must be explicit, and invalid kind is refused before HTTP',async()=>{
 const f=fixture();await assert.rejects(f.run({syntheticOnly:false}));await assert.rejects(f.run({kind:'arbitrary'}));assert.equal(f.state.fetches,0);assert.equal(f.state.reserved.length,0);
});
for(const {name,options}of[
 {name:'403',options:{status:403,raw:'SYNTHETIC_PRIVATE_REFUSAL_BODY'}},
 {name:'404',options:{status:404}},{name:'500',options:{status:500}},
 {name:'redirect flag',options:{redirected:true}},{name:'different final URL',options:{finalUrl:'https://synthetic-unrelated.invalid/login'}},
 {name:'wrong API content type',options:{contentType:'text/html'}},{name:'wrong Web content type',options:{kind:'web',contentType:'application/json'}},
 {name:'invalid JSON',options:{raw:'not-json'}},{name:'wrong API service',options:{raw:JSON.stringify({service:'web',status:'ok',database:'ready'})}},
 {name:'nonready database',options:{raw:JSON.stringify({service:'api',status:'ok',database:'not-ready'})}},
 {name:'Web non-HTML',options:{kind:'web',raw:'not-an-html-document'}},{name:'Web no assets',options:{kind:'web',raw:'<html><body>no assets</body></html>'}},
 {name:'Web query parameter in asset',options:{kind:'web',raw:'<html><script src="/_next/static/main.js?access_token=SYNTHETIC_PRIVATE"></script></html>'}},
 {name:'Web fragment in asset',options:{kind:'web',raw:'<html><script src="/_next/static/main.js#fragment"></script></html>'}},
 {name:'Web dynamic asset endpoint',options:{kind:'web',raw:'<html><img src="/_next/image"></html>'}},
]){test('public HTTP acceptance refuses '+name,async()=>{const f=fixture(options);await assert.rejects(f.run());assert.equal(f.state.fetches,1);assert.equal(f.state.fetchInit.signal.aborted,true);if(!options.redirected&&!options.finalUrl){assertReleased(f);}assertNoRawFailureSaved(f);});}
test('403 persists only status/size and no raw error body before semantic rejection',async()=>{const f=fixture({status:403,raw:'SYNTHETIC_PRIVATE_DENIED_BODY'});await assert.rejects(f.run());assert.equal(f.state.saves[0].value.status,403);assert.equal(f.state.saves[0].value.semanticAcceptance,false);assertNoRawFailureSaved(f);assertReleased(f);});
test('body volume above one MiB is refused and durably accounted before stopping',async()=>{const f=fixture({chunks:[Buffer.alloc(1048577,97)]});await assert.rejects(f.run());assert.deepEqual(f.state.responses,[{responseBytes:1048577}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assert.equal(f.state.saves.length,0);assertReleased(f);});
test('body cannot exceed the actually remaining shared response-byte budget',async()=>{const f=fixture({remainingResponseBytes:3,chunks:[Buffer.from('four')]});await assert.rejects(f.run());assert.deepEqual(f.state.responses,[{responseBytes:4}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assertReleased(f);});
test('stream read exception releases its lock and records only bytes really read',async()=>{const f=fixture({chunks:[Buffer.from('partial')],readThrowsAt:1});await assert.rejects(f.run());assert.deepEqual(f.state.responses,[{responseBytes:7}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assertReleased(f);assertNoRawFailureSaved(f);});
test('a failed reader cancel is suppressed without exposing its message, and the lock is still released',async()=>{const f=fixture({cancelThrows:true});const r=await f.run();assert.equal(r.response.status,200);assertReleased(f);assertNoRawFailureSaved(f);});
for(const {name,options,gotReader}of[
 {name:'fetch exception',options:{fetchThrows:true},gotReader:false},{name:'null response',options:{nullResponse:true},gotReader:false},{name:'response URL getter',options:{urlGetterThrows:true},gotReader:false},
 {name:'response body getter',options:{bodyGetterThrows:true},gotReader:false},{name:'getReader exception',options:{getReaderThrows:true},gotReader:false},
 {name:'content-type getter',options:{headersThrow:true},gotReader:true},
]){test('private '+name+' failure is never written as raw evidence',async()=>{const f=fixture(options);await assert.rejects(f.run());assertNoRawFailureSaved(f);assert.equal(f.state.fetchInit.signal.aborted,true);if(gotReader){assertReleased(f);}else{assert.equal(f.state.cancels,0);assert.equal(f.state.releases,0);assert.deepEqual(f.state.responses,[{responseBytes:0}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);}});}
test('timer aborts a pending synthetic fetch and releases the request without retry',async()=>{const f=fixture({remainingMs:5,pendingFetch:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assert.equal(f.state.fetchInit.signal.aborted,true);assert.deepEqual(f.state.responses,[{responseBytes:0}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);});
test('timer aborts a pending body read and still cancels/releases the reader',async()=>{const f=fixture({remainingMs:5,pendingRead:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assertReleased(f);assert.deepEqual(f.state.responses,[{responseBytes:0}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);});
test('status persistence refusal cannot return an accepted proof and does not resend HTTP',async()=>{const f=fixture({saveThrows:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assertReleased(f);});
test('durable response accounting refusal stops without a second HTTP attempt',async()=>{const f=fixture({recordThrows:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assert.equal(f.state.saves.length,0);assertReleased(f);});
test('multiple decoded chunks are hashed and counted together, with no raw chunk receipt',async()=>{const split=20,f=fixture({chunks:[Buffer.from(HEALTH.slice(0,split)),Buffer.from(HEALTH.slice(split))]}),r=await f.run();assert.equal(r.response.bodySha256,sha(HEALTH));assert.deepEqual(f.state.responses,[{responseBytes:Buffer.byteLength(HEALTH)}]);assert.equal(r.responseReceivedAt,new Date(START+70).toISOString());assertReleased(f);});


// Additive BFF V3 pure suites; every original test byte above is preserved.
import bffNodeTest from 'node:test';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';
import {webcrypto} from 'node:crypto';import {ReadableStream} from 'node:stream/web';
import {simulateImageForwardBffReservationV3 as reserveBffV3,simulateImageForwardTwoPublicGetsV3 as twoBffGetsV3,buildImageBffBrowserGetExpressionV3,reconcileImageBffBrowserCaptureV3,simulateImageBffBrowserGetProducerV3} from './operational-forward-cli-v2.mjs';
import {POST_BFF_SOURCE_BINDING_V2} from './post-readiness-v2.mjs';
const bffBudgetFixturesV3=(()=>{
const test=(name,fn)=>bffNodeTest('BFF budget V3 / '+name,fn);const reserve=reserveBffV3,twoGets=twoBffGetsV3;
// Proposal-only pure/fake-port tests. No SDK/Git/GCP/Jira/network/SQL or real
// forward entry. The only writes are two explicit SYNTHETIC wx saver receipts.
const START=Date.parse('2026-10-30T21:00:00.000Z'),BINDING='a'.repeat(64),PLAN='b'.repeat(64),BODYMAX=262144;
const iso=n=>new Date(n).toISOString(),sha=v=>createHash('sha256').update(v).digest('hex');
const GET={method:'GET',resource:'https://run.googleapis.com/v2/projects/crmynov-prod-n7x4q2/locations/europe-west1/services/crm-prod-api',requestSha256:'f'.repeat(64)};
function fixture({expiry=START+600000,actorCount=2}={}){
 const s={now:START,requests:0,bytes:0,first:null,pending:null,stopped:false,stopCode:null,reserveCalls:0,responseCalls:0,stops:[],throwRecord:false};
 const raw={inspect:()=>({schemaVersion:2,kind:'IMAGE_NATIVE_SESSION_BUDGET_STATE_V2',bindingSha256:BINDING,firstNativeAt:s.first,deadlineAt:START+900000,requestsReserved:s.requests,remainingRequests:200-s.requests,totalResponseBytes:s.bytes,remainingResponseBytes:20971520-s.bytes,pendingOrdinal:s.pending?.ordinal??null,stopped:s.stopped,stopCode:s.stopCode,remainingMs:Math.max(0,START+900000-s.now),lastRecordSha256:s.requests?'c'.repeat(64):null}),
  reserveRequest(request){s.reserveCalls++;assert.equal(s.pending,null);assert.equal(request.method,'GET');s.requests++;s.first??=s.now;s.pending=Object.freeze({ordinal:s.requests,deadlineAt:Math.min(START+900000,s.now+15000),remainingMs:15000});return s.pending;},
  recordResponse(ticket,response){s.responseCalls++;assert.equal(ticket,s.pending);s.bytes+=response.responseBytes;s.pending=null;if(s.throwRecord||response.responseBytes>1048576||s.bytes>20971520){s.stopped=true;s.stopCode='RAW_REFUSED';throw Error('SYNTHETIC_RAW_RESPONSE_REFUSAL_AFTER_ACCOUNT');}return raw.inspect();},
  stop(code){s.stops.push(code);s.stopped=true;s.stopCode=code;return raw.inspect();}};
 const input={syntheticOnly:true,rawBudget:raw,sessionBindingSha256:BINDING,leaseExpiresAt:iso(expiry),actorCount,clock:()=>s.now};
 const api=reserve(input);return{s,raw,input,api,step(bytes=0){const ticket=api.budget.reserveRequest(GET);return api.budget.recordResponse(ticket,{responseBytes:bytes});}};
}
function packet(f,{bodyBytes}={}){
 const apiOrigin='https://crm-prod-api-synthetic-ew.a.run.app',webOrigin='https://crm-prod-web-synthetic-ew.a.run.app';
 const actors=[{key:'synthetic-super-admin',role:'SUPER_ADMIN',campusId:'SYNTHETIC-CAMPUS',professionalEmailSha256:sha('synthetic-admin@example.invalid'),identityBasis:'UI_OBSERVED_EXPECTATION_NOT_HTTP_AUTHENTICATION'},{key:'synthetic-manager',role:'MANAGER',campusId:'SYNTHETIC-CAMPUS',professionalEmailSha256:sha('synthetic-manager@example.invalid'),identityBasis:'UI_OBSERVED_EXPECTATION_NOT_HTTP_AUTHENTICATION'}];
 const readiness={recipe:{schemaVersion:2,apiOrigin,webOrigin,upstreamApiOrigin:apiOrigin,sessionSurface:'WEB_BFF',sessionPath:'/api/crm/sessions/current',upstreamSessionPath:'/sessions/current',actors},bffSourceBinding:POST_BFF_SOURCE_BINDING_V2};
 const afterImageObservedAt=iso(START+1000),report=f.api.report(),records=[],measurements=[];
 for(const [i,a]of actors.entries()){
  const requestStartedAt=iso(START+2000+i*200),responseReceivedAt=iso(START+2100+i*200),requestId='SYNTHETIC-BROWSER-REQUEST-'+i;
  // Actual fixture decoded bytes are measured, not re-labelled wire bytes.
  let decodedBody=JSON.stringify({roles:[a.role],scopes:a.role==='SUPER_ADMIN'?[{kind:'GLOBAL'}]:[{kind:'CAMPUS',id:a.campusId}],mustChangeSecret:false,professionalEmail:i?'synthetic-manager@example.invalid':'synthetic-admin@example.invalid'});if(bodyBytes!==undefined){assert(bodyBytes>=Buffer.byteLength(decodedBody));decodedBody+=' '.repeat(bodyBytes-Buffer.byteLength(decodedBody));}
  const record={schemaVersion:2,kind:'OFFICIAL_BROWSER_NETWORK_GET_RESPONSE_V2',requestId,requestStartedAt,responseReceivedAt,observationSurface:'BROWSER_NETWORK_RESPONSE_BODY_NOT_DOM',request:{method:'GET',url:webOrigin+'/api/crm/sessions/current'},response:{status:200,finalUrl:webOrigin+'/api/crm/sessions/current',redirected:false,bodySha256:sha(decodedBody),hashMeaning:'DECODED_NETWORK_RESPONSE_BODY_NOT_WIRE_BYTES',projection:{roles:[a.role],scopes:a.role==='SUPER_ADMIN'?[{kind:'GLOBAL'}]:[{kind:'CAMPUS',id:a.campusId}],mustChangeSecret:false,professionalEmailSha256:a.professionalEmailSha256}}};
  records.push({actorKey:a.key,record});measurements.push({actorKey:a.key,requestId,observationSha256:digest(record),bodySha256:sha(decodedBody),decodedBodyBytes:Buffer.byteLength(decodedBody),requestStartedAt,responseReceivedAt});
 }
 const value={schemaVersion:3,kind:'POST_BROWSER_ROLE_OBSERVATIONS_V3',planSha256:PLAN,afterImageObservedAt,sessionBindingSha256:BINDING,allocationSha256:report.allocationSha256,records,annex:{schemaVersion:1,kind:'MEASURED_EXTERNAL_BFF_RESPONSE_BUDGET_V1',measurementMeaning:'LOCAL_OFFICIAL_BROWSER_DECODED_BODY_MEASUREMENT_NOT_PROVIDER_ATTESTATION',sessionBindingSha256:BINDING,allocationSha256:report.allocationSha256,providerCryptographicSignatureAsserted:false,records:measurements}};
 return{value,context:{readiness,afterImageObservedAt,planSha256:PLAN,now:f.s.now}};
}
function readyPacket(options){const f=fixture();f.step(5);f.s.now=START+4000;const p=packet(f,options);return{f,p};}

test('reservation before first native keeps four methods/14 fields and truthful raw counters',()=>{
 const f=fixture(),report=f.api.report(),state=f.api.budget.inspect();assert.deepEqual(Object.keys(f.api.budget).sort(),['inspect','recordResponse','reserveRequest','stop']);assert.equal(Object.keys(state).length,14);
 assert.equal(state.requestsReserved,0);assert.equal(state.totalResponseBytes,0);assert.equal(state.firstNativeAt,null);assert.equal(state.remainingRequests,198);assert.equal(state.remainingResponseBytes,20447232);assert.equal(state.deadlineAt,START+600000);
 assert.equal(f.s.reserveCalls,0);assert.equal(report.actualBffRequests,null);assert.equal(report.actualBffDecodedBodyBytes,null);assert.equal(report.packetAccepted,false);assert.equal(report.reservedAllowanceIsNotConsumption,true);assert.equal(report.allocation.providerCryptographicSignatureAsserted,false);
});
test('198 native reservations pass and the199th refuses before raw request or network',()=>{
 const f=fixture();for(let i=0;i<198;i++){f.step();}assert.equal(f.s.requests,198);assert.equal(f.s.reserveCalls,198);assert.equal(f.api.budget.inspect().remainingRequests,0);assert.throws(()=>f.api.budget.reserveRequest(GET),/BFF_EXTERNAL_REQUEST_ALLOWANCE_RESERVED/u);assert.equal(f.s.reserveCalls,198);assert.equal(f.raw.inspect().remainingRequests,2);
});
test('one wholeMiB response must fit in addition to the fixed512KiB reservation',()=>{
 const f=fixture();f.step();f.s.bytes=19398656;const ticket=f.api.budget.reserveRequest(GET);f.api.budget.recordResponse(ticket,{responseBytes:1048576});assert.equal(f.s.bytes,20447232);assert.equal(f.api.budget.inspect().remainingResponseBytes,0);assert.equal(f.raw.inspect().remainingResponseBytes,524288);const calls=f.s.reserveCalls;assert.throws(()=>f.api.budget.reserveRequest(GET),/BFF_EXTERNAL_BODY_ALLOWANCE_RESERVED/u);assert.equal(f.s.reserveCalls,calls);
 const g=fixture();g.step();g.s.bytes=19398657;const old=g.s.reserveCalls;assert.throws(()=>g.api.budget.reserveRequest(GET),/BFF_EXTERNAL_BODY_ALLOWANCE_RESERVED/u);assert.equal(g.s.reserveCalls,old);
});
test('raw response bytes are accounted exactly once on oversized or private raw refusal',()=>{
 for(const throwRecord of [false,true]){const f=fixture(),ticket=f.api.budget.reserveRequest(GET);f.s.throwRecord=throwRecord;assert.throws(()=>f.api.budget.recordResponse(ticket,{responseBytes:1048577}));assert.equal(f.s.responseCalls,1);assert.equal(f.s.bytes,1048577);assert.equal(f.s.requests,1);}
});
test('expired lease refuses before reservation but a pending real response is still accounted',()=>{
 const f=fixture({expiry:START+100}),ticket=f.api.budget.reserveRequest(GET);f.s.now=START+101;assert.throws(()=>f.api.budget.recordResponse(ticket,{responseBytes:7}),/BFF_RESERVED_NATIVE_BOUNDARY_EXCEEDED/u);assert.equal(f.s.responseCalls,1);assert.equal(f.s.bytes,7);assert.equal(f.s.stops.length,1);
 const g=fixture();g.s.now=START+600000;assert.equal(g.api.budget.inspect().remainingMs,0);assert.throws(()=>g.api.budget.reserveRequest(GET));assert.equal(g.s.reserveCalls,0);
});
test('allocation cannot be created after a native request or with a different binding',()=>{
 const f=fixture();f.step();assert.throws(()=>reserve(f.input),/BFF_RESERVATION_MUST_PRECEDE_FIRST_NATIVE_REQUEST/u);
 const g=fixture();assert.throws(()=>reserve({...g.input,sessionBindingSha256:'f'.repeat(64)}));assert.throws(()=>reserve({...g.input,actorCount:3}));assert.throws(()=>reserve({...g.input,syntheticOnly:false}));
});
test('returned native ticket clamps the actual request timeout to the current lease',()=>{const f=fixture({expiry:START+100}),ticket=f.api.budget.reserveRequest(GET);assert.equal(ticket.deadlineAt,START+100);assert.equal(ticket.remainingMs,100);assert.equal(f.s.pending.deadlineAt,START+15000);f.api.budget.recordResponse(ticket,{responseBytes:3});assert.equal(f.s.responseCalls,1);assert.equal(f.s.bytes,3);});

test('catch paths cannot account an already attempted response twice, even after raw or lease failure',()=>{for(const rawFailure of [false,true]){const f=fixture({expiry:START+100}),ticket=f.api.budget.reserveRequest(GET);if(rawFailure){f.s.throwRecord=true;}else{f.s.now=START+101;}assert.throws(()=>f.api.budget.recordResponse(ticket,{responseBytes:7}));assert.equal(f.s.responseCalls,1);assert.throws(()=>f.api.budget.recordResponse(ticket,{responseBytes:7}),/BFF_RESPONSE_ALREADY_ATTEMPTED_OR_UNMATCHED/u);assert.equal(f.s.responseCalls,1);assert.equal(f.s.bytes,7);}const g=fixture();assert.throws(()=>g.api.budget.recordResponse({ordinal:1,deadlineAt:START+100,remainingMs:100},{responseBytes:1}),/BFF_RESPONSE_ALREADY_ATTEMPTED_OR_UNMATCHED/u);assert.equal(g.s.responseCalls,0);});

test('accepted packet links two untouchedV2 observations to measured body hashes and current allocation',()=>{

 const {f,p}=readyPacket(),before=structuredClone(p.value),result=f.api.accept(p.value,p.context);assert.deepEqual(p.value,before);assert.equal(result.roles.length,2);assert.equal(result.syntheticOnly,true);assert.equal(result.nativeAuthority,false);assert.equal(result.externalReadBudget.measuredRequests,2);assert(result.externalReadBudget.measuredDecodedBodyBytes<524288);assert.equal(result.externalReadBudget.rawNativeRequests,1);assert.equal(result.externalReadBudget.totalAccountedRequests,3);assert.equal(f.s.requests,1);assert.equal(f.s.reserveCalls,1);assert.equal(result.externalReadBudget.providerCryptographicSignatureAsserted,false);assert.equal(f.api.report().packetAccepted,true);
});
test('two correctly rebound actor records with one observed requestId refuse without namespace invention',()=>{const {f,p}=readyPacket(),id=p.value.records[0].record.requestId;p.value.records[1].record.requestId=id;p.value.annex.records[1].requestId=id;p.value.annex.records[1].observationSha256=digest(p.value.records[1].record);assert.throws(()=>f.api.accept(p.value,p.context),/BFF_DISTINCT_OBSERVED_REQUEST_IDS_REQUIRED/u);assert.equal(f.api.report().packetAccepted,false);assert.equal(f.api.report().actualBffRequests,null);assert.equal(f.s.reserveCalls,1);});

test('two max262144 responses consume the whole reserved512KiB, no fake raw entries',()=>{
 const {f,p}=readyPacket({bodyBytes:BODYMAX}),result=f.api.accept(p.value,p.context);assert.equal(result.externalReadBudget.measuredDecodedBodyBytes,524288);assert.equal(f.s.requests,1);assert.equal(f.s.responseCalls,1);assert.equal(f.api.final().totalAccountedResponseBytes,524293);
});
test('final composition includes later native tail without releasing the conservative reservation',()=>{
 const {f,p}=readyPacket();f.api.accept(p.value,p.context);f.step(9);const result=f.api.final();assert.equal(result.rawNativeRequests,2);assert.equal(result.totalAccountedRequests,4);assert.equal(result.rawNativeResponseBytes,14);assert.equal(f.api.budget.inspect().remainingRequests,196);
});
for(const [name,change]of [
 ['missing annex',p=>{delete p.value.annex;}],['oldV2 fallback',p=>{p.value.schemaVersion=2;p.value.kind='POST_BROWSER_ROLE_OBSERVATIONS_V2';}],['different binding',p=>{p.value.sessionBindingSha256='f'.repeat(64);}],['different allocation',p=>{p.value.allocationSha256='f'.repeat(64);}],['different plan',p=>{p.value.planSha256='f'.repeat(64);}],['different afterImage',p=>{p.value.afterImageObservedAt=iso(START);}],
 ['request mismatch',p=>{p.value.annex.records[0].requestId+='-other';}],['record digest mismatch',p=>{p.value.annex.records[0].observationSha256='f'.repeat(64);}],['body hash mismatch',p=>{p.value.annex.records[0].bodySha256='f'.repeat(64);}],['body over262144',p=>{p.value.annex.records[0].decodedBodyBytes=262145;}],['body zero',p=>{p.value.annex.records[0].decodedBodyBytes=0;}],['body fractional',p=>{p.value.annex.records[0].decodedBodyBytes=1.5;}],
 ['measurement row missing',p=>{p.value.annex.records.pop();}],['duplicated actor',p=>{p.value.annex.records[1].actorKey=p.value.annex.records[0].actorKey;}],['wire hash meaning',p=>{p.value.records[0].record.response.hashMeaning='WIRE_BYTES';}],['fake provider signature',p=>{p.value.annex.providerCryptographicSignatureAsserted=true;}],['fake provider invocation',p=>{p.value.annex.providerInvocationId='SYNTHETIC_NOT_A_REAL_PROVIDER_ID';}],['different source measure',p=>{p.value.annex.measurementMeaning='JSON_RECONSTRUCTION';}],['measurement date mismatch',p=>{p.value.annex.records[0].requestStartedAt=iso(START);}],
 ])test('packet refuses '+name+' without fallback, native request or capacity reuse',()=>{const {f,p}=readyPacket();change(p);assert.throws(()=>f.api.accept(p.value,p.context));assert.equal(f.api.report().packetAccepted,false);assert.equal(f.api.report().actualBffRequests,null);assert.equal(f.s.reserveCalls,1);assert.throws(()=>f.api.accept(packet(f).value,p.context),/BFF_PACKET_ATTEMPT_ALREADY_CONSUMED/u);});
test('crossed common lease or perGET15s rejects even if record digest is recomputed',()=>{
 const {f,p}=readyPacket();f.s.now=START+600000;p.context.now=f.s.now;assert.throws(()=>f.api.accept(p.value,p.context),/BFF_PACKET_OUTSIDE_CURRENT_SESSION/u);
 const q=readyPacket();q.p.value.records[0].record.responseReceivedAt=iso(START+18001);q.p.value.annex.records[0].responseReceivedAt=iso(START+18001);q.p.value.annex.records[0].observationSha256=digest(q.p.value.records[0].record);q.f.s.now=START+19000;q.p.context.now=q.f.s.now;assert.throws(()=>q.f.api.accept(q.p.value,q.p.context),/BFF_MEASURED_REQUEST_OUTSIDE_COMMON_DEADLINE/u);
});
test('unknown raw budget fields or missing packet cannot be silently accepted as success',()=>{
 const f=fixture();f.step();assert.throws(()=>f.api.final());const inspect=f.raw.inspect;f.raw.inspect=()=>({...inspect(),other:true});assert.throws(()=>f.api.budget.inspect());
});
test('no SDK callback or broader capability is accepted by the synthetic seam',()=>{const f=fixture();assert.throws(()=>reserve({...f.input,openSdk:()=>assert.fail('must not run')}));assert.equal(f.s.reserveCalls,0);});
test('a caller cannot hide the real expired clock behind an older supplied packet now',()=>{const {f,p}=readyPacket();f.s.now=START+600001;assert.throws(()=>f.api.accept(p.value,p.context),/BFF_PACKET_OUTSIDE_CURRENT_SESSION/u);assert.equal(f.api.report().packetAccepted,false);});
test('two publicGETs share the real ordinalwx saver: prior collision allegation is explicitly false',async()=>{
 const f=fixture(),outputDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'crm-bff-v3-synthetic-public-saver-'));
 const apiUrl='https://crm-prod-api-synthetic-ew.a.run.app/health/ready',webUrl='https://crm-prod-web-synthetic-ew.a.run.app/';let fetches=0;
 const fetchImpl=async(url,init)=>{fetches++;assert.equal(init.credentials,'omit');const api=url===apiUrl;assert(api||url===webUrl);const bytes=Buffer.from(api?JSON.stringify({service:'api',status:'ok',database:'ready'}):'<html><script src="/_next/static/main.js"></script></html>');let sent=false;return{url,redirected:false,status:200,headers:{get:()=>api?'application/json':'text/html'},body:{getReader:()=>({async read(){f.s.now++;if(sent){return{done:true};}sent=true;return{done:false,value:bytes};},async cancel(){},releaseLock(){}})}};};
 const result=await twoGets({syntheticOnly:true,outputDirectory,apiUrl,webUrl,budget:f.api.budget,guard:()=>{},fetchImpl,clock:()=>f.s.now});
 assert.equal(fetches,2);assert.equal(result.receipts.length,2);assert.notEqual(result.receipts[0].path,result.receipts[1].path);assert.deepEqual(fs.readdirSync(outputDirectory).sort(),['0000-POST-PUBLIC-HTTP-STATUS.json','0001-POST-PUBLIC-HTTP-STATUS.json']);for(const row of result.receipts){const saved=JSON.parse(fs.readFileSync(row.path));assert.equal(saved.syntheticOnly,true);assert.equal(saved.nativeAuthority,false);assert.equal(saved.semanticAcceptance,false);}assert.equal(f.s.requests,2);
});

return{fixture,packet,START,BINDING,PLAN,iso};
})();
const bffProducerFixturesV3=(()=>{
const test=(name,fn)=>bffNodeTest('BFF producer V3 / '+name,fn);const build=buildImageBffBrowserGetExpressionV3,reconcile=reconcileImageBffBrowserCaptureV3,simulate=simulateImageBffBrowserGetProducerV3;
// Executes the actual generated expression only in an isolated VM with fake
// fetch/WebStreams. There is no browser, Cua, CDP, SDK, network, Git or SQL port.
const NOW=Date.parse('2026-10-30T21:45:00.000Z'),ORIGIN='https://crm-prod-web-synthetic-ew.a.run.app',URL=ORIGIN+'/api/crm/sessions/current';
const MARKER='PRIVATE_SYNTHETIC_VALUE_MUST_NOT_APPEAR',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const input=()=>({expectedWebOrigin:ORIGIN,observedCurrentOrigin:ORIGIN,actorKey:'superadmin-casablanca',afterImageObservedAt:new Date(NOW-1000).toISOString(),promptDeadlineAt:NOW+120000,effectiveGlobalLeaseExpiresAt:NOW+900000,sessionBindingSha256:'a'.repeat(64),allocationSha256:'b'.repeat(64)});
const publicValue=()=>({roles:['SUPER_ADMIN','ADMISSIONS'],scopes:[{kind:'GLOBAL'},{kind:'CAMPUS',id:'SYNTHETIC-CAMPUS'}],mustChangeSecret:false,professionalEmail:'synthetic@example.invalid',campusLabel:'Campus synthétique'});
function fixture(options={}){
 const state={now:NOW,calls:[],timers:[],clears:[],cancelCalls:0,releaseCalls:0,aborted:false,headerReads:0};
 const bytes=options.bytes??new TextEncoder().encode(' { "roles": ["SUPER_ADMIN", "ADMISSIONS"], "scopes": [{"kind":"GLOBAL"},{"kind":"CAMPUS","id":"SYNTHETIC-CAMPUS"}], "mustChangeSecret":false, "professionalEmail":"synthetic@example.invalid", "campusLabel":"Campus synthétique" }\n');
 const slices=options.chunks??[bytes.slice(0,11),bytes.slice(11)];let index=0;
 const stream=new ReadableStream({pull(controller){if(options.hangBody){return;}if(options.advancePerPull){state.now+=options.advancePerPull;}if(index<slices.length){controller.enqueue(slices[index++]);}else{controller.close();}},cancel(){}});
 const body={getReader(){const reader=stream.getReader();return{read(){if(options.fireDeadlineAfterBody){queueMicrotask(()=>{const pending=state.timers[0];state.now+=pending.ms;pending.callback();});}return reader.read();},cancel(){state.cancelCalls++;if(options.cancelThrows){throw Error(MARKER);}return reader.cancel();},releaseLock(){state.releaseCalls++;if(options.releaseThrows){throw Error(MARKER);}reader.releaseLock();}};}};
 const response={status:options.status??200,url:options.responseUrl??URL,redirected:options.redirected??false,body:options.noBody?null:body};
 Object.defineProperty(response,'headers',{get(){state.headerReads++;throw Error(MARKER);}});
 class FakeDate extends Date{constructor(value){super(value===undefined?state.now:value);}static now(){return state.now;}}
 const context={Date:FakeDate,TextEncoder,TextDecoder,Uint8Array,AbortController,location:{origin:options.actualOrigin??ORIGIN},crypto:options.cryptoFactory?options.cryptoFactory(state):webcrypto,
  setTimeout(callback,ms){const id={callback,ms};state.timers.push(id);if(options.fireDeadline){queueMicrotask(()=>{state.now+=ms;callback();});}return id;},clearTimeout(id){state.clears.push(id);},
  fetch(url,init){state.calls.push({url,init});init.signal.addEventListener('abort',()=>{state.aborted=true;},{once:true});if(options.foreignError){throw options.foreignError;}if(options.throwFetch){throw Error(MARKER);}if(options.hangFetch){return new Promise(()=>{});}return Promise.resolve(response);}};
 return{state,bytes,environment:context,async run(overrides={}){const generated=build({...input(),...overrides}),result=await vm.runInNewContext(generated.expression,context,{timeout:1000});return{generated,result:JSON.parse(JSON.stringify(result))};},async runDirect(overrides={}){const result=await simulate({syntheticOnly:true,input:{...input(),...overrides},environment:context});assert.equal(result.syntheticOnly,true);assert.equal(result.nativeAuthority,false);return JSON.parse(JSON.stringify(result.result));}};
}
test('actual expression performs one exact bounded GET, hashes original decoded bytes and projects public fields only',async()=>{const f=fixture(),{generated,result}=await f.run();assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].url,URL);const init=f.state.calls[0].init;assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert(!Object.hasOwn(init,'headers'));assert.equal(result.state,'OBSERVED_DECODED_RESPONSE_NOT_PROVIDER_ATTESTATION');assert.equal(result.response.bodySha256,hash(f.bytes));assert.equal(result.response.decodedBodyBytes,f.bytes.byteLength);assert.notEqual(result.response.bodySha256,hash(JSON.stringify(publicValue())));assert.equal(result.response.projection.professionalEmailSha256,hash('synthetic@example.invalid'));assert.equal(result.networkRequestIdGenerated,false);assert(!Object.hasOwn(result,'requestId'));assert.equal(generated.nativeAuthority,false);assert.equal(f.state.headerReads,0);assert.equal(f.state.cancelCalls,1);assert.equal(f.state.releaseCalls,1);assert.equal(f.state.clears.length,1);assert(f.state.aborted);assert(!JSON.stringify(result).includes('synthetic@example.invalid'));});
test('returned hashes use exact UTF8 bytes including multibyte characters and noncanonical whitespace',async()=>{const bytes=new TextEncoder().encode(JSON.stringify(publicValue(),null,3)+'\n'),f=fixture({bytes}),{result}=await f.run();assert.equal(result.response.bodySha256,hash(bytes));assert.equal(result.response.decodedBodyBytes,bytes.length);});
test('exact limit can succeed without keeping raw padding or JSON content',async()=>{const prefix=JSON.stringify(publicValue()),bytes=new TextEncoder().encode(prefix+' '.repeat(262144-new TextEncoder().encode(prefix).length)),f=fixture({bytes}),{result}=await f.run();assert.equal(result.response.decodedBodyBytes,262144);assert.equal(result.response.bodySha256,hash(bytes));});
test('oversize decoded body aborts during stream consumption before copying an extra chunk',async()=>{const f=fixture({chunks:[new Uint8Array(262144),new Uint8Array(1)]}),{result}=await f.run();assert.equal(result.code,'DECODED_BODY_LIMIT_EXCEEDED');assert.equal(result.decodedBodyBytesObserved,262145);assert.equal(result.retainedDecodedBodyBytes,262144);assert.equal(f.state.calls.length,1);assert(f.state.aborted);assert.equal(f.state.cancelCalls,1);assert(!JSON.stringify(result).includes(MARKER));});
test('one oversize chunk is observed honestly but refused before its bytes enter the retained decoded total',async()=>{const f=fixture({chunks:[new Uint8Array(262145)]}),{result}=await f.run();assert.equal(result.code,'DECODED_BODY_LIMIT_EXCEEDED');assert.equal(result.decodedBodyBytesObserved,262145);assert.equal(result.retainedDecodedBodyBytes,0);});
for(const [name,options,code]of [['redirect',{redirected:true},'REDIRECT_OR_ORIGIN_REFUSED'],['final-origin',{responseUrl:'https://example.invalid/'},'REDIRECT_OR_ORIGIN_REFUSED'],['http403',{status:403},'HTTP_STATUS_REFUSED'],['http500',{status:500},'HTTP_STATUS_REFUSED'],['missing-body',{noBody:true},'BODY_STREAM_REQUIRED'],['fetch-error',{throwFetch:true},'BROWSER_GET_OR_STREAM_REFUSED']]){test('single fetch refuses '+name+' without raw error or retry',async()=>{const f=fixture(options),{result}=await f.run();assert.equal(result.code,code);assert.equal(result.state,'REFUSED_NO_RETRY');assert.equal(f.state.calls.length,1);assert(!JSON.stringify(result).includes(MARKER));});}
test('actual current-origin mismatch refuses before the only fetch',async()=>{const f=fixture({actualOrigin:'https://example.invalid'}),{result}=await f.run();assert.equal(result.code,'CURRENT_ORIGIN_REFUSED');assert.equal(f.state.calls.length,0);assert.equal(result.fetchDispatched,false);});
for(const [name,overrides,cap]of [['request-cap',{},15000],['prompt-cap',{promptDeadlineAt:NOW+47},47],['effective-global-lease-cap',{effectiveGlobalLeaseExpiresAt:NOW+29},29]]){test('minimum deadline '+name+' aborts a hanging fetch without extending or retrying',async()=>{const f=fixture({fireDeadline:true,hangFetch:true}),{result}=await f.run(overrides);assert.equal(result.code,'DEADLINE_EXCEEDED');assert.equal(f.state.calls.length,1);assert.equal(f.state.timers[0].ms,cap);assert.equal(f.state.clears.length,1);assert(f.state.aborted);});}
test('deadline also aborts a hanging body read after response headers, not only fetch headers',async()=>{const f=fixture({fireDeadlineAfterBody:true,hangBody:true}),{result}=await f.run();assert.equal(result.code,'DEADLINE_EXCEEDED');assert.equal(result.stage,'READ_BODY');assert.equal(f.state.calls.length,1);assert.equal(f.state.cancelCalls,1);assert(f.state.aborted);});
test('expired prompt refuses before fetch and does not create a deadline timer',async()=>{const f=fixture(),{result}=await f.run({promptDeadlineAt:NOW});assert.equal(result.code,'DEADLINE_EXCEEDED');assert.equal(f.state.calls.length,0);assert.equal(f.state.timers.length,0);});
test('future after-image timestamp refuses before fetch',async()=>{const f=fixture(),{result}=await f.run({afterImageObservedAt:new Date(NOW+1).toISOString()});assert.equal(result.code,'POST_RUNTIME_TIME_REFUSED');assert.equal(f.state.calls.length,0);});
for(const [name,bytes,code]of [['empty',new Uint8Array(),'JSON_DECODE_REFUSED'],['non-json',new TextEncoder().encode(MARKER),'JSON_DECODE_REFUSED'],['invalid-utf8',new Uint8Array([255]),'JSON_DECODE_REFUSED'],['array',new TextEncoder().encode('[]'),'JSON_SHAPE_REFUSED']]){test('body decoding refuses '+name+' without retaining payload',async()=>{const f=fixture({bytes}),{result}=await f.run();assert.equal(result.code,code);assert(!JSON.stringify(result).includes(MARKER));});}
for(const [name,mutate]of [['extra-token',v=>{v.token=MARKER;}],['missing-email',v=>{delete v.professionalEmail;}],['roles-string',v=>{v.roles='SUPER_ADMIN';}],['duplicate-role',v=>{v.roles=['SUPER_ADMIN','SUPER_ADMIN'];}],['role-control',v=>{v.roles=['SUPER_ADMIN\n'];}],['scope-extra',v=>{v.scopes=[{kind:'GLOBAL',secret:MARKER}];}],['scope-invalid-kind',v=>{v.scopes=[{kind:'UNKNOWN'}];}],['scope-no-id',v=>{v.scopes=[{kind:'CAMPUS'}];}],['must-change-type',v=>{v.mustChangeSecret='false';}],['email-not-string',v=>{v.professionalEmail=null;}]]){test('public session projection refuses '+name,async()=>{const value=publicValue();mutate(value);const f=fixture({bytes:new TextEncoder().encode(JSON.stringify(value))}),{result}=await f.run();assert.equal(result.code,'JSON_SHAPE_REFUSED');assert(!JSON.stringify(result).includes(MARKER));});}
test('mustChangeSecret true is faithfully projected, never changed to false for acceptance',async()=>{const value=publicValue();value.mustChangeSecret=true;const f=fixture({bytes:new TextEncoder().encode(JSON.stringify(value))}),{result}=await f.run();assert.equal(result.response.projection.mustChangeSecret,true);});
for(const [name,mutate]of [['extra',v=>{v.requestId='invented';}],['api-origin',v=>{v.expectedWebOrigin='https://crm-prod-api-synthetic-ew.a.run.app';v.observedCurrentOrigin=v.expectedWebOrigin;}],['custom-origin',v=>{v.expectedWebOrigin='https://example.invalid';v.observedCurrentOrigin=v.expectedWebOrigin;}],['origin-path',v=>{v.expectedWebOrigin+='/admin';v.observedCurrentOrigin=v.expectedWebOrigin;}],['origin-query',v=>{v.expectedWebOrigin+='?secret=x';v.observedCurrentOrigin=v.expectedWebOrigin;}],['origin-mismatch',v=>{v.observedCurrentOrigin='https://example.invalid';}],['actor-injection',v=>{v.actorKey='x);fetch(1)';}],['null-allocation',v=>{v.allocationSha256=null;}],['float-deadline',v=>{v.promptDeadlineAt+=0.5;}],['bad-date',v=>{v.afterImageObservedAt='not-a-date';}]]){test('generator refuses '+name+' without producing code or issuing fetch',()=>{const value=input();mutate(value);assert.throws(()=>build(value));});}
test('host input getter is refused without evaluating it',()=>{let calls=0;const value=input();Object.defineProperty(value,'actorKey',{get(){calls++;return 'superadmin-casablanca';}});assert.throws(()=>build(value));assert.equal(calls,0);});
test('generator does not manufacture a provider ID, read secret-bearing browser surfaces or define any retry/fallback port',()=>{const generated=build(input());assert.equal(generated.networkRequestIdGenerated,false);assert.equal(generated.providerCryptographicSignatureAsserted,false);assert(generated.requiredExternalEvidence.includes('loadingFinished'));for(const forbidden of ['document.cookie','localStorage','sessionStorage','Authorization','getResponseHeader','response.headers','randomUUID']){assert(!generated.expression.includes(forbidden));}assert.equal((generated.expression.match(/environment\.fetch\(/gu)??[]).length,1);});
test('wall-clock revalidation accounts delivered late bytes then refuses before copying them',async()=>{const f=fixture({advancePerPull:8000}),{result}=await f.run();assert.equal(result.code,'DEADLINE_EXCEEDED');assert.equal(f.state.calls.length,1);assert(result.decodedBodyBytesObserved>result.retainedDecodedBodyBytes);assert(f.state.aborted);});
test('hashing and projection are inside the same absolute envelope, not a new post-read lease',async()=>{const f=fixture({cryptoFactory:state=>({subtle:{async digest(...args){const output=await webcrypto.subtle.digest(...args);state.now+=15001;return output;}}})}),{result}=await f.run();assert.equal(result.code,'DEADLINE_EXCEEDED');assert.equal(result.stage,'HASH_BODY');assert.equal(f.state.calls.length,1);});
test('foreign exceptions are never read through message, stack or code getters',async()=>{let getters=0;const foreign={};for(const key of ['message','stack','code','closedCode']){Object.defineProperty(foreign,key,{get(){getters++;throw Error(MARKER);}});}const f=fixture({foreignError:foreign}),{result}=await f.run();assert.equal(result.code,'BROWSER_GET_OR_STREAM_REFUSED');assert.equal(getters,0);assert(!JSON.stringify(result).includes(MARKER));});
test('non-byte stream chunk is refused rather than stringified or re-encoded',async()=>{const f=fixture({chunks:[MARKER]}),{result}=await f.run();assert.equal(result.code,'BODY_CHUNK_REFUSED');assert.equal(result.decodedBodyBytesObserved,0);assert(!JSON.stringify(result).includes(MARKER));});

const localContext={kind:'LOCAL_OBSERVED_CUA_TAB_CDP_BINDING_V1',browserId:'SYNTHETIC-LOCAL-BROWSER',boundTabId:'SYNTHETIC-LOCAL-TAB-HANDLE',providerTabId:'123',cdpTarget:null};
const eventSource={extensionId:'SYNTHETIC-EXTENSION',sessionId:null,tabId:123,targetId:null},networkId='SYNTHETIC-NETWORK-REQUEST-NOT-A-PROVIDER-OBSERVATION';
function fakeCapture(){return{schemaVersion:1,kind:'SAFE_LOCAL_CDP_NETWORK_EVENT_PROJECTION_V1',localContext:structuredClone(localContext),providerSource:structuredClone(eventSource),providerSourceNormalization:'DOCUMENTED_OPTIONALS_ABSENT_TO_LOCAL_NULL_NOT_PROVIDER_NULL',cursorStart:10,cursorEnd:13,truncated:false,hasMore:false,events:[
 {method:'Network.requestWillBeSent',sequence:11,providerSource:structuredClone(eventSource),requestId:networkId,timestamp:1000,wallTime:NOW/1000,url:URL,requestMethod:'GET',redirectResponsePresent:false},
 {method:'Network.responseReceived',sequence:12,providerSource:structuredClone(eventSource),requestId:networkId,timestamp:1000,url:URL,status:200},
 {method:'Network.loadingFinished',sequence:13,providerSource:structuredClone(eventSource),requestId:networkId,timestamp:1000},
]};}
async function correlationFixture(){const {result}=await fixture().run();return{producerResult:result,requestInput:input(),captureContext:structuredClone(localContext),capture:fakeCapture(),now:NOW+10};}
test('actual generated producer result composes with three explicitly SYNTHETIC safe events and preserves supplied ID only',async()=>{const value=await correlationFixture(),before=JSON.stringify(value),result=reconcile(value);assert.equal(result.observation.record.requestId,networkId);assert.equal(result.measurement.requestId,networkId);assert.equal(result.measurement.observationSha256,digest(result.observation.record));assert.equal(result.measurement.bodySha256,value.producerResult.response.bodySha256);assert.equal(result.measurement.decodedBodyBytes,value.producerResult.response.decodedBodyBytes);assert.equal(result.observation.record.responseReceivedAt,new Date(NOW).toISOString());assert.equal(result.responseReceivedAtMeaning,'FULL_BODY_NETWORK_LOADING_FINISHED_NOT_HEADER_EVENT');assert.equal(result.providerOriginAuthenticatedByThisPureFunction,false);assert.equal(result.nativeAuthority,false);assert.equal(JSON.stringify(value),before);});
test('full-body end derives from loadingFinished monotonic delta, not earlier headers or local-body relabelling',async()=>{const value=await correlationFixture();value.producerResult.localTiming.bodyReadCompletedAt=new Date(NOW+10).toISOString();value.producerResult.localTiming.projectionCompletedAt=new Date(NOW+10).toISOString();value.capture.events[1].timestamp=1000.001;value.capture.events[2].timestamp=1000.005;value.now=NOW+20;const result=reconcile(value);assert.equal(result.observation.record.responseReceivedAt,new Date(NOW+5).toISOString());assert.notEqual(result.observation.record.responseReceivedAt,value.producerResult.localTiming.bodyReadCompletedAt);});
for(const [name,mutate]of [
 ['truncated',v=>{v.capture.truncated=true;}],['hasMore',v=>{v.capture.hasMore=true;}],['empty',v=>{v.capture.events=[];}],['missing-finished',v=>{v.capture.events.pop();}],['duplicate-identical-request',v=>{v.capture.events.unshift(structuredClone(v.capture.events[0]));}],['loading-failed',v=>{v.capture.events[2].method='Network.loadingFailed';}],
 ['before-cursor',v=>{v.capture.cursorStart=11;}],['cursor-end',v=>{v.capture.cursorEnd=12;}],['nonadvancing-seq',v=>{v.capture.events[2].sequence=12;}],['event-order',v=>{v.capture.events.reverse();}],['requestId-mismatch',v=>{v.capture.events[1].requestId='DIFFERENT-ACTUAL-ID';}],['requestId-control',v=>{v.capture.events[0].requestId='bad\n';}],
 ['wrong-tab',v=>{v.capture.events[1].providerSource.tabId=124;}],['wrong-session',v=>{v.capture.events[2].providerSource.sessionId='OTHER';}],['wrong-envelope-source',v=>{v.capture.providerSource.extensionId='OTHER';}],['unsafe-header-field',v=>{v.capture.events[0].headers={authorization:MARKER};}],['raw-response-field',v=>{v.capture.events[1].rawBody=MARKER;}],['encoded-length-substitution',v=>{v.capture.events[2].encodedDataLength=12;}],
 ['redirect-response-present',v=>{v.capture.events[0].redirectResponsePresent=true;}],['request-method',v=>{v.capture.events[0].requestMethod='POST';}],['request-url',v=>{v.capture.events[0].url=ORIGIN+'/admin';}],['response-url',v=>{v.capture.events[1].url='https://example.invalid';}],['response-status',v=>{v.capture.events[1].status=403;}],
 ['missing-wallTime',v=>{delete v.capture.events[0].wallTime;}],['nonfinite-monotonic',v=>{v.capture.events[0].timestamp=NaN;}],['reversed-time',v=>{v.capture.events[2].timestamp=999;}],['headers-after-finish',v=>{v.capture.events[1].timestamp=1001;}],['more-than15s',v=>{v.capture.events[2].timestamp=1015.001;}],['body-outside-local-complete',v=>{v.capture.events[2].timestamp=1000.001;}],['request-before-dispatch',v=>{v.capture.events[0].wallTime=(NOW-1)/1000;}],
 ['expired-common-lease',v=>{v.now=v.requestInput.effectiveGlobalLeaseExpiresAt;}],['expired-prompt',v=>{v.now=v.requestInput.promptDeadlineAt;}],['false-source-attestation',v=>{v.producerResult.providerCryptographicSignatureAsserted=true;}],['local-actor-drift',v=>{v.producerResult.localBinding.actorKey='other-actor';}],['local-allocation-drift',v=>{v.producerResult.localBinding.allocationSha256='c'.repeat(64);}],['local-session-drift',v=>{v.producerResult.localBinding.sessionBindingSha256='c'.repeat(64);}],
 ['wrong-hash',v=>{v.producerResult.response.bodySha256='not-a-hash';}],['oversize-success',v=>{v.producerResult.response.decodedBodyBytes=262145;}],['missing-byte-count',v=>{delete v.producerResult.response.decodedBodyBytes;}],['local-projection-after-deadline',v=>{v.producerResult.localTiming.projectionCompletedAt=v.producerResult.localTiming.deadlineAt;}],['invented-provider-ID-in-producer',v=>{v.producerResult.requestId='invented';}],
]){test('safe event/producer correlation refuses '+name,async()=>{const value=await correlationFixture();mutate(value);assert.throws(()=>reconcile(value));});}
test('closed producer failure cannot be promoted into an observation or measured success annex',async()=>{const value=await correlationFixture(),{result}=await fixture({status:500}).run();value.producerResult=result;assert.throws(()=>reconcile(value));});

const directCases=[
 ['success',{},null],['overflow-first',{chunks:[new Uint8Array(262145)]},'DECODED_BODY_LIMIT_EXCEEDED'],['overflow-cumulative',{chunks:[new Uint8Array(262144),new Uint8Array(1)]},'DECODED_BODY_LIMIT_EXCEEDED'],
 ['redirect',{redirected:true},'REDIRECT_OR_ORIGIN_REFUSED'],['response-url',{responseUrl:'https://example.invalid/'},'REDIRECT_OR_ORIGIN_REFUSED'],['http403',{status:403},'HTTP_STATUS_REFUSED'],['http500',{status:500},'HTTP_STATUS_REFUSED'],['body-absent',{noBody:true},'BODY_STREAM_REQUIRED'],['bad-chunk',{chunks:[MARKER]},'BODY_CHUNK_REFUSED'],
 ['fetch-error',{throwFetch:true},'BROWSER_GET_OR_STREAM_REFUSED'],['actual-origin',{actualOrigin:'https://example.invalid'},'CURRENT_ORIGIN_REFUSED'],['hanging-fetch',{fireDeadline:true,hangFetch:true},'DEADLINE_EXCEEDED'],['hanging-body',{fireDeadlineAfterBody:true,hangBody:true},'DEADLINE_EXCEEDED'],['late-chunk',{advancePerPull:8000},'DEADLINE_EXCEEDED'],
 ['non-json',{bytes:new TextEncoder().encode(MARKER)},'JSON_DECODE_REFUSED'],['invalid-utf8',{bytes:new Uint8Array([255])},'JSON_DECODE_REFUSED'],['json-shape',{bytes:new TextEncoder().encode('[]')},'JSON_SHAPE_REFUSED'],['cleanup-throws',{cancelThrows:true,releaseThrows:true},null],
];
for(const [name,options,code]of directCases){test('direct STRICT_SYNTHETIC seam covers the SAME body: '+name,async()=>{const f=fixture(options),result=await f.runDirect();if(code){assert.equal(result.code,code);}else{assert.equal(result.state,'OBSERVED_DECODED_RESPONSE_NOT_PROVIDER_ATTESTATION');assert.equal(result.response.bodySha256,hash(f.bytes));}assert(f.state.calls.length<=1);assert(!JSON.stringify(result).includes(MARKER));});}
for(const [name,mutate]of [['unknown-field',v=>{v.token=MARKER;}],['roles',v=>{v.roles=[];}],['scope-kind',v=>{v.scopes=[{kind:'UNKNOWN'}];}],['scope-id',v=>{v.scopes=[{kind:'CAMPUS'}];}],['email',v=>{v.professionalEmail=null;}]]){test('direct body projection refusal: '+name,async()=>{const value=publicValue();mutate(value);const result=await fixture({bytes:new TextEncoder().encode(JSON.stringify(value))}).runDirect();assert.equal(result.code,'JSON_SHAPE_REFUSED');});}
test('direct body before-dispatch expiry and future-image checks do not invoke fetch',async()=>{for(const overrides of [{promptDeadlineAt:NOW},{afterImageObservedAt:new Date(NOW+1).toISOString()}]){const f=fixture(),result=await f.runDirect(overrides);assert.equal(result.fetchDispatched,false);assert.equal(f.state.calls.length,0);}});
test('direct body remains inside absolute envelope while hashing and never reads foreign exception getters',async()=>{const f=fixture({cryptoFactory:state=>({subtle:{async digest(...args){const result=await webcrypto.subtle.digest(...args);state.now+=15001;return result;}}})});assert.equal((await f.runDirect()).code,'DEADLINE_EXCEEDED');let calls=0;const foreign={};Object.defineProperty(foreign,'closedCode',{get(){calls++;throw Error(MARKER);}});assert.equal((await fixture({foreignError:foreign}).runDirect()).code,'BROWSER_GET_OR_STREAM_REFUSED');assert.equal(calls,0);});
test('direct simulation rejects missing marker, global environment and ambient native fetch identity',async()=>{const f=fixture();await assert.rejects(()=>simulate({syntheticOnly:false,input:input(),environment:f.environment}));await assert.rejects(()=>simulate({syntheticOnly:true,input:input(),environment:globalThis}));const environment={...f.environment,fetch:globalThis.fetch};await assert.rejects(()=>simulate({syntheticOnly:true,input:input(),environment}));});

function replaceProviderSource(value,source){value.capture.providerSource=structuredClone(source);for(const event of value.capture.events){event.providerSource=structuredClone(source);}value.capture.localContext=structuredClone(value.captureContext);}
test('documented parent-tab route omits target locally and accepts absent provider session/target without inventing them',async()=>{const value=await correlationFixture(),result=reconcile(value);assert.equal(value.captureContext.cdpTarget,null);assert.equal(value.capture.providerSource.sessionId,null);assert.equal(value.capture.providerSource.targetId,null);assert.deepEqual(result.sourceAssociation.anchors,['LOCAL_CANONICAL_DECIMAL_PROVIDER_TAB_ID_MATCH']);assert(result.sourceAssociation.nullProviderFieldsMean.includes('NOT_PROVIDER_NULL'));assert(!Object.hasOwn(value.capture.providerSource,'browserId'));assert.equal(result.observation.record.requestId,networkId);});
for(const key of ['sessionId','targetId']){test('actual explicit child selector can bind solely through documented '+key,async()=>{const value=await correlationFixture();value.captureContext.providerTabId=null;value.captureContext.cdpTarget={[key]:'SYNTHETIC-OBSERVED-'+key};replaceProviderSource(value,{extensionId:null,tabId:null,sessionId:null,targetId:null,[key]:'SYNTHETIC-OBSERVED-'+key});const result=reconcile(value);assert.deepEqual(result.sourceAssociation.anchors,['ACTUAL_EXPLICIT_CDP_TARGET_'+key]);});}
for(const [name,mutate]of [
 ['all-optional-anchors-absent',v=>{replaceProviderSource(v,{extensionId:null,sessionId:null,tabId:null,targetId:null});}],['extension-only',v=>{replaceProviderSource(v,{extensionId:'OBSERVED-EXTENSION',sessionId:null,tabId:null,targetId:null});}],
 ['provider-browser-id-invented',v=>{v.capture.providerSource.browserId='NOT-A-DOCUMENTED-PROVIDER-FIELD';}],['provider-tab-string-instead-of-number',v=>{replaceProviderSource(v,{...eventSource,tabId:'123'});}],['provider-tab-unsafe-number',v=>{replaceProviderSource(v,{...eventSource,tabId:Number.MAX_SAFE_INTEGER+1});}],['provider-tab-negative',v=>{replaceProviderSource(v,{...eventSource,tabId:-1});}],
 ['local-provider-tab-nondecimal',v=>{v.captureContext.providerTabId='opaque-id';v.capture.localContext=structuredClone(v.captureContext);}],['local-provider-tab-leading-zero',v=>{v.captureContext.providerTabId='0123';v.capture.localContext=structuredClone(v.captureContext);}],['local-provider-tab-mismatch',v=>{v.captureContext.providerTabId='124';v.capture.localContext=structuredClone(v.captureContext);}],
 ['boundtab-is-not-provider-fallback',v=>{v.captureContext.boundTabId='123';v.captureContext.providerTabId=null;v.capture.localContext=structuredClone(v.captureContext);}],['local-context-drift',v=>{v.capture.localContext.boundTabId='ANOTHER-TAB';}],['provider-null-meaning-omitted',v=>{delete v.capture.providerSourceNormalization;}],['caller-association-boolean',v=>{v.captureContext.associationVerified=true;}],
 ['child-session-not-observed',v=>{v.captureContext.cdpTarget={sessionId:'SYNTHETIC-CHILD'};v.capture.localContext=structuredClone(v.captureContext);}],['child-selector-both-fields',v=>{v.captureContext.cdpTarget={sessionId:'SYNTHETIC',targetId:'SYNTHETIC'};v.capture.localContext=structuredClone(v.captureContext);}],
]){test('documented local/provider source association refuses '+name,async()=>{const value=await correlationFixture();mutate(value);assert.throws(()=>reconcile(value));});}

function tabScopedV2(value){value.captureContext={...value.captureContext,kind:'LOCAL_OBSERVED_CUA_TAB_CDP_BINDING_V2',route:'DOCUMENTED_TAB_SCOPED_CDP',associationBasis:'LOCAL_OBSERVED_CANONICAL_TAB_SCALAR_CORRESPONDENCE',boundTabId:'123',providerTabId:'["SYNTHETIC-OPAQUE-UNPARSED","123"]',cdpTarget:null};value.capture.localContext=structuredClone(value.captureContext);return value;}
test('explicit V2 tab-scoped route uses observed LOCAL Tab.id correspondence, not opaque providerTabId parsing',async()=>{const value=tabScopedV2(await correlationFixture()),before=structuredClone(value),result=reconcile(value);assert.deepEqual(result.sourceAssociation.anchors,['LOCAL_OBSERVED_TAB_SCOPED_CANONICAL_TAB_SCALAR_CORRESPONDENCE']);assert.equal(result.sourceAssociation.opaqueProviderTabIdParsed,false);assert(result.sourceAssociation.localAssociationBasis.includes('NOT_PROVIDER_ATTESTATION'));assert.deepEqual(value,before);assert.equal(result.observation.record.requestId,networkId);assert.equal(result.providerOriginAuthenticatedByThisPureFunction,false);});
test('V2 does not inspect opaque providerTabId components or infer extension UUID semantics',async()=>{const value=tabScopedV2(await correlationFixture());value.captureContext.providerTabId='not even JSON; opaque unchanged';value.capture.localContext=structuredClone(value.captureContext);assert.equal(reconcile(value).measurement.requestId,networkId);});
test('explicit context dispatch refuses a kind getter without evaluating it',async()=>{const value=tabScopedV2(await correlationFixture());let evaluated=0;Object.defineProperty(value.captureContext,'kind',{get(){evaluated++;throw Error(MARKER);}});assert.throws(()=>reconcile(value));assert.equal(evaluated,0);});
test('V2 exact correspondence does not require an optional providerTabId field to be present',async()=>{const value=tabScopedV2(await correlationFixture());value.captureContext.providerTabId=null;value.capture.localContext=structuredClone(value.captureContext);assert.equal(reconcile(value).measurement.requestId,networkId);});
for(const [name,change]of [
 ['route missing',v=>{delete v.captureContext.route;}],['route other',v=>{v.captureContext.route='INFERRED_PROVIDER_UUID_ROUTE';}],['basis missing',v=>{delete v.captureContext.associationBasis;}],['basis provider attestation',v=>{v.captureContext.associationBasis='PROVIDER_ATTESTED';}],['numeric actual tab absent',v=>{replaceProviderSource(v,{...eventSource,tabId:null});}],['actual tab mismatch',v=>{replaceProviderSource(v,{...eventSource,tabId:124});}],['local tab opaque',v=>{v.captureContext.boundTabId='opaque-local';}],['local tab leading zero',v=>{v.captureContext.boundTabId='0123';}],['local tab unsafe',v=>{v.captureContext.boundTabId=String(Number.MAX_SAFE_INTEGER+1);}],['child target forbidden',v=>{v.captureContext.cdpTarget={targetId:'SYNTHETIC-CHILD'};}],['old kind cannot silently inherit V2 route',v=>{v.captureContext.kind='LOCAL_OBSERVED_CUA_TAB_CDP_BINDING_V1';}],['provider IDs still incoherent',v=>{v.capture.events[2].providerSource.extensionId='OTHER-OBSERVED-SOURCE';}]
]){test('explicit tab-scoped V2 refuses '+name,async()=>{const value=tabScopedV2(await correlationFixture());change(value);value.capture.localContext=structuredClone(value.captureContext);assert.throws(()=>reconcile(value));});}

return{fixture,input,fakeCapture,localContext,eventSource,NOW,ORIGIN,tabScopedV2};
})();

async function makeBffCrossPacketV3({duplicateId=false,truncated=false}={}){
 const b=bffBudgetFixturesV3,f=b.fixture();f.step(5);f.s.now=b.START+4000;
 const p=b.packet(f),records=[],measurements=[],producerResults=[];
 for(const [index,actor]of p.context.readiness.recipe.actors.entries()){
  const professionalEmail=index?'synthetic-manager@example.invalid':'synthetic-admin@example.invalid';
  const decoded=new TextEncoder().encode(JSON.stringify({roles:[actor.role],scopes:actor.role==='SUPER_ADMIN'?[{kind:'GLOBAL'}]:[{kind:'CAMPUS',id:actor.campusId}],mustChangeSecret:false,professionalEmail}));
  const pf=bffProducerFixturesV3.fixture({bytes:decoded}),at=b.START+2000+index*200;pf.state.now=at;
  const overrides={actorKey:actor.key,afterImageObservedAt:p.context.afterImageObservedAt,promptDeadlineAt:b.START+600000,effectiveGlobalLeaseExpiresAt:b.START+600000,sessionBindingSha256:b.BINDING,allocationSha256:f.api.report().allocationSha256};
  const {result:producerResult}=await pf.run(overrides),requestInput={...bffProducerFixturesV3.input(),...overrides},capture=bffProducerFixturesV3.fakeCapture();
  const routed=bffProducerFixturesV3.tabScopedV2({captureContext:structuredClone(bffProducerFixturesV3.localContext),capture}),captureContext={...routed.captureContext,boundTabId:String(123+index)},providerSource={...bffProducerFixturesV3.eventSource,tabId:123+index},requestId='SYNTHETIC-CROSS-REQUEST-'+(duplicateId?0:index);
  capture.localContext=structuredClone(captureContext);capture.providerSource=structuredClone(providerSource);capture.truncated=truncated;
  for(const event of capture.events){event.providerSource=structuredClone(providerSource);event.requestId=requestId;}capture.events[0].wallTime=at/1000;
  const joined=reconcileImageBffBrowserCaptureV3({producerResult,requestInput,captureContext,capture,now:f.s.now});
  assert.equal(joined.sourceAssociation.opaqueProviderTabIdParsed,false);assert.deepEqual(joined.sourceAssociation.anchors,['LOCAL_OBSERVED_TAB_SCOPED_CANONICAL_TAB_SCALAR_CORRESPONDENCE']);
  records.push(joined.observation);measurements.push(joined.measurement);producerResults.push({result:producerResult,fakeFetchCalls:pf.state.calls.length});
 }
 p.value.records=records;p.value.annex.records=measurements;return{f,p,producerResults};
}
bffNodeTest('BFF composition V3 / actual generated body and actual correlation feed the actual reserved-budget consumer',async()=>{
 const {f,p,producerResults}=await makeBffCrossPacketV3(),result=f.api.accept(p.value,p.context);
 assert.equal(result.roles.length,2);assert.equal(result.externalReadBudget.measuredRequests,2);assert.equal(result.externalReadBudget.totalAccountedRequests,3);assert.equal(f.s.reserveCalls,1);assert.equal(f.s.responseCalls,1);
 assert(producerResults.every(row=>row.fakeFetchCalls===1));assert.equal(result.externalReadBudget.measuredDecodedBodyBytes,producerResults.reduce((sum,row)=>sum+row.result.response.decodedBodyBytes,0));assert.equal(result.externalReadBudget.providerCryptographicSignatureAsserted,false);
});
bffNodeTest('BFF composition V3 / ambiguous repeated actual event ID is not locally prefixed to make two requests',async()=>{
 const {f,p}=await makeBffCrossPacketV3({duplicateId:true});assert.throws(()=>f.api.accept(p.value,p.context),/BFF_DISTINCT_OBSERVED_REQUEST_IDS_REQUIRED/u);assert.equal(f.api.report().packetAccepted,false);assert.equal(f.s.reserveCalls,1);
});
bffNodeTest('BFF composition V3 / truncated official-event projection refuses before any successful packet',async()=>{
 await assert.rejects(()=>makeBffCrossPacketV3({truncated:true}));
});
