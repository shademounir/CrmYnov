// Local composition of three official reads, AUTH_ONLY exclusively. It is not
// a provider invocation/signature, common-credential attestation or atomic read.
// Pure validation only: no filesystem, connector, SDK, SQL or RUN operations.
import assert from 'node:assert/strict';
import {canonical,byteHash} from './controlled-pool-contract-v1.mjs';
import {dataFields,canonicalTime,NATIVE_JIRA_BINDING} from './general-prospective-pre-authority-v1.mjs';

export const AUTH_JIRA_V2_KIND='AUTH_ONLY_COMPOSED_OFFICIAL_JIRA_READINESS_V2';
export const AUTH_JIRA_NATIVE_READ_KIND='AUTH_ONLY_OFFICIAL_JIRA_NATIVE_READ_V2';
export const AUTH_JIRA_EXPECTED_BINDINGS=Object.freeze({accountId:NATIVE_JIRA_BINDING.accountId,cloudId:NATIVE_JIRA_BINDING.cloudId,
  tenantUrl:'https://mounirbaali-1778581315657.atlassian.net',ticketUrl:NATIVE_JIRA_BINDING.url,
  ticketUrlOrigin:'DERIVED_FROM_EXACT_TENANT_AND_EXPECTED_TICKET_NOT_PROVIDER_CONTEXT',ticketKey:NATIVE_JIRA_BINDING.key,
  ticketId:NATIVE_JIRA_BINDING.id,issueType:NATIVE_JIRA_BINDING.issueType,status:NATIVE_JIRA_BINDING.status,
  dependencyKey:NATIVE_JIRA_BINDING.dependency,dependencyStatus:'Done'});
export const AUTH_JIRA_CONNECTION_ORIGIN=Object.freeze({toolNamespace:'mcp__codex_apps__atlassian',route:'PRIMARY_OFFICIAL_BOUND_CONNECTOR_ROUTE',
  providerConnectionId:null,providerAccountId:null,providerCloudId:null,
  matchingBasis:'OBSERVED_SAME_BOUND_CONNECTOR_ROUTE_NOT_COMMON_CREDENTIAL_ATTESTATION'});
export const AUTH_JIRA_READ_TOOLS=Object.freeze({
  identity:Object.freeze({sourceTool:'atlassianUserInfo',sourceToolFullyQualified:'mcp__codex_apps__atlassian_atlassianuserinfo'}),
  tenant:Object.freeze({sourceTool:'getAccessibleAtlassianResources',sourceToolFullyQualified:'mcp__codex_apps__atlassian_getaccessibleatlassianresources'}),
  ticket:Object.freeze({sourceTool:'getJiraIssue',sourceToolFullyQualified:'mcp__codex_apps__atlassian_getjiraissue'}),
});
export const AUTH_JIRA_TICKET_REQUEST=Object.freeze({cloudId:NATIVE_JIRA_BINDING.cloudId,issueIdOrKey:NATIVE_JIRA_BINDING.key,
  fields:Object.freeze(['status','issuetype','labels','issuelinks']),view:'full',actionSource:'model_tool_call'});
const HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MAX_BYTES=65536,ROLES=Object.freeze(['identity','tenant','ticket']);
const CODES=new Set(['AUTH_JIRA_V2_BYTES','AUTH_JIRA_V2_HASH','AUTH_JIRA_V2_JSON','AUTH_JIRA_V2_CANONICAL',
  'AUTH_JIRA_V2_FIELDS','AUTH_JIRA_V2_SCOPE','AUTH_JIRA_V2_ACTOR','AUTH_JIRA_V2_GRANT','AUTH_JIRA_V2_PROVENANCE',
  'AUTH_JIRA_V2_CONNECTION','AUTH_JIRA_V2_READ','AUTH_JIRA_V2_REQUEST','AUTH_JIRA_V2_RESPONSE','AUTH_JIRA_V2_ACCOUNT',
  'AUTH_JIRA_V2_TENANT','AUTH_JIRA_V2_TICKET','AUTH_JIRA_V2_LABELS','AUTH_JIRA_V2_LINKS','AUTH_JIRA_V2_BLOCKED',
  'AUTH_JIRA_V2_DEPENDENCY','AUTH_JIRA_V2_TIMING','AUTH_JIRA_V2_FRESHNESS','AUTH_JIRA_V2_FLAGS']);
