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
 const fetchImpl=async(actualUrl,init)=>{state.fetches++;assert.equal(actualUrl,url);state.fetchInit=init;state.now+=40;if(options.fetchThrows){throw new Error('SYNTHETIC_PRIVATE_FETCH_FAILURE');}if(options.pendingFetch){return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('SYNTHETIC_ABORTED_FETCH')),{once:true}));}return response;};
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
 for(const kind of ['api','web']){const f=fixture({kind});await f.run();const i=f.state.fetchInit;assert.deepEqual(Object.keys(i).sort(),['credentials','headers','method','redirect','signal']);assert.equal(i.credentials,'omit');assert.equal(i.redirect,'error');assert.equal(i.method,'GET');assert.deepEqual(i.headers,{accept:kind==='api'?'application/json':'text/html'});assert.equal(i.signal instanceof AbortSignal,true);}
});
test('the only saved status receipt has explicit synthetic flags and never claims semantic acceptance',async()=>{
 const f=fixture();await f.run();assert.equal(f.state.saves.length,1);const saved=f.state.saves[0];assert.equal(saved.name,'POST-PUBLIC-HTTP-STATUS');
 assert.equal(saved.value.kind,'EXPURGATED_POST_PUBLIC_HTTP_STATUS_V2');assert.equal(saved.value.syntheticOnly,true);assert.equal(saved.value.nativeAuthority,false);assert.equal(saved.value.semanticAcceptance,false);assert.equal(saved.value.credentialsSent,false);assert.equal(saved.value.status,200);assert.equal(saved.value.responseReceivedAt,new Date(START+60).toISOString());assert.equal(saved.value.responseBytes,Buffer.byteLength(f.raw));assert(!Object.hasOwn(saved.value,'body'));
});
test('an initial local guard refusal sends no HTTP and reserves no request',async()=>{const f=fixture({guardThrowsAt:1});await assert.rejects(f.run());assert.equal(f.state.fetches,0);assert.equal(f.state.reserved.length,0);assert.equal(f.state.saves.length,0);});
test('request reservation refusal sends no HTTP',async()=>{const f=fixture({reserveThrows:true});await assert.rejects(f.run());assert.equal(f.state.fetches,0);assert.equal(f.state.saves.length,0);});
test('a final source or lease guard refusal cannot return accepted HTTP proof',async()=>{const f=fixture({guardThrowsAt:2});await assert.rejects(f.run());assert.equal(f.state.saves.length,1);assert.equal(f.state.saves[0].value.semanticAcceptance,false);assertReleased(f);});
test('synthetic entry must be explicit, and invalid kind is refused before HTTP',async()=>{
 const f=fixture();await assert.rejects(f.run({syntheticOnly:false}));await assert.rejects(f.run({kind:'arbitrary'}));assert.equal(f.state.fetches,0);assert.equal(f.state.reserved.length,0);
});
for(const [name,options]of[
 ['403',{status:403,raw:'SYNTHETIC_PRIVATE_REFUSAL_BODY'}],
 ['404',{status:404}],['500',{status:500}],
 ['redirect flag',{redirected:true}],['different final URL',{finalUrl:'https://synthetic-unrelated.invalid/login'}],
 ['wrong API content type',{contentType:'text/html'}],['wrong Web content type',{kind:'web',contentType:'application/json'}],
 ['invalid JSON',{raw:'not-json'}],['wrong API service',{raw:JSON.stringify({service:'web',status:'ok',database:'ready'})}],
 ['nonready database',{raw:JSON.stringify({service:'api',status:'ok',database:'not-ready'})}],
 ['Web non-HTML',{kind:'web',raw:'not-an-html-document'}],['Web no assets',{kind:'web',raw:'<html><body>no assets</body></html>'}],
 ['Web query parameter in asset',{kind:'web',raw:'<html><script src="/_next/static/main.js?access_token=SYNTHETIC_PRIVATE"></script></html>'}],
 ['Web fragment in asset',{kind:'web',raw:'<html><script src="/_next/static/main.js#fragment"></script></html>'}],
 ['Web dynamic asset endpoint',{kind:'web',raw:'<html><img src="/_next/image"></html>'}],
]){test('public HTTP acceptance refuses '+name,async()=>{const f=fixture(options);await assert.rejects(f.run());assert.equal(f.state.fetches,1);assert.equal(f.state.fetchInit.signal.aborted,true);if(!options.redirected&&!options.finalUrl){assertReleased(f);}assertNoRawFailureSaved(f);});}
test('403 persists only status/size and no raw error body before semantic rejection',async()=>{const f=fixture({status:403,raw:'SYNTHETIC_PRIVATE_DENIED_BODY'});await assert.rejects(f.run());assert.equal(f.state.saves[0].value.status,403);assert.equal(f.state.saves[0].value.semanticAcceptance,false);assertNoRawFailureSaved(f);assertReleased(f);});
test('body volume above one MiB is refused and durably accounted before stopping',async()=>{const f=fixture({chunks:[Buffer.alloc(1048577,97)]});await assert.rejects(f.run());assert.deepEqual(f.state.responses,[{responseBytes:1048577}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assert.equal(f.state.saves.length,0);assertReleased(f);});
test('body cannot exceed the actually remaining shared response-byte budget',async()=>{const f=fixture({remainingResponseBytes:3,chunks:[Buffer.from('four')]});await assert.rejects(f.run());assert.deepEqual(f.state.responses,[{responseBytes:4}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assertReleased(f);});
test('stream read exception releases its lock and records only bytes really read',async()=>{const f=fixture({chunks:[Buffer.from('partial')],readThrowsAt:1});await assert.rejects(f.run());assert.deepEqual(f.state.responses,[{responseBytes:7}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assertReleased(f);assertNoRawFailureSaved(f);});
test('a failed reader cancel is suppressed without exposing its message, and the lock is still released',async()=>{const f=fixture({cancelThrows:true});const r=await f.run();assert.equal(r.response.status,200);assertReleased(f);assertNoRawFailureSaved(f);});
for(const [name,options,gotReader]of[
 ['fetch exception',{fetchThrows:true},false],['response URL getter',{urlGetterThrows:true},false],
 ['response body getter',{bodyGetterThrows:true},false],['getReader exception',{getReaderThrows:true},false],
 ['content-type getter',{headersThrow:true},true],
]){test('private '+name+' failure is never written as raw evidence',async()=>{const f=fixture(options);await assert.rejects(f.run());assertNoRawFailureSaved(f);assert.equal(f.state.fetchInit.signal.aborted,true);if(gotReader){assertReleased(f);}else{assert.equal(f.state.cancels,0);assert.equal(f.state.releases,0);assert.deepEqual(f.state.responses,[{responseBytes:0}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);}});}
test('timer aborts a pending synthetic fetch and releases the request without retry',async()=>{const f=fixture({remainingMs:5,pendingFetch:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assert.equal(f.state.fetchInit.signal.aborted,true);assert.deepEqual(f.state.responses,[{responseBytes:0}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);});
test('timer aborts a pending body read and still cancels/releases the reader',async()=>{const f=fixture({remainingMs:5,pendingRead:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assertReleased(f);assert.deepEqual(f.state.responses,[{responseBytes:0}]);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);});
test('status persistence refusal cannot return an accepted proof and does not resend HTTP',async()=>{const f=fixture({saveThrows:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assertReleased(f);});
test('durable response accounting refusal stops without a second HTTP attempt',async()=>{const f=fixture({recordThrows:true});await assert.rejects(f.run());assert.equal(f.state.fetches,1);assert.deepEqual(f.state.stops,['POST_PUBLIC_HTTP_STOP']);assert.equal(f.state.saves.length,0);assertReleased(f);});
test('multiple decoded chunks are hashed and counted together, with no raw chunk receipt',async()=>{const split=20,f=fixture({chunks:[Buffer.from(HEALTH.slice(0,split)),Buffer.from(HEALTH.slice(split))]}),r=await f.run();assert.equal(r.response.bodySha256,sha(HEALTH));assert.deepEqual(f.state.responses,[{responseBytes:Buffer.byteLength(HEALTH)}]);assert.equal(r.responseReceivedAt,new Date(START+70).toISOString());assertReleased(f);});
