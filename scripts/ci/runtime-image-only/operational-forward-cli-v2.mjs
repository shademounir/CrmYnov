// The short SQL PRE window is not spent recollecting GitHub governance. This
// cache keeps only a previously verified lease; it cannot issue or renew one.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {validateImageObjective,authorizeImageOnlyDriver} from './authority.mjs';
import {validateImageMarkerV2,imagePublicRefV2,OPERATIONAL_HUMAN_SHA256} from './late-binding-v2.mjs';
import {imageJournalDigest as digest,createImageSessionBudget} from './journal.mjs';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {createReadOnlyGithubReader} from '../pool-reconciliation/pool-driver-github-v1.mjs';
import {openOfficialSdkOperationalSession} from '../readonly-probe/official-sdk-auth-preflight-v1.mjs';
import {readImageOperationalSource,imageExternalDirectory} from './local-source.mjs';
import {validateImageDossierPublicProjectionV3} from './dossier-public-projection-v3.mjs';
import {validateImagePostDossierV2,acquireImagePostAuthorityV2,releaseImagePostAuthorityV2,imagePostResourceBindingsV2,makeImagePostSdkSessionV2,makeImagePostRuntimeContractV2,prepareImagePostResourceV2,runImagePostReadOnlyV2,withVerifiedImagePostV2,releaseVerifiedImagePostV2,observeImagePostUnusedResourceV2} from './post-operational-v2.mjs';
import {runGeneralOperationalPreV3,releaseVerifiedGeneralPreV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {validateProspectiveConsumerInputs} from '../pool-reconciliation/general-prospective-pre-session-v1.mjs';
import {validateImagePreparationV2,validateImageIndependentEvidenceV2,bindImageLivePostReadinessV2} from './preparation-v2.mjs';
import {createImageOnlyExecutor} from './executor.mjs';
import {createImageOperationalTransport} from './transport.mjs';
import {runImageForwardSequenceV2} from './operational-forward-sequence-v2.mjs';
import {compareImagePostUsingPrivateGeneralV2} from './post-preservation-v2.mjs';
import {validateImagePostBffSessionObservationV2} from './post-readiness-v2.mjs';
import {READONLY_RUNTIME_FILES} from '../pool-reconciliation/pool-job-dossier-v1.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const H=/^[a-f0-9]{64}$/u;
const fields=['objectiveId','authorityRecordSha256','resourceBindingSha256','preparationPhase'];
const actions=new Set(['READ_METADATA','TEST_PERMISSIONS','CREATE_BACKUP','PATCH_API','PATCH_WEB','OBSERVE_OPERATION']);

function browserBffGetV3ExpressionBody(input,simulation) {
  const environment=simulation===undefined?globalThis:simulation.environment;
  if(simulation!==undefined&&(simulation.syntheticOnly!==true||Object.keys(simulation).length!==2)){throw new Error('BFF_SYNTHETIC_ENVIRONMENT_REQUIRED');}
  return (async () => {
    const MAX_MS=15000,MAX_BYTES=262144,PATH='/api/crm/sessions/current';
    let stage='PRECHECK',controller,reader,timer,stopped=false,dispatched=false;
    let buffer,bytes,decoded,parsed,response,total=0,observedTotal=0,fetchStartedAt=null,bodyCompletedAt=null;
    let deadlineAt=null;
    const closedFailures=new WeakMap();
    const refusal=code=>{const error=new Error('BFF_CLOSED_REFUSAL');closedFailures.set(error,code);return error;};
    const now=()=>environment.Date.now();
    const check=()=>{if(stopped||now()>=deadlineAt){controller?.abort();throw refusal('DEADLINE_EXCEEDED');}};
    const safeText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
    const hex=value=>Array.from(new environment.Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
    function publicProjection(value){
      if(!value||Object.getPrototypeOf(value)!==Object.prototype){throw refusal('JSON_SHAPE_REFUSED');}
      const keys=Object.keys(value),required=['roles','scopes','mustChangeSecret','professionalEmail'];
      if(required.some(key=>!Object.hasOwn(value,key))||keys.some(key=>![...required,'campusLabel'].includes(key))){throw refusal('JSON_SHAPE_REFUSED');}
      if(!Array.isArray(value.roles)||value.roles.length<1||value.roles.length>32||new Set(value.roles).size!==value.roles.length||value.roles.some(role=>!safeText(role,64)||!/^[A-Z][A-Z0-9_]*$/u.test(role))){throw refusal('JSON_SHAPE_REFUSED');}
      if(!Array.isArray(value.scopes)||value.scopes.length>128||typeof value.mustChangeSecret!=='boolean'||!safeText(value.professionalEmail,320)||!value.professionalEmail.includes('@')){throw refusal('JSON_SHAPE_REFUSED');}
      const scopes=value.scopes.map(scope=>{
        if(!scope||Object.getPrototypeOf(scope)!==Object.prototype||!['GLOBAL','CAMPUS','TEAM'].includes(scope.kind)){throw refusal('JSON_SHAPE_REFUSED');}
        const expected=scope.kind==='GLOBAL'?['kind']:['kind','id'];
        if(Object.keys(scope).length!==expected.length||Object.keys(scope).some(key=>!expected.includes(key))||(scope.kind!=='GLOBAL'&&!safeText(scope.id,256))){throw refusal('JSON_SHAPE_REFUSED');}
        return scope.kind==='GLOBAL'?{kind:scope.kind}:{kind:scope.kind,id:scope.id};
      });
      return{roles:[...value.roles],scopes,mustChangeSecret:value.mustChangeSecret};
    }
    function releaseReader(){
      if(reader){try{const cancel=reader.cancel();if(cancel&&typeof cancel.catch==='function'){void cancel.catch(()=>{});}}catch{/* No raw stream error. */}try{reader.releaseLock();}catch{/* A pending read may still hold the lock. */}}
    }
    async function perform(){
      check();stage='FETCH';fetchStartedAt=new environment.Date(now()).toISOString();dispatched=true;
      response=await environment.fetch(input.expectedWebOrigin+PATH,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
      check();if(response.redirected!==false||response.url!==input.expectedWebOrigin+PATH){throw refusal('REDIRECT_OR_ORIGIN_REFUSED');}
      if(response.status!==200){throw refusal('HTTP_STATUS_REFUSED');}
      if(!response.body||typeof response.body.getReader!=='function'){throw refusal('BODY_STREAM_REQUIRED');}
      reader=response.body.getReader();buffer=new environment.Uint8Array(MAX_BYTES);stage='READ_BODY';
      while(true){
        check();const part=await reader.read();
        if(!part.done){if(!(part.value instanceof environment.Uint8Array)||!Number.isSafeInteger(part.value.byteLength)){throw refusal('BODY_CHUNK_REFUSED');}observedTotal+=part.value.byteLength;}
        check();if(part.done){break;}
        if(part.value.byteLength>MAX_BYTES-total){controller.abort();throw refusal('DECODED_BODY_LIMIT_EXCEEDED');}
        buffer.set(part.value,total);total+=part.value.byteLength;
      }
      bodyCompletedAt=new environment.Date(now()).toISOString();check();bytes=buffer.subarray(0,total);
      stage='DECODE_JSON';try{decoded=new environment.TextDecoder('utf-8',{fatal:true}).decode(bytes);parsed=JSON.parse(decoded);}catch{throw refusal('JSON_DECODE_REFUSED');}
      check();const projection=publicProjection(parsed);
      stage='HASH_BODY';const bodySha256=hex(await environment.crypto.subtle.digest('SHA-256',bytes));check();
      stage='PROJECT';const professionalEmailSha256=hex(await environment.crypto.subtle.digest('SHA-256',new environment.TextEncoder().encode(parsed.professionalEmail)));check();
      return{schemaVersion:3,kind:'LOCAL_OFFICIAL_BROWSER_BFF_GET_PRODUCER_RESULT_V3',state:'OBSERVED_DECODED_RESPONSE_NOT_PROVIDER_ATTESTATION',
        localBinding:{actorKey:input.actorKey,sessionBindingSha256:input.sessionBindingSha256,allocationSha256:input.allocationSha256},
        request:{method:'GET',url:input.expectedWebOrigin+PATH},response:{status:200,finalUrl:response.url,redirected:false,bodySha256,decodedBodyBytes:total,hashMeaning:'DECODED_NETWORK_RESPONSE_BODY_NOT_WIRE_BYTES',projection:{...projection,professionalEmailSha256}},
        localTiming:{fetchDispatchedAt:fetchStartedAt,bodyReadCompletedAt:bodyCompletedAt,projectionCompletedAt:new environment.Date(now()).toISOString(),deadlineAt:new environment.Date(deadlineAt).toISOString()},
        limits:{perRequestMs:MAX_MS,decodedBodyBytes:MAX_BYTES},networkRequestIdGenerated:false,providerCryptographicSignatureAsserted:false,nativeAuthority:false};
    }
    try{
      const started=now();
      if(environment.location.origin!==input.expectedWebOrigin||environment.location.origin!==input.observedCurrentOrigin){throw refusal('CURRENT_ORIGIN_REFUSED');}
      if(!Number.isSafeInteger(started)||started<environment.Date.parse(input.afterImageObservedAt)){throw refusal('POST_RUNTIME_TIME_REFUSED');}
      deadlineAt=Math.min(started+MAX_MS,input.promptDeadlineAt,input.effectiveGlobalLeaseExpiresAt);
      if(!Number.isSafeInteger(deadlineAt)||started>=deadlineAt){throw refusal('DEADLINE_EXCEEDED');}
      controller=new environment.AbortController();
      const deadline=new Promise((_,reject)=>{timer=environment.setTimeout(()=>{controller.abort();reject(refusal('DEADLINE_EXCEEDED'));},deadlineAt-started);});
      return await Promise.race([perform(),deadline]);
    }catch(error){
      const allowed=['CURRENT_ORIGIN_REFUSED','POST_RUNTIME_TIME_REFUSED','DEADLINE_EXCEEDED','REDIRECT_OR_ORIGIN_REFUSED','HTTP_STATUS_REFUSED','BODY_STREAM_REQUIRED','BODY_CHUNK_REFUSED','DECODED_BODY_LIMIT_EXCEEDED','JSON_DECODE_REFUSED','JSON_SHAPE_REFUSED'];
      const closed=closedFailures.get(error);let code='BROWSER_GET_OR_STREAM_REFUSED';if(allowed.includes(closed)){code=closed;}else if(deadlineAt!==null&&now()>=deadlineAt){code='DEADLINE_EXCEEDED';}
      return{schemaVersion:3,kind:'LOCAL_OFFICIAL_BROWSER_BFF_GET_PRODUCER_REFUSAL_V3',state:'REFUSED_NO_RETRY',stage,code,fetchDispatched:dispatched,decodedBodyBytesObserved:observedTotal,retainedDecodedBodyBytes:total,rawBodyRetained:false,rawErrorOrStackRetained:false,networkRequestIdGenerated:false,nativeAuthority:false};
    }finally{
      stopped=true;if(timer!==undefined){environment.clearTimeout(timer);}controller?.abort();
      releaseReader();
      if(buffer){buffer.fill(0);}buffer=undefined;bytes=undefined;decoded=undefined;parsed=undefined;response=undefined;reader=undefined;
    }
  })();
}

export function buildImageBffBrowserGetExpressionV3(input){
  assert(input&&Object.getPrototypeOf(input)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(input);
  assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));
  const keys=['expectedWebOrigin','observedCurrentOrigin','actorKey','afterImageObservedAt','promptDeadlineAt','effectiveGlobalLeaseExpiresAt','sessionBindingSha256','allocationSha256'];
  assert.deepEqual(Object.keys(descriptors).sort(),keys.sort());
  const origin=new URL(input.expectedWebOrigin);assert(origin.protocol==='https:'&&/^crm-prod-web-[a-z0-9-]+(?:\.a)?\.run\.app$/u.test(origin.hostname)&&origin.origin===input.expectedWebOrigin&&!origin.username&&!origin.password&&!origin.search&&!origin.hash&&origin.pathname==='/');
  assert.equal(input.observedCurrentOrigin,input.expectedWebOrigin);assert(typeof input.actorKey==='string'&&/^[a-z][a-z0-9-]{2,80}$/u.test(input.actorKey));
  assert(typeof input.afterImageObservedAt==='string'&&new Date(input.afterImageObservedAt).toISOString()===input.afterImageObservedAt);
  assert(Number.isSafeInteger(input.promptDeadlineAt)&&Number.isSafeInteger(input.effectiveGlobalLeaseExpiresAt)&&input.promptDeadlineAt>Date.parse(input.afterImageObservedAt)&&input.effectiveGlobalLeaseExpiresAt>Date.parse(input.afterImageObservedAt));
  assert(/^[a-f0-9]{64}$/u.test(input.sessionBindingSha256)&&/^[a-f0-9]{64}$/u.test(input.allocationSha256));
  return Object.freeze({schemaVersion:3,kind:'LOCAL_GENERATED_BROWSER_BFF_GET_EXPRESSION_V3',expression:'('+browserBffGetV3ExpressionBody.toString()+')('+JSON.stringify(input)+')',
    expectedEndpoint:input.expectedWebOrigin+'/api/crm/sessions/current',maximumRequestMs:15000,maximumDecodedBodyBytes:262144,
    sourceOnly:true,nativeAuthority:false,networkRequestIdGenerated:false,providerCryptographicSignatureAsserted:false,
    requiredExternalEvidence:'Actual unique matching Network.requestWillBeSent, responseReceived and loadingFinished events with requestId and dates; bounded complete event pages; no headers/cookies/raw body persisted.'});
}

export async function simulateImageBffBrowserGetProducerV3({syntheticOnly,input,environment}){
  assert.equal(syntheticOnly,true);buildImageBffBrowserGetExpressionV3(input);assert(environment&&environment!==globalThis&&Object.getPrototypeOf(environment)===Object.prototype);
  const keys=['Date','TextEncoder','TextDecoder','Uint8Array','AbortController','location','crypto','setTimeout','clearTimeout','fetch'];const descriptors=Object.getOwnPropertyDescriptors(environment);
  assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));assert.deepEqual(Object.keys(descriptors).sort(),keys.sort());
  for(const key of ['Date','TextEncoder','TextDecoder','Uint8Array','AbortController','setTimeout','clearTimeout','fetch']){assert.equal(typeof environment[key],'function');}assert.notEqual(environment.fetch,globalThis.fetch);
  return{syntheticOnly:true,nativeAuthority:false,result:await browserBffGetV3ExpressionBody(input,{syntheticOnly:true,environment})};
}

