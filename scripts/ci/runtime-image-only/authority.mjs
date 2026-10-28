// Image-only authority specialization of the existing operational driver.
// Shared protected merge/source/delegation gates; no READ ONLY capability upgrade.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {approvedMerge,verifySource} from './protected-gates.mjs';
import {githubFile,validateOperatorJiraObservation,assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {GRANT_PATH,grantDigest,validateGrant} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH,validateProtectedCodeReviewPolicy} from '../../pr-policy/github-code-review.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {PROJECT} from './plan.mjs';
import {validateImagePlan,imagePlanScope,isImageRollback} from './plan-mode.mjs';
import {verifyImagePreparationOrigins} from './preparation-origins.mjs';

export const IMAGE_CATALOG='docs/governance/runtime-image-only-objectives-v1.json';
export const IMAGE_SCOPE='RC48_SERVICE_IMAGE_ONLY_V1';
const repo='shademounir/CrmYnov',base='/repos/'+repo+'/',main='8253024ea35cee6be5636cc6b10a88ae7e177377';
const hash=/^[a-f0-9]{64}$/u,sha=/^[a-f0-9]{40}$/u;
const actions=new Set(['READ_METADATA','CREATE_BACKUP','PATCH_API','PATCH_WEB','OBSERVE_OPERATION']);
const byteHash=b=>createHash('sha256').update(b).digest('hex');

