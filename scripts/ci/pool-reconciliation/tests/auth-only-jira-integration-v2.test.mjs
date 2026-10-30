// Pure synthetic composition through the existing concrete governance validators.
// No positive actual entry, SDK, connector, network, historical DB or RUN is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {byteHash,digest} from '../controlled-pool-contract-v1.mjs';
import {AUTH_HUMAN_SHA256,AUTH_SDK_CACHE_HUMAN_SHA256,AUTH_JIRA_V2_HUMAN_SHA256,AUTH_NEW_FILES,AUTH_PREFLIGHT_DRIVER_INPUTS,AUTH_JIRA_V2_NEW_FILES,AUTH_JIRA_V2_DRIVER_INPUTS,
  authRecordVersion,authDriverInputs,validateAuthOnlyRecord,validateJiraV2HumanAuthority,authorizeAuthOnlyPreflight,simulateAuthOnlyGovernance,authGuard,authRefusalDiagnostic} from '../general-auth-preflight-authority-v1.mjs';
import {AUTH_JIRA_V2_QUAL_STATUS,AUTH_JIRA_V2_EXISTING_DELTA,validateAuthSourceQualification,inspectProspectiveAuthOnlyReadiness,runProspectiveAuthPreflightV2,runProspectiveGeneralPreV2,simulateAuthOnlySession} from '../general-prospective-pre-session-v2.mjs';
import {AUTH_JIRA_V2_KIND,AUTH_JIRA_NATIVE_READ_KIND,AUTH_JIRA_EXPECTED_BINDINGS,AUTH_JIRA_CONNECTION_ORIGIN,AUTH_JIRA_READ_TOOLS,AUTH_JIRA_TICKET_REQUEST,canonicalAuthJiraBytes} from '../auth-only-jira-evidence-v2.mjs';
import {NATIVE_JIRA_BINDING} from '../general-prospective-pre-authority-v1.mjs';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,scopeDigest} from '../../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH} from '../../../pr-policy/github-code-review.mjs';
const NOW=Date.parse('2026-10-30T10:00:00.000Z'),H='a'.repeat(64),SECRET='PRIVATE_SYNTHETIC_DIAGNOSTIC_MUST_NOT_ESCAPE';
const instant=offset=>new Date(NOW+offset).toISOString(),hash=value=>byteHash(canonicalAuthJiraBytes(value));
function record(version=2,jiraEvidenceVersion=2){
  const value={schemaVersion:version,kind:'GENERAL_COMPLETE_AUTH_PREFLIGHT_AUTHORITY_V'+version,mode:'AUTH_ONLY',humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,
    validFrom:instant(-1000),expiresAt:instant(60000),qualificationSha256:H,source:{commit:'2'.repeat(40),tree:'3'.repeat(40),head:'1'.repeat(40),pr:302,files:[]}};
  if(version===2)Object.assign(value,{jiraEvidenceVersion,jiraV2HumanAuthorityReceiptSha256:AUTH_JIRA_V2_HUMAN_SHA256});
  value.source.files=authDriverInputs(value).map(p=>({path:p,sha256:byteHash('// synthetic '+p)}));return value;
}
function readRef(role,response,start,end){
  const receipt={schemaVersion:2,kind:AUTH_JIRA_NATIVE_READ_KIND,role,...AUTH_JIRA_READ_TOOLS[role],connectionOrigin:{...AUTH_JIRA_CONNECTION_ORIGIN},requestStartedAt:instant(start),responseReceivedAt:instant(end),
    request:role==='ticket'?structuredClone(AUTH_JIRA_TICKET_REQUEST):{},response,successfulRead:true,responseRepresentation:'CONTENT_JSON',structuredContentReturned:false,
    providerInvocationId:null,providerContextAbsent:true,providerCryptographicSignatureAsserted:false,noCredentialsTokensCookiesOrHeadersStored:true};
  return{receipt,receiptSha256:hash(receipt),requestSha256:hash(receipt.request),responseSha256:hash(receipt.response)};
}
function composedJira(gd){return{schemaVersion:2,kind:AUTH_JIRA_V2_KIND,mode:'AUTH_ONLY',observedBy:'shademounir',grantDigest:gd,
  localObservationId:'local:b99b80b8-9cea-4b72-9303-5148a6c1f59f',localObservationIdOrigin:'LOCAL_GENERATED_NOT_PROVIDER',providerInvocationId:null,providerContextAbsent:true,
  providerCryptographicSignatureAsserted:false,atomicProviderSnapshotAsserted:false,commonCredentialIdentityAsserted:false,
  identity:readRef('identity',{accountId:AUTH_JIRA_EXPECTED_BINDINGS.accountId},-1000,-900),
  tenant:readRef('tenant',{resources:[{cloudId:AUTH_JIRA_EXPECTED_BINDINGS.cloudId,url:AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl}]},-800,-700),
  ticket:readRef('ticket',{id:'10681',key:'CRMY-63',issueType:'Task',status:'In Review',labels:['codex-ready'],links:[{id:'11388',type:'Blocks',inward:{key:'CRMY-61',status:'Done'},outward:null}]},-600,-500),
  expectedBindings:{...AUTH_JIRA_EXPECTED_BINDINGS},oldestRequestStartedAt:instant(-1000),latestResponseReceivedAt:instant(-500),sourceReadinessOnly:true,notPersonalHumanApproval:true,
  noJiraMutation:true,businessMutationAuthorized:false,gcpResourceAccessAuthorized:false,runAuthorized:false,productionDeploymentAuthorized:false};}
