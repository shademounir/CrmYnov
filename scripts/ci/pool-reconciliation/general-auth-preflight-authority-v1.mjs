// AUTH_ONLY has its own direct human authority. An expired GENERAL catalogue
// and a permanently closed RUN capability are deliberately NOT its authority.
import assert from 'node:assert/strict';
import {byteHash,digest} from './controlled-pool-contract-v1.mjs';
import {PROSPECTIVE_DRIVER_INPUTS,dataFields,canonicalTime,validateNativeJiraReadObservation} from './general-prospective-pre-authority-v1.mjs';
import {githubFile,assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,validateGrant,selectDelegatedDecision,validateDelegatedDecision} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH,validateProtectedCodeReviewPolicy} from '../../pr-policy/github-code-review.mjs';
import {validateRequiredChecks} from '../../release-manifest/checks.mjs';
export const AUTH_HUMAN_SHA256='21402bf950bd37d416e6bff5f157b231d1539a6a029d835c45b6d459f1c45d9d';
export const AUTH_SDK_CACHE_HUMAN_SHA256='58ed93bdeee323b5dd0ad0e3e8d15ee4509042f31c2773f214ea00db3897c3a1';
export const AUTH_JIRA_V2_HUMAN_SHA256='395b1f08d37beadaef5524725e32ef2ff9d75f1e406256f2bd9b93225291df3c';
export const AUTH_NEW_FILES=Object.freeze([
  'docs/governance/general-auth-preflight-v1.md',
  'scripts/ci/pool-reconciliation/general-auth-preflight-authority-v1.mjs',
  'scripts/ci/pool-reconciliation/general-prospective-pre-session-v2.mjs',
  'scripts/ci/pool-reconciliation/tests/general-auth-preflight-v1.test.mjs',
  'scripts/ci/readonly-probe/official-sdk-auth-preflight-v1.mjs',
  'scripts/ci/tests/general-auth-preflight.test.mjs',
]);
export const AUTH_PREFLIGHT_DRIVER_INPUTS=Object.freeze([...new Set([...PROSPECTIVE_DRIVER_INPUTS,...AUTH_NEW_FILES])].sort((a,b)=>a.localeCompare(b,'en')));
export const AUTH_JIRA_V2_NEW_FILES=Object.freeze([
  'docs/governance/auth-only-jira-evidence-v2.md',
  'scripts/ci/pool-reconciliation/auth-only-jira-evidence-v2.mjs',
  'scripts/ci/pool-reconciliation/tests/auth-only-jira-evidence-v2.test.mjs',
  'scripts/ci/pool-reconciliation/tests/auth-only-jira-integration-v2.test.mjs',
  'scripts/ci/tests/auth-only-jira-evidence-v2.test.mjs',
  'scripts/ci/tests/auth-only-jira-integration-v2.test.mjs',
]);
export const AUTH_JIRA_V2_DRIVER_INPUTS=Object.freeze([...new Set([...AUTH_PREFLIGHT_DRIVER_INPUTS,...AUTH_JIRA_V2_NEW_FILES])].sort((a,b)=>a.localeCompare(b,'en')));
const HASH=/^[a-f0-9]{64}$/u,SHA=/^[a-f0-9]{40}$/u,REPO='shademounir/CrmYnov',API='/repos/'+REPO+'/';
export function authRecordVersion(record){
  assert(record&&Object.getPrototypeOf(record)===Object.prototype,'PLAIN_DATA_REQUIRED');
  const descriptor=Object.getOwnPropertyDescriptor(record,'schemaVersion');
  assert(descriptor&&Object.hasOwn(descriptor,'value'),'AUTH_RECORD_VERSION_DATA_REQUIRED');
  assert([1,2].includes(descriptor.value),'AUTH_RECORD_VERSION_REQUIRED');return descriptor.value;
}
export function authDriverInputs(record){return authRecordVersion(record)===2?AUTH_JIRA_V2_DRIVER_INPUTS:AUTH_PREFLIGHT_DRIVER_INPUTS;}
const AUTH_STAGES=new Set(['AUTH_INPUTS','AUTH_RECORD','AUTH_HUMAN_QUALIFICATION','AUTH_JIRA_V2_HUMAN','AUTH_ENVIRONMENT','AUTH_QUALIFICATION','AUTH_GLOBAL_LOCK','AUTH_HISTORICAL_BOUNDARIES','AUTH_REUSABLE_INPUTS','AUTH_LOCAL_SOURCE','GITHUB_IDENTITY','GITHUB_BRANCH','GITHUB_PROTECTION','GITHUB_GRANT_POLICY','GITHUB_ANCESTRY','GITHUB_SOURCE_PR','GITHUB_SOURCE_CHECKS','GITHUB_SOURCE_CONVERSATIONS','GITHUB_DELEGATED_DECISION','GITHUB_SOURCE_TREE','GITHUB_SOURCE_FILES','GITHUB_MARKER','AUTH_JIRA_EVIDENCE','GITHUB_FINAL_BRANCH','AUTH_FINAL_LEASE','AUTH_FINAL_REVALIDATION','AUTH_INTENT','AUTH_SDK','AUTH_FIN_PERSISTENCE','AUTH_PREPARE']);
const AUTH_GUARDS=new Set(['AUTH_GUARD_REFUSED','PLAIN_DATA_REQUIRED','ACCESSORS_REFUSED','EXACT_FIELDS_REQUIRED','AUTH_RECORD_VERSION_DATA_REQUIRED','AUTH_RECORD_VERSION_REQUIRED','AUTH_ONLY_AUTHORITY_EXPIRED','COMPLETE_AUTH_SOURCE_MANIFEST','EXACT_AUTH_HUMAN_BYTES','AUTH_QUALIFICATION_BYTES','EXACT_NARROW_SDK_CACHE_CLARIFICATION','EXACT_JIRA_V2_HUMAN_AUTHORITY','AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND','FRESH_AUTH_ONLY_MARKER_REQUIRED','PROTECTED_AUTH_SOURCE_BYTES','AUTH_ONLY_GOVERNANCE_DRIFT','CLEAN_AUTH_SOURCE_REQUIRED','AUTH_ONLY_ATTEMPT_ALREADY_CONSUMED','OLD_CLOSED_EVIDENCE_BYTES_CHANGED','REUSABLE_CONSUMER_BYTES_CHANGED','AUTH_LOCAL_SOURCE_DRIFT']);
const AUTH_JIRA_GUARDS=new Set(['AUTH_JIRA_V2_BYTES','AUTH_JIRA_V2_HASH','AUTH_JIRA_V2_JSON','AUTH_JIRA_V2_CANONICAL','AUTH_JIRA_V2_FIELDS','AUTH_JIRA_V2_SCOPE','AUTH_JIRA_V2_ACTOR','AUTH_JIRA_V2_GRANT','AUTH_JIRA_V2_PROVENANCE','AUTH_JIRA_V2_CONNECTION','AUTH_JIRA_V2_READ','AUTH_JIRA_V2_REQUEST','AUTH_JIRA_V2_RESPONSE','AUTH_JIRA_V2_ACCOUNT','AUTH_JIRA_V2_TENANT','AUTH_JIRA_V2_TICKET','AUTH_JIRA_V2_LABELS','AUTH_JIRA_V2_LINKS','AUTH_JIRA_V2_BLOCKED','AUTH_JIRA_V2_DEPENDENCY','AUTH_JIRA_V2_TIMING','AUTH_JIRA_V2_FRESHNESS','AUTH_JIRA_V2_FLAGS']);
const AUTH_NATIVE_JIRA_GUARDS=new Set(['NATIVE_JIRA_EVIDENCE_REFUSED','NATIVE_JIRA_BYTES','NATIVE_JIRA_HASH','NATIVE_JIRA_JSON','NATIVE_JIRA_SOURCE','NATIVE_JIRA_EXECUTOR','NATIVE_JIRA_ACTOR','NATIVE_JIRA_GRANT','NATIVE_JIRA_ACCOUNT','NATIVE_JIRA_TENANT','NATIVE_JIRA_INVOCATION','NATIVE_JIRA_URL','NATIVE_JIRA_SCOPE','NATIVE_JIRA_FLAGS','NATIVE_JIRA_LABELS','NATIVE_JIRA_READINESS','NATIVE_JIRA_LINKS','NATIVE_JIRA_LINK','NATIVE_JIRA_DEPENDENCY','NATIVE_JIRA_BLOCKED','NATIVE_JIRA_FRESHNESS']);
class AuthOnlyGuardRefusal extends Error{
  constructor(stage,guardCode='AUTH_GUARD_REFUSED',{substage=null,sourceFile=null}={}){
    assert(AUTH_STAGES.has(stage));assert(substage===null||['ENVELOPE','IDENTITY','TENANT','TICKET','COMPOSITION'].includes(substage));
    assert(sourceFile===null||AUTH_JIRA_V2_DRIVER_INPUTS.includes(sourceFile));assert(AUTH_GUARDS.has(guardCode)||AUTH_JIRA_GUARDS.has(guardCode)||AUTH_NATIVE_JIRA_GUARDS.has(guardCode));
    super(guardCode);this.name='AuthOnlyGuardRefusal';Object.defineProperties(this,{stage:{value:stage},guardCode:{value:guardCode},substage:{value:substage},sourceFile:{value:sourceFile}});
  }
}
export function authRefusalDiagnostic(error,fallback='AUTH_PREPARE'){
  assert(AUTH_STAGES.has(fallback));
  if(error instanceof AuthOnlyGuardRefusal)return{stage:error.stage,guardCode:error.guardCode,substage:error.substage,sourceFile:error.sourceFile};
  const message=error&&Object.getOwnPropertyDescriptor(error,'message')?.value;
  const allowed=fallback==='AUTH_JIRA_EVIDENCE'?[...AUTH_GUARDS,...AUTH_NATIVE_JIRA_GUARDS]:[...AUTH_GUARDS];
  const code=typeof message==='string'?allowed.find(value=>message===value||message.startsWith(value+'\n')):null;
  return{stage:fallback,guardCode:code??'AUTH_GUARD_REFUSED',substage:null,sourceFile:null};
}
export function authGuard(stage,operation){
  assert(AUTH_STAGES.has(stage));
  const refused=error=>{const d=authRefusalDiagnostic(error,stage);throw new AuthOnlyGuardRefusal(d.stage,d.guardCode,d);};
  try{const result=operation();return result instanceof Promise?result.catch(refused):result;}catch(error){return refused(error);}
}
export function validateJiraV2HumanAuthority(bytes){
  assert(Buffer.isBuffer(bytes)&&bytes.length<=65536);assert.equal(byteHash(bytes),AUTH_JIRA_V2_HUMAN_SHA256,'EXACT_JIRA_V2_HUMAN_AUTHORITY');
  const human=JSON.parse(bytes);assert.equal(human.schemaVersion,'crm-soft-leave-human-authority/v1');
  assert.equal(human.deferredUntilNextHumanResume,true);assert.equal(human.autoResumeScheduled,false);return human;
}
export function validateAuthOnlyRecord(record,now){
  const version=authRecordVersion(record);
  const fields=['schemaVersion','kind','mode','humanAuthorityReceiptSha256','sdkCacheClarificationSha256','validFrom','expiresAt','source','qualificationSha256'];
  dataFields(record,version===2?[...fields,'jiraEvidenceVersion','jiraV2HumanAuthorityReceiptSha256']:fields);
  assert.equal(record.kind,'GENERAL_COMPLETE_AUTH_PREFLIGHT_AUTHORITY_V'+version);assert.equal(record.mode,'AUTH_ONLY');
  if(version===2){assert([1,2].includes(record.jiraEvidenceVersion),'EXPLICIT_AUTH_JIRA_EVIDENCE_VERSION_REQUIRED');assert.equal(record.jiraV2HumanAuthorityReceiptSha256,AUTH_JIRA_V2_HUMAN_SHA256);}
  assert.equal(record.humanAuthorityReceiptSha256,AUTH_HUMAN_SHA256);assert.equal(record.sdkCacheClarificationSha256,AUTH_SDK_CACHE_HUMAN_SHA256);
  assert(HASH.test(record.qualificationSha256)&&record.qualificationSha256!=='0'.repeat(64));
  const start=canonicalTime(record.validFrom),end=canonicalTime(record.expiresAt);assert(end>start&&end-start<=86400000);
  assert(Number.isSafeInteger(now)&&now>=start&&now<end,'AUTH_ONLY_AUTHORITY_EXPIRED');
  const source=record.source;dataFields(source,['commit','tree','head','pr','files']);for(const key of ['commit','tree','head']){assert(SHA.test(source[key]));}
  assert(Number.isSafeInteger(source.pr)&&source.pr>0);assert(Array.isArray(source.files));
  assert.deepEqual(source.files.map(file=>file.path),authDriverInputs(record),'COMPLETE_AUTH_SOURCE_MANIFEST');
  for(const file of source.files){dataFields(file,['path','sha256']);assert(HASH.test(file.sha256));}return record;
}
export function validateAuthHumanAndQualification({humanAuthorityBytes,qualificationBytes,record}){
  assert(Buffer.isBuffer(humanAuthorityBytes)&&humanAuthorityBytes.length<=65536);assert.equal(byteHash(humanAuthorityBytes),AUTH_HUMAN_SHA256,'EXACT_AUTH_HUMAN_BYTES');
  assert(Buffer.isBuffer(qualificationBytes)&&qualificationBytes.length<=20971520);assert.equal(byteHash(qualificationBytes),record.qualificationSha256,'AUTH_QUALIFICATION_BYTES');
  const human=JSON.parse(humanAuthorityBytes);
  assert.equal(human.kind,'SOURCE_INTEGRATION_AND_ONE_OFFICIAL_COMPLETE_AUTHENTICATION_PREFLIGHT_ONLY');
  assert.equal(human.maximumNativeAuthenticationAttempts,1);assert.equal(human.absoluteCommonAuthenticationEnvelopeMs,15000);
  assert.equal(human.currentTrialMustExitBeforeRightsResourceChecksOrRunArming,true);return human;
}
export function validateSdkCacheClarification(bytes){
  assert(Buffer.isBuffer(bytes)&&bytes.length<=65536);assert.equal(byteHash(bytes),AUTH_SDK_CACHE_HUMAN_SHA256,'EXACT_NARROW_SDK_CACHE_CLARIFICATION');
  const value=JSON.parse(bytes);assert.equal(value.parentHumanAuthority.sha256,AUTH_HUMAN_SHA256);
  assert.equal(value.officialSdkStandardInternalTokenCacheAllowedForTheOneExistingTrial,true);
  assert.equal(value.newAuthenticationAttemptOrRetryGranted,false);assert.equal(value.cloudRunLoggingSqlRunOrRunCapabilityAuthorityAdded,false);return value;
}
function protectionUnchanged(protection){
  assert.equal(protection.enforce_admins.enabled,true);assert.equal(protection.required_status_checks.strict,true);
  assert(protection.required_status_checks.contexts.includes('pr-policy'));assert.equal(protection.required_conversation_resolution.enabled,true);
  assert.equal(protection.allow_force_pushes.enabled,false);assert.equal(protection.allow_deletions.enabled,false);
}
function authMarker(comments,record,actors){
  const prefix='<!-- codex-general-auth-preflight-authorization:v1';
  const candidates=comments.filter(comment=>actors.includes(comment.user?.login)&&comment.user.type==='User'&&typeof comment.body==='string'&&comment.body.includes(prefix));
  candidates.sort((a,b)=>b.id-a.id);assert(candidates.length);const comment=candidates[0],start=comment.body.indexOf(prefix),end=comment.body.indexOf('-->',start+prefix.length);
  assert(comment.body.length<=65536&&start===comment.body.lastIndexOf(prefix)&&end>start);const marker=JSON.parse(comment.body.slice(start+prefix.length,end).trim());
  dataFields(marker,['schemaVersion','executor','mode','authorityRecordSha256','driverCommit','humanAuthorityReceiptSha256','sdkCacheClarificationSha256','qualificationSha256',
    'grantDigest','jiraObservationSha256','expiresAt','businessMutation','runAuthorized']);
  assert.equal(marker.schemaVersion,1);assert.equal(marker.executor,'Codex');assert.equal(marker.mode,'AUTH_ONLY');
  assert.equal(marker.authorityRecordSha256,digest(record));assert.equal(marker.driverCommit,record.source.commit);
  assert.equal(marker.humanAuthorityReceiptSha256,AUTH_HUMAN_SHA256);assert.equal(marker.sdkCacheClarificationSha256,AUTH_SDK_CACHE_HUMAN_SHA256);assert.equal(marker.qualificationSha256,record.qualificationSha256);
  assert.equal(marker.businessMutation,false);assert.equal(marker.runAuthorized,false);return{comment,marker};
}
async function sourceFilesSequential(github,source,record,index=0){
  assert(Number.isSafeInteger(index)&&index>=0&&index<=authDriverInputs(record).length);
  if(index===source.files.length){return;}
  const file=source.files[index];
  try{await authGuard('GITHUB_SOURCE_FILES',async()=>assert.equal(byteHash(await githubFile(github,file.path,source.commit)),file.sha256,'PROTECTED_AUTH_SOURCE_BYTES'));}
  catch(error){const d=authRefusalDiagnostic(error,'GITHUB_SOURCE_FILES');throw new AuthOnlyGuardRefusal(d.stage,d.guardCode,{sourceFile:file.path});}
  return sourceFilesSequential(github,source,record,index+1);
}
async function protectedSource(github,record,grant,actor){
  const source=record.source,pull=await authGuard('GITHUB_SOURCE_PR',async()=>{const value=await github.get(API+'pulls/'+source.pr);
    validateSourcePull(value,source,grant);return value;});
  const files=await authGuard('GITHUB_SOURCE_PR',()=>github.pages(API+'pulls/'+source.pr+'/files'));
  const checks=await authGuard('GITHUB_SOURCE_CHECKS',async()=>{const value=await github.pages(API+'commits/'+source.head+'/check-runs','check_runs');
    validateRequiredChecks([...DELEGATED_CHECKS,'simulate','pr-policy'],value,{expectedSha:source.head});return value;});
  const comments=await authGuard('GITHUB_MARKER',()=>github.pages(API+'issues/'+source.pr+'/comments'));
  await authGuard('GITHUB_SOURCE_CONVERSATIONS',async()=>{
    const timeline=await github.pages(API+'issues/'+source.pr+'/timeline');assert(!timeline.some(event=>['auto_merge_enabled','auto_merge_disabled'].includes(event.event)));
    const threads=await github.reviewThreads(source.pr);assert(!threads.reviewThreads.pageInfo.hasNextPage);assert(threads.reviewThreads.nodes.every(thread=>thread.isResolved));
    assert(!threads.reviews.nodes.some(review=>review.state==='CHANGES_REQUESTED'));
  });
  await authGuard('GITHUB_DELEGATED_DECISION',async()=>{
    const headGrant=JSON.parse(await githubFile(github,GRANT_PATH,source.head));assert.equal(grantDigest(headGrant),grantDigest(grant));
    validateDelegatedDecision({decision:selectDelegatedDecision(comments,grant.authenticatedActors),grant,repository:REPO,actor,base:'develop',
      changedFiles:files.map(file=>file.filename),reasons:['production','audited-repository-tooling'],headSha:source.head,pullRequestNumber:source.pr,
      requiredChecks:DELEGATED_CHECKS,checkRuns:checks,mergedAt:pull.merged_at,headGrantDigest:grantDigest(headGrant)});
  });
  await authGuard('GITHUB_SOURCE_TREE',async()=>assert.equal((await github.get(API+'git/commits/'+source.commit)).tree.sha,source.tree));
  await sourceFilesSequential(github,source,record);return comments;
}
function validateSourcePull(pull,source,grant){
  assert.equal(pull.number,source.pr);assert.equal(pull.head.sha,source.head);assert.equal(pull.merge_commit_sha,source.commit);
  assert.equal(pull.base.ref,'develop');assert.equal(pull.base.repo.full_name,REPO);assert.equal(pull.head.repo.full_name,REPO);
  assert.equal(pull.merged,true);assert.equal(pull.draft,false);assert.equal(pull.auto_merge,null);assert(grant.authenticatedActors.includes(pull.merged_by.login));
  const labels=new Set(pull.labels.map(label=>label.name));assert(labels.has('codex-delegated-approved'));assert(!labels.has('po-approved')&&!labels.has('policy-approved'));
}
async function validateJiraForRecord(record,jiraBytes,options){
  if(authRecordVersion(record)===1||record.jiraEvidenceVersion===1)return authGuard('AUTH_JIRA_EVIDENCE',()=>validateNativeJiraReadObservation(jiraBytes,options));
  const module=await import('./auth-only-jira-evidence-v2.mjs');
  try{return module.validateAuthOnlyComposedJiraObservation(jiraBytes,options);}
  catch(error){
    const diagnostic=module.diagnosticAuthOnlyJiraRefusal(error);
    if(!diagnostic||!module.AUTH_JIRA_REFUSAL_CODES.includes(diagnostic.code))throw new AuthOnlyGuardRefusal('AUTH_JIRA_EVIDENCE');
    throw new AuthOnlyGuardRefusal('AUTH_JIRA_EVIDENCE',diagnostic.code,{substage:diagnostic.stage});
  }
}
// Concrete existing governance validators, no boolean authorization callback and
// no automatic bot-review prerequisite. Reads here are GitHub, NOT GCP rights.
async function verifyAuthOnlyGovernance({github,record,jiraBytes,localSource,clock=Date.now}){
  const began=clock();authGuard('AUTH_RECORD',()=>validateAuthOnlyRecord(record,began));
  authGuard('AUTH_LOCAL_SOURCE',()=>assert.deepEqual(localSource,{...record.source,clean:true}));
  const user=await authGuard('GITHUB_IDENTITY',async()=>{const value=await github.get('/user');assert.equal(value.type,'User');return value;});const actor=user.login;
  const branch=await authGuard('GITHUB_BRANCH',async()=>{const value=await github.get(API+'branches/develop');assert.equal(value.protected,true);assert(SHA.test(value.commit.sha));return value;});const revision=branch.commit.sha;
  await authGuard('GITHUB_PROTECTION',async()=>protectionUnchanged(await github.get(API+'branches/develop/protection')));
  const grant=await authGuard('GITHUB_GRANT_POLICY',async()=>{
    const value=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(value,{repository:REPO,actor,base:'develop',reasons:['production','audited-repository-tooling']});
    assert.equal(value.id,'crm-ynov-po-delegation-20261001');validateProtectedCodeReviewPolicy(JSON.parse(await githubFile(github,GITHUB_CODE_REVIEW_POLICY_PATH,revision)),REPO);return value;
  });
  await authGuard('GITHUB_ANCESTRY',async()=>{const comparison=await github.get(API+'compare/'+record.source.commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,record.source.commit);assert(['ahead','identical'].includes(comparison.status));});
  const comments=await protectedSource(github,record,grant,actor);
  const {comment,marker}=authGuard('GITHUB_MARKER',()=>{const value=authMarker(comments,record,grant.authenticatedActors);assert.equal(value.marker.grantDigest,grantDigest(grant));return value;});
  const now=clock();authGuard('AUTH_RECORD',()=>validateAuthOnlyRecord(record,now));authGuard('AUTH_FINAL_LEASE',()=>assert(now>=began&&now-began<60000,'AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND'));
  const issued=Date.parse(comment.updated_at??comment.created_at),expires=authGuard('GITHUB_MARKER',()=>canonicalTime(marker.expiresAt));
  authGuard('GITHUB_MARKER',()=>assert(Number.isFinite(issued)&&issued<=now&&now-issued<600000&&expires>now&&expires-issued<=600000,'FRESH_AUTH_ONLY_MARKER_REQUIRED'));
  const jira=await validateJiraForRecord(record,jiraBytes,{expectedSha256:marker.jiraObservationSha256,actor,grantSha256:grantDigest(grant),now});
  await authGuard('GITHUB_FINAL_BRANCH',async()=>assert.equal((await github.get(API+'branches/develop')).commit.sha,revision,'AUTH_ONLY_GOVERNANCE_DRIFT'));
  // Include the final provider read in the collection deadline. A previously
  // checked timestamp cannot extend the lease/collection window across it.
  const completed=clock();authGuard('AUTH_FINAL_LEASE',()=>assert(completed>=now&&completed-began<60000,'AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND'));
  const authority={entry:{scope:'OFFICIAL_SDK_COMPLETE_AUTHENTICATION_ONLY'},receipt:{verifiedAt:new Date(completed).toISOString(),
    expiresAt:new Date(Math.min(expires,canonicalTime(record.expiresAt),Date.parse(jira.observedAt)+600000)).toISOString(),
    authorityRecordSha256:digest(record),humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,qualificationSha256:record.qualificationSha256,
    driverCommit:record.source.commit,authorityRevision:revision,grantDigest:grantDigest(grant),jiraObservationSha256:byteHash(jiraBytes),
    jiraEvidenceSource:jira.source,jiraProviderCryptographicSignatureAsserted:false,operationalCommentId:comment.id,gitHubCodeReviewRequired:false,
    businessMutationAuthorized:false,gcpResourceAccessAuthorized:false,runAuthorized:false}};
  authGuard('AUTH_FINAL_LEASE',()=>assertAuthorityCurrent(authority,clock()));return Object.freeze(authority);
}
export async function authorizeAuthOnlyPreflight(input){
  authGuard('AUTH_RECORD',()=>validateAuthOnlyRecord(input.record,(input.clock??Date.now)()));
  authGuard('AUTH_HUMAN_QUALIFICATION',()=>validateAuthHumanAndQualification(input));
  if(authRecordVersion(input.record)===2)authGuard('AUTH_JIRA_V2_HUMAN',()=>validateJiraV2HumanAuthority(input.jiraV2HumanAuthorityBytes));
  return verifyAuthOnlyGovernance(input);
}
// Shared governance algorithm exercised with purely synthetic API fixtures.
// It does not authenticate the pinned human bytes, never yields an actual lease
// to the concrete entry and explicitly labels the result as no native authority.
export async function simulateAuthOnlyGovernance({syntheticOnly,...input}){
  assert.equal(syntheticOnly,true);const result=await verifyAuthOnlyGovernance(input);
  return{...result,syntheticOnly:true,nativeAuthority:false};
}