function browserBffExact(value,keys){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype);const descriptors=Object.getOwnPropertyDescriptors(value);
  assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));assert.deepEqual(Object.keys(descriptors).sort(),[...keys].sort());
}
function browserBffText(value){assert(typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/u.test(value));}
function browserBffIso(value){assert(typeof value==='string');const time=Date.parse(value);assert(Number.isSafeInteger(time)&&new Date(time).toISOString()===value);return time;}
function browserBffProviderSource(value){
  browserBffExact(value,['extensionId','sessionId','tabId','targetId']);for(const key of ['extensionId','sessionId','targetId']){if(value[key]!==null){browserBffText(value[key]);}}
  assert(value.tabId===null||(Number.isSafeInteger(value.tabId)&&value.tabId>=0));
}
function browserBffCaptureContext(requestInput,captureContext){
  buildImageBffBrowserGetExpressionV3(requestInput);assert(captureContext&&Object.getPrototypeOf(captureContext)===Object.prototype);
  const kindDescriptor=Object.getOwnPropertyDescriptor(captureContext,'kind');assert(kindDescriptor&&Object.hasOwn(kindDescriptor,'value'));
  const documentedTabScoped=kindDescriptor.value==='LOCAL_OBSERVED_CUA_TAB_CDP_BINDING_V2';
  browserBffExact(captureContext,documentedTabScoped?['kind','browserId','boundTabId','providerTabId','cdpTarget','route','associationBasis']:['kind','browserId','boundTabId','providerTabId','cdpTarget']);
  if(documentedTabScoped){assert(captureContext.route==='DOCUMENTED_TAB_SCOPED_CDP'&&captureContext.associationBasis==='LOCAL_OBSERVED_CANONICAL_TAB_SCALAR_CORRESPONDENCE'&&captureContext.cdpTarget===null);}else{assert.equal(captureContext.kind,'LOCAL_OBSERVED_CUA_TAB_CDP_BINDING_V1');}
  browserBffText(captureContext.browserId);browserBffText(captureContext.boundTabId);if(captureContext.providerTabId!==null){browserBffText(captureContext.providerTabId);}
  if(captureContext.cdpTarget!==null){const key=Object.hasOwn(captureContext.cdpTarget,'sessionId')?'sessionId':'targetId';browserBffExact(captureContext.cdpTarget,[key]);browserBffText(captureContext.cdpTarget[key]);}
  return documentedTabScoped;
}
function browserBffProducerIdentity(producerResult,requestInput){
  browserBffExact(producerResult,['schemaVersion','kind','state','localBinding','request','response','localTiming','limits','networkRequestIdGenerated','providerCryptographicSignatureAsserted','nativeAuthority']);
  assert(producerResult.schemaVersion===3&&producerResult.kind==='LOCAL_OFFICIAL_BROWSER_BFF_GET_PRODUCER_RESULT_V3'&&producerResult.state==='OBSERVED_DECODED_RESPONSE_NOT_PROVIDER_ATTESTATION');
  assert(producerResult.networkRequestIdGenerated===false&&producerResult.providerCryptographicSignatureAsserted===false&&producerResult.nativeAuthority===false);
  assert.deepEqual(producerResult.localBinding,{actorKey:requestInput.actorKey,sessionBindingSha256:requestInput.sessionBindingSha256,allocationSha256:requestInput.allocationSha256});
  const endpoint=requestInput.expectedWebOrigin+'/api/crm/sessions/current';assert.deepEqual(producerResult.request,{method:'GET',url:endpoint});return endpoint;
}
function browserBffProjectionScope(scope){
  browserBffExact(scope,scope.kind==='GLOBAL'?['kind']:['kind','id']);assert(['GLOBAL','CAMPUS','TEAM'].includes(scope.kind));if(scope.kind!=='GLOBAL'){browserBffText(scope.id);}
}
function browserBffResponseProjection(producerResult,endpoint){
  const response=producerResult.response;browserBffExact(response,['status','finalUrl','redirected','bodySha256','decodedBodyBytes','hashMeaning','projection']);
  assert(response.status===200&&response.finalUrl===endpoint&&response.redirected===false&&response.hashMeaning==='DECODED_NETWORK_RESPONSE_BODY_NOT_WIRE_BYTES');assert(/^[a-f0-9]{64}$/u.test(response.bodySha256));
  assert(Number.isSafeInteger(response.decodedBodyBytes)&&response.decodedBodyBytes>0&&response.decodedBodyBytes<=262144);assert.deepEqual(producerResult.limits,{perRequestMs:15000,decodedBodyBytes:262144});
  browserBffExact(response.projection,['roles','scopes','mustChangeSecret','professionalEmailSha256']);assert(/^[a-f0-9]{64}$/u.test(response.projection.professionalEmailSha256)&&typeof response.projection.mustChangeSecret==='boolean');
  assert(Array.isArray(response.projection.roles)&&response.projection.roles.length>0&&response.projection.roles.length<=32&&new Set(response.projection.roles).size===response.projection.roles.length);
  for(const role of response.projection.roles){assert(typeof role==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(role));}
  assert(Array.isArray(response.projection.scopes)&&response.projection.scopes.length<=128);for(const scope of response.projection.scopes){browserBffProjectionScope(scope);}return response;
}
function browserBffLocalTimings(producerResult,requestInput,now){
  browserBffExact(producerResult.localTiming,['fetchDispatchedAt','bodyReadCompletedAt','projectionCompletedAt','deadlineAt']);const local=producerResult.localTiming;
  const startLocal=browserBffIso(local.fetchDispatchedAt),bodyLocal=browserBffIso(local.bodyReadCompletedAt),projectionLocal=browserBffIso(local.projectionCompletedAt),deadlineLocal=browserBffIso(local.deadlineAt);
  const afterImage=browserBffIso(requestInput.afterImageObservedAt),commonDeadline=Math.min(requestInput.promptDeadlineAt,requestInput.effectiveGlobalLeaseExpiresAt);
  assert(afterImage<=startLocal&&startLocal<=bodyLocal&&bodyLocal<=projectionLocal&&projectionLocal<deadlineLocal&&projectionLocal<=now&&now<commonDeadline);assert(deadlineLocal<=Math.min(startLocal+15000,commonDeadline));
  return{startLocal,bodyLocal,deadlineLocal,afterImage,commonDeadline};
}
function browserBffCaptureEnvelope(capture,captureContext){
  browserBffExact(capture,['schemaVersion','kind','localContext','providerSource','providerSourceNormalization','cursorStart','cursorEnd','truncated','hasMore','events']);assert(capture.schemaVersion===1&&capture.kind==='SAFE_LOCAL_CDP_NETWORK_EVENT_PROJECTION_V1');
  assert.deepEqual(capture.localContext,captureContext);browserBffProviderSource(capture.providerSource);assert.equal(capture.providerSourceNormalization,'DOCUMENTED_OPTIONALS_ABSENT_TO_LOCAL_NULL_NOT_PROVIDER_NULL');
}
function browserBffScalarCorrespondence(localTab,providerTab){
  assert(/^(?:0|[1-9]\d*)$/u.test(localTab));const tab=Number(localTab);assert(Number.isSafeInteger(tab)&&String(tab)===localTab&&tab===providerTab);
}
function browserBffSourceAnchors(capture,captureContext,documentedTabScoped){
  const anchors=[];
  if(documentedTabScoped){assert(capture.providerSource.tabId!==null);browserBffScalarCorrespondence(captureContext.boundTabId,capture.providerSource.tabId);anchors.push('LOCAL_OBSERVED_TAB_SCOPED_CANONICAL_TAB_SCALAR_CORRESPONDENCE');}
  else if(capture.providerSource.tabId!==null&&captureContext.providerTabId!==null){browserBffScalarCorrespondence(captureContext.providerTabId,capture.providerSource.tabId);anchors.push('LOCAL_CANONICAL_DECIMAL_PROVIDER_TAB_ID_MATCH');}
  for(const key of ['sessionId','targetId']){if(captureContext.cdpTarget&&Object.hasOwn(captureContext.cdpTarget,key)){assert(capture.providerSource[key]!==null);assert.equal(captureContext.cdpTarget[key],capture.providerSource[key]);anchors.push('ACTUAL_EXPLICIT_CDP_TARGET_'+key);}}
  assert(anchors.length>0,'OBSERVED_PROVIDER_TO_BOUND_TAB_ASSOCIATION_REQUIRED_NO_FALLBACK_ID');return anchors;
}
function browserBffCaptureEvent(event,capture,previous,extraFields){
  assert(Object.keys(extraFields).includes(event.method),'UNEXPECTED_OR_FAILED_NETWORK_EVENT_REFUSED');const extra=extraFields[event.method];
  browserBffExact(event,['method','sequence','providerSource','requestId','timestamp',...extra]);browserBffProviderSource(event.providerSource);assert.deepEqual(event.providerSource,capture.providerSource);browserBffText(event.requestId);
  assert(Number.isSafeInteger(event.sequence)&&previous<event.sequence&&event.sequence<=capture.cursorEnd);assert(Number.isFinite(event.timestamp)&&event.timestamp>=0);return event.sequence;
}
function browserBffSelectedEvent(events,method){const rows=events.filter(event=>event.method===method);assert.equal(rows.length,1);return rows[0];}
function browserBffNetworkEvents(capture,endpoint){
  assert(capture.truncated===false&&capture.hasMore===false);assert(Number.isSafeInteger(capture.cursorStart)&&capture.cursorStart>=0&&Number.isSafeInteger(capture.cursorEnd)&&capture.cursorEnd>capture.cursorStart);
  assert(Array.isArray(capture.events)&&capture.events.length===3,'EXACT_UNIQUE_COMPLETE_CDP_TRIPLE_REQUIRED');
  const methods=['Network.requestWillBeSent','Network.responseReceived','Network.loadingFinished'],extraFields={'Network.requestWillBeSent':['wallTime','url','requestMethod','redirectResponsePresent'],'Network.responseReceived':['url','status'],'Network.loadingFinished':[]};
  let previous=capture.cursorStart;for(const event of capture.events){previous=browserBffCaptureEvent(event,capture,previous,extraFields);}
  const request=browserBffSelectedEvent(capture.events,methods[0]),headers=browserBffSelectedEvent(capture.events,methods[1]),finished=browserBffSelectedEvent(capture.events,methods[2]);assert(request.sequence<headers.sequence&&headers.sequence<finished.sequence);
  assert(request.requestId===headers.requestId&&request.requestId===finished.requestId);assert(request.requestMethod==='GET'&&request.url===endpoint&&headers.url===endpoint&&headers.status===200&&request.redirectResponsePresent===false);
  assert(Number.isFinite(request.wallTime)&&request.wallTime>0&&request.timestamp<=headers.timestamp&&headers.timestamp<=finished.timestamp);return{request,finished};
}
function browserBffNetworkTimings(request,finished,local,now){
  const {startLocal,bodyLocal,deadlineLocal,afterImage,commonDeadline}=local,requestEpoch=request.wallTime*1000,finishedEpoch=requestEpoch+(finished.timestamp-request.timestamp)*1000;
  assert(Number.isFinite(requestEpoch)&&Number.isFinite(finishedEpoch)&&finishedEpoch-requestEpoch<=15000);assert(requestEpoch>=startLocal&&finishedEpoch<deadlineLocal&&finishedEpoch<commonDeadline,'RAW_CDP_DEADLINE_REQUIRED_BEFORE_ISO_CONVERSION');
  const requestStartedAt=new Date(Math.floor(requestEpoch)).toISOString(),responseReceivedAt=new Date(Math.floor(finishedEpoch)).toISOString(),start=browserBffIso(requestStartedAt),end=browserBffIso(responseReceivedAt);
  assert(startLocal<=start&&start<=end&&end<=bodyLocal&&afterImage<=start&&end<=now&&end<deadlineLocal&&end-start<=15000,'ACTUAL_CDP_AND_LOCAL_FULL_BODY_WINDOW_REQUIRED');return{requestStartedAt,responseReceivedAt};
}
export function reconcileImageBffBrowserCaptureV3({producerResult,requestInput,captureContext,capture,now}){
  const documentedTabScoped=browserBffCaptureContext(requestInput,captureContext);assert(Number.isSafeInteger(now));
  const endpoint=browserBffProducerIdentity(producerResult,requestInput),response=browserBffResponseProjection(producerResult,endpoint),local=browserBffLocalTimings(producerResult,requestInput,now);
  browserBffCaptureEnvelope(capture,captureContext);const anchors=browserBffSourceAnchors(capture,captureContext,documentedTabScoped),{request,finished}=browserBffNetworkEvents(capture,endpoint),{requestStartedAt,responseReceivedAt}=browserBffNetworkTimings(request,finished,local,now);
  const record={schemaVersion:2,kind:'OFFICIAL_BROWSER_NETWORK_GET_RESPONSE_V2',requestId:request.requestId,requestStartedAt,responseReceivedAt,observationSurface:'BROWSER_NETWORK_RESPONSE_BODY_NOT_DOM',request:{method:'GET',url:endpoint},response:{status:200,finalUrl:endpoint,redirected:false,bodySha256:response.bodySha256,hashMeaning:'DECODED_NETWORK_RESPONSE_BODY_NOT_WIRE_BYTES',projection:structuredClone(response.projection)}};
  return{observation:{actorKey:requestInput.actorKey,record},measurement:{actorKey:requestInput.actorKey,requestId:request.requestId,observationSha256:digest(record),bodySha256:response.bodySha256,decodedBodyBytes:response.decodedBodyBytes,requestStartedAt,responseReceivedAt},
    eventProjectionSha256:digest(capture),sourceAssociation:{localAssociationBasis:documentedTabScoped?'LOCAL_OBSERVED_CANONICAL_TAB_SCALAR_CORRESPONDENCE_NOT_PROVIDER_ATTESTATION':'LOCAL_DOCUMENTED_V1_ANCHOR_NOT_PROVIDER_ATTESTATION',opaqueProviderTabIdParsed:false,localContextSha256:digest(captureContext),providerSourceSha256:digest(capture.providerSource),anchors,omittedCdpTargetMeans:'LOCAL_PARAMETER_OMITTED_USES_BOUND_TAB_NOT_CHILD_TARGET',nullProviderFieldsMean:'LOCALLY_NORMALIZED_ABSENT_DOCUMENTED_OPTIONALS_NOT_PROVIDER_NULL'},responseReceivedAtMeaning:'FULL_BODY_NETWORK_LOADING_FINISHED_NOT_HEADER_EVENT',timestampDerivation:'REQUEST_WALL_TIME_PLUS_LOADING_FINISHED_MONOTONIC_DELTA_LOCAL_FLOOR_TO_ISO_MILLISECONDS',
    providerOriginAuthenticatedByThisPureFunction:false,providerCryptographicSignatureAsserted:false,nativeAuthority:false};
}

