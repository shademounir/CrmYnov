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
export const AUTH_NEW_FILES=Object.freeze([
  'docs/governance/general-auth-preflight-v1.md',
  'scripts/ci/pool-reconciliation/general-auth-preflight-authority-v1.mjs',
  'scripts/ci/pool-reconciliation/general-prospective-pre-session-v2.mjs',
  'scripts/ci/pool-reconciliation/tests/general-auth-preflight-v1.test.mjs',
  'scripts/ci/readonly-probe/official-sdk-auth-preflight-v1.mjs',
  'scripts/ci/tests/general-auth-preflight.test.mjs',
]);
export const AUTH_PREFLIGHT_DRIVER_INPUTS=Object.freeze([...new Set([...PROSPECTIVE_DRIVER_INPUTS,...AUTH_NEW_FILES])].sort((a,b)=>a.localeCompare(b,'en')));
const HASH=/^[a-f0-9]{64}$/u,SHA=/^[a-f0-9]{40}$/u,REPO='shademounir/CrmYnov',API='/repos/'+REPO+'/';
export function validateAuthOnlyRecord(record,now){
  dataFields(record,['schemaVersion','kind','mode','humanAuthorityReceiptSha256','sdkCacheClarificationSha256','validFrom','expiresAt','source','qualificationSha256']);
  assert.equal(record.schemaVersion,1);assert.equal(record.kind,'GENERAL_COMPLETE_AUTH_PREFLIGHT_AUTHORITY_V1');assert.equal(record.mode,'AUTH_ONLY');
  assert.equal(record.humanAuthorityReceiptSha256,AUTH_HUMAN_SHA256);assert.equal(record.sdkCacheClarificationSha256,AUTH_SDK_CACHE_HUMAN_SHA256);
  assert(HASH.test(record.qualificationSha256)&&record.qualificationSha256!=='0'.repeat(64));
  const start=canonicalTime(record.validFrom),end=canonicalTime(record.expiresAt);assert(end>start&&end-start<=86400000);
  assert(Number.isSafeInteger(now)&&now>=start&&now<end,'AUTH_ONLY_AUTHORITY_EXPIRED');
  const source=record.source;dataFields(source,['commit','tree','head','pr','files']);for(const key of ['commit','tree','head']){assert(SHA.test(source[key]));}
  assert(Number.isSafeInteger(source.pr)&&source.pr>0);assert(Array.isArray(source.files));
  assert.deepEqual(source.files.map(file=>file.path),AUTH_PREFLIGHT_DRIVER_INPUTS,'COMPLETE_AUTH_SOURCE_MANIFEST');
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
async function sourceFilesSequential(github,source,index=0){
  assert(Number.isSafeInteger(index)&&index>=0&&index<=AUTH_PREFLIGHT_DRIVER_INPUTS.length);
  if(index===source.files.length){return;}
  const file=source.files[index];assert.equal(byteHash(await githubFile(github,file.path,source.commit)),file.sha256,'PROTECTED_AUTH_SOURCE_BYTES');
  return sourceFilesSequential(github,source,index+1);
}
async function protectedSource(github,record,grant,actor){
  const source=record.source,pull=await github.get(API+'pulls/'+source.pr);
  assert.equal(pull.number,source.pr);assert.equal(pull.head.sha,source.head);assert.equal(pull.merge_commit_sha,source.commit);
  assert.equal(pull.base.ref,'develop');assert.equal(pull.base.repo.full_name,REPO);assert.equal(pull.head.repo.full_name,REPO);
  assert.equal(pull.merged,true);assert.equal(pull.draft,false);assert.equal(pull.auto_merge,null);assert(grant.authenticatedActors.includes(pull.merged_by.login));
  const labels=new Set(pull.labels.map(label=>label.name));assert(labels.has('codex-delegated-approved'));assert(!labels.has('po-approved')&&!labels.has('policy-approved'));
  const files=await github.pages(API+'pulls/'+source.pr+'/files'),checks=await github.pages(API+'commits/'+source.head+'/check-runs','check_runs');
  validateRequiredChecks([...DELEGATED_CHECKS,'simulate','pr-policy'],checks,{expectedSha:source.head});
  const comments=await github.pages(API+'issues/'+source.pr+'/comments'),timeline=await github.pages(API+'issues/'+source.pr+'/timeline');
  assert(!timeline.some(event=>['auto_merge_enabled','auto_merge_disabled'].includes(event.event)));
  const threads=await github.reviewThreads(source.pr);assert(!threads.reviewThreads.pageInfo.hasNextPage);assert(threads.reviewThreads.nodes.every(thread=>thread.isResolved));
  assert(!threads.reviews.nodes.some(review=>review.state==='CHANGES_REQUESTED'));
  const headGrant=JSON.parse(await githubFile(github,GRANT_PATH,source.head));assert.equal(grantDigest(headGrant),grantDigest(grant));
  validateDelegatedDecision({decision:selectDelegatedDecision(comments,grant.authenticatedActors),grant,repository:REPO,actor,base:'develop',
    changedFiles:files.map(file=>file.filename),reasons:['production','audited-repository-tooling'],headSha:source.head,pullRequestNumber:source.pr,
    requiredChecks:DELEGATED_CHECKS,checkRuns:checks,mergedAt:pull.merged_at,headGrantDigest:grantDigest(headGrant)});
  assert.equal((await github.get(API+'git/commits/'+source.commit)).tree.sha,source.tree);await sourceFilesSequential(github,source);return comments;
}
// Concrete existing governance validators, no boolean authorization callback and
// no automatic bot-review prerequisite. Reads here are GitHub, NOT GCP rights.
async function verifyAuthOnlyGovernance({github,record,jiraBytes,localSource,clock=Date.now}){
  const began=clock();validateAuthOnlyRecord(record,began);
  assert.deepEqual(localSource,{...record.source,clean:true});const user=await github.get('/user');assert.equal(user.type,'User');const actor=user.login;
  const branch=await github.get(API+'branches/develop');assert.equal(branch.protected,true);assert(SHA.test(branch.commit.sha));const revision=branch.commit.sha;
  protectionUnchanged(await github.get(API+'branches/develop/protection'));
  const grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(grant,{repository:REPO,actor,base:'develop',reasons:['production','audited-repository-tooling']});
  assert.equal(grant.id,'crm-ynov-po-delegation-20261001');validateProtectedCodeReviewPolicy(JSON.parse(await githubFile(github,GITHUB_CODE_REVIEW_POLICY_PATH,revision)),REPO);
  const comparison=await github.get(API+'compare/'+record.source.commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,record.source.commit);assert(['ahead','identical'].includes(comparison.status));
  const comments=await protectedSource(github,record,grant,actor),{comment,marker}=authMarker(comments,record,grant.authenticatedActors);assert.equal(marker.grantDigest,grantDigest(grant));
  const now=clock();validateAuthOnlyRecord(record,now);assert(now>=began&&now-began<60000,'AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND');
  const issued=Date.parse(comment.updated_at??comment.created_at),expires=canonicalTime(marker.expiresAt);
  assert(Number.isFinite(issued)&&issued<=now&&now-issued<600000&&expires>now&&expires-issued<=600000,'FRESH_AUTH_ONLY_MARKER_REQUIRED');
  const jira=validateNativeJiraReadObservation(jiraBytes,{expectedSha256:marker.jiraObservationSha256,actor,grantSha256:grantDigest(grant),now});
  assert.equal((await github.get(API+'branches/develop')).commit.sha,revision,'AUTH_ONLY_GOVERNANCE_DRIFT');
  // Include the final provider read in the collection deadline. A previously
  // checked timestamp cannot extend the lease/collection window across it.
  const completed=clock();assert(completed>=now&&completed-began<60000,'AUTH_ONLY_GOVERNANCE_COLLECTION_BOUND');
  const authority={entry:{scope:'OFFICIAL_SDK_COMPLETE_AUTHENTICATION_ONLY'},receipt:{verifiedAt:new Date(completed).toISOString(),
    expiresAt:new Date(Math.min(expires,canonicalTime(record.expiresAt),Date.parse(jira.observedAt)+600000)).toISOString(),
    authorityRecordSha256:digest(record),humanAuthorityReceiptSha256:AUTH_HUMAN_SHA256,sdkCacheClarificationSha256:AUTH_SDK_CACHE_HUMAN_SHA256,qualificationSha256:record.qualificationSha256,
    driverCommit:record.source.commit,authorityRevision:revision,grantDigest:grantDigest(grant),jiraObservationSha256:byteHash(jiraBytes),
    jiraEvidenceSource:jira.source,jiraProviderCryptographicSignatureAsserted:false,operationalCommentId:comment.id,gitHubCodeReviewRequired:false,
    businessMutationAuthorized:false,gcpResourceAccessAuthorized:false,runAuthorized:false}};
  assertAuthorityCurrent(authority,clock());return Object.freeze(authority);
}
export async function authorizeAuthOnlyPreflight(input){
  validateAuthOnlyRecord(input.record,(input.clock??Date.now)());validateAuthHumanAndQualification(input);return verifyAuthOnlyGovernance(input);
}
// Shared governance algorithm exercised with purely synthetic API fixtures.
// It does not authenticate the pinned human bytes, never yields an actual lease
// to the concrete entry and explicitly labels the result as no native authority.
export async function simulateAuthOnlyGovernance({syntheticOnly,...input}){
  assert.equal(syntheticOnly,true);const result=await verifyAuthOnlyGovernance(input);
  return{...result,syntheticOnly:true,nativeAuthority:false};
}
