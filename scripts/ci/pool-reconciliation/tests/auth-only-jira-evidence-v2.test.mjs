// SYNTHETIC ONLY. No native connector, SDK, resource, filesystem or RUN calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {byteHash} from '../controlled-pool-contract-v1.mjs';
import {validateNativeJiraReadObservation,validateProspectiveAuthorityRecord} from '../general-prospective-pre-authority-v1.mjs';
import {AUTH_JIRA_V2_KIND,AUTH_JIRA_NATIVE_READ_KIND,AUTH_JIRA_EXPECTED_BINDINGS,AUTH_JIRA_CONNECTION_ORIGIN,AUTH_JIRA_READ_TOOLS,AUTH_JIRA_TICKET_REQUEST,AUTH_JIRA_REFUSAL_CODES,diagnosticAuthOnlyJiraRefusal,
  canonicalAuthJiraBytes,validateAuthOnlyComposedJiraObservation} from '../auth-only-jira-evidence-v2.mjs';
const NOW=Date.parse('2026-10-30T10:00:00.000Z'),GRANT='a'.repeat(64),ACTOR='shademounir',SECRET='PRIVATE_SYNTHETIC_VALUE_NEVER_PROJECT';
const instant=offset=>new Date(NOW+offset).toISOString();
const hash=value=>byteHash(canonicalAuthJiraBytes(value));
function reference(role,response,start,end){
  const receipt={schemaVersion:2,kind:AUTH_JIRA_NATIVE_READ_KIND,role,...AUTH_JIRA_READ_TOOLS[role],connectionOrigin:{...AUTH_JIRA_CONNECTION_ORIGIN},
    requestStartedAt:instant(start),responseReceivedAt:instant(end),request:role==='ticket'?structuredClone(AUTH_JIRA_TICKET_REQUEST):{},response,
    successfulRead:true,responseRepresentation:'CONTENT_JSON',structuredContentReturned:false,providerInvocationId:null,providerContextAbsent:true,
    providerCryptographicSignatureAsserted:false,noCredentialsTokensCookiesOrHeadersStored:true};
  return{receipt,receiptSha256:hash(receipt),requestSha256:hash(receipt.request),responseSha256:hash(receipt.response)};
}
function fixture(){return{schemaVersion:2,kind:AUTH_JIRA_V2_KIND,mode:'AUTH_ONLY',observedBy:ACTOR,grantDigest:GRANT,
  localObservationId:'local:67b13329-7bb5-4c3b-84ce-6ba129132688',localObservationIdOrigin:'LOCAL_GENERATED_NOT_PROVIDER',providerInvocationId:null,
  providerContextAbsent:true,providerCryptographicSignatureAsserted:false,atomicProviderSnapshotAsserted:false,commonCredentialIdentityAsserted:false,
  identity:reference('identity',{accountId:AUTH_JIRA_EXPECTED_BINDINGS.accountId},-1000,-900),
  tenant:reference('tenant',{resources:[{cloudId:AUTH_JIRA_EXPECTED_BINDINGS.cloudId,url:AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl}]},-800,-700),
  ticket:reference('ticket',{id:'10681',key:'CRMY-63',issueType:'Task',status:'In Review',labels:['codex-ready'],
    links:[{id:'11388',type:'Blocks',inward:{key:'CRMY-61',status:'Done'},outward:null}]},-600,-500),
  expectedBindings:{...AUTH_JIRA_EXPECTED_BINDINGS},oldestRequestStartedAt:instant(-1000),latestResponseReceivedAt:instant(-500),
  sourceReadinessOnly:true,notPersonalHumanApproval:true,noJiraMutation:true,businessMutationAuthorized:false,gcpResourceAccessAuthorized:false,
  runAuthorized:false,productionDeploymentAuthorized:false};}
function rehash(value){for(const role of ['identity','tenant','ticket']){const r=value[role];r.receiptSha256=hash(r.receipt);r.requestSha256=hash(r.receipt.request);r.responseSha256=hash(r.receipt.response);}return value;}
function validate(value=fixture(),options={}){const bytes=canonicalAuthJiraBytes(value);return validateAuthOnlyComposedJiraObservation(bytes,{expectedSha256:byteHash(bytes),actor:ACTOR,grantSha256:GRANT,now:NOW,...options});}
function refused(value,code,stage,options){assert.throws(()=>validate(value,options),error=>error.name==='AuthOnlyJiraEvidenceError'&&error.code===code&&error.stage===stage&&!error.message.includes(SECRET));}