const alphabetical=(left,right)=>left.localeCompare(right,'en');
export function makeImageForwardLocalLeaseV2({authority,dossier,plan,candidate,baseline,source,jiraBytes,assertSource}){
  assert.equal(typeof assertSource,'function');assert(Buffer.isBuffer(jiraBytes));
  const initial=structuredClone(authority),raw=structuredClone(initial.entry);
  assert.equal(initial.receipt.schemaVersion,2);assert.equal(raw.schemaVersion,2);
  for(const field of fields){delete raw[field];}
  assert.equal(raw.scope,'RC48_SERVICE_IMAGE_ONLY_V1');
  assert.equal(digest(raw),initial.receipt.catalogEntrySha256,'LOCAL_LEASE_REQUIRES_EXACT_VERIFIED_CATALOGUE_ENTRY');
  assert.equal(initial.receipt.authorityRecordSha256,digest(raw));
  assert.equal(initial.receipt.resourceBindingSha256,digest(raw.resourceBindings));
  const comment=initial.operationalMarkerObservation;
  assert(comment&&H.test(initial.receipt.operationalMarkerSha256));
  assert.equal(hash(Buffer.from(comment.body,'utf8')),initial.receipt.operationalMarkerSha256);
  assert.equal(comment.updated_at,initial.receipt.operationalMarkerUpdatedAt);
  assert.equal(digest(comment),initial.receipt.operationalMarkerObservationSha256);
  assert.equal(comment.id,initial.receipt.operationalCommentId);
  assert.equal(comment.user.login,initial.receipt.actor);
  const jiraHash=hash(jiraBytes),oldestVerified=Date.parse(initial.receipt.verifiedAt);
  assert(Number.isSafeInteger(oldestVerified));
  return Object.freeze({
    current(action,preparationPhase,now){
      assertSource(source);assert.equal(hash(jiraBytes),jiraHash);assert(actions.has(action));
      assert(initial.receipt.authorizedActions.includes(action),'ACTION_OUTSIDE_VERIFIED_OPERATIONAL_MARKER');
      assert(initial.receipt.allowedPreparationPhases.includes(preparationPhase),'PHASE_OUTSIDE_VERIFIED_OPERATIONAL_MARKER');
      assertAuthorityCurrent(initial,now);assert(now>=oldestVerified);
      validateImageObjective(raw,{id:raw.id,dossier,plan,candidate,baseline,source,action,preparationPhase,now});
      const marker=validateImageMarkerV2([comment],{actors:[initial.receipt.actor],entry:raw,dossier,plan,source,jiraBytes,
        actor:initial.receipt.actor,action,preparationPhase,now},initial.receipt.grantDigest,hash);
      assert.equal(marker.commentId,initial.receipt.operationalCommentId);
      assert.equal(marker.markerSha256,initial.receipt.operationalMarkerSha256);
      // Do not replace verifiedAt with now or extend any observed expiry.
      const expiresAt=new Date(Math.min(Date.parse(initial.receipt.expiresAt),marker.expiresAt)).toISOString();
      const result={entry:{...structuredClone(raw),objectiveId:raw.id,authorityRecordSha256:digest(raw),
        resourceBindingSha256:digest(raw.resourceBindings),preparationPhase},
      receipt:{...structuredClone(initial.receipt),preparationPhase,expiresAt},
      operationalMarkerObservation:structuredClone(comment)};
      assertAuthorityCurrent(result,now);return Object.freeze(result);
    },
    originalReceipt:()=>structuredClone(initial.receipt),
  });
}