function oldJira(gd){return{observedAt:instant(-1000),source:NATIVE_JIRA_BINDING.source,executor:'Codex',observedBy:'shademounir',grantDigest:gd,accountId:NATIVE_JIRA_BINDING.accountId,cloudId:NATIVE_JIRA_BINDING.cloudId,
  invocationId:'b99b80b8-9cea-4b72-9303-5148a6c1f59f',url:NATIVE_JIRA_BINDING.url,ticket:{key:'CRMY-63',id:'10681',issueType:'Task',status:'In Review',labels:['codex-ready'],codexReady:true,blocked:false,
    links:[{id:'11388',type:'Blocks',inward:{key:'CRMY-61',status:'Done'},outward:null}]},sourceReadinessOnly:true,notPersonalHumanApproval:true,productionDeploymentAuthorized:false,noJiraMutation:true};}
function qualification(source=record().source){return{
  status:AUTH_JIRA_V2_QUAL_STATUS,base:'d123032cc46b5fc08fa524615e090c3fe8f3f313',allOtherSourcesUnchanged:true,oldHostV1Unchanged:true,
  changedExistingSourcePaths:[...AUTH_JIRA_V2_EXISTING_DELTA],addedSourcePaths:[...AUTH_JIRA_V2_NEW_FILES],jiraV2HumanAuthority:{sha256:AUTH_JIRA_V2_HUMAN_SHA256},
  previousQualification:{sha256:'cb9f78025bac81377b81f0961701241520304d3e49aa03ee165b4047e36154c0'},sourceFrozen:true,sdkCalls:0,nativeCalls:0,productionSqlQueries:0,dockerCalls:0,
  oldUnknownAndClosedClaimsUnchanged:true,newRunCapacityArmed:false,rootTotals:{pass:3100,fail:0,cancelled:0,skipped:3},targetedTests:{pass:204,fail:0,cancelled:0,skipped:0},
  stages:['ROOT-SYNTHETIC','REPOSITORY-STATIC-lint','REPOSITORY-STATIC-type-check','REPOSITORY-STATIC-build'].map(name=>({name,exitCode:0,errorCode:null})),
  humanAuthority:{sha256:AUTH_HUMAN_SHA256},humanSdkStandardCacheClarification:{sha256:AUTH_SDK_CACHE_HUMAN_SHA256},sources:source.files.map(f=>({...f})),sourceCount:source.files.length};}