test('three observed official-route reads without provider context compose only AUTH_ONLY readiness',()=>{
  const r=validate();assert.equal(r.schemaVersion,2);assert.equal(r.observedAt,instant(-1000));assert.equal(r.expiresAt,instant(599000));assert.equal(r.latestResponseReceivedAt,instant(-500));
  assert.equal(r.accountId,AUTH_JIRA_EXPECTED_BINDINGS.accountId);assert.equal(r.cloudId,AUTH_JIRA_EXPECTED_BINDINGS.cloudId);assert.equal(r.ticket,'CRMY-63');assert.equal(r.dependency,'CRMY-61');
  assert.equal(r.providerInvocationId,null);assert.equal(r.providerCryptographicSignatureAsserted,false);assert.equal(r.commonCredentialIdentityAsserted,false);assert.equal(r.atomicProviderSnapshotAsserted,false);
  assert.equal(r.localObservationIdOrigin,'LOCAL_GENERATED_NOT_PROVIDER');assert.equal(r.connectionMatchingBasis,AUTH_JIRA_CONNECTION_ORIGIN.matchingBasis);assert(Object.isFrozen(r));
  assert.equal(r.runAuthorized,false);assert.equal(r.gcpResourceAccessAuthorized,false);assert.equal(r.businessMutationAuthorized,false);assert.equal(r.productionDeploymentAuthorized,false);
  assert.equal(r.noJiraMutation,true);assert.equal(r.sourceReadinessOnly,true);assert.equal(r.notPersonalHumanApproval,true);
});
test('canonicalization is deterministic key-sorted UTF8 with one trailing newline',()=>{assert.equal(canonicalAuthJiraBytes({z:['é',true,null,1],a:{b:2}}).toString(),'\x7b"a":{"b":2},"z":["é",true,null,1]}\n');});
test('input objects are not mutated or returned by reference',()=>{const f=fixture(),before=JSON.stringify(f);validate(f);assert.equal(JSON.stringify(f),before);});
test('diagnostic projects only recognized closed code and actual stage, never a foreign message',()=>{
  const f=fixture();f.identity.receipt.response.accountId='another';let failure;try{validate(rehash(f));}catch(error){failure=error;}
  const d=diagnosticAuthOnlyJiraRefusal(failure);assert.deepEqual(d,{code:'AUTH_JIRA_V2_ACCOUNT',stage:'IDENTITY'});assert(Object.isFrozen(d));assert(AUTH_JIRA_REFUSAL_CODES.includes(d.code));
  assert.equal(diagnosticAuthOnlyJiraRefusal(new Error(SECRET)),null);assert.equal(diagnosticAuthOnlyJiraRefusal({code:'AUTH_JIRA_V2_ACCOUNT',stage:'IDENTITY',message:SECRET}),null);assert.equal(diagnosticAuthOnlyJiraRefusal(null),null);
});
test('provider connection metadata may be retained only consistently and without credential identity claim',()=>{
  const f=fixture();for(const role of ['identity','tenant','ticket'])Object.assign(f[role].receipt.connectionOrigin,{providerConnectionId:'provider-returned-connection-7',providerAccountId:AUTH_JIRA_EXPECTED_BINDINGS.accountId,providerCloudId:AUTH_JIRA_EXPECTED_BINDINGS.cloudId});
  assert.equal(validate(rehash(f)).commonCredentialIdentityAsserted,false);
});
test('additional accessible tenants neither grant resource rights nor replace the unique exact target',()=>{const f=fixture();f.tenant.receipt.response.resources.push({cloudId:'4cfae020-8dce-4b65-956e-eb034e86f08e',url:'https://another-site.atlassian.net'});assert.equal(validate(rehash(f)).gcpResourceAccessAuthorized,false);});
test('done additional inward Blocks and a valid outward issue preserve readiness',()=>{const f=fixture();f.ticket.receipt.response.links.push({id:'11389',type:'Blocks',inward:{key:'CRMY-62',status:'Done'},outward:null},{id:'11390',type:'Relates',inward:null,outward:{key:'CRMY-64',status:'In Progress'}});assert.equal(validate(rehash(f)).ticket,'CRMY-63');});