export function makeImageForwardPreparationV2({phase,objectiveId,dossier,plan,source,postReadiness,general,now,expiresAt}){
  assert(['BACKUP_READY','FORWARD_FINAL'].includes(phase));assert(Number.isSafeInteger(now));
  assert.equal(general===null,phase==='BACKUP_READY');
  return {schemaVersion:2,kind:'RC48_LATE_BOUND_IMAGE_PREPARATION_V2',preparationPhase:phase,objectiveId,
    staticDossierSha256:digest(dossier),planSha256:digest(plan),preparationRulesSha256:dossier.preparationRulesSha256,
    humanAuthorityReceiptSha256:dossier.humanAuthorityReceiptSha256,
    source:{commit:source.commit,tree:source.tree,inputManifestSha256:digest(source.files)},
    qualifiedAt:new Date(now).toISOString(),expiresAt,general,postReadiness};
}

export function parseImagePostPreparationArgumentsV2(args){
  const allowed=['--objective-id','--dossier','--jira-evidence','--session-binding','--journal-dir','--output-dir'];
  assert(Array.isArray(args)&&args[0]==='post-create-v2'&&args.length===13,'EXPLICIT_POST_RESOURCE_PREPARATION_REQUIRED');const result={};
  for(let i=1;i<args.length;i+=2){const key=args[i],value=args[i+1];assert(allowed.includes(key)&&!Object.hasOwn(result,key));assert(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(value));result[key]=value;}
  assert.match(result['--objective-id'],/^rc48-general-post-[a-z0-9-]{8,63}$/u);
  for(const key of allowed.filter(key=>key!=='--objective-id')){assert(path.isAbsolute(result[key]));}return result;
}
function exact(value,keys){assert(value&&Object.getPrototypeOf(value)===Object.prototype);assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')));assert.deepEqual(Object.keys(value).sort(alphabetical),[...keys].sort(alphabetical));}
function validatePublic(value){return validateImageDossierPublicProjectionV3(value,readImageForwardCollectorSourceV2);}
function publicJson(file,max=1048576){const bytes=readPoolPrivateFile(file,max),value=JSON.parse(bytes);validatePublic(value);return value;}
function verifiedPublicBytes(ref){imagePublicRefV2(ref);const bytes=readPoolPrivateFile(ref.path,1048576);assert.equal(hash(bytes),ref.sha256,'FORWARD_INPUT_BYTES_CHANGED');validatePublic(JSON.parse(bytes));return bytes;}
export function readImageForwardPublicReferenceV2(ref){return JSON.parse(verifiedPublicBytes(ref));}
function publicSaver(output){let ordinal=0;return(name,value)=>{
  assert(/^[A-Z][A-Z0-9-]{0,95}$/u.test(name));validatePublic(value);
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),file=path.join(output,String(ordinal++).padStart(4,'0')+'-'+name+'.json'),fd=fs.openSync(file,'wx',0o600);
  try{let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);assert(n>0);offset+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return{path:file,sha256:hash(fs.readFileSync(file))};
};}
function fixedSourceGuard(source){assert.deepEqual(readImageOperationalSource(),source,'FORWARD_PROTECTED_SOURCE_CHANGED');}
export function readImageForwardCollectorSourceV2(file){assert(Object.values(READONLY_RUNTIME_FILES).includes(file),'FORWARD_COLLECTOR_SOURCE_OUTSIDE_FIXED_MODULES');return readPoolPrivateFile(path.resolve(import.meta.dirname,'../pool-reconciliation',file));}
function cleanupEntry(result,{sdk,budget,postAuthority,postResult,generalResult,stopCode}){
  let refused=false;for(const release of [()=>releaseVerifiedImagePostV2(postResult?.privatePostCapability),()=>releaseVerifiedGeneralPreV3(generalResult?.privatePreCapability),()=>{if(postAuthority){releaseImagePostAuthorityV2(postAuthority.authorityCapability);}},()=>sdk?.close(),()=>{if(budget&&!budget.inspect().stopped){budget.stop(stopCode);}}]){try{release();}catch{refused=true;}}
  if(refused){return{...result,observedStateBeforeCleanup:result?.state,state:'OPERATIONAL_ENTRY_STOPPED_LOCAL_CLEANUP_INCOMPLETE',secondaryGuard:'LOCAL_CLEANUP_FAILED_NO_RETRY',canRetry:false};}return result;
}
function entryTerminal(result,{sdk,budget,save,name}){
  let publicResult;try{publicResult={...result};if(sdk){publicResult.sdkAuthentication=sdk.report();}if(budget){publicResult.nativeSession=budget.inspect();}validatePublic(publicResult);}catch{publicResult={schemaVersion:2,kind:'EXPURGATED_OPERATIONAL_ENTRY_TERMINAL_REFUSED_V2',state:'STOPPED_TERMINAL_PROJECTION_NOT_PUBLIC',guardCode:'LOCAL_TERMINAL_PROJECTION_FAILED_NO_RETRY',canRetry:false};}
  if(!save){return publicResult;}try{return{...publicResult,entryReceipt:save(name,publicResult)};}catch{return{...publicResult,receiptPersistence:'FAILED_NO_RETRY',secondaryGuard:publicResult.secondaryGuard??'LOCAL_TERMINAL_PERSISTENCE_FAILED_NO_RETRY',canRetry:false};}
}
// Qualification only: the real private public-write helpers, no SDK/native port.
export function simulateImageForwardPublicPersistenceV3(input){
  validatePublic(input);exact(input,['syntheticOnly','outputDirectory','result','name']);assert.equal(input.syntheticOnly,true);
  assert(typeof input.name==='string'&&/^[A-Z][A-Z0-9-]{0,95}$/u.test(input.name));
  const directory=imageExternalDirectory(input.outputDirectory);assert.equal(fs.readdirSync(directory).length,0,'SYNTHETIC_PUBLIC_OUTPUT_MUST_BE_EMPTY');
  const result=entryTerminal({...input.result,syntheticOnly:true,nativeAuthority:false,nativeAcceptance:false},{save:publicSaver(directory),name:input.name});
  return{syntheticOnly:true,nativeAuthority:false,nativeAcceptance:false,result};
}
function validateSessionBinding(binding,authority,source,scope,resources){
  exact(binding,['sessionId','authorityRecordSha256','resourceBindingSha256','scope','windowStart','windowEnd','sourceCommit','project','region']);
  assert.match(binding.sessionId,/^local:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  assert.equal(binding.scope,scope);assert.equal(binding.authorityRecordSha256,authority.receipt.authorityRecordSha256);
  assert.equal(binding.resourceBindingSha256,digest(resources));assert.equal(binding.sourceCommit,source.commit);
  assert.equal(binding.project,'crmynov-prod-n7x4q2');assert.equal(binding.region,'europe-west1');
  const start=Date.parse(binding.windowStart),end=Date.parse(binding.windowEnd);assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>start&&end-start<=900000);
  assert.equal(new Date(start).toISOString(),binding.windowStart);assert.equal(new Date(end).toISOString(),binding.windowEnd);
  assert(Date.parse(authority.entry.validFrom)<=start&&end<=Date.parse(authority.entry.expiresAt));assert(start<=Date.now()&&Date.now()<end);
}
// Preparation creates only the separately reviewed POST resource. It never
// executes that resource, invokes PRE, patches a service or opens a private key.
export async function runImagePostResourcePreparationV2(args){
  let stage='POST_CREATE_INPUTS',sdk,budget,acquired,save,result;
  try{
    assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
    const o=parseImagePostPreparationArgumentsV2(args),source=readImageOperationalSource(),dossier=publicJson(o['--dossier']);
    validateImagePostDossierV2(dossier,readImageForwardCollectorSourceV2);
    const jiraBytes=readPoolPrivateFile(o['--jira-evidence'],65536),binding=publicJson(o['--session-binding']);
    const directory=imageExternalDirectory(o['--journal-dir']),output=imageExternalDirectory(o['--output-dir']);assert.notEqual(directory,output);
    assert.equal(fs.readdirSync(directory).length,0,'POST_CREATE_REQUIRES_NEW_EMPTY_JOURNAL');assert.equal(fs.readdirSync(output).length,0,'POST_CREATE_REQUIRES_NEW_EMPTY_OUTPUT');save=publicSaver(output);
    stage='POST_CREATE_GOVERNANCE';acquired=await acquireImagePostAuthorityV2({objectiveId:o['--objective-id'],dossier,jiraBytes,journalDirectory:directory,preparationPhase:'POST_RESOURCE_PREPARATION'});
    assert.deepEqual(acquired.source,source);fixedSourceGuard(source);
    const resources=imagePostResourceBindingsV2(acquired.authority,dossier);validateSessionBinding(binding,acquired.authority,source,'POST_PRESERVATION_READ_ONLY_V2',resources);
    // Its location is derived from the protected objective's journal directory;
    // callers cannot replace a stopped budget with a fresh arbitrary directory.
    const budgetDirectory=directory+'-native-session';assert(!fs.existsSync(budgetDirectory),'POST_CREATE_SESSION_ALREADY_ENTERED');fs.mkdirSync(budgetDirectory);
    budget=createImageSessionBudget({directory:imageExternalDirectory(budgetDirectory),binding});
    const projected=makeImagePostSdkSessionV2({authority:acquired.authority,dossier,binding,commonSessionBindingSha256:digest(binding),budgetState:budget.inspect(),preparationPhase:'POST_RESOURCE_PREPARATION',now:Date.now()});
    const guard=()=>{fixedSourceGuard(source);assertAuthorityCurrent(acquired.authority,Date.now());const current=budget.inspect();assert(!current.stopped&&current.remainingMs>0);};
    save('POST-CREATE-ENTRY-START',{schemaVersion:2,kind:'POST_RESOURCE_PREPARATION_ENTRY_START_V2',objectiveId:o['--objective-id'],source,binding,resources,at:new Date().toISOString(),runCapabilityCreated:false,runPosts:0});
    stage='POST_CREATE_AUTHENTICATION';sdk=await openOfficialSdkOperationalSession({operationContract:projected.operationContract,getAuthority:()=>projected.authority,assertCurrent:guard});assert.equal(sdk.report().authenticationChainValidated,true,'POST_CREATE_SDK_AUTHENTICATION_REFUSED');
    stage='POST_CREATE_NATIVE';const runtimeContract=makeImagePostRuntimeContractV2({authority:acquired.authority,dossier,source,sharedBudget:budget,preparationPhase:'POST_RESOURCE_PREPARATION'});
    result=await prepareImagePostResourceV2({objectiveId:o['--objective-id'],dossier,jiraBytes,journalDirectory:directory,authorityCapability:acquired.authorityCapability,sharedBudget:budget,runtimeContract,accessToken:sdk.accessToken,save,assertSessionCurrent:guard});
    assert.equal(result.state,'FIN_POST_RESOURCE_READY_UNUSED_V2');
    const origin={schemaVersion:1,kind:'PROTECTED_POST_READONLY_OBJECTIVE_ORIGIN_V1',objectiveId:o['--objective-id'],dossierSha256:digest(dossier),objectiveSha256:dossier.objective.objectiveSha256,
      sourceSha256:dossier.objective.sourceSha256,catalogueSha256:acquired.authority.receipt.catalogueSha256,driverCommit:source.commit,driverInputManifestSha256:digest(source.files)};
    assert(H.test(origin.catalogueSha256));const recipeOrigin=save('POST-RECIPE-PROTECTED-ORIGIN',origin);
    result={...result,recipeOrigin,source,humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,runtimeChanged:false,sheetsActivated:false};
  }catch{result={schemaVersion:2,kind:'POST_RESOURCE_PREPARATION_STOP_V2',state:'POST_RESOURCE_PREPARATION_STOPPED_NO_AUTOMATIC_RETRY',guardStage:stage,runPosts:0,runCapabilityCreated:false,runtimeChanged:false,sheetsActivated:false,canRetry:false};}
  finally{
    result=cleanupEntry(result,{sdk,budget,postAuthority:acquired,stopCode:result?.state==='FIN_POST_RESOURCE_READY_UNUSED_V2'?'POST_RESOURCE_PREPARATION_FIN':'POST_RESOURCE_PREPARATION_STOP'});
  }
  return entryTerminal(result,{sdk,budget,save,name:result.state==='FIN_POST_RESOURCE_READY_UNUSED_V2'?'POST-RESOURCE-PREPARATION-FIN':'POST-RESOURCE-PREPARATION-STOP'});
}