export const AUTH_JIRA_REFUSAL_CODES=Object.freeze([...CODES]);
const STAGES=new Set(['ENVELOPE','IDENTITY','TENANT','TICKET','COMPOSITION']);
class AuthOnlyJiraEvidenceError extends Error{
  constructor(code,stage){assert(CODES.has(code)&&STAGES.has(stage));super(code);this.name='AuthOnlyJiraEvidenceError';Object.defineProperties(this,{code:{value:code,enumerable:true},stage:{value:stage,enumerable:true}});}
}
// Never project a foreign error's message/body or an unrecognized code.
export function diagnosticAuthOnlyJiraRefusal(error){return error instanceof AuthOnlyJiraEvidenceError?Object.freeze({code:error.code,stage:error.stage}):null;}
function requireFact(condition,code,stage){if(!condition)throw new AuthOnlyJiraEvidenceError(code,stage);}
function atStage(stage,code,operation){try{return operation();}catch(error){if(error instanceof AuthOnlyJiraEvidenceError)throw error;throw new AuthOnlyJiraEvidenceError(code,stage);}}
function exact(value,fields,stage){atStage(stage,'AUTH_JIRA_V2_FIELDS',()=>dataFields(value,fields));}
function plainJsonData(value,depth=0){
  assert(depth<=40,'JSON_DEPTH_BOUND');
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'){assert(Number.isFinite(value));return;}
  assert(value&&typeof value==='object');assert.equal(Object.getOwnPropertySymbols(value).length,0);
  const descriptors=Object.getOwnPropertyDescriptors(value);assert(Object.values(descriptors).every(d=>Object.hasOwn(d,'value')));
  if(Array.isArray(value)){
    assert.equal(Object.getPrototypeOf(value),Array.prototype);assert.equal(Object.keys(value).length,value.length);
    assert(Object.keys(value).every((key,index)=>key===String(index)));for(const item of value)plainJsonData(item,depth+1);return;
  }
  assert.equal(Object.getPrototypeOf(value),Object.prototype);assert(Object.values(descriptors).every(d=>d.enumerable));
  for(const item of Object.values(value))plainJsonData(item,depth+1);
}
// The sole serialization accepted for retained minimized objects. Round-trip
// equality below rejects duplicate keys, alternate encodings and ambiguous JSON.
export function canonicalAuthJiraBytes(value){plainJsonData(value);const bytes=Buffer.from(canonical(value)+'\n','utf8');assert(bytes.length<=MAX_BYTES);return bytes;}
function parseEnvelope(bytes,expectedSha256){
  requireFact(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_BYTES,'AUTH_JIRA_V2_BYTES','ENVELOPE');
  requireFact(HASH.test(expectedSha256)&&byteHash(bytes)===expectedSha256,'AUTH_JIRA_V2_HASH','ENVELOPE');
  const value=atStage('ENVELOPE','AUTH_JIRA_V2_JSON',()=>JSON.parse(bytes));
  const roundTrip=atStage('ENVELOPE','AUTH_JIRA_V2_CANONICAL',()=>canonicalAuthJiraBytes(value));
  requireFact(bytes.equals(roundTrip),'AUTH_JIRA_V2_CANONICAL','ENVELOPE');return value;
}
function projectionHash(value,pin,stage){const bytes=atStage(stage,'AUTH_JIRA_V2_CANONICAL',()=>canonicalAuthJiraBytes(value));requireFact(HASH.test(pin)&&byteHash(bytes)===pin,'AUTH_JIRA_V2_HASH',stage);}
function flags(value,stage){
  for(const key of ['sourceReadinessOnly','notPersonalHumanApproval','noJiraMutation'])requireFact(value[key]===true,'AUTH_JIRA_V2_FLAGS',stage);
  for(const key of ['businessMutationAuthorized','gcpResourceAccessAuthorized','runAuthorized','productionDeploymentAuthorized'])requireFact(value[key]===false,'AUTH_JIRA_V2_FLAGS',stage);
}
function provenance(value,stage){
  requireFact(value.providerInvocationId===null&&value.providerContextAbsent===true&&value.providerCryptographicSignatureAsserted===false,'AUTH_JIRA_V2_PROVENANCE',stage);
}
function connection(value,stage){
  exact(value,Object.keys(AUTH_JIRA_CONNECTION_ORIGIN),stage);
  for(const key of ['toolNamespace','route','matchingBasis'])requireFact(value[key]===AUTH_JIRA_CONNECTION_ORIGIN[key],'AUTH_JIRA_V2_CONNECTION',stage);
  const id=value.providerConnectionId;
  requireFact(id===null||(typeof id==='string'&&id.length>0&&id.length<=128&&!/[\u0000-\u001f]/u.test(id)&&!id.startsWith('local:')),'AUTH_JIRA_V2_CONNECTION',stage);
  requireFact(value.providerAccountId===null||value.providerAccountId===NATIVE_JIRA_BINDING.accountId,'AUTH_JIRA_V2_CONNECTION',stage);
  requireFact(value.providerCloudId===null||value.providerCloudId===NATIVE_JIRA_BINDING.cloudId,'AUTH_JIRA_V2_CONNECTION',stage);
}
function readReceipt(reference,role,now){
  const stage=role.toUpperCase();exact(reference,['receipt','receiptSha256','requestSha256','responseSha256'],stage);
  const r=reference.receipt;projectionHash(r,reference.receiptSha256,stage);
  exact(r,['schemaVersion','kind','role','sourceTool','sourceToolFullyQualified','connectionOrigin','requestStartedAt','responseReceivedAt','request','response',
    'successfulRead','responseRepresentation','structuredContentReturned','providerInvocationId','providerContextAbsent','providerCryptographicSignatureAsserted','noCredentialsTokensCookiesOrHeadersStored'],stage);
  requireFact(r.schemaVersion===2&&r.kind===AUTH_JIRA_NATIVE_READ_KIND&&r.role===role,'AUTH_JIRA_V2_READ',stage);
  requireFact(r.sourceTool===AUTH_JIRA_READ_TOOLS[role].sourceTool&&r.sourceToolFullyQualified===AUTH_JIRA_READ_TOOLS[role].sourceToolFullyQualified,'AUTH_JIRA_V2_READ',stage);
  connection(r.connectionOrigin,stage);provenance(r,stage);
  requireFact(r.successfulRead===true&&r.responseRepresentation==='CONTENT_JSON'&&r.structuredContentReturned===false&&r.noCredentialsTokensCookiesOrHeadersStored===true,'AUTH_JIRA_V2_READ',stage);
  projectionHash(r.request,reference.requestSha256,stage);projectionHash(r.response,reference.responseSha256,stage);
  const expected=role==='ticket'?AUTH_JIRA_TICKET_REQUEST:{};
  requireFact(canonical(r.request)===canonical(expected),'AUTH_JIRA_V2_REQUEST',stage);
  const started=atStage(stage,'AUTH_JIRA_V2_TIMING',()=>canonicalTime(r.requestStartedAt));
  const received=atStage(stage,'AUTH_JIRA_V2_TIMING',()=>canonicalTime(r.responseReceivedAt));
  requireFact(started<=received&&received<=now,'AUTH_JIRA_V2_TIMING',stage);return{receipt:r,started,received};
}
function identityResponse(value){exact(value,['accountId'],'IDENTITY');requireFact(value.accountId===NATIVE_JIRA_BINDING.accountId,'AUTH_JIRA_V2_ACCOUNT','IDENTITY');}
function tenantResponse(value){
  exact(value,['resources'],'TENANT');requireFact(Array.isArray(value.resources)&&value.resources.length>0&&value.resources.length<=100,'AUTH_JIRA_V2_TENANT','TENANT');
  for(const r of value.resources){
    exact(r,['cloudId','url'],'TENANT');requireFact(typeof r.cloudId==='string'&&UUID.test(r.cloudId)&&typeof r.url==='string'&&r.url.length<=256,'AUTH_JIRA_V2_TENANT','TENANT');
    const url=atStage('TENANT','AUTH_JIRA_V2_TENANT',()=>new URL(r.url));
    requireFact(url.protocol==='https:'&&url.origin===r.url&&url.hostname.endsWith('.atlassian.net'),'AUTH_JIRA_V2_TENANT','TENANT');
    if(r.cloudId===NATIVE_JIRA_BINDING.cloudId||r.url===AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl){requireFact(r.cloudId===NATIVE_JIRA_BINDING.cloudId&&r.url===AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl,'AUTH_JIRA_V2_TENANT','TENANT');}
  }
  requireFact(new Set(value.resources.map(r=>r.cloudId)).size===value.resources.length&&new Set(value.resources.map(r=>r.url)).size===value.resources.length,'AUTH_JIRA_V2_TENANT','TENANT');
  requireFact(value.resources.filter(r=>r.cloudId===NATIVE_JIRA_BINDING.cloudId&&r.url===AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl).length===1,'AUTH_JIRA_V2_TENANT','TENANT');
}
function text(value,max){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/u.test(value);}
function edge(value){if(value===null)return;exact(value,['key','status'],'TICKET');requireFact(/^CRMY-[1-9]\d{0,7}$/u.test(value.key)&&text(value.status,80),'AUTH_JIRA_V2_LINKS','TICKET');}
function dependencies(links){
  requireFact(Array.isArray(links)&&links.length<=100,'AUTH_JIRA_V2_LINKS','TICKET');
  for(const link of links){
    exact(link,['id','type','inward','outward'],'TICKET');requireFact(typeof link.id==='string'&&/^[1-9]\d{0,15}$/u.test(link.id)&&text(link.type,80),'AUTH_JIRA_V2_LINKS','TICKET');
    edge(link.inward);edge(link.outward);requireFact((link.inward===null)!==(link.outward===null),'AUTH_JIRA_V2_LINKS','TICKET');
    if(link.type==='Blocks'&&link.inward!==null)requireFact(link.inward.status==='Done','AUTH_JIRA_V2_BLOCKED','TICKET');
  }
  requireFact(new Set(links.map(link=>link.id)).size===links.length,'AUTH_JIRA_V2_LINKS','TICKET');
  requireFact(links.filter(link=>link.type==='Blocks'&&link.inward?.key===NATIVE_JIRA_BINDING.dependency).length===1,'AUTH_JIRA_V2_DEPENDENCY','TICKET');
}
function ticketResponse(value){
  exact(value,['id','key','issueType','status','labels','links'],'TICKET');
  for(const key of ['id','key','issueType','status'])requireFact(value[key]===NATIVE_JIRA_BINDING[key],'AUTH_JIRA_V2_TICKET','TICKET');
  const labels=value.labels;requireFact(Array.isArray(labels)&&labels.length<=100&&labels.every(label=>text(label,128)),'AUTH_JIRA_V2_LABELS','TICKET');
  requireFact(new Set(labels).size===labels.length&&labels.includes('codex-ready'),'AUTH_JIRA_V2_LABELS','TICKET');
  requireFact(!labels.some(label=>['blocked','codex-blocked'].includes(label.toLowerCase())),'AUTH_JIRA_V2_BLOCKED','TICKET');dependencies(value.links);
}
function envelope(value,actor,grantSha256){
  exact(value,['schemaVersion','kind','mode','observedBy','grantDigest','localObservationId','localObservationIdOrigin','providerInvocationId','providerContextAbsent',
    'providerCryptographicSignatureAsserted','atomicProviderSnapshotAsserted','commonCredentialIdentityAsserted','identity','tenant','ticket','expectedBindings',
    'oldestRequestStartedAt','latestResponseReceivedAt','sourceReadinessOnly','notPersonalHumanApproval','noJiraMutation','businessMutationAuthorized','gcpResourceAccessAuthorized','runAuthorized','productionDeploymentAuthorized'],'ENVELOPE');
  requireFact(value.schemaVersion===2&&value.kind===AUTH_JIRA_V2_KIND&&value.mode==='AUTH_ONLY','AUTH_JIRA_V2_SCOPE','ENVELOPE');
  requireFact(typeof actor==='string'&&value.observedBy===actor,'AUTH_JIRA_V2_ACTOR','ENVELOPE');
  requireFact(HASH.test(grantSha256)&&value.grantDigest===grantSha256,'AUTH_JIRA_V2_GRANT','ENVELOPE');
  requireFact(typeof value.localObservationId==='string'&&value.localObservationId.startsWith('local:')&&UUID.test(value.localObservationId.slice(6))&&value.localObservationIdOrigin==='LOCAL_GENERATED_NOT_PROVIDER','AUTH_JIRA_V2_PROVENANCE','ENVELOPE');
  provenance(value,'ENVELOPE');requireFact(value.atomicProviderSnapshotAsserted===false&&value.commonCredentialIdentityAsserted===false,'AUTH_JIRA_V2_PROVENANCE','ENVELOPE');
  requireFact(canonical(value.expectedBindings)===canonical(AUTH_JIRA_EXPECTED_BINDINGS),'AUTH_JIRA_V2_SCOPE','ENVELOPE');flags(value,'ENVELOPE');
}
function composition(value,reads,now){
  const origins=reads.map(read=>canonical(read.receipt.connectionOrigin));requireFact(new Set(origins).size===1,'AUTH_JIRA_V2_CONNECTION','COMPOSITION');
  const oldest=Math.min(...reads.map(read=>read.started)),latest=Math.max(...reads.map(read=>read.received));
  const claimedOldest=atStage('COMPOSITION','AUTH_JIRA_V2_TIMING',()=>canonicalTime(value.oldestRequestStartedAt));
  const claimedLatest=atStage('COMPOSITION','AUTH_JIRA_V2_TIMING',()=>canonicalTime(value.latestResponseReceivedAt));
  requireFact(claimedOldest===oldest&&claimedLatest===latest,'AUTH_JIRA_V2_TIMING','COMPOSITION');
  requireFact(Number.isSafeInteger(now)&&oldest<=now&&now-oldest<=600000,'AUTH_JIRA_V2_FRESHNESS','COMPOSITION');
  return Object.freeze({schemaVersion:2,kind:'AUTH_ONLY_COMPOSED_JIRA_READINESS_PROJECTION_V2',source:'OFFICIAL_ATLASSIAN_CONNECTOR_COMPOSED_READS_AUTH_ONLY',
    observedAt:value.oldestRequestStartedAt,expiresAt:new Date(oldest+600000).toISOString(),latestResponseReceivedAt:value.latestResponseReceivedAt,
    observedBy:value.observedBy,accountId:NATIVE_JIRA_BINDING.accountId,cloudId:NATIVE_JIRA_BINDING.cloudId,ticket:NATIVE_JIRA_BINDING.key,
    dependency:NATIVE_JIRA_BINDING.dependency,providerInvocationId:null,providerCryptographicSignatureAsserted:false,
    localObservationId:value.localObservationId,localObservationIdOrigin:'LOCAL_GENERATED_NOT_PROVIDER',atomicProviderSnapshotAsserted:false,
    commonCredentialIdentityAsserted:false,connectionMatchingBasis:AUTH_JIRA_CONNECTION_ORIGIN.matchingBasis,
    sourceReadinessOnly:true,notPersonalHumanApproval:true,noJiraMutation:true,businessMutationAuthorized:false,gcpResourceAccessAuthorized:false,runAuthorized:false,productionDeploymentAuthorized:false});
}
export function validateAuthOnlyComposedJiraObservation(bytes,{expectedSha256,actor,grantSha256,now}){
  return atStage('ENVELOPE','AUTH_JIRA_V2_FIELDS',()=>{
    const value=parseEnvelope(bytes,expectedSha256);envelope(value,actor,grantSha256);
    const reads=ROLES.map(role=>readReceipt(value[role],role,now));
    identityResponse(reads[0].receipt.response);tenantResponse(reads[1].receipt.response);ticketResponse(reads[2].receipt.response);
    return composition(value,reads,now);
  });
}
