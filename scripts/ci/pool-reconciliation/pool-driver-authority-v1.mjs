// Narrow pool objective authority. Reuses the existing protected delegation,
// check verifier and official Jira attestation contract. No default catalog entry.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,validateGrant,selectDelegatedDecision,validateDelegatedDecision} from '../../pr-policy/delegation.mjs';
import {validateRequiredChecks} from '../../release-manifest/checks.mjs';
import {githubFile,validateOperatorJiraObservation,assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {digest,TRUSTED_INTENT_SHA256} from './controlled-pool-contract-v1.mjs';
export const POOL_CATALOG='docs/governance/readonly-probe-objectives-v1.json';
const REPO='shademounir/CrmYnov',BASE='/repos/'+REPO+'/',MAIN='8253024ea35cee6be5636cc6b10a88ae7e177377';
const HASH=/^[a-f0-9]{64}$/u,SHA=/^[a-f0-9]{40}$/u;
const byteHash=b=>createHash('sha256').update(b).digest('hex');
function cleanReview(comments,head){
  const rows=comments.filter(c=>c.user?.login==='chatgpt-codex-connector[bot]'&&c.user.type==='Bot'&&c.performed_via_github_app?.slug==='chatgpt-codex-connector'&&c.body.includes('<!-- codex-review-state:v1 ')).sort((a,b)=>b.id-a.id);
  assert(rows.length>0);const state=JSON.parse(rows[0].body.match(/<!-- codex-review-state:v1 (.*?) -->/u)[1]).code_review;
  assert.equal(state.commit_sha,head);assert.equal(state.status,'completed');assert.equal(state.has_any_findings,false);assert.equal(state.has_unresolved_findings,false);return rows[0].id;
}
async function approvedMerge(github,reference,{grant,actor,base}){
  assert(Number.isSafeInteger(reference.pr)&&reference.pr>0);assert(SHA.test(reference.head)&&SHA.test(reference.mergeCommit));
  const pull=await github.get(BASE+'pulls/'+reference.pr);assert.equal(pull.head.sha,reference.head);assert.equal(pull.merge_commit_sha,reference.mergeCommit);assert.equal(pull.base.ref,base);assert.equal(pull.head.repo.full_name,REPO);assert.equal(pull.base.repo.full_name,REPO);assert.equal(pull.merged,true);assert.equal(pull.draft,false);assert.equal(pull.auto_merge,null);assert(grant.authenticatedActors.includes(pull.merged_by.login));
  const labels=new Set(pull.labels.map(l=>l.name));assert(labels.has('codex-delegated-approved'));assert(!labels.has('po-approved')&&!labels.has('policy-approved'));
  const [files,checks,comments,timeline,threads]=await Promise.all([github.pages(BASE+'pulls/'+reference.pr+'/files'),github.pages(BASE+'commits/'+reference.head+'/check-runs','check_runs'),github.pages(BASE+'issues/'+reference.pr+'/comments'),github.pages(BASE+'issues/'+reference.pr+'/timeline'),github.reviewThreads(reference.pr)]);
  validateRequiredChecks([...DELEGATED_CHECKS,'pr-policy'],checks,{expectedSha:reference.head});assert(!timeline.some(e=>['auto_merge_enabled','auto_merge_disabled'].includes(e.event)));assert(!threads.reviewThreads.pageInfo.hasNextPage);assert(threads.reviewThreads.nodes.every(t=>t.isResolved));assert(!threads.reviews.nodes.some(r=>r.state==='CHANGES_REQUESTED'));
  const headGrant=JSON.parse(await githubFile(github,GRANT_PATH,reference.head));assert.equal(grantDigest(headGrant),grantDigest(grant));
  const decision=selectDelegatedDecision(comments,grant.authenticatedActors);
  validateDelegatedDecision({decision,grant,repository:REPO,actor,base,changedFiles:files.map(f=>f.filename),reasons:['production','audited-repository-tooling'],headSha:reference.head,pullRequestNumber:reference.pr,requiredChecks:DELEGATED_CHECKS,checkRuns:checks,mergedAt:pull.merged_at,headGrantDigest:grantDigest(headGrant)});
  return {pull,files,comments,reviewId:cleanReview(comments,reference.head)};
}
function operationalMarker(comments,actors){
  const prefix='<!-- codex-readonly-probe-objective-authorization:v1';
  const rows=comments.filter(c=>actors.includes(c.user?.login)&&c.user.type==='User'&&c.body.includes(prefix)).sort((a,b)=>b.id-a.id);assert(rows.length>0,'FRESH_OPERATIONAL_AUTHORITY_REQUIRED');
  const comment=rows[0],start=comment.body.indexOf(prefix),end=comment.body.indexOf('-->',start+prefix.length);assert(comment.body.length<=65536&&start===comment.body.lastIndexOf(prefix)&&end>start);
  return {comment,value:JSON.parse(comment.body.slice(start+prefix.length,end).trim())};
}
async function verifySource(github,source,entry){
  assert.equal(source.commit,entry.driver.mergeCommit);assert.equal(source.tree,entry.driver.tree);assert.equal(source.clean,true);assert.deepEqual(source.files,entry.driver.files);
  for(let n=0;n<source.files.length;n+=4){await Promise.all(source.files.slice(n,n+4).map(async f=>{assert(HASH.test(f.sha256));assert.equal(byteHash(await githubFile(github,f.path,source.commit)),f.sha256,'PROTECTED_DRIVER_BYTES');}));}
}
function validateFreshMarker(marker,{entry,objectiveId,localSource,jiraBytes,grant,actor,now,action}){
  const {value,comment}=marker;assert.equal(value.schemaVersion,1);assert.equal(value.executor,'Codex');assert.equal(value.objectiveId,objectiveId);assert.equal(value.catalogEntrySha256,digest(entry));assert.equal(value.dossierSha256,entry.dossierSha256);assert.equal(value.driverCommit,localSource.commit);assert.equal(value.grantDigest,grantDigest(grant));assert.equal(value.productionBusinessMutation,false);assert(value.actions.includes(action));assert.equal(value.humanAuthorityReceiptSha256,entry.humanAuthorityReceiptSha256);
  const issued=Date.parse(comment.updated_at??comment.created_at),expires=Date.parse(value.expiresAt);assert(issued<=now&&now-issued<600000&&expires>now&&expires-issued<=600000,'EXPIRED_OPERATIONAL_MARKER');
  const jira=validateOperatorJiraObservation(jiraBytes,{expectedSha256:value.jiraObservationSha256,ticket:'CRMY-63',actor,grantSha256:grantDigest(grant),now});
  return {jira,expiresAt:Math.min(expires,issued+600000,Date.parse(jira.observedAt)+600000,Date.parse(entry.expiresAt))};
}
export async function authorizePoolDriver({github,objectiveId,dossier,jiraBytes,localSource,action,clock=Date.now}){
  const started=clock();assert(Number.isSafeInteger(started));assert(['VERIFY','CREATE','OBSERVE_CREATE','RUN','OBSERVE_RUN','READ_OUTPUT'].includes(action));assert(/^[a-z0-9][a-z0-9-]{1,80}$/u.test(objectiveId));
  const user=await github.get('/user');assert.equal(user.type,'User');const actor=user.login;
  const branch=await github.get(BASE+'branches/develop'),revision=branch.commit.sha;assert.equal(branch.protected,true);const protection=await github.get(BASE+'branches/develop/protection');assert.equal(protection.enforce_admins.enabled,true);assert.equal(protection.required_status_checks.strict,true);assert(protection.required_status_checks.contexts.includes('pr-policy'));
  const grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(grant,{repository:REPO,actor,base:'develop',reasons:['production','audited-repository-tooling']});assert.equal(grant.id,'crm-ynov-po-delegation-20261001');
  const catalog=JSON.parse(await githubFile(github,POOL_CATALOG,revision));assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.entries)&&catalog.entries.length<=100);const matches=catalog.entries.filter(e=>e.id===objectiveId);assert.equal(matches.length,1,'REVIEWED_POOL_OBJECTIVE_ABSENT');const entry=matches[0];
  assert.equal(entry.schemaVersion,1);assert.equal(entry.status,'approved');assert.equal(entry.scope,'POOL_RECONCILIATION_READ_ONLY_V1');assert.equal(entry.businessMutation,false);assert.equal(entry.ticket,'CRMY-63');assert(entry.actions.includes(action));assert(started>=Date.parse(entry.validFrom)&&started<Date.parse(entry.expiresAt));assert.equal(entry.dossierSha256,digest(dossier));
  assert.equal(entry.originalIntentSha256,TRUSTED_INTENT_SHA256);for(const name of ['independentInputsSha256','humanAuthorityReceiptSha256','journalDirectorySha256'])assert(HASH.test(entry[name]??''));
  await verifySource(github,localSource,entry);
  assert.deepEqual(Object.keys(entry.objectiveReview),['pr']);const objectivePull=await github.get(BASE+'pulls/'+entry.objectiveReview.pr);const objectiveRef={pr:entry.objectiveReview.pr,head:objectivePull.head.sha,mergeCommit:objectivePull.merge_commit_sha};
  const [driver,objective]=await Promise.all([approvedMerge(github,entry.driver,{grant,actor,base:'develop'}),approvedMerge(github,objectiveRef,{grant,actor,base:'develop'})]);assert(objective.files.some(f=>f.filename===POOL_CATALOG));
  const approved=JSON.parse(await githubFile(github,POOL_CATALOG,objectiveRef.mergeCommit));assert.equal(digest(approved.entries.filter(e=>e.id===objectiveId)),digest([entry]));
  for(const commit of [entry.driver.mergeCommit,objectiveRef.mergeCommit]){const comparison=await github.get(BASE+'compare/'+commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(comparison.status));}
  assert.equal(entry.release.pr,243);assert.equal(entry.release.mergeCommit,MAIN);assert.equal(entry.release.tag,'v0.1.0-rc.48');
  const main=await github.get(BASE+'branches/main');assert.equal(main.commit.sha,MAIN);assert.equal(main.protected,true);await approvedMerge(github,entry.release,{grant,actor,base:'main'});
  const release=await github.get(BASE+'releases/tags/v0.1.0-rc.48');assert.equal(release.id,entry.release.releaseId);assert.equal(release.draft,false);assert.equal(release.prerelease,true);const tag=await github.get(BASE+'git/ref/tags/v0.1.0-rc.48');assert.equal(tag.object.type,'commit');assert.equal(tag.object.sha,MAIN);const post=await github.get(BASE+'actions/runs/'+entry.release.postPublishRun);assert.equal(post.head_sha,MAIN);assert.equal(post.status,'completed');assert.equal(post.conclusion,'success');assert.equal(post.event,'release');assert.equal(post.path,'.github/workflows/release-publish.yml');
  const marker=operationalMarker(objective.comments,grant.authenticatedActors),initial=validateFreshMarker(marker,{entry,objectiveId,localSource,jiraBytes,grant,actor,now:started,action});
  assert.equal((await github.get(BASE+'branches/develop')).commit.sha,revision);const now=clock();assert(Number.isSafeInteger(now)&&now>=started&&now-started<60000);const final=validateFreshMarker(marker,{entry,objectiveId,localSource,jiraBytes,grant,actor,now,action});assert(now>=Date.parse(entry.validFrom)&&now<final.expiresAt);assert.equal(final.expiresAt,initial.expiresAt);
  const result={entry:structuredClone(entry),receipt:{schemaVersion:1,executor:'Codex',actor,authorityRevision:revision,grantDigest:grantDigest(grant),objectiveId,dossierSha256:entry.dossierSha256,catalogEntrySha256:digest(entry),driverCommit:localSource.commit,driverReviewId:driver.reviewId,objectiveReviewId:objective.reviewId,operationalCommentId:marker.comment.id,jiraObservedAt:final.jira.observedAt,verifiedAt:new Date(now).toISOString(),expiresAt:new Date(final.expiresAt).toISOString(),businessMutationAuthorized:false}};assertAuthorityCurrent(result,now);return Object.freeze(result);
}