export function parseImageForwardArgumentsV2(args){
  const keys=new Set(['--input','--jira-evidence','--journal-dir','--output-dir']);assert(Array.isArray(args)&&args[0]==='forward-v2'&&args.length===9,'EXPLICIT_FORWARD_V2_REQUIRED');const result={};
  for(let i=1;i<args.length;i+=2){assert(keys.has(args[i])&&!Object.hasOwn(result,args[i]));const value=args[i+1];assert(typeof value==='string'&&path.isAbsolute(value)&&value.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(value));result[args[i]]=value;}return result;
}
function forwardInputs(value){
  exact(value,['schemaVersion','kind','objectiveId','dossier','plan','candidate','baseline','postReadiness','sessionBinding','general','post','roleObservationsFile']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'RC48_FORWARD_OPERATIONAL_INPUT_V2');assert.match(value.objectiveId,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
  const loaded={};for(const key of ['dossier','plan','candidate','baseline','postReadiness','sessionBinding']){loaded[key]=readImageForwardPublicReferenceV2(value[key]);}
  exact(value.general,['record','dossier','privateKeyFile','consumerReferences']);exact(value.post,['objectiveId','dossier','privateKeyFile','journalDirectory']);
  const refs=value.general.consumerReferences;exact(refs,['historicalBaseline','cutoverIndex','configuration','decision','currentComparison']);
  const verified=Object.fromEntries(Object.entries(refs).map(([key,ref])=>[key,verifiedPublicBytes(ref)]));
  const consumerInputs={historicalBaselineBytes:verified.historicalBaseline,cutoverIndexBytes:verified.cutoverIndex,evidence:{}};
  for(const key of ['configuration','decision','currentComparison']){consumerInputs.evidence[key]=verified[key];}
  validateProspectiveConsumerInputs(consumerInputs);
  for(const file of [value.general.privateKeyFile,value.post.privateKeyFile,value.post.journalDirectory,value.roleObservationsFile]){assert(typeof file==='string'&&path.isAbsolute(file)&&file.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(file));}
  value=structuredClone(value);value.post.journalDirectory=imageExternalDirectory(value.post.journalDirectory);
  assert.match(value.post.objectiveId,/^rc48-general-post-[a-z0-9-]{8,63}$/u);
  return{...loaded,descriptor:value,generalRecord:readImageForwardPublicReferenceV2(value.general.record),generalDossierBytes:verifiedPublicBytes(value.general.dossier),postDossier:readImageForwardPublicReferenceV2(value.post.dossier),consumerInputs};
}
function projectionSource(source){return{commit:source.commit,tree:source.tree,inputManifestSha256:digest(source.files)};}
function publicHttpProjection(kind,body){
  if(kind==='api'){const p=JSON.parse(body);assert.equal(p.service,'api');assert.equal(p.status,'ok');assert.equal(p.database,'ready');return{service:p.service,status:p.status,database:p.database};}
  assert(/<html(?:\s|>)/iu.test(body));const paths=[...new Set([...body.matchAll(/(?:src|href)=["'](\/_next\/[^"'<>]+)["']/gu)].map(match=>match[1]))];assert(paths.length>0&&paths.length<=100);assert(paths.every(value=>/^\/_next\/static\/[A-Za-z0-9._~/%@+-]+$/u.test(value)),'ONLY_PUBLIC_STATIC_ASSET_PATHS');return{documentKind:'HTML',assetPaths:paths};
}
async function publicImageGet(kind,url,{budget,guard,save},{fetchImpl=fetch,clock=Date.now}={}){
  assert(['api','web'].includes(kind));guard();const started=clock(),request={method:'GET',url},ticket=budget.reserveRequest({method:'GET',resource:url,requestSha256:digest(request)}),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ticket.remainingMs);let size=0,recorded=false,accountingAttempted=false,reader;
  try{
    const response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,headers:{accept:kind==='api'?'application/json':'text/html'}});
    assert.equal(response.url,url);assert.equal(response.redirected,false);const chunks=[];reader=response.body.getReader();
    async function readNextChunk(){const part=await reader.read();if(part.done){return;}size+=part.value.byteLength;assert(size<=1048576&&size<=budget.inspect().remainingResponseBytes,'POST_PUBLIC_HTTP_VOLUME_BOUND');chunks.push(part.value);return readNextChunk();}
    await readNextChunk();
    accountingAttempted=true;budget.recordResponse(ticket,{responseBytes:size});recorded=true;
    save('POST-PUBLIC-HTTP-STATUS',{schemaVersion:2,kind:'EXPURGATED_POST_PUBLIC_HTTP_STATUS_V2',request,status:response.status,requestStartedAt:new Date(started).toISOString(),responseReceivedAt:new Date(clock()).toISOString(),responseBytes:size,semanticAcceptance:false,credentialsSent:false,sessionBindingSha256:budget.inspect().bindingSha256});
    assert.equal(response.status,200,'POST_PUBLIC_HTTP_STATUS_REFUSED');
    const type=response.headers.get('content-type')??'';assert(kind==='api'?/^application\/json(?:;|$)/iu.test(type):/^text\/html(?:;|$)/iu.test(type));
    const bytes=Buffer.concat(chunks),projection=publicHttpProjection(kind,bytes.toString('utf8'));guard();
    return{schemaVersion:2,kind:'SOURCE_BOUND_PUBLIC_RUNTIME_GET_V2',requestStartedAt:new Date(started).toISOString(),responseReceivedAt:new Date(clock()).toISOString(),request,
      response:{status:200,finalUrl:url,redirected:false,bodySha256:hash(bytes),hashMeaning:'DECODED_FETCH_RESPONSE_BODY_NOT_WIRE_BYTES',projection},credentialsSent:false,sessionBindingSha256:budget.inspect().bindingSha256};
  }finally{clearTimeout(timer);controller.abort();if(reader){try{await reader.cancel();}catch{/* Do not expose a stream's raw failure. */}reader.releaseLock();}if(!recorded){try{if(!accountingAttempted){accountingAttempted=true;budget.recordResponse(ticket,{responseBytes:size});}}finally{budget.stop('POST_PUBLIC_HTTP_STOP');}}}
}
export async function simulateImageForwardPublicHttpV2({syntheticOnly,kind,url,budget,guard,save,fetchImpl,clock}){
  assert.equal(syntheticOnly,true);assert.equal(typeof fetchImpl,'function');assert.equal(typeof clock,'function');
  const result=await publicImageGet(kind,url,{budget,guard,save:(name,value)=>save(name,{...value,syntheticOnly:true,nativeAuthority:false})},{fetchImpl,clock});return{...result,syntheticOnly:true,nativeAuthority:false};
}
const BFF_EXTERNAL_LIMITS_V3=Object.freeze({requests:2,perBodyBytes:262144,totalBodyBytes:524288,perRequestMs:15000,nativeRequests:198,nativeBodyBytes:20447232});
const BFF_BUDGET_FIELDS_V3=['schemaVersion','kind','bindingSha256','firstNativeAt','deadlineAt','requestsReserved','remainingRequests','totalResponseBytes','remainingResponseBytes','pendingOrdinal','stopped','stopCode','remainingMs','lastRecordSha256'];
const bffReservationStateV3=new WeakMap();
function bffTimeV3(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n)&&new Date(n).toISOString()===value,'BFF_CANONICAL_TIME_REQUIRED');return n;}
function bffStateV3(budget){const s=bffReservationStateV3.get(budget);assert(s,'BFF_PRIVATE_RESERVATION_REQUIRED');return s;}
function bffRawStateV3(state){const raw=state.raw.inspect();exact(raw,BFF_BUDGET_FIELDS_V3);assert.equal(raw.bindingSha256,state.bindingSha256);assert(raw.kind==='IMAGE_NATIVE_SESSION_BUDGET_STATE_V2'&&raw.schemaVersion===2);for(const key of ['deadlineAt','requestsReserved','remainingRequests','totalResponseBytes','remainingResponseBytes','remainingMs']){assert(Number.isSafeInteger(raw[key])&&raw[key]>=0);}return raw;}
function bffEffectiveDeadlineV3(state,raw){return Math.min(raw.deadlineAt,state.leaseExpiresAt);}
function makeReservedBffBudgetV3(raw,{sessionBindingSha256,leaseExpiresAt,actorCount,clock=Date.now}){
  exact(raw,['inspect','reserveRequest','recordResponse','stop']);assert(Object.values(raw).every(value=>typeof value==='function'));assert(H.test(sessionBindingSha256));assert.equal(actorCount,2,'EXACT_TWO_BFF_ACTORS_REQUIRED');assert.equal(typeof clock,'function');
  const expiry=bffTimeV3(leaseExpiresAt),state={raw,bindingSha256:sessionBindingSha256,leaseExpiresAt:expiry,clock,requestTickets:new WeakMap(),packetAttempted:false,packetAccepted:false,actualBffRequests:null,actualBffBytes:null};
  const allocation={schemaVersion:3,kind:'FORWARD_EXTERNAL_BFF_RESERVATION_V3',sessionBindingSha256,limits:BFF_EXTERNAL_LIMITS_V3,leaseExpiresAt,reservationMeaning:'CONSERVATIVE_ALLOWANCE_NOT_OBSERVED_REQUESTS',providerCryptographicSignatureAsserted:false};state.allocation=Object.freeze(allocation);state.allocationSha256=digest(allocation);
  const first=bffRawStateV3(state);assert(!first.stopped&&first.pendingOrdinal===null&&clock()<bffEffectiveDeadlineV3(state,first),'BFF_ALLOCATION_SESSION_NOT_CURRENT');assert(first.requestsReserved===0&&first.totalResponseBytes===0&&first.firstNativeAt===null,'BFF_RESERVATION_MUST_PRECEDE_FIRST_NATIVE_REQUEST');
  let wrapped;
  wrapped=Object.freeze({
    inspect(){const current=bffRawStateV3(state),deadlineAt=bffEffectiveDeadlineV3(state,current);return{...current,deadlineAt,remainingRequests:Math.max(0,current.remainingRequests-BFF_EXTERNAL_LIMITS_V3.requests),remainingResponseBytes:Math.max(0,current.remainingResponseBytes-BFF_EXTERNAL_LIMITS_V3.totalBodyBytes),remainingMs:Math.max(0,Math.min(current.remainingMs,deadlineAt-clock()))};},
    reserveRequest(request){const current=bffRawStateV3(state);assert(!current.stopped&&current.pendingOrdinal===null&&clock()<bffEffectiveDeadlineV3(state,current),'BFF_RESERVED_SESSION_EXPIRED');assert(current.requestsReserved<BFF_EXTERNAL_LIMITS_V3.nativeRequests&&current.remainingRequests>BFF_EXTERNAL_LIMITS_V3.requests,'BFF_EXTERNAL_REQUEST_ALLOWANCE_RESERVED');assert(current.remainingResponseBytes>=1048576+BFF_EXTERNAL_LIMITS_V3.totalBodyBytes,'BFF_EXTERNAL_BODY_ALLOWANCE_RESERVED');const rawTicket=raw.reserveRequest(request),deadlineAt=Math.min(rawTicket.deadlineAt,state.leaseExpiresAt),remainingMs=Math.min(rawTicket.remainingMs,deadlineAt-clock());if(remainingMs<=0){raw.stop('BFF_RESERVED_LEASE_EXPIRED_DURING_ADMISSION');throw new Error('BFF_RESERVED_LEASE_EXPIRED_DURING_ADMISSION');}const ticket=Object.freeze({ordinal:rawTicket.ordinal,deadlineAt,remainingMs});state.requestTickets.set(ticket,{rawTicket,accountingAttempted:false});return ticket;},
    recordResponse(ticket,response){const retained=state.requestTickets.get(ticket);assert(retained&&!retained.accountingAttempted,'BFF_RESPONSE_ALREADY_ATTEMPTED_OR_UNMATCHED');retained.accountingAttempted=true;raw.recordResponse(retained.rawTicket,response);const current=bffRawStateV3(state);if(current.requestsReserved>BFF_EXTERNAL_LIMITS_V3.nativeRequests||current.totalResponseBytes>BFF_EXTERNAL_LIMITS_V3.nativeBodyBytes||clock()>=bffEffectiveDeadlineV3(state,current)){raw.stop('BFF_RESERVED_NATIVE_BOUNDARY_EXCEEDED');throw new Error('BFF_RESERVED_NATIVE_BOUNDARY_EXCEEDED');}return wrapped.inspect();},
    stop:code=>raw.stop(code),
  });
  bffReservationStateV3.set(wrapped,state);return wrapped;
}
function bffAllocationReportV3(budget){const s=bffStateV3(budget),raw=bffRawStateV3(s);return{allocation:s.allocation,allocationSha256:s.allocationSha256,effectiveDeadlineAt:new Date(bffEffectiveDeadlineV3(s,raw)).toISOString(),rawNativeBudget:raw,packetAttempted:s.packetAttempted,packetAccepted:s.packetAccepted,actualBffRequests:s.actualBffRequests,actualBffDecodedBodyBytes:s.actualBffBytes,reservedAllowanceIsNotConsumption:true};}
function bffFinalCompositionV3(budget){const state=bffStateV3(budget),raw=bffRawStateV3(state);assert(state.packetAccepted&&!raw.stopped&&raw.pendingOrdinal===null&&state.clock()<bffEffectiveDeadlineV3(state,raw),'BFF_FINAL_COMPOSITION_NOT_CURRENT');assert(raw.requestsReserved+BFF_EXTERNAL_LIMITS_V3.requests<=200&&raw.totalResponseBytes+state.actualBffBytes<=20971520,'BFF_FINAL_GLOBAL_LIMIT_EXCEEDED');return{allocationSha256:state.allocationSha256,sessionBindingSha256:state.bindingSha256,reservedRequests:2,reservedDecodedBodyBytes:BFF_EXTERNAL_LIMITS_V3.totalBodyBytes,measuredRequests:state.actualBffRequests,measuredDecodedBodyBytes:state.actualBffBytes,rawNativeRequests:raw.requestsReserved,rawNativeResponseBytes:raw.totalResponseBytes,totalAccountedRequests:raw.requestsReserved+2,totalAccountedResponseBytes:raw.totalResponseBytes+state.actualBffBytes,effectiveDeadlineAt:new Date(bffEffectiveDeadlineV3(state,raw)).toISOString(),measurementMeaning:'LOCAL_OFFICIAL_BROWSER_DECODED_BODY_MEASUREMENT_NOT_PROVIDER_ATTESTATION',providerCryptographicSignatureAsserted:false};}
function acceptBrowserBffPacketV3(packet,{budget,readiness,afterImageObservedAt,planSha256,now}){
  const state=bffStateV3(budget);assert.equal(state.packetAttempted,false,'BFF_PACKET_ATTEMPT_ALREADY_CONSUMED');state.packetAttempted=true;
  const raw=bffRawStateV3(state),deadline=bffEffectiveDeadlineV3(state,raw),current=state.clock();assert(Number.isSafeInteger(now)&&now<=current&&!raw.stopped&&raw.pendingOrdinal===null&&raw.firstNativeAt!==null&&Number.isSafeInteger(raw.firstNativeAt)&&current<deadline,'BFF_PACKET_OUTSIDE_CURRENT_SESSION');assert(raw.requestsReserved<=198&&raw.totalResponseBytes<=20447232,'BFF_NATIVE_ALLOWANCE_EXCEEDED');
  exact(packet,['schemaVersion','kind','planSha256','afterImageObservedAt','sessionBindingSha256','allocationSha256','records','annex']);
  assert(packet.schemaVersion===3&&packet.kind==='POST_BROWSER_ROLE_OBSERVATIONS_V3','EXPLICIT_BFF_PACKET_V3_REQUIRED');assert.equal(packet.planSha256,planSha256);assert.equal(packet.afterImageObservedAt,afterImageObservedAt);assert.equal(packet.sessionBindingSha256,state.bindingSha256);assert.equal(packet.allocationSha256,state.allocationSha256);
  assert(Array.isArray(readiness.recipe.actors)&&readiness.recipe.actors.length===2);assert(Array.isArray(packet.records)&&packet.records.length===2);const annex=packet.annex;
  exact(annex,['schemaVersion','kind','measurementMeaning','sessionBindingSha256','allocationSha256','providerCryptographicSignatureAsserted','records']);assert(annex.schemaVersion===1&&annex.kind==='MEASURED_EXTERNAL_BFF_RESPONSE_BUDGET_V1');assert.equal(annex.measurementMeaning,'LOCAL_OFFICIAL_BROWSER_DECODED_BODY_MEASUREMENT_NOT_PROVIDER_ATTESTATION');assert.equal(annex.providerCryptographicSignatureAsserted,false);assert.equal(annex.sessionBindingSha256,state.bindingSha256);assert.equal(annex.allocationSha256,state.allocationSha256);assert(Array.isArray(annex.records)&&annex.records.length===2);
  const keys=readiness.recipe.actors.map(actor=>actor.key);assert.equal(new Set(keys).size,2);assert.deepEqual(packet.records.map(row=>row.actorKey).sort(alphabetical),[...keys].sort(alphabetical));assert.deepEqual(annex.records.map(row=>row.actorKey).sort(alphabetical),[...keys].sort(alphabetical));
  assert.equal(new Set(packet.records.map(row=>row.record.requestId)).size,2,'BFF_DISTINCT_OBSERVED_REQUEST_IDS_REQUIRED');
  let total=0;const roles=keys.map(actorKey=>{
    const observed=packet.records.filter(row=>row.actorKey===actorKey),measurements=annex.records.filter(row=>row.actorKey===actorKey);assert.equal(observed.length,1);assert.equal(measurements.length,1);exact(observed[0],['actorKey','record']);const record=observed[0].record,m=measurements[0];
    exact(m,['actorKey','requestId','observationSha256','bodySha256','decodedBodyBytes','requestStartedAt','responseReceivedAt']);assert.equal(m.requestId,record.requestId);assert.equal(m.observationSha256,digest(record));assert.equal(m.bodySha256,record.response.bodySha256);assert.equal(m.requestStartedAt,record.requestStartedAt);assert.equal(m.responseReceivedAt,record.responseReceivedAt);
    assert(Number.isSafeInteger(m.decodedBodyBytes)&&m.decodedBodyBytes>0&&m.decodedBodyBytes<=BFF_EXTERNAL_LIMITS_V3.perBodyBytes,'BFF_MEASURED_BODY_SIZE_LIMIT');total+=m.decodedBodyBytes;
    const start=bffTimeV3(m.requestStartedAt),end=bffTimeV3(m.responseReceivedAt);assert(raw.firstNativeAt<=start&&bffTimeV3(afterImageObservedAt)<=start&&start<=end&&end<=now&&end<=deadline&&end-start<=BFF_EXTERNAL_LIMITS_V3.perRequestMs,'BFF_MEASURED_REQUEST_OUTSIDE_COMMON_DEADLINE');
    return validateImagePostBffSessionObservationV2(record,{readiness,actorKey,afterImageObservedAt,now});
  });
  assert(total<=BFF_EXTERNAL_LIMITS_V3.totalBodyBytes);assert.equal(new Set(roles.map(row=>row.professionalEmailSha256)).size,2,'POST_DISTINCT_ROLE_IDENTITIES_REQUIRED');
  state.packetAccepted=true;state.actualBffRequests=2;state.actualBffBytes=total;return{roles,externalReadBudget:bffFinalCompositionV3(budget)};
}
// Pure fake-budget/packet seam. No SDK callback, credential, HTTP or authority port.
export function simulateImageForwardBffReservationV3(input){
  exact(input,['syntheticOnly','rawBudget','sessionBindingSha256','leaseExpiresAt','actorCount','clock']);assert.equal(input.syntheticOnly,true);
  const budget=makeReservedBffBudgetV3(input.rawBudget,input);return{syntheticOnly:true,nativeAuthority:false,budget,report:()=>bffAllocationReportV3(budget),final:()=>bffFinalCompositionV3(budget),accept:(packet,context)=>({...acceptBrowserBffPacketV3(packet,{...context,budget}),syntheticOnly:true,nativeAuthority:false})};
}
export async function simulateImageForwardTwoPublicGetsV3(input){
  exact(input,['syntheticOnly','outputDirectory','apiUrl','webUrl','budget','guard','fetchImpl','clock']);assert.equal(input.syntheticOnly,true);assert.equal(typeof input.fetchImpl,'function');assert.equal(typeof input.guard,'function');assert.equal(typeof input.clock,'function');
  const output=imageExternalDirectory(input.outputDirectory);assert.equal(fs.readdirSync(output).length,0,'SYNTHETIC_PUBLIC_OUTPUT_MUST_BE_EMPTY');const write=publicSaver(output),receipts=[],save=(name,value)=>{const ref=write(name,{...value,syntheticOnly:true,nativeAuthority:false});receipts.push(ref);return ref;};
  const api=await publicImageGet('api',input.apiUrl,{budget:input.budget,guard:input.guard,save},{fetchImpl:input.fetchImpl,clock:input.clock});
  const web=await publicImageGet('web',input.webUrl,{budget:input.budget,guard:input.guard,save},{fetchImpl:input.fetchImpl,clock:input.clock});
  return{api,web,receipts,syntheticOnly:true,nativeAuthority:false};
}
async function browserRoles({file,readiness,afterImageObservedAt,planSha256,budget,guard,save}){
  guard();const allocation=bffAllocationReportV3(budget),last=Math.min(Date.now()+120000,Date.parse(allocation.effectiveDeadlineAt)-1000);assert(last>Date.now(),'BFF_EXTERNAL_WINDOW_EXPIRED');
  save('POST-BROWSER-ROLE-OBSERVATIONS-REQUIRED',{schemaVersion:3,kind:'POST_BROWSER_ROLE_OBSERVATIONS_REQUIRED_V3',path:file,afterImageObservedAt,planSha256,roles:readiness.recipe.actors.map(a=>({key:a.key,role:a.role,campusId:a.campusId})),deadlineAt:new Date(last).toISOString(),allocation:allocation.allocation,allocationSha256:allocation.allocationSha256,measuredDecodedBodyLimit:262144,observationsNotYetQualified:true});
  async function waitForObservationFile(){if(fs.existsSync(file)||Date.now()>=last){return;}guard();await new Promise(resolve=>setTimeout(resolve,1000));return waitForObservationFile();}
  await waitForObservationFile();guard();assert(fs.existsSync(file),'POST_BROWSER_ROLE_OBSERVATIONS_NOT_AVAILABLE');
  const result=acceptBrowserBffPacketV3(publicJson(file),{budget,readiness,afterImageObservedAt,planSha256,now:Date.now()});guard();save('POST-BFF-EXTERNAL-BUDGET-COMPOSITION',result.externalReadBudget);return result.roles;
}
function watchedTransport(transport,observed){return Object.freeze({...transport,
  async getService(kind){const value=await transport.getService(kind);observed[kind]={...observed[kind],service:structuredClone(value)};return value;},
  async getRevision(kind,name){const value=await transport.getRevision(kind,name);observed[kind]={...observed[kind],revision:structuredClone(value),observedAt:new Date().toISOString()};return value;},
});}
function emptyOutputAndBudget(directory,output,binding,applicationOrigins){
  assert.equal(fs.readdirSync(directory).length,0,'FORWARD_REQUIRES_NEW_EMPTY_IMAGE_JOURNAL');assert.equal(fs.readdirSync(output).length,0,'FORWARD_REQUIRES_NEW_EMPTY_OUTPUT');
  const budgetDirectory=directory+'-native-session';assert(!fs.existsSync(budgetDirectory),'FORWARD_NATIVE_SESSION_ALREADY_ENTERED');fs.mkdirSync(budgetDirectory);
  return createImageSessionBudget({directory:imageExternalDirectory(budgetDirectory),binding,applicationOrigins});
}
function publicPreparation(x,source,phase,general,expiry){return makeImageForwardPreparationV2({phase,objectiveId:x.descriptor.objectiveId,dossier:x.dossier,plan:x.plan,source,postReadiness:x.liveReadinessRef??x.descriptor.postReadiness,general,now:Date.now(),expiresAt:expiry});}
// One closed adapter over the existing executor, GENERAL and separate POST.
// JSON contains only pinned inputs/paths, never callbacks or alternate tools.
export async function runImageForwardOperationalV2(args){
  let stage='FORWARD_INPUTS',sdk,budget,postAuthority,postResult,generalResult,save,result;
  try{
    assert.equal(process.versions.node,'22.23.3');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
    const options=parseImageForwardArgumentsV2(args),source=readImageOperationalSource(),x=forwardInputs(publicJson(options['--input']));
    const directory=imageExternalDirectory(options['--journal-dir']),output=imageExternalDirectory(options['--output-dir']),jiraBytes=readPoolPrivateFile(options['--jira-evidence'],65536),github=createReadOnlyGithubReader();assert.notEqual(directory,output);assert.equal(fs.readdirSync(output).length,0,'FORWARD_REQUIRES_NEW_EMPTY_OUTPUT');save=publicSaver(output);
    readImageForwardPublicReferenceV2(x.descriptor.general.dossier);
    assert.equal(digest(x.generalRecord),x.dossier.pendingGeneral.prospectiveAuthoritySha256);
    assert.equal(digest(x.postDossier),digest(x.candidate.readOnlyPostJob.dossier));
    stage='FORWARD_GOVERNANCE';const authority=await authorizeImageOnlyDriver({github,objectiveId:x.descriptor.objectiveId,dossier:x.dossier,plan:x.plan,candidate:x.candidate,baseline:x.baseline,localSource:source,jiraBytes,action:'READ_METADATA',preparationPhase:'BACKUP_READY',readEvidence:readPoolPrivateFile});
    assert.equal(authority.entry.journalDirectorySha256,hash(directory));
    const lease=makeImageForwardLocalLeaseV2({authority,dossier:x.dossier,plan:x.plan,candidate:x.candidate,baseline:x.baseline,source,jiraBytes,assertSource:fixedSourceGuard});
    postAuthority=await acquireImagePostAuthorityV2({objectiveId:x.descriptor.post.objectiveId,dossier:x.postDossier,jiraBytes,journalDirectory:x.descriptor.post.journalDirectory,preparationPhase:'POST_EXECUTION'});assert.deepEqual(postAuthority.source,source);
    const binding=x.sessionBinding;validateSessionBinding(binding,authority,source,'RC48_SERVICE_IMAGE_ONLY_V1',authority.entry.resourceBindings);
    let phase='BACKUP_READY',currentAuthority=lease.current('READ_METADATA',phase,Date.now()),preparation,completionContext,backupFin;
    const expiry=new Date(Math.min(Date.parse(authority.receipt.expiresAt),Date.parse(postAuthority.authority.receipt.expiresAt),Date.parse(binding.windowEnd))).toISOString();
    preparation=publicPreparation(x,source,phase,null,expiry);
    const qualify=(a,now)=>validateImagePreparationV2({bytes:Buffer.from(JSON.stringify(preparation)),entry:a.entry,dossier:x.dossier,plan:x.plan,baseline:x.baseline,source,readEvidence:readPoolPrivateFile,readSource:readImageForwardCollectorSourceV2,journalDirectory:directory,action:preparation.preparationPhase==='BACKUP_READY'?'CREATE_BACKUP':'PATCH_API',now});
    validateImageIndependentEvidenceV2(x.dossier,{plan:x.plan,baseline:x.baseline,source,readEvidence:readPoolPrivateFile,now:Date.now()});
    bindImageLivePostReadinessV2(x.postReadiness,x.dossier.postReadiness,readPoolPrivateFile);
    budget=makeReservedBffBudgetV3(emptyOutputAndBudget(directory,output,binding,[x.postReadiness.recipe.apiOrigin,x.postReadiness.recipe.webOrigin]),{sessionBindingSha256:digest(binding),leaseExpiresAt:expiry,actorCount:x.postReadiness.recipe.actors.length});
    save('FORWARD-EXTERNAL-BFF-RESERVATION',bffAllocationReportV3(budget));
    const guard=()=>{fixedSourceGuard(source);lease.current('READ_METADATA',phase,Date.now());assertAuthorityCurrent(postAuthority.authority,Date.now());const s=budget.inspect();assert(!s.stopped&&s.remainingMs>0);};
    save('FORWARD-ENTRY-START',{schemaVersion:2,kind:'SOURCE_BOUND_FORWARD_ENTRY_START_V2',objectiveId:x.descriptor.objectiveId,source,binding,dossierSha256:digest(x.dossier),planSha256:digest(x.plan),at:new Date().toISOString(),runCapabilityNotYetArmed:true});
    stage='FORWARD_AUTHENTICATION';sdk=await openOfficialSdkOperationalSession({operationContract:{schemaVersion:2,kind:'OFFICIAL_SDK_OPERATIONAL_RESOURCE_SESSION_V2',...binding,sourceTree:source.tree,googleAccount:'casablancaynovcampus@gmail.com'},getAuthority:()=>lease.current('READ_METADATA','BACKUP_READY',Date.now()),assertCurrent:guard});assert.equal(sdk.report().authenticationChainValidated,true,'FORWARD_SDK_AUTHENTICATION_REFUSED');
    const observed={},native=createImageOperationalTransport({binding,plan:x.plan,accessToken:sdk.accessToken,getAuthority:()=>currentAuthority,sessionBudget:budget}),transport=watchedTransport(native,observed);
    const executor=createImageOnlyExecutor({plan:x.plan,candidate:x.candidate,baseline:x.baseline,source,dossier:x.dossier,objectiveId:x.descriptor.objectiveId,journalDirectory:directory,transport,
      authorizeFresh:async action=>{currentAuthority=lease.current(action,phase,Date.now());return currentAuthority;},qualifyPreparation:qualify,saveReceipt:async(stageName,value)=>save(stageName+'-NATIVE-FIN',value),getCompletionContext:()=>completionContext});
    const adapter={
      assertLocalState:async()=>guard(),
      prepareBackupReady:async()=>{currentAuthority=lease.current('TEST_PERMISSIONS',phase,Date.now());await transport.testProjectPermissions();await transport.testServicePermissions('api');await transport.testServicePermissions('web');await transport.testJobPermissions();transport.assertGeneralPermissionsReady();
        const runtimeContract=makeImagePostRuntimeContractV2({authority:postAuthority.authority,dossier:x.postDossier,source,sharedBudget:budget,preparationPhase:'POST_EXECUTION'});
        const fresh=await observeImagePostUnusedResourceV2({objectiveId:x.descriptor.post.objectiveId,dossier:x.postDossier,jiraBytes,journalDirectory:x.descriptor.post.journalDirectory,authorityCapability:postAuthority.authorityCapability,sharedBudget:budget,runtimeContract,accessToken:sdk.accessToken,save,assertSessionCurrent:guard});
        assert.equal(fresh.state,'FIN_POST_UNUSED_RESOURCE_OBSERVED_V2');assert.equal(fresh.uid,x.candidate.readOnlyPostJob.uid);
        const jobRead=readImageForwardPublicReferenceV2(fresh.jobObservation);
        const live={...x.postReadiness,preparedAt:new Date().toISOString(),expiresAt:new Date(Math.min(Date.parse(expiry),Date.parse(jobRead.requestStartedAt)+600000)).toISOString(),postJobObservationRef:fresh.jobObservation};delete live.staticPostContractSha256;
        x.postReadiness=bindImageLivePostReadinessV2(live,x.dossier.postReadiness,readPoolPrivateFile);x.liveReadinessRef=save('POST-LIVE-READY-BINDING',x.postReadiness);preparation=publicPreparation(x,source,phase,null,expiry);return qualify(currentAuthority,Date.now());},
      runGeneral:async value=>{
        backupFin=value.backupFin;generalResult=await runGeneralOperationalPreV3({root:path.resolve(import.meta.dirname,'../../..'),record:x.generalRecord,humanAuthorityBytes:readPoolPrivateFile('C:/Crm Ynov/output/casablanca-pilot-20261022/crm-operational-continuation-20261030-v1/HUMAN-ADDITIVE-OPERATIONAL-AUTHORITY.json'),dossierBytes:x.generalDossierBytes,jiraBytes,consumerInputs:x.consumerInputs,evidenceDirectory:x.generalRecord.evidenceDirectory,sharedBudget:budget,accessToken:sdk.accessToken,permissionEvidence:()=>transport.permissionEvidence(),
          verifyCutoverReady:({recordSha256})=>{guard();qualify(currentAuthority,Date.now());return{schemaVersion:3,kind:'SOURCE_BOUND_IMAGE_GENERAL_PRE_READY_V3',generalAuthorityRecordSha256:recordSha256,imageAuthorityRecordSha256:authority.receipt.authorityRecordSha256,staticDossierSha256:digest(x.dossier),imagePlanSha256:digest(x.plan),backupFin:backupFin.backup,postReadinessSha256:x.liveReadinessRef.sha256,verifiedAt:new Date().toISOString(),expiresAt:expiry,commonSessionBindingSha256:digest(binding)};},
          readPrivateKey:()=>readPoolPrivateFile(x.descriptor.general.privateKeyFile,16384).toString('utf8')});return generalResult;
      },
      qualifyFinal:async value=>{assert.equal(value.state,'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED');completionContext=value.completionContext;const next=publicPreparation(x,source,'FORWARD_FINAL',value.sourceProofRef,expiry),nextAuthority=lease.current('PATCH_API','FORWARD_FINAL',Date.now());const previous=preparation;preparation=next;try{const checked=qualify(nextAuthority,Date.now());phase='FORWARD_FINAL';currentAuthority=nextAuthority;return checked;}catch(error){preparation=previous;throw error;}},
      runPost:async({webFin,afterImageObservedAt})=>{
        const webProof=readImageForwardPublicReferenceV2(webFin.nativeReceipt);
        const apiAt=webProof.relatedServed.api.observedAt,webAt=webProof.served.observedAt;
        assert.equal(new Date(Math.max(Date.parse(apiAt),Date.parse(webAt))).toISOString(),webFin.servedObservedAt);
        const imageContext={plan:x.plan,candidate:x.candidate,baseline:x.baseline,imageAuthority:lease.current('READ_METADATA',phase,Date.now()),api:{...observed.api,observedAt:apiAt},web:{...observed.web,observedAt:webAt}};
        const runtimeContract=makeImagePostRuntimeContractV2({authority:postAuthority.authority,dossier:x.postDossier,source,sharedBudget:budget,preparationPhase:'POST_EXECUTION'});
        postResult=await runImagePostReadOnlyV2({objectiveId:x.descriptor.post.objectiveId,dossier:x.postDossier,jiraBytes,journalDirectory:x.descriptor.post.journalDirectory,authorityCapability:postAuthority.authorityCapability,sharedBudget:budget,runtimeContract,accessToken:sdk.accessToken,save,assertSessionCurrent:guard,imageContext,privateKeyFile:x.descriptor.post.privateKeyFile});
        assert.equal(postResult.afterImageObservedAt,afterImageObservedAt);return postResult;
      },
      verifyPost:async({afterImageObservedAt})=>{
        const sql=await withVerifiedImagePostV2(postResult.privatePostCapability,({checked,capturedAt})=>compareImagePostUsingPrivateGeneralV2({privatePreCapability:generalResult.privatePreCapability,postChecked:checked,consumerInputs:x.consumerInputs,expectedGeneralAuthorityRecordSha256:x.dossier.pendingGeneral.prospectiveAuthoritySha256,postCapturedAt:capturedAt,afterImageObservedAt,now:Date.now()}));
        const apiHttp=await publicImageGet('api',x.postReadiness.recipe.apiOrigin+'/health/ready',{budget,guard,save});
        const webHttp=await publicImageGet('web',x.postReadiness.recipe.webOrigin+'/',{budget,guard,save});
        const publicHttp=[apiHttp,webHttp];
        const roles=await browserRoles({file:x.descriptor.roleObservationsFile,readiness:x.postReadiness,afterImageObservedAt,planSha256:digest(x.plan),budget,guard,save});
        const postJobs=await transport.collectJobs(),postSchedulers=await transport.collectSchedulers();
        const postCompletion={schemaVersion:2,completions:[...completionContext.completions,...postResult.completionContext.completions]};
        const {validateUnpatchedResourceClaims}=await import('./plan.mjs');validateUnpatchedResourceClaims(x.plan,{jobs:postJobs,schedulers:postSchedulers,observedAt:new Date().toISOString()},postCompletion);
        const receipt=save('RUNTIME-POST-COMPOSITION-FIN',{schemaVersion:2,kind:'RC48_RUNTIME_POST_COMPOSITION_V2',planSha256:digest(x.plan),afterImageObservedAt,sql,publicHttp,roles,externalBffBudget:bffFinalCompositionV3(budget),preservedJobsAndSchedulersChecked:true,otherFivePreparationFamiliesRemainDistinct:true,authenticatedSessionRoleScopeOnly:true,endpointPermissionMatrixQualified:false,visualWorkflowQualified:false,rolesUiAcceptance:false,fullPortfolioCoverage:false,sheetsActivated:false});
        return{schemaVersion:2,kind:'RC48_IMAGE_POST_SOURCE_CHECKED_V2',planSha256:digest(x.plan),afterImageObservedAt,sqlPreservationClaimsChecked:true,httpRoleClaimsChecked:true,sheetsActivated:false,receipt};
      },
      releasePost:async()=>{releaseVerifiedImagePostV2(postResult?.privatePostCapability);releaseVerifiedGeneralPreV3(generalResult?.privatePreCapability);},
      saveReceipt:async(name,value)=>save(name,value),
    };
    stage='FORWARD_SEQUENCE';result=await runImageForwardSequenceV2({objectiveId:x.descriptor.objectiveId,planSha256:digest(x.plan),staticDossierSha256:digest(x.dossier),source:projectionSource(source),sessionBindingSha256:digest(binding),sdkSession:sdk,sharedBudget:budget,executor,adapter});
  }catch{result={schemaVersion:2,kind:'RC48_FORWARD_ENTRY_STOP_V2',state:'FORWARD_ENTRY_STOPPED_NO_AUTOMATIC_RETRY',guardStage:stage,runReplayAuthorized:false,sheetsActivated:false,canRetry:false};}
  finally{
    result=cleanupEntry(result,{sdk,budget,postAuthority,postResult,generalResult,stopCode:'FORWARD_ENTRY_CLOSED'});
  }
  return entryTerminal(result,{sdk,budget,save,name:'FORWARD-ENTRY-FIN'});
}