function governance(version=2,jiraEvidenceVersion=2){
  const r=record(version,jiraEvidenceVersion),usesComposition=version===2&&jiraEvidenceVersion===2,source=r.source,base='/repos/shademounir/CrmYnov/',revision='6'.repeat(40),responses=new Map(),calls=[];let current=NOW;
  const grant=JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/codex-delegation.json',import.meta.url))),gd=grantDigest(grant);
  const blob=value=>({encoding:'base64',content:Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64')});
  const put=(route,value)=>responses.set(route,value),user={login:'shademounir',type:'User'};
  put('/user',user);put(base+'branches/develop',{protected:true,commit:{sha:revision}});
  put(base+'branches/develop/protection',{enforce_admins:{enabled:true},required_status_checks:{strict:true,contexts:['pr-policy']},required_conversation_resolution:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}});
  for(const ref of [source.head,revision])put(base+'contents/'+GRANT_PATH+'?ref='+ref,blob(grant));
  put(base+'contents/'+GITHUB_CODE_REVIEW_POLICY_PATH+'?ref='+revision,blob(JSON.parse(fs.readFileSync(new URL('../../../../docs/governance/github-code-review-policy.json',import.meta.url)))));
  put(base+'compare/'+source.commit+'...'+revision,{merge_base_commit:{sha:source.commit},status:'ahead'});put(base+'git/commits/'+source.commit,{tree:{sha:source.tree}});
  for(const file of source.files)put(base+'contents/'+file.path+'?ref='+source.commit,blob('// synthetic '+file.path));
  const changed=version===2?[...AUTH_JIRA_V2_EXISTING_DELTA,...AUTH_JIRA_V2_NEW_FILES]:[...AUTH_NEW_FILES];
  const checks=DELEGATED_CHECKS.map((name,i)=>({id:30200+i,name,status:'completed',conclusion:'success',head_sha:source.head}));
  checks.push({id:30299,name:'pr-policy',status:'completed',conclusion:'success',head_sha:source.head},{id:30300,name:'simulate',status:'completed',conclusion:'success',head_sha:source.head});
  const decision={schemaVersion:1,executor:'Codex',decision:'approved',grantId:grant.id,grantDigest:gd,pullRequest:302,headSha:source.head,scopeDigest:scopeDigest(changed),
    checks:checks.filter(c=>!['pr-policy','simulate'].includes(c.name)).map(c=>({name:c.name,id:c.id})),evidence:['https://example.test/synthetic'],reservations:[],rollback:'Protected scoped revert without mutation of any CRM data.',personalVisualAcceptance:false,productionDeploymentAuthorized:false};
  const jira=usesComposition?composedJira(gd):oldJira(gd);
  const marker={schemaVersion:1,executor:'Codex',mode:'AUTH_ONLY',authorityRecordSha256:digest(r),driverCommit:source.commit,humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,
    sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,qualificationSha256:r.qualificationSha256,grantDigest:gd,jiraObservationSha256:hash(jira),expiresAt:instant(60000),businessMutation:false,runAuthorized:false};
  const comments=[{id:100,user,created_at:'2026-10-30T08:00:00Z',body:'<!-- codex-delegated-decision\n'+JSON.stringify(decision)+'\n-->'},
    {id:102,user,created_at:instant(-1000),body:''}];
  put(base+'pulls/302',{number:302,head:{sha:source.head,repo:{full_name:'shademounir/CrmYnov'}},base:{ref:'develop',repo:{full_name:'shademounir/CrmYnov'}},merge_commit_sha:source.commit,
    merged:true,draft:false,auto_merge:null,user,merged_by:user,merged_at:'2026-10-30T08:30:00Z',labels:[{name:'codex-delegated-approved'}]});
  put(base+'pulls/302/files',changed.map(filename=>({filename})));put(base+'commits/'+source.head+'/check-runs',checks);put(base+'issues/302/comments',comments);put(base+'issues/302/timeline',[]);
  const read=route=>{calls.push(route);assert(responses.has(route));return structuredClone(responses.get(route));};
  const github={get:async route=>read(route),pages:async route=>read(route),reviewThreads:async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]},reviews:{nodes:[]}})};
  const f={record:r,responses,calls,base,blob,github,marker,jira,jiraBytes:canonicalAuthJiraBytes(jira),advance(ms){current+=ms;},
    refreshMarker(){marker.authorityRecordSha256=digest(r);comments[1].body='<!-- codex-general-auth-preflight-authorization:v1 '+JSON.stringify(marker)+' -->';},
    refreshJira(){for(const role of usesComposition?['identity','tenant','ticket']:[]){const ref=jira[role];ref.receiptSha256=hash(ref.receipt);ref.requestSha256=hash(ref.receipt.request);ref.responseSha256=hash(ref.receipt.response);}f.jiraBytes=canonicalAuthJiraBytes(jira);marker.jiraObservationSha256=byteHash(f.jiraBytes);f.refreshMarker();},
    run(){return simulateAuthOnlyGovernance({syntheticOnly:true,github,record:r,jiraBytes:f.jiraBytes,localSource:{...source,clean:true},clock:()=>current});}};
  f.refreshMarker();return f;
}
function checkFailure(stage,guardCode,substage=null){return error=>{const d=authRefusalDiagnostic(error);assert.equal(d.stage,stage);if(guardCode)assert.equal(d.guardCode,guardCode);assert.equal(d.substage,substage);assert(!JSON.stringify(d).includes(SECRET));return true;};}