for(const[field,value,code]of[
  ['schemaVersion',1,'AUTH_JIRA_V2_SCOPE'],['kind','GENERAL_PROSPECTIVE_PRE_SINGLE_OBSERVATION_AUTHORITY_V1','AUTH_JIRA_V2_SCOPE'],['mode','RUN','AUTH_JIRA_V2_SCOPE'],
  ['observedBy','another','AUTH_JIRA_V2_ACTOR'],['grantDigest','b'.repeat(64),'AUTH_JIRA_V2_GRANT'],
  ['localObservationId','67b13329-7bb5-4c3b-84ce-6ba129132688','AUTH_JIRA_V2_PROVENANCE'],['localObservationId','local:invalid','AUTH_JIRA_V2_PROVENANCE'],
  ['localObservationIdOrigin','PROVIDER','AUTH_JIRA_V2_PROVENANCE'],['providerInvocationId','67b13329-7bb5-4c3b-84ce-6ba129132688','AUTH_JIRA_V2_PROVENANCE'],
  ['providerContextAbsent',false,'AUTH_JIRA_V2_PROVENANCE'],['providerCryptographicSignatureAsserted',true,'AUTH_JIRA_V2_PROVENANCE'],
  ['atomicProviderSnapshotAsserted',true,'AUTH_JIRA_V2_PROVENANCE'],['commonCredentialIdentityAsserted',true,'AUTH_JIRA_V2_PROVENANCE'],
])test('envelope refuses '+field,()=>{const f=fixture();f[field]=value;refused(f,code,'ENVELOPE');});
for(const key of ['sourceReadinessOnly','notPersonalHumanApproval','noJiraMutation','businessMutationAuthorized','gcpResourceAccessAuthorized','runAuthorized','productionDeploymentAuthorized'])test('authority flag cannot be weakened '+key,()=>{const f=fixture();f[key]=!f[key];refused(f,'AUTH_JIRA_V2_FLAGS','ENVELOPE');});
for(const key of ['oldestRequestStartedAt','observedBy','mode','expectedBindings'])test('missing exact composite field '+key,()=>{const f=fixture();delete f[key];refused(f,'AUTH_JIRA_V2_FIELDS','ENVELOPE');});
for(const key of ['recordedAt','createdAt','capabilityId','invocationId','credential','extra'])test('no substitute freshness/provider/authority field '+key,()=>{const f=fixture();f[key]=SECRET;refused(f,'AUTH_JIRA_V2_FIELDS','ENVELOPE');});
test('wrong bindings cannot override fixed expected account or ticket URL',()=>{const f=fixture();f.expectedBindings.ticketId='10682';refused(f,'AUTH_JIRA_V2_SCOPE','ENVELOPE');});