export function validateImageObjective(entry,{id,dossier,plan,candidate,baseline,rollbackContext,source,action,now}){
  assert.equal(entry?.schemaVersion,1);assert.equal(entry.id,id);assert.match(id,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
  assert.equal(entry.status,'approved');assert.equal(entry.scope,imagePlanScope(plan));assert.equal(entry.ticket,'CRMY-63');
  assert.equal(entry.project,PROJECT);assert.equal(entry.googleAccount,'casablancaynovcampus@gmail.com');
  assert.equal(entry.businessMutation,false);assert.equal(entry.runtimeImageMutation,true);
  assert.deepEqual([...entry.actions].sort((a,b)=>a.localeCompare(b,'en')),[...actions].sort((a,b)=>a.localeCompare(b,'en')));assert(actions.has(action));
  assert.equal(dossier.schemaVersion,1);assert.equal(dossier.id,id);assert.equal(dossier.scope,entry.scope);
  assert.equal(entry.dossierSha256,digest(dossier));assert(hash.test(entry.humanAuthorityReceiptSha256));
  assert.equal(entry.humanAuthorityReceiptSha256,dossier.humanAuthorityReceiptSha256);
  assert(hash.test(entry.preparationReceiptSha256??''));assert.equal(entry.preparationReceiptSha256,dossier.preparationReceiptSha256);
  assert.deepEqual(dossier.candidate,candidate);
  assert.deepEqual(dossier.readOnlyPreparationJobs??[],candidate.readOnlyPreparationJobs??[],'OBJECTIVE_PREPARATION_JOB_BINDINGS');
  validateImagePlan(plan,candidate,baseline,rollbackContext);
  assert(Date.parse(plan.baselineObservedAt)<=now,'FUTURE_NATIVE_BASELINE_REFUSED');
  if(isImageRollback(plan)){
    assert.equal(entry.direction,'RESTORE_CAPTURED_RC44');assert.equal(dossier.direction,entry.direction);
    assert.equal(entry.forwardContextSha256,digest(rollbackContext));assert.equal(dossier.forwardContextSha256,entry.forwardContextSha256);
    assert.equal(entry.forwardObjectiveId,rollbackContext.forwardObjectiveId);assert.notEqual(entry.id,entry.forwardObjectiveId);
    assert(hash.test(entry.forwardCatalogEntrySha256));assert.equal(dossier.forwardCatalogEntrySha256,entry.forwardCatalogEntrySha256);
  }else{assert.equal(entry.direction??'PROMOTE_RC48','PROMOTE_RC48');assert.equal(entry.forwardContextSha256,undefined);}
  assert.deepEqual(plan.preservedJobs,dossier.preservedJobs,'OBJECTIVE_JOB_CONFIGURATION_PINS');
  assert.deepEqual(plan.preservedSchedulers,dossier.preservedSchedulers,'OBJECTIVE_SCHEDULER_PINS');
  assert.equal(dossier.noDatabaseRestore,true);assert.equal(dossier.noMigration,true);assert.equal(dossier.noFlagActivation,true);
  assert.equal(dossier.noJobOrSchedulerMutation,true);assert.equal(dossier.preserveInterveningWrites,true);
  assert.equal(source.commit,entry.driver.mergeCommit);assert.equal(source.tree,entry.driver.tree);assert(source.clean);
  assert(Array.isArray(source.files)&&source.files.length>=15);assert.deepEqual(source.files,entry.driver.files);
  assert.equal(entry.release.pr,243);assert.equal(entry.release.mergeCommit,main);assert.equal(entry.release.releaseId,424492409);
  assert.equal(entry.release.tag,'v0.1.0-rc.48');assert.equal(entry.release.sourceTree,'8e6c456f091cab3c6f095665ae021badf85315c0');
  assert.equal(typeof entry.journalDirectorySha256,'string');assert(hash.test(entry.journalDirectorySha256));
  assert(Number.isSafeInteger(now)&&now>=Date.parse(entry.validFrom)&&now<Date.parse(entry.expiresAt));
  assert.deepEqual(Object.keys(entry.objectiveReview),['pr']);
  return true;
}

export function validateImageOperationalMarker(comments,{actors,entry,dossier,plan,source,jiraBytes,grant,actor,action,now}){
  const prefix='<!-- codex-runtime-image-authorization:v1';
  const rows=comments.filter(c=>actors.includes(c.user?.login)&&c.user.type==='User'&&typeof c.body==='string'&&c.body.includes(prefix)).sort((a,b)=>b.id-a.id);
  assert(rows.length>0,'FRESH_IMAGE_OPERATIONAL_MARKER_REQUIRED');const comment=rows[0];
  assert(comment.body.length<=65536);const start=comment.body.indexOf(prefix),end=comment.body.indexOf('-->',start+prefix.length);
  assert(start===comment.body.lastIndexOf(prefix)&&end>start);
  const value=JSON.parse(comment.body.slice(start+prefix.length,end).trim());
  assert.equal(value.schemaVersion,1);assert.equal(value.executor,'Codex');assert.equal(value.objectiveId,entry.id);
  assert.equal(value.catalogEntrySha256,digest(entry));assert.equal(value.dossierSha256,digest(dossier));
  assert.equal(value.planSha256,digest(plan));assert.equal(value.driverCommit,source.commit);assert.equal(value.grantDigest,grantDigest(grant));
  assert.equal(value.humanAuthorityReceiptSha256,entry.humanAuthorityReceiptSha256);
  assert.equal(value.productionRuntimeMutation,true);assert.equal(value.productionBusinessMutation,false);
  if(isImageRollback(plan)){assert.equal(value.scope,entry.scope);assert.equal(value.forwardContextSha256,entry.forwardContextSha256);}
  assert(Array.isArray(value.actions)&&value.actions.includes(action)&&value.actions.every(a=>actions.has(a)));
  // A separate protected, source-bound preparation receipt is required. It is
  // not replaced with a local true flag, an old SQL timestamp or an empty catalog.
  assert(hash.test(value.preparationReceiptSha256??''));assert.equal(value.preparationReceiptSha256,entry.preparationReceiptSha256);
  const issued=Date.parse(comment.updated_at??comment.created_at),expires=Date.parse(value.expiresAt);
  assert(issued<=now&&now-issued<600000&&expires>now&&expires-issued<=600000,'IMAGE_MARKER_EXPIRED');
  const jira=validateOperatorJiraObservation(jiraBytes,{expectedSha256:value.jiraObservationSha256,ticket:entry.ticket,actor,grantSha256:grantDigest(grant),now});
  return {commentId:comment.id,jira,expiresAt:Math.min(expires,issued+600000,Date.parse(jira.observedAt)+600000,Date.parse(entry.expiresAt)),planSha256:value.planSha256};
}

async function verifyRollbackOrigin(github,catalog,entry,context,authorization){
  const rows=catalog.entries.filter(e=>e.id===context.forwardObjectiveId);assert.equal(rows.length,1,'PROTECTED_FORWARD_OBJECTIVE_REQUIRED');
  const forward=rows[0];assert.equal(forward.status,'approved');assert.equal(forward.scope,IMAGE_SCOPE);
  assert.equal(digest(forward),entry.forwardCatalogEntrySha256);assert.equal(forward.dossierSha256,context.forwardDossierSha256);
  assert.equal(forward.driver.mergeCommit,context.forwardEvidence.sourceHead);
  assert.equal(forward.journalDirectorySha256,byteHash(context.originalJournalDirectory));
  const originalSource={commit:forward.driver.mergeCommit,tree:forward.driver.tree,clean:true,files:forward.driver.files};
  await verifySource(github,originalSource,forward);
  const objectivePull=await github.get(base+'pulls/'+forward.objectiveReview.pr);
  const objectiveRef={pr:forward.objectiveReview.pr,head:objectivePull.head.sha,mergeCommit:objectivePull.merge_commit_sha};
  await Promise.all([approvedMerge(github,forward.driver,{...authorization,base:'develop'}),approvedMerge(github,objectiveRef,{...authorization,base:'develop'})]);
  const protectedCatalog=JSON.parse(await githubFile(github,IMAGE_CATALOG,objectiveRef.mergeCommit));
  assert.equal(digest(protectedCatalog.entries.filter(e=>e.id===forward.id)),digest([forward]));
}
export async function authorizeImageOnlyDriver(input){
  const {github,objectiveId,dossier,plan,candidate,baseline,rollbackContext,localSource:source,action,clock=Date.now}=input;
  const started=clock();assert(Number.isSafeInteger(started));assert(actions.has(action));
  const user=await github.get('/user');assert.equal(user.type,'User');const actor=user.login;
  const branch=await github.get(base+'branches/develop'),revision=branch.commit.sha;assert(sha.test(revision)&&branch.protected);
  const protection=await github.get(base+'branches/develop/protection');assert(protection.enforce_admins.enabled&&protection.required_status_checks.strict&&protection.required_conversation_resolution.enabled);
  assert(protection.required_status_checks.contexts.includes('pr-policy'));assert(!protection.allow_force_pushes.enabled&&!protection.allow_deletions.enabled);
  const grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(grant,{repository:repo,actor,base:'develop',reasons:['production','audited-repository-tooling']});
  assert.equal(grant.id,'crm-ynov-po-delegation-20261001');const policyBytes=await githubFile(github,GITHUB_CODE_REVIEW_POLICY_PATH,revision);validateProtectedCodeReviewPolicy(JSON.parse(policyBytes),repo);
  const catalog=JSON.parse(await githubFile(github,IMAGE_CATALOG,revision));assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.entries)&&catalog.entries.length>0&&catalog.entries.length<=100);
  const entries=catalog.entries.filter(e=>e.id===objectiveId);assert.equal(entries.length,1,'PROTECTED_CONCRETE_IMAGE_OBJECTIVE_REQUIRED');const entry=entries[0];
  validateImageObjective(entry,{id:objectiveId,dossier,plan,candidate,baseline,rollbackContext,source,action,now:started});await verifySource(github,source,entry);
  if(isImageRollback(plan)){await verifyRollbackOrigin(github,catalog,entry,rollbackContext,{grant,actor});}
  const objectivePull=await github.get(base+'pulls/'+entry.objectiveReview.pr);const objectiveRef={pr:entry.objectiveReview.pr,head:objectivePull.head.sha,mergeCommit:objectivePull.merge_commit_sha};
  const [driver,objective]=await Promise.all([approvedMerge(github,entry.driver,{grant,actor,base:'develop'}),approvedMerge(github,objectiveRef,{grant,actor,base:'develop'})]);
  await verifyImagePreparationOrigins(github,candidate,{revision,grant,actor,now:started,driver});
  assert(objective.files.some(f=>f.filename===IMAGE_CATALOG));const approved=JSON.parse(await githubFile(github,IMAGE_CATALOG,objectiveRef.mergeCommit));assert.equal(digest(approved.entries.filter(e=>e.id===objectiveId)),digest([entry]));
  await Promise.all([source.commit,objectiveRef.mergeCommit].map(async commit=>{const comparison=await github.get(base+'compare/'+commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(comparison.status));}));
  const mainBranch=await github.get(base+'branches/main');assert.equal(mainBranch.commit.sha,main);assert(mainBranch.protected);
  await approvedMerge(github,entry.release,{grant,actor,base:'main'});
  const release=await github.get(base+'releases/tags/v0.1.0-rc.48');assert.equal(release.id,424492409);assert.equal(release.draft,false);assert.equal(release.prerelease,true);
  const tag=await github.get(base+'git/ref/tags/v0.1.0-rc.48');assert.equal(tag.object.type,'commit');assert.equal(tag.object.sha,main);
  const post=await github.get(base+'actions/runs/'+entry.release.postPublishRun);assert.equal(post.head_sha,main);assert.equal(post.event,'release');assert.equal(post.path,'.github/workflows/release-publish.yml');assert.equal(post.status,'completed');assert.equal(post.conclusion,'success');
  const args={actors:grant.authenticatedActors,entry,dossier,plan,source,jiraBytes:input.jiraBytes,grant,actor,action};
  validateImageOperationalMarker(objective.comments,{...args,now:started});assert.equal((await github.get(base+'branches/develop')).commit.sha,revision);
  const now=clock();assert(Number.isSafeInteger(now)&&now>=started&&now-started<60000);
  validateImageObjective(entry,{id:objectiveId,dossier,plan,candidate,baseline,rollbackContext,source,action,now});const marker=validateImageOperationalMarker(objective.comments,{...args,now});
  const authority={entry:{...structuredClone(entry),objectiveId,planSha256:marker.planSha256},receipt:{schemaVersion:1,executor:'Codex',actor,authorityRevision:revision,grantDigest:grantDigest(grant),objectiveId,catalogEntrySha256:digest(entry),dossierSha256:digest(dossier),planSha256:marker.planSha256,driverCommit:source.commit,driverPr:driver.pull.number,objectivePr:objectiveRef.pr,operationalCommentId:marker.commentId,codeReviewRequired:false,codeReviewPolicySha256:byteHash(policyBytes),verifiedAt:new Date(now).toISOString(),expiresAt:new Date(marker.expiresAt).toISOString(),businessMutationAuthorized:false,runtimeImageMutationAuthorized:true}};
  assertAuthorityCurrent(authority,now);return Object.freeze(authority);
}