test('V1 closure52 and V2 additive closure58 route explicitly and retain the old record shape',()=>{
  assert.equal(AUTH_PREFLIGHT_DRIVER_INPUTS.length,52);assert.equal(AUTH_JIRA_V2_DRIVER_INPUTS.length,58);assert.equal(AUTH_JIRA_V2_NEW_FILES.length,6);
  for(const version of [1,2]){const r=record(version);assert.equal(authRecordVersion(r),version);assert.equal(validateAuthOnlyRecord(r,NOW),r);assert.deepEqual(authDriverInputs(r),version===2?AUTH_JIRA_V2_DRIVER_INPUTS:AUTH_PREFLIGHT_DRIVER_INPUTS);}
});
for(const[name,change]of[
  ['wrong version',r=>r.schemaVersion=3],['RUN mode',r=>r.mode='RUN'],['wrong Jira version',r=>r.jiraEvidenceVersion=3],['missing Jira version',r=>delete r.jiraEvidenceVersion],
  ['wrong V2 authority',r=>r.jiraV2HumanAuthorityReceiptSha256=H],['missing V2 authority',r=>delete r.jiraV2HumanAuthorityReceiptSha256],
  ['old closure only',r=>r.source.files=r.source.files.filter(f=>AUTH_PREFLIGHT_DRIVER_INPUTS.includes(f.path))],['extra RUN field',r=>r.capabilityId='fake'],
])test('record2 refuses '+name,()=>{const r=record();change(r);assert.throws(()=>validateAuthOnlyRecord(r,NOW));});
test('schemaVersion accessor is never evaluated when choosing the route',()=>{let reads=0;const r=record();Object.defineProperty(r,'schemaVersion',{get(){reads++;throw Error(SECRET);},enumerable:true});assert.throws(()=>authRecordVersion(r),/AUTH_RECORD_VERSION_DATA_REQUIRED/u);assert.throws(()=>authDriverInputs(r));assert.equal(reads,0);});
test('V1 does not implicitly accept the new record fields',()=>{const r=record(1);r.jiraEvidenceVersion=2;assert.throws(()=>validateAuthOnlyRecord(r,NOW));});
test('V2 human agreement is the immutable saved human receipt, not a caller boolean',()=>{assert.equal(AUTH_JIRA_V2_HUMAN_SHA256,'395b1f08d37beadaef5524725e32ef2ff9d75f1e406256f2bd9b93225291df3c');assert.throws(()=>validateJiraV2HumanAuthority(Buffer.from('{}')),/EXACT_JIRA_V2_HUMAN_AUTHORITY/u);});
test('Q2 binds source closure, declared delta, previous qualification and all static stages',()=>{const r=record(),q=qualification(r.source);assert.deepEqual(validateAuthSourceQualification(Buffer.from(JSON.stringify(q)),r.source,r),q);});
for(const[name,change]of[
  ['wrong status',q=>q.status='PASS'],['wrong base',q=>q.base='f'.repeat(40)],['other sources changed',q=>q.allOtherSourcesUnchanged=false],['old HOST changed',q=>q.oldHostV1Unchanged=false],
  ['delta weakened',q=>q.changedExistingSourcePaths.pop()],['additional delta',q=>q.changedExistingSourcePaths.push('scripts/pr-policy/delegation.mjs')],['new source omitted',q=>q.addedSourcePaths.pop()],
  ['previous Q replaced',q=>q.previousQualification.sha256=H],['wrong V2 human',q=>q.jiraV2HumanAuthority.sha256=H],['source unfrozen',q=>q.sourceFrozen=false],
  ['SDK called',q=>q.sdkCalls=1],['resource called',q=>q.nativeCalls=1],['SQL called',q=>q.productionSqlQueries=1],['Docker called',q=>q.dockerCalls=1],
  ['old UNKNOWN changed',q=>q.oldUnknownAndClosedClaimsUnchanged=false],['RUN armed',q=>q.newRunCapacityArmed=true],['root failure',q=>q.rootTotals.fail=1],['target skipped',q=>q.targetedTests.skipped=1],
  ['static stage absent',q=>q.stages.pop()],['static failure',q=>q.stages[2].exitCode=1],['wrong exact source',q=>q.sources[0].sha256=H],
])test('Q2 refuses '+name,()=>{const r=record(),q=qualification(r.source);change(q);assert.throws(()=>validateAuthSourceQualification(Buffer.from(JSON.stringify(q)),r.source,r));});
test('Q2 cannot be silently consumed as V1 or without explicit versioned record',()=>{const r=record(),bytes=Buffer.from(JSON.stringify(qualification(r.source)));assert.throws(()=>validateAuthSourceQualification(bytes,r.source));assert.throws(()=>validateAuthSourceQualification(bytes,r.source,record(1)));});