for(const role of ['identity','tenant','ticket']){
  const stage=role.toUpperCase();
  for(const[field,value,code]of[
    ['schemaVersion',1,'AUTH_JIRA_V2_READ'],['kind','SHAPE-ONLY','AUTH_JIRA_V2_READ'],['role','other','AUTH_JIRA_V2_READ'],
    ['sourceTool','another','AUTH_JIRA_V2_READ'],['sourceToolFullyQualified','mcp__codex_apps__atlassian_rovo__legacy_getjiraissue','AUTH_JIRA_V2_READ'],
    ['successfulRead',false,'AUTH_JIRA_V2_READ'],['responseRepresentation','UI','AUTH_JIRA_V2_READ'],['structuredContentReturned',true,'AUTH_JIRA_V2_READ'],
    ['noCredentialsTokensCookiesOrHeadersStored',false,'AUTH_JIRA_V2_READ'],['providerInvocationId','local:67b13329-7bb5-4c3b-84ce-6ba129132688','AUTH_JIRA_V2_PROVENANCE'],
    ['providerContextAbsent',false,'AUTH_JIRA_V2_PROVENANCE'],['providerCryptographicSignatureAsserted',true,'AUTH_JIRA_V2_PROVENANCE'],
  ])test(role+' refuses read field '+field,()=>{const f=fixture();f[role].receipt[field]=value;refused(rehash(f),code,stage);});
  test(role+' refuses absent native request timing (SHAPE-ONLY cannot be upgraded)',()=>{const f=fixture();f[role].receipt.requestStartedAt=null;refused(rehash(f),'AUTH_JIRA_V2_TIMING',stage);});
  test(role+' refuses missing receipt exact field',()=>{const f=fixture();delete f[role].receipt.successfulRead;refused(rehash(f),'AUTH_JIRA_V2_FIELDS',stage);});
  test(role+' refuses added native recordedAt fallback',()=>{const f=fixture();f[role].receipt.recordedAt=instant(-100);refused(rehash(f),'AUTH_JIRA_V2_FIELDS',stage);});
  for(const field of ['receiptSha256','requestSha256','responseSha256'])test(role+' refuses '+field+' mismatch',()=>{const f=fixture();f[role][field]='b'.repeat(64);refused(f,'AUTH_JIRA_V2_HASH',stage);});
  test(role+' refuses a hidden alternative reference field',()=>{const f=fixture();f[role].path='other.json';refused(f,'AUTH_JIRA_V2_FIELDS',stage);});
  test(role+' refuses alternate request',()=>{const f=fixture();f[role].receipt.request.extra=SECRET;refused(rehash(f),'AUTH_JIRA_V2_REQUEST',stage);});
  for(const[field,value]of[['toolNamespace','legacy'],['route','ANOTHER_CONNECTION'],['matchingBasis','SAME_CREDENTIAL_ATTESTED'],['providerConnectionId','local:fake'],['providerAccountId','wrong'],['providerCloudId','wrong']])test(role+' refuses unrelatable origin '+field,()=>{const f=fixture();f[role].receipt.connectionOrigin[field]=value;refused(rehash(f),'AUTH_JIRA_V2_CONNECTION',stage);});
  test(role+' refuses missing origin',()=>{const f=fixture();delete f[role].receipt.connectionOrigin.route;refused(rehash(f),'AUTH_JIRA_V2_FIELDS',stage);});
  test(role+' refuses absent response field',()=>{const f=fixture();f[role].receipt.response={};refused(rehash(f),'AUTH_JIRA_V2_FIELDS',stage);});
  test(role+' future response cannot become current proof',()=>{const f=fixture();f[role].receipt.responseReceivedAt=instant(1);refused(rehash(f),'AUTH_JIRA_V2_TIMING',stage);});
  test(role+' reversed request/response timing refuses',()=>{const f=fixture();f[role].receipt.requestStartedAt=instant(-100);refused(rehash(f),'AUTH_JIRA_V2_TIMING',stage);});
  test(role+' noncanonical timestamp refuses',()=>{const f=fixture();f[role].receipt.requestStartedAt='2026-10-30T09:59:00Z';refused(rehash(f),'AUTH_JIRA_V2_TIMING',stage);});
}
test('different real connection IDs refuse despite matching account and tenant',()=>{const f=fixture();for(const role of ['identity','tenant','ticket'])f[role].receipt.connectionOrigin.providerConnectionId='real-one';f.ticket.receipt.connectionOrigin.providerConnectionId='real-two';refused(rehash(f),'AUTH_JIRA_V2_CONNECTION','COMPOSITION');});
test('mixed returned/absent connection IDs refuse',()=>{const f=fixture();f.tenant.receipt.connectionOrigin.providerConnectionId='real-one';refused(rehash(f),'AUTH_JIRA_V2_CONNECTION','COMPOSITION');});
test('mixed returned/absent account/cloud connection context refuses',()=>{const f=fixture();f.identity.receipt.connectionOrigin.providerAccountId=AUTH_JIRA_EXPECTED_BINDINGS.accountId;refused(rehash(f),'AUTH_JIRA_V2_CONNECTION','COMPOSITION');});
test('wrong observed account refuses at identity stage',()=>{const f=fixture();f.identity.receipt.response.accountId='another';refused(rehash(f),'AUTH_JIRA_V2_ACCOUNT','IDENTITY');});
for(const[name,change]of[
  ['wrong cloud',r=>r.resources[0].cloudId='4cfae020-8dce-4b65-956e-eb034e86f08e'],['wrong URL',r=>r.resources[0].url='https://other.atlassian.net'],
  ['noncanonical URL',r=>r.resources[0].url+='/' ],['nonHTTPS',r=>r.resources[0].url=r.resources[0].url.replace('https:','http:')],['external origin',r=>r.resources[0].url='https://example.com'],
  ['empty list',r=>r.resources=[]],['duplicate target',r=>r.resources.push({...r.resources[0]})],['malformed ID',r=>r.resources[0].cloudId='invalid'],
  ['same cloud conflicting URL',r=>r.resources.push({cloudId:r.resources[0].cloudId,url:'https://other.atlassian.net'})],
  ['URL parser failure',r=>r.resources[0].url='https://[invalid'],['too many resources',r=>r.resources=Array.from({length:101},()=>({...r.resources[0]}))],
])test('tenant refuses '+name,()=>{const f=fixture();change(f.tenant.receipt.response);refused(rehash(f),'AUTH_JIRA_V2_TENANT','TENANT');});
for(const key of ['id','key','issueType','status'])test('ticket refuses wrong '+key,()=>{const f=fixture();f.ticket.receipt.response[key]='wrong';refused(rehash(f),'AUTH_JIRA_V2_TICKET','TICKET');});
for(const labels of [[],['codex-ready','codex-ready'],['codex-ready',''],['codex-ready','line\nfeed'],['codex-ready','x'.repeat(129)],Array.from({length:101},(_,i)=>'label'+i),null])test('ticket rejects malformed labels '+JSON.stringify(labels).slice(0,35),()=>{const f=fixture();f.ticket.receipt.response.labels=labels;refused(rehash(f),'AUTH_JIRA_V2_LABELS','TICKET');});
for(const label of ['blocked','codex-blocked','BLOCKED','Codex-Blocked'])test('case-insensitive blocked label '+label,()=>{const f=fixture();f.ticket.receipt.response.labels.push(label);refused(rehash(f),'AUTH_JIRA_V2_BLOCKED','TICKET');});
for(const[name,change,code]of[
  ['absent dependency',r=>r.links=[],'AUTH_JIRA_V2_DEPENDENCY'],['wrong dependency',r=>r.links[0].inward.key='CRMY-62','AUTH_JIRA_V2_DEPENDENCY'],
  ['undone dependency',r=>r.links[0].inward.status='In Progress','AUTH_JIRA_V2_BLOCKED'],
  ['undone other dependency',r=>r.links.push({id:'11389',type:'Blocks',inward:{key:'CRMY-62',status:'In Progress'},outward:null}),'AUTH_JIRA_V2_BLOCKED'],
  ['duplicate link ID',r=>r.links.push({...r.links[0]}),'AUTH_JIRA_V2_LINKS'],['duplicate prerequisite with unique ID',r=>r.links.push({...r.links[0],id:'11389'}),'AUTH_JIRA_V2_DEPENDENCY'],
  ['two directions',r=>r.links[0].outward={key:'CRMY-62',status:'Done'},'AUTH_JIRA_V2_LINKS'],['no direction',r=>r.links[0].inward=null,'AUTH_JIRA_V2_LINKS'],
  ['invalid link ID',r=>r.links[0].id='fake','AUTH_JIRA_V2_LINKS'],['numeric link ID',r=>r.links[0].id=1,'AUTH_JIRA_V2_LINKS'],
  ['invalid type',r=>r.links[0].type='','AUTH_JIRA_V2_LINKS'],['invalid issue key',r=>r.links[0].inward.key='OTHER-61','AUTH_JIRA_V2_LINKS'],
  ['invalid edge status',r=>r.links[0].inward.status='','AUTH_JIRA_V2_LINKS'],['too many links',r=>r.links=Array.from({length:101},()=>({...r.links[0]})),'AUTH_JIRA_V2_LINKS'],
  ['nonarray links',r=>r.links=null,'AUTH_JIRA_V2_LINKS'],
])test('ticket refuses '+name,()=>{const f=fixture();change(f.ticket.receipt.response);refused(rehash(f),code,'TICKET');});

