// A reviewed objective catalog and fresh official provenance are mandatory.
// Local operator Jira observation is an attestation, not a connector signature.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DELEGATED_CHECKS,GRANT_PATH,grantDigest,selectDelegatedDecision,validateDelegatedDecision,validateGrant} from '../../pr-policy/delegation.mjs';
import {validateRequiredChecks} from '../../release-manifest/checks.mjs';
import {digest} from './rc47-select-only-probe-core-v1.mjs';
export const REPOSITORY='shademounir/CrmYnov';
export const CATALOG_PATH='docs/governance/readonly-probe-objectives-v1.json';
export const RELEASE_MAIN='8253024ea35cee6be5636cc6b10a88ae7e177377';
const base='/repos/'+REPOSITORY+'/',H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u;
const byteHash=b=>createHash('sha256').update(b).digest('hex');
export async function githubFile(github,file,revision) {
  assert(S.test(revision));assert(/^[A-Za-z0-9_./-]+$/u.test(file)&&!file.includes('..'));
  const value=await github.get(base+'contents/'+file+'?ref='+revision);
  assert.equal(value.encoding,'base64');assert.equal(typeof value.content,'string');assert(value.content.length<=1400000);
  const bytes=Buffer.from(value.content,'base64');assert(bytes.length<=1048576);return bytes;
}
function review(comments,head) {
  const entries=comments.filter(c=>c.user?.login==='chatgpt-codex-connector[bot]'&&c.user.type==='Bot'&&c.performed_via_github_app?.slug==='chatgpt-codex-connector'&&c.body.includes('<!-- codex-review-state:v1 ')).sort((a,b)=>b.id-a.id);
  assert(entries.length>0,'final source-bound bot review missing');
  const marker=entries[0].body.match(/<!-- codex-review-state:v1 (.*?) -->/u);assert(marker);
  const state=JSON.parse(marker[1]).code_review;
  assert.equal(state.commit_sha,head);assert.equal(state.status,'completed');assert.equal(state.has_any_findings,false);assert.equal(state.has_unresolved_findings,false);
  return entries[0].id;
}
async function mergedPull(github,reference,grant,actor,targetBase) {
  assert(Number.isSafeInteger(reference.pr)&&reference.pr>0);assert(S.test(reference.head)&&S.test(reference.mergeCommit));
  const pr=await github.get(base+'pulls/'+reference.pr);
  assert.equal(pr.number,reference.pr);assert.equal(pr.head.sha,reference.head);assert.equal(pr.merge_commit_sha,reference.mergeCommit);assert.equal(pr.base.ref,targetBase);
  assert.equal(pr.base.repo.full_name,REPOSITORY);assert.equal(pr.head.repo.full_name,REPOSITORY);
  assert.equal(pr.merged,true);assert.equal(pr.draft,false);assert.equal(pr.auto_merge,null);assert(grant.authenticatedActors.includes(pr.user.login)&&grant.authenticatedActors.includes(pr.merged_by.login));
  const labels=new Set(pr.labels.map(l=>l.name));assert(labels.has('codex-delegated-approved'));assert(!labels.has('po-approved')&&!labels.has('policy-approved'));
  const files=(await github.pages(base+'pulls/'+reference.pr+'/files')).map(f=>f.filename);
  const checks=await github.pages(base+'commits/'+reference.head+'/check-runs','check_runs');
  validateRequiredChecks([...DELEGATED_CHECKS,'pr-policy'],checks,{expectedSha:reference.head});
  const comments=await github.pages(base+'issues/'+reference.pr+'/comments');
  const timeline=await github.pages(base+'issues/'+reference.pr+'/timeline');assert(!timeline.some(e=>['auto_merge_enabled','auto_merge_disabled'].includes(e.event)));
  const threads=await github.reviewThreads(reference.pr);assert(!threads.reviewThreads.pageInfo.hasNextPage);assert(threads.reviewThreads.nodes.every(t=>t.isResolved));assert(!threads.reviews.nodes.some(r=>r.state==='CHANGES_REQUESTED'));
  const headGrant=JSON.parse(await githubFile(github,GRANT_PATH,reference.head));assert.equal(grantDigest(headGrant),grantDigest(grant));
  const decision=selectDelegatedDecision(comments,grant.authenticatedActors);
  const approval=validateDelegatedDecision({decision,grant,repository:REPOSITORY,actor,base:targetBase,changedFiles:files,reasons:['audited-repository-tooling','production'],headSha:reference.head,pullRequestNumber:reference.pr,requiredChecks:DELEGATED_CHECKS,checkRuns:checks,mergedAt:pr.merged_at,headGrantDigest:grantDigest(headGrant)});
  return {pr,files,checks,comments,reviewId:review(comments,reference.head),decisionId:approval.decisionCommentId};
}
function marker(comments,name,actors) {
  const prefix='<!-- '+name;
  const rows=comments.filter(c=>actors.includes(c.user?.login)&&c.user.type==='User'&&c.body.includes(prefix)).sort((a,b)=>b.id-a.id);assert(rows.length>0,'fresh operational authorization missing');
  const comment=rows[0];assert(comment.body.length<=65536);assert.equal(comment.body.indexOf(prefix),comment.body.lastIndexOf(prefix));const end=comment.body.indexOf('-->',comment.body.indexOf(prefix)+prefix.length);assert(end>0);
  return {value:JSON.parse(comment.body.slice(comment.body.indexOf(prefix)+prefix.length,end).trim()),comment};
}
export function validateOperatorJiraObservation(bytes,{expectedSha256,ticket,actor,grantSha256,now}) {
  assert(H.test(expectedSha256));assert.equal(byteHash(bytes),expectedSha256);
  const v=JSON.parse(bytes);assert.equal(v.schemaVersion,1);assert.equal(v.source,'OFFICIAL_JIRA_UI_OPERATOR_OBSERVATION');assert.equal(v.executor,'Codex');assert.equal(v.observedBy,actor);assert.equal(v.grantDigest,grantSha256);assert.equal(v.ticket.key,ticket);assert.equal(v.ticket.codexReady,true);assert.equal(v.ticket.blocked,false);assert(['In Progress','In Review'].includes(v.ticket.status));
  const at=Date.parse(v.observedAt);assert(Number.isFinite(at)&&at<=now&&now-at<=600000,'fresh Jira UI operator attestation required');
  assert.equal(v.claim,'Operator-observed official Jira UI; not a cryptographic Jira connector or native signature');return v;
}
export function assertAuthorityCurrent(authority,now) {
  const verified=Date.parse(authority?.receipt?.verifiedAt),expires=Date.parse(authority?.receipt?.expiresAt);
  assert(Number.isSafeInteger(now)&&Number.isFinite(verified)&&Number.isFinite(expires));
  assert(now>=verified&&now<expires,'operational authority expired or clock moved backwards');
}
// Called by the existing bounded exchange AFTER its token await and immediately
// before the native POST. GET remains a non-mutating metadata observation.
export function createAuthorityBoundFetch({fetchImpl,getAuthority,clock=Date.now}) {
  assert.equal(typeof fetchImpl,'function');assert.equal(typeof getAuthority,'function');assert.equal(typeof clock,'function');
  let lastClock;
  return (url,options={})=>{
    assert.equal(typeof url,'string','Request objects are not accepted at the guarded transport boundary');
    assert(options&&Object.getPrototypeOf(options)===Object.prototype,'plain request init required');
    const descriptors=Object.getOwnPropertyDescriptors(options),allowed=new Set(['method','redirect','signal','headers','body']);
    assert(Reflect.ownKeys(options).every(key=>typeof key==='string'&&allowed.has(key)),'unsupported request init');
    assert(Object.values(descriptors).every(d=>Object.hasOwn(d,'value')),'request init accessors refused');
    const init=Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,d.value]));
    const rawMethod=Object.hasOwn(init,'method')?init.method:'GET';assert.equal(typeof rawMethod,'string');
    const method=rawMethod.toUpperCase();assert(['GET','POST'].includes(method),'only GET/POST permitted');
    if(method==='GET'){assert(!Object.hasOwn(init,'body'),'GET body refused');}
    const now=clock();assert(Number.isSafeInteger(now));assert(lastClock===undefined||now>=lastClock,'clock moved backwards');lastClock=now;
    if(method==='POST'){
      assertAuthorityCurrent(getAuthority(),now);
    }
    return fetchImpl(url,{...init,method});
  };
}
export async function authorizeProbeDriver({github,objectiveId,dossier,jiraBytes,localSource,action,clock=Date.now}) {
  assert.equal(typeof clock,'function');const start=clock(),now=start;assert(Number.isSafeInteger(start));assert(['CREATE_JOB','OBSERVE_CREATE','DISPATCH','OBSERVE_RUN','VERIFY'].includes(action));assert(/^[a-z0-9][a-z0-9-]{1,80}$/u.test(objectiveId));
  const user=await github.get('/user'),actor=user.login;assert.equal(user.type,'User');
  const branch=await github.get(base+'branches/develop'),revision=branch.commit.sha;assert(S.test(revision));assert.equal(branch.protected,true);
  const protection=await github.get(base+'branches/develop/protection');assert(protection.required_status_checks.contexts.includes('pr-policy'));
  const grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(grant,{repository:REPOSITORY,actor,base:'develop',reasons:['production','audited-repository-tooling']});assert.equal(grant.id,'crm-ynov-po-delegation-20261001');
  const catalog=JSON.parse(await githubFile(github,CATALOG_PATH,revision));assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.entries)&&catalog.entries.length<=100);
  const matches=catalog.entries.filter(e=>e.id===objectiveId);assert.equal(matches.length,1,'reviewed objective absent or ambiguous');const entry=matches[0];
  assert.equal(entry.status,'approved');assert.equal(entry.schemaVersion,1);assert.equal(entry.scope,'READONLY_PRESERVATION_PROBE_ONLY');assert.equal(entry.businessMutation,false);assert(entry.actions.includes(action));assert(now>=Date.parse(entry.validFrom)&&now<Date.parse(entry.expiresAt));
  assert.equal(entry.dossierSha256,digest(dossier),'unreviewed or changed private objective');
  for(const key of ['settingsSha256','membershipSha256','permissionSha256','poolSha256']){const pin=entry.baselineLineage?.[key];assert(pin,'historical baseline pin lineage missing: '+key);assert.equal(pin.value,dossier.preservation[key]);assert(H.test(pin.value)&&pin.value!=='0'.repeat(64));assert(H.test(pin.evidenceSha256)&&pin.evidenceSha256!=='0'.repeat(64));assert.equal(pin.source,'OFFICIAL_IMMUTABLE_BASELINE_RECEIPT');assert(Number.isFinite(Date.parse(pin.observedAt))&&Date.parse(pin.observedAt)<=now);}
  assert.equal(entry.ticket,'CRMY-63');assert.equal(localSource.commit,entry.driver.mergeCommit);assert.equal(localSource.tree,entry.driver.tree);assert.equal(localSource.clean,true);
  assert.deepEqual(localSource.files,entry.driver.files);assert(entry.driver.files.length>=10);
  // Bounded groups avoid serial network waits without unbounded provider fan-out.
  const sourceGroups=Array.from({length:Math.ceil(entry.driver.files.length/4)},(_,i)=>entry.driver.files.slice(i*4,i*4+4));
  await sourceGroups.reduce((previous,group)=>previous.then(()=>Promise.all(group.map(async file=>{assert(H.test(file.sha256));assert.equal(byteHash(await githubFile(github,file.path,localSource.commit)),file.sha256,'driver source mismatch');}))),Promise.resolve());
  // The catalog may name its own PR number (known from an earlier draft), but
  // never its own head/merge hash: that would require an impossible fixed point.
  assert.deepEqual(Object.keys(entry.objectiveReview),['pr']);
  const objectivePull=await github.get(base+'pulls/'+entry.objectiveReview.pr);
  const objectiveReference={pr:entry.objectiveReview.pr,head:objectivePull.head.sha,mergeCommit:objectivePull.merge_commit_sha};
  await Promise.all([entry.driver.mergeCommit,objectiveReference.mergeCommit].map(async commit=>{assert(S.test(commit));const comparison=await github.get(base+'compare/'+commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(comparison.status));}));
  const driver=await mergedPull(github,entry.driver,grant,actor,'develop');
  const objective=await mergedPull(github,objectiveReference,grant,actor,'develop');assert(objective.files.includes(CATALOG_PATH));
  const approvedCatalog=JSON.parse(await githubFile(github,CATALOG_PATH,objectiveReference.mergeCommit));assert.equal(digest(approvedCatalog.entries.filter(e=>e.id===objectiveId)),digest([entry]),'catalog objective was not approved in referenced merge');
  assert.equal(entry.release.pr,243);assert.equal(entry.release.mergeCommit,RELEASE_MAIN);assert.equal(entry.release.tag,'v0.1.0-rc.48');
  const main=await github.get(base+'branches/main');assert.equal(main.commit.sha,RELEASE_MAIN,'release target drift');assert.equal(main.protected,true);
  const releaseApproval=await mergedPull(github,entry.release,grant,actor,'main');
  const mainChecks=await github.pages(base+'commits/'+RELEASE_MAIN+'/check-runs','check_runs');validateRequiredChecks(DELEGATED_CHECKS,mainChecks,{expectedSha:RELEASE_MAIN});
  const release=await github.get(base+'releases/tags/v0.1.0-rc.48');assert.equal(release.id,entry.release.releaseId);assert.equal(release.draft,false);assert.equal(release.prerelease,true);assert(Number.isFinite(Date.parse(release.published_at)));
  const tag=await github.get(base+'git/ref/tags/v0.1.0-rc.48');assert.equal(tag.object.type,'commit');assert.equal(tag.object.sha,RELEASE_MAIN);
  const post=await github.get(base+'actions/runs/'+entry.release.postPublishRun);assert.equal(post.head_sha,RELEASE_MAIN);assert.equal(post.event,'release');assert.equal(post.path,'.github/workflows/release-publish.yml');assert.equal(post.status,'completed');assert.equal(post.conclusion,'success');assert(Date.parse(post.created_at)>=Date.parse(release.published_at));
  const {value:authorization,comment}=marker(objective.comments,'codex-readonly-probe-objective-authorization:v1',grant.authenticatedActors);
  assert.equal(authorization.schemaVersion,1);assert.equal(authorization.executor,'Codex');assert.equal(authorization.grantDigest,grantDigest(grant));assert.equal(authorization.objectiveId,objectiveId);assert.equal(authorization.catalogEntrySha256,digest(entry));assert.equal(authorization.dossierSha256,entry.dossierSha256);assert.equal(authorization.driverCommit,localSource.commit);assert(authorization.actions.includes(action));assert.equal(authorization.productionBusinessMutation,false);
  const issued=Date.parse(comment.updated_at??comment.created_at),expiry=Date.parse(authorization.expiresAt);assert(Number.isFinite(issued)&&issued<=now&&now-issued<=600000&&expiry>now&&expiry-issued<=600000,'fresh operational authority expired');
  const jira=validateOperatorJiraObservation(jiraBytes,{expectedSha256:authorization.jiraObservationSha256,ticket:entry.ticket,actor,grantSha256:grantDigest(grant),now});
  assert(H.test(authorization.humanAuthorityReceiptSha256));assert.equal(authorization.humanAuthorityReceiptSha256,entry.humanAuthorityReceiptSha256);
  const finalBranch=await github.get(base+'branches/develop');assert.equal(finalBranch.commit.sha,revision,'protected authority changed');
  const finalNow=clock();assert(Number.isSafeInteger(finalNow)&&finalNow>=start,'clock moved backwards');assert(finalNow-start<60000,'authority collection deadline');
  assert(finalNow>=Date.parse(entry.validFrom)&&finalNow<Date.parse(entry.expiresAt),'objective expired during collection');
  assert(issued<=finalNow&&finalNow-issued<600000&&expiry>finalNow,'operational authority expired during collection');
  validateOperatorJiraObservation(jiraBytes,{expectedSha256:authorization.jiraObservationSha256,ticket:entry.ticket,actor,grantSha256:grantDigest(grant),now:finalNow});
  const expiresAt=Math.min(Date.parse(entry.expiresAt),expiry,issued+600000,Date.parse(jira.observedAt)+600000);
  assert(finalNow<expiresAt,'authority freshness expired during collection');
  return Object.freeze({entry:structuredClone(entry),receipt:Object.freeze({schemaVersion:1,actor,executor:'Codex',authorityRevision:revision,grantDigest:grantDigest(grant),objectiveId,dossierSha256:entry.dossierSha256,catalogEntrySha256:digest(entry),driverCommit:localSource.commit,driverReviewId:driver.reviewId,objectiveReviewId:objective.reviewId,releaseReviewId:releaseApproval.reviewId,operationalCommentId:comment.id,jiraObservedAt:jira.observedAt,jiraEvidenceMeaning:jira.claim,verifiedAt:new Date(finalNow).toISOString(),expiresAt:new Date(expiresAt).toISOString(),businessMutationAuthorized:false})});
}