test('V2 governance uses existing protection, delegated decision, exact CI and protected closure validators',async()=>{
  const f=governance(),r=await f.run();assert.equal(r.syntheticOnly,true);assert.equal(r.nativeAuthority,false);assert.equal(r.receipt.jiraEvidenceSource,'OFFICIAL_ATLASSIAN_CONNECTOR_COMPOSED_READS_AUTH_ONLY');
  assert.equal(r.receipt.gitHubCodeReviewRequired,false);assert.equal(r.receipt.runAuthorized,false);assert.equal(r.receipt.gcpResourceAccessAuthorized,false);assert.equal(r.receipt.expiresAt,instant(60000));
  assert(f.calls.some(p=>p.includes('/check-runs')));assert.equal(f.calls.filter(p=>p.includes('?ref='+f.record.source.commit)).length,58);assert(!f.calls.some(p=>p.includes('readonly-probe-objectives')));
});
test('V1 source and V1 native evidence remain accepted only by explicit V1 route',async()=>{const f=governance(1),r=await f.run();assert.equal(r.receipt.jiraEvidenceSource,NATIVE_JIRA_BINDING.source);});
test('new source record explicitly selects V1 when the official response genuinely provides invocation metadata',async()=>{
  const f=governance(2,1);assert.equal(f.record.jiraEvidenceVersion,1);assert.equal(validateAuthOnlyRecord(f.record,NOW),f.record);assert.equal(f.record.source.files.length,58);
  const r=await f.run();assert.equal(r.receipt.jiraEvidenceSource,NATIVE_JIRA_BINDING.source);assert.equal(r.receipt.gitHubCodeReviewRequired,false);
  assert.equal(r.receipt.runAuthorized,false);assert.equal(r.receipt.gcpResourceAccessAuthorized,false);assert.equal(r.receipt.expiresAt,instant(60000));
  assert(f.jira.invocationId&&!f.jira.invocationId.startsWith('local:'));assert(!Object.hasOwn(f.jira,'providerContextAbsent'));assert.equal(r.nativeAuthority,false);
});
for(const[name,change,code]of[
  ['wrong native account',f=>f.jira.accountId=SECRET,'NATIVE_JIRA_ACCOUNT'],
  ['invalid native invocation',f=>f.jira.invocationId='local:'+SECRET,'NATIVE_JIRA_INVOCATION'],
  ['expired native observation',f=>f.jira.observedAt=instant(-600001),'NATIVE_JIRA_FRESHNESS'],
])test('explicit V1 preserves the real closed native guard without raw content: '+name,async()=>{
  const f=governance(2,1);change(f);f.refreshJira();await assert.rejects(f.run(),checkFailure('AUTH_JIRA_EVIDENCE',code));
  assert.equal(authRefusalDiagnostic(new Error(code),'AUTH_RECORD').guardCode,'AUTH_GUARD_REFUSED');
  assert(!JSON.stringify(authRefusalDiagnostic(new Error(code),'AUTH_RECORD')).includes(SECRET));
});
test('explicit V1 selector on new source never retries valid V2 composition after V1 refusal',async()=>{
  const f=governance(2,1);f.jiraBytes=canonicalAuthJiraBytes(composedJira(f.marker.grantDigest));f.marker.jiraObservationSha256=byteHash(f.jiraBytes);f.refreshMarker();
  await assert.rejects(f.run(),checkFailure('AUTH_JIRA_EVIDENCE'));assert.equal(f.calls.filter(p=>p===f.base+'branches/develop').length,1);
});
test('explicit V2 selector never erases returned invocation metadata to manufacture absent-provider evidence',async()=>{
  const f=governance(2,2);f.jiraBytes=canonicalAuthJiraBytes(oldJira(f.marker.grantDigest));f.marker.jiraObservationSha256=byteHash(f.jiraBytes);f.refreshMarker();
  await assert.rejects(f.run(),checkFailure('AUTH_JIRA_EVIDENCE','AUTH_JIRA_V2_FIELDS','ENVELOPE'));assert.equal(f.calls.filter(p=>p===f.base+'branches/develop').length,1);
});
test('selector is bound by the exact record digest in the operational marker',async()=>{
  const f=governance(2,1);f.record.jiraEvidenceVersion=2;await assert.rejects(f.run(),checkFailure('GITHUB_MARKER'));
});
for(const version of [0,3,'1','2',null])test('unsupported explicit Jira evidence selector refuses before governance '+JSON.stringify(version),async()=>{
  const f=governance();f.record.jiraEvidenceVersion=version;assert.throws(()=>validateAuthOnlyRecord(f.record,NOW),/EXPLICIT_AUTH_JIRA_EVIDENCE_VERSION_REQUIRED/u);
  await assert.rejects(f.run(),checkFailure('AUTH_RECORD'));assert.equal(f.calls.length,0);
});
test('explicit Jira evidence selector accessor is never invoked',()=>{let calls=0;const f=record();Object.defineProperty(f,'jiraEvidenceVersion',{enumerable:true,get(){calls++;throw Error(SECRET);}});assert.throws(()=>validateAuthOnlyRecord(f,NOW));assert.equal(calls,0);});
test('V2 does not fallback to V1 when handed old native evidence',async()=>{const f=governance();f.jiraBytes=canonicalAuthJiraBytes(oldJira(f.marker.grantDigest));f.marker.jiraObservationSha256=byteHash(f.jiraBytes);f.refreshMarker();await assert.rejects(f.run(),checkFailure('AUTH_JIRA_EVIDENCE','AUTH_JIRA_V2_FIELDS','ENVELOPE'));});
test('V1 does not fallback to V2 evidence',async()=>{const f=governance(1);f.jiraBytes=canonicalAuthJiraBytes(composedJira(f.marker.grantDigest));f.marker.jiraObservationSha256=byteHash(f.jiraBytes);f.refreshMarker();await assert.rejects(f.run(),checkFailure('AUTH_JIRA_EVIDENCE'));});
for(const[name,change,stage]of[
  ['unprotected branch',f=>f.responses.get(f.base+'branches/develop').protected=false,'GITHUB_BRANCH'],
  ['admin protection',f=>f.responses.get(f.base+'branches/develop/protection').enforce_admins.enabled=false,'GITHUB_PROTECTION'],
  ['strict CI protection',f=>f.responses.get(f.base+'branches/develop/protection').required_status_checks.strict=false,'GITHUB_PROTECTION'],
  ['conversation protection',f=>f.responses.get(f.base+'branches/develop/protection').required_conversation_resolution.enabled=false,'GITHUB_PROTECTION'],
  ['force pushes',f=>f.responses.get(f.base+'branches/develop/protection').allow_force_pushes.enabled=true,'GITHUB_PROTECTION'],
  ['deletions',f=>f.responses.get(f.base+'branches/develop/protection').allow_deletions.enabled=true,'GITHUB_PROTECTION'],
  ['wrong merge',f=>f.responses.get(f.base+'pulls/302').merge_commit_sha='f'.repeat(40),'GITHUB_SOURCE_PR'],
  ['wrong exact SHA check',f=>f.responses.get(f.base+'commits/'+f.record.source.head+'/check-runs')[0].head_sha='f'.repeat(40),'GITHUB_SOURCE_CHECKS'],
  ['failed CI',f=>f.responses.get(f.base+'commits/'+f.record.source.head+'/check-runs')[0].conclusion='failure','GITHUB_SOURCE_CHECKS'],
  ['latest simulate nonterminal',f=>f.responses.get(f.base+'commits/'+f.record.source.head+'/check-runs').push({id:99999,name:'simulate',head_sha:f.record.source.head,status:'in_progress',conclusion:null}),'GITHUB_SOURCE_CHECKS'],
  ['conversation unresolved',f=>f.github.reviewThreads=async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[{isResolved:false}]},reviews:{nodes:[]}}),'GITHUB_SOURCE_CONVERSATIONS'],
  ['changes requested',f=>f.github.reviewThreads=async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]},reviews:{nodes:[{state:'CHANGES_REQUESTED'}]}}),'GITHUB_SOURCE_CONVERSATIONS'],
  ['auto merge history',f=>f.responses.set(f.base+'issues/302/timeline',[{event:'auto_merge_enabled'}]),'GITHUB_SOURCE_CONVERSATIONS'],
  ['decision absent',f=>f.responses.get(f.base+'issues/302/comments').shift(),'GITHUB_DELEGATED_DECISION'],
  ['wrong source tree',f=>f.responses.get(f.base+'git/commits/'+f.record.source.commit).tree.sha='f'.repeat(40),'GITHUB_SOURCE_TREE'],
  ['source bytes changed',f=>f.responses.set(f.base+'contents/'+f.record.source.files[1].path+'?ref='+f.record.source.commit,f.blob('changed')),'GITHUB_SOURCE_FILES'],
  ['RUN marker',f=>{f.marker.runAuthorized=true;f.refreshMarker();},'GITHUB_MARKER'],
  ['wrong Q marker',f=>{f.marker.qualificationSha256='b'.repeat(64);f.refreshMarker();},'GITHUB_MARKER'],
  ['expired marker',f=>{f.marker.expiresAt=instant(0);f.refreshMarker();},'GITHUB_MARKER'],
  ['marker absent',f=>f.responses.get(f.base+'issues/302/comments').pop(),'GITHUB_MARKER'],
])test('V2 still refuses '+name,async()=>{const f=governance();change(f);await assert.rejects(f.run(),checkFailure(stage));});
test('source-file drift includes only its protected allowlisted relative path and stops later reads',async()=>{
  const f=governance(),source=f.record.source.files[1];f.responses.set(f.base+'contents/'+source.path+'?ref='+f.record.source.commit,f.blob(SECRET));
  await assert.rejects(f.run(),error=>{const d=authRefusalDiagnostic(error);assert.equal(d.stage,'GITHUB_SOURCE_FILES');assert.equal(d.guardCode,'PROTECTED_AUTH_SOURCE_BYTES');assert.equal(d.sourceFile,source.path);assert(AUTH_JIRA_V2_DRIVER_INPUTS.includes(d.sourceFile));assert(!JSON.stringify(d).includes(SECRET));return true;});
  assert(!f.calls.includes(f.base+'contents/'+f.record.source.files[2].path+'?ref='+f.record.source.commit));
});
for(const[name,change,code,substage]of[
  ['wrong account',f=>f.jira.identity.receipt.response.accountId='wrong','AUTH_JIRA_V2_ACCOUNT','IDENTITY'],
  ['wrong tenant',f=>f.jira.tenant.receipt.response.resources[0].cloudId='4cfae020-8dce-4b65-956e-eb034e86f08e','AUTH_JIRA_V2_TENANT','TENANT'],
  ['wrong ticket',f=>f.jira.ticket.receipt.response.key='CRMY-64','AUTH_JIRA_V2_TICKET','TICKET'],
  ['wrong connection',f=>f.jira.ticket.receipt.connectionOrigin.route='another','AUTH_JIRA_V2_CONNECTION','TICKET'],
  ['expired oldest',f=>{f.jira.identity.receipt.requestStartedAt=instant(-600001);f.jira.oldestRequestStartedAt=instant(-600001);},'AUTH_JIRA_V2_FRESHNESS','COMPOSITION'],
])test('Jira precise substage survives AUTH authority wrapper: '+name,async()=>{const f=governance();change(f);f.refreshJira();await assert.rejects(f.run(),checkFailure('AUTH_JIRA_EVIDENCE',code,substage));});
for(const[boundary,expected]of[['authority',250],['marker',350],['oldest',450]])test('minimum lease retains actual '+boundary+' expiry',async()=>{
  const f=governance();if(boundary==='authority'){f.record.expiresAt=instant(expected);f.refreshMarker();}else if(boundary==='marker'){f.marker.expiresAt=instant(expected);f.refreshMarker();}else{f.jira.identity.receipt.requestStartedAt=instant(expected-600000);f.jira.oldestRequestStartedAt=instant(expected-600000);f.refreshJira();}
  const r=await f.run();assert.equal(r.receipt.expiresAt,instant(expected));
});
test('final branch drift is refused after reading protected source',async()=>{const f=governance(),get=f.github.get;let reads=0;f.github.get=async route=>{const r=await get(route);if(route===f.base+'branches/develop'&&++reads===2)r.commit.sha='f'.repeat(40);return r;};await assert.rejects(f.run(),checkFailure('GITHUB_FINAL_BRANCH','AUTH_ONLY_GOVERNANCE_DRIFT'));});
test('final read elapsed time is included and exact60s cannot yield a lease',async()=>{const f=governance(),get=f.github.get;let reads=0;f.github.get=async route=>{const r=await get(route);if(route===f.base+'branches/develop'&&++reads===2)f.advance(60000);return r;};await assert.rejects(f.run(),checkFailure('AUTH_FINAL_LEASE','AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND'));});
test('proof expiring during final branch read cannot yield fresh authority',async()=>{
  const f=governance(),get=f.github.get;f.jira.identity.receipt.requestStartedAt=instant(-599900);f.jira.oldestRequestStartedAt=instant(-599900);f.refreshJira();let reads=0;
  f.github.get=async route=>{const r=await get(route);if(route===f.base+'branches/develop'&&++reads===2)f.advance(200);return r;};await assert.rejects(f.run(),checkFailure('AUTH_FINAL_LEASE'));
});
test('foreign errors retain stage but never message/body in diagnostics',async()=>{await assert.rejects(authGuard('GITHUB_BRANCH',async()=>{throw new Error(SECRET);}),error=>{assert.deepEqual(authRefusalDiagnostic(error),{stage:'GITHUB_BRANCH',guardCode:'AUTH_GUARD_REFUSED',substage:null,sourceFile:null});return true;});});
test('assertion diff is discarded while its exact allowlisted guard remains visible',()=>{
  assert.throws(()=>authGuard('GITHUB_SOURCE_FILES',()=>assert.equal('actual','expected','PROTECTED_AUTH_SOURCE_BYTES')),error=>{assert.equal(authRefusalDiagnostic(error).guardCode,'PROTECTED_AUTH_SOURCE_BYTES');assert(!JSON.stringify(authRefusalDiagnostic(error)).includes('actual'));return true;});
  assert.equal(authRefusalDiagnostic(new Error('PROTECTED_AUTH_SOURCE_BYTES\n'+SECRET),'GITHUB_SOURCE_FILES').guardCode,'PROTECTED_AUTH_SOURCE_BYTES');
  assert.equal(authRefusalDiagnostic(new Error('PROTECTED_AUTH_SOURCE_BYTES '+SECRET),'GITHUB_SOURCE_FILES').guardCode,'AUTH_GUARD_REFUSED');
});
test('a recognized diagnostic instance cannot be modified to leak an arbitrary code or path',()=>{
  let failure;try{authGuard('AUTH_RECORD',()=>{throw new Error('AUTH_ONLY_AUTHORITY_EXPIRED');});}catch(error){failure=error;}
  for(const key of ['stage','guardCode','substage','sourceFile'])assert.throws(()=>{failure[key]=SECRET;},TypeError);
  const d=authRefusalDiagnostic(failure);assert.equal(d.guardCode,'AUTH_ONLY_AUTHORITY_EXPIRED');assert(!JSON.stringify(d).includes(SECRET));
});
test('diagnosing a foreign message accessor never evaluates it',()=>{let called=0;const error={};Object.defineProperty(error,'message',{get(){called++;throw Error(SECRET);}});assert.equal(authRefusalDiagnostic(error,'AUTH_RECORD').guardCode,'AUTH_GUARD_REFUSED');assert.equal(called,0);});
test('expired V2 record refuses before the first synthetic GitHub call',async()=>{const f=governance();f.record.expiresAt=instant(0);await assert.rejects(f.run(),checkFailure('AUTH_RECORD','AUTH_ONLY_AUTHORITY_EXPIRED'));assert.equal(f.calls.length,0);});
test('revoked grant remains a hard AUTH_ONLY governance refusal',async()=>{const f=governance(),route=f.base+'contents/'+GRANT_PATH+'?ref='+('6'.repeat(40));const raw=JSON.parse(Buffer.from(f.responses.get(route).content,'base64'));raw.status='revoked';f.responses.set(route,f.blob(raw));await assert.rejects(f.run(),checkFailure('GITHUB_GRANT_POLICY'));});
test('malformed marker expiry identifies its real marker stage rather than prepare',async()=>{const f=governance();f.marker.expiresAt='invalid';f.refreshMarker();await assert.rejects(f.run(),checkFailure('GITHUB_MARKER'));});
test('unauthenticated synthetic human/Q bytes stop public authorization before any GitHub call',async()=>{let calls=0;await assert.rejects(authorizeAuthOnlyPreflight({record:record(),humanAuthorityBytes:Buffer.from('{}'),qualificationBytes:Buffer.from('{}'),jiraV2HumanAuthorityBytes:Buffer.from('{}'),github:{get(){calls++;}},clock:()=>NOW}),checkFailure('AUTH_HUMAN_QUALIFICATION'));assert.equal(calls,0);});
test('readiness rejects invalid/injected inputs before commands, AUTH intent or SDK',async()=>{
  let evaluated=0;const accessor={};Object.defineProperty(accessor,'record',{enumerable:true,get(){evaluated++;throw Error(SECRET);}});
  for(const input of [{},accessor,{record:record(),execute(){evaluated++;throw Error(SECRET);}},{root:'x',record:record(),jiraBytes:Buffer.from('{}'),humanAuthorityBytes:Buffer.from('{}'),qualificationBytes:Buffer.from('{}'),consumerInputs:{},jiraV2HumanAuthorityBytes:Buffer.from('{}'),authorize:true}]){
    const r=await inspectProspectiveAuthOnlyReadiness(input);assert.equal(r.state,'AUTH_ONLY_READINESS_REFUSED_BEFORE_ATTEMPT');assert.equal(r.refusal.stage,'AUTH_INPUTS');assert.equal(r.sdkCommands,0);assert.equal(r.authIntentCreated,false);assert.equal(r.authentication,null);assert.equal(r.runPosts,0);assert.equal(r.sqlQueries,0);assert.equal(r.cloudRunOrLoggingResourceCalls,0);assert(!JSON.stringify(r).includes(SECRET));
  }assert.equal(evaluated,0);
});
test('actual entry invalid input preserves explicit precise diagnosis without consuming attempt',async()=>{const r=await runProspectiveAuthPreflightV2({unknown:SECRET});assert.equal(r.state,'AUTH_ONLY_REFUSED_BEFORE_ATTEMPT');assert.equal(r.refusal.stage,'AUTH_INPUTS');assert.equal(r.authentication,null);assert.equal(r.canRetry,false);assert(!JSON.stringify(r).includes(SECRET));});
test('synthetic orchestration preserves prepare diagnostic before intent or authenticate',async()=>{const events=[];const r=await simulateAuthOnlySession({syntheticOnly:true,steps:{prepare(){events.push('prepare');return authGuard('AUTH_RECORD',()=>{throw new Error('AUTH_ONLY_AUTHORITY_EXPIRED');});},intent(){events.push('intent');},authenticate(){events.push('sdk');}}});assert.deepEqual(events,['prepare']);assert.equal(r.refusal.stage,'AUTH_RECORD');assert.equal(r.refusal.guardCode,'AUTH_ONLY_AUTHORITY_EXPIRED');assert.equal(r.authentication,null);});
test('AUTH_ONLY evidence cannot unlock real GENERAL/RUN or create a replacement capability',async()=>{await assert.rejects(runProspectiveGeneralPreV2({record:record(),jiraBytes:canonicalAuthJiraBytes(composedJira(H))}),/SEPARATE_RUN_AUTHORITY_AND_QUALIFIED_RIGHTS_RESOURCE_ADAPTER_REQUIRED/u);});