test('oldest actual request age600000 inclusive is accepted without extending expiry',()=>{const f=fixture();f.identity.receipt.requestStartedAt=instant(-600000);f.oldestRequestStartedAt=instant(-600000);const r=validate(rehash(f));assert.equal(r.expiresAt,instant(0));});
test('age600001 refuses although two later reads remain fresh',()=>{const f=fixture();f.identity.receipt.requestStartedAt=instant(-600001);f.oldestRequestStartedAt=instant(-600001);refused(rehash(f),'AUTH_JIRA_V2_FRESHNESS','COMPOSITION');});
test('latest response cannot reset oldest age',()=>{const f=fixture();f.oldestRequestStartedAt=f.latestResponseReceivedAt;refused(f,'AUTH_JIRA_V2_TIMING','COMPOSITION');});
test('a later completion timestamp must match actual maximum receipt time',()=>{const f=fixture();f.latestResponseReceivedAt=instant(-100);refused(f,'AUTH_JIRA_V2_TIMING','COMPOSITION');});
test('invalid claimed oldest date refuses',()=>{const f=fixture();f.oldestRequestStartedAt='invalid';refused(f,'AUTH_JIRA_V2_TIMING','COMPOSITION');});
test('noninteger now cannot validate a proof',()=>{refused(fixture(),'AUTH_JIRA_V2_FRESHNESS','COMPOSITION',{now:NOW+0.5});});
test('V2 bytes are refused by unchanged V1 Jira validator and GENERAL authority record',()=>{const bytes=canonicalAuthJiraBytes(fixture());assert.throws(()=>validateNativeJiraReadObservation(bytes,{expectedSha256:byteHash(bytes),actor:ACTOR,grantSha256:GRANT,now:NOW}));assert.throws(()=>validateProspectiveAuthorityRecord(fixture(),NOW));});
for(const mode of ['GENERAL','GENERAL_PRESERVATION_READ_ONLY_V1','SYNTHETIC_FUTURE_RUN'])test('V2 cannot relabel its scope as '+mode,()=>{const f=fixture();f.mode=mode;refused(f,'AUTH_JIRA_V2_SCOPE','ENVELOPE');});

for(const bytes of [Buffer.alloc(0),Buffer.alloc(65537),null,'{}'])test('invalid byte input '+String(bytes?.length),()=>{assert.throws(()=>validateAuthOnlyComposedJiraObservation(bytes,{expectedSha256:GRANT,actor:ACTOR,grantSha256:GRANT,now:NOW}),error=>error.code==='AUTH_JIRA_V2_BYTES');});
test('outer minimized byte hash must match',()=>{const bytes=canonicalAuthJiraBytes(fixture());assert.throws(()=>validateAuthOnlyComposedJiraObservation(bytes,{expectedSha256:GRANT,actor:ACTOR,grantSha256:GRANT,now:NOW}),error=>error.code==='AUTH_JIRA_V2_HASH');});
for(const text of ['{broken',JSON.stringify(fixture()),canonicalAuthJiraBytes(fixture()).toString().replace('"schemaVersion":2','"schemaVersion":1,"schemaVersion":2')])test('malformed/noncanonical/duplicate JSON refuses '+text.slice(0,20),()=>{const bytes=Buffer.from(text);assert.throws(()=>validateAuthOnlyComposedJiraObservation(bytes,{expectedSha256:byteHash(bytes),actor:ACTOR,grantSha256:GRANT,now:NOW}),error=>['AUTH_JIRA_V2_JSON','AUTH_JIRA_V2_CANONICAL'].includes(error.code));});
for(const value of [undefined,()=>{},NaN,new Date(),new Map(),Object.create(null),Object.assign([], {extra:true}),Array(2)])test('canonical builder rejects non-plain/unsupported input '+typeof value,()=>{assert.throws(()=>canonicalAuthJiraBytes(value));});
test('canonical builder does not invoke an accessor or toJSON callback',()=>{let calls=0;const accessor={};Object.defineProperty(accessor,'secret',{enumerable:true,get(){calls++;throw Error(SECRET);}});assert.throws(()=>canonicalAuthJiraBytes(accessor));assert.throws(()=>canonicalAuthJiraBytes({toJSON(){calls++;throw Error(SECRET);}}));assert.equal(calls,0);});
test('canonical builder refuses symbols, nonenumerable object properties, deep nesting and oversized data',()=>{const symbol={};symbol[Symbol('secret')]=SECRET;const hidden={};Object.defineProperty(hidden,'hidden',{value:SECRET});let deep={};for(let n=0;n<42;n++)deep={child:deep};for(const value of [symbol,hidden,deep,{large:'x'.repeat(65536)}])assert.throws(()=>canonicalAuthJiraBytes(value));});
