// Specialized image extension gates using the existing policy primitives.
// The historical READ ONLY driver bytes and objective pins remain unchanged.
import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{DELEGATED_CHECKS,GRANT_PATH,grantDigest,selectDelegatedDecision,validateDelegatedDecision}from'../../pr-policy/delegation.mjs';
import{validateRequiredChecks}from'../../release-manifest/checks.mjs';
import{observeOptionalCodexReview}from'../../pr-policy/github-code-review.mjs';
import{githubFile}from'../readonly-probe/probe-driver-authority-v1.mjs';
const repository='shademounir/CrmYnov',base='/repos/'+repository+'/',sha=/^[a-f0-9]{40}$/u;
function mergeIdentity(pull,reference,target,grant){
 assert.deepEqual({number:pull.number,head:pull.head.sha,merge:pull.merge_commit_sha,target:pull.base.ref,sourceRepo:pull.head.repo.full_name,targetRepo:pull.base.repo.full_name,merged:pull.merged,draft:pull.draft,autoMerge:pull.auto_merge},{number:reference.pr,head:reference.head,merge:reference.mergeCommit,target,sourceRepo:repository,targetRepo:repository,merged:true,draft:false,autoMerge:null});
 assert(grant.authenticatedActors.includes(pull.merged_by.login));
 const labels=pull.labels.map(l=>l.name);assert(labels.includes('codex-delegated-approved'));assert(!labels.some(l=>['po-approved','policy-approved'].includes(l)));
}
export async function approvedMerge(github,reference,{grant,actor,base:target}){
 assert(Number.isSafeInteger(reference.pr)&&reference.pr>0&&sha.test(reference.head)&&sha.test(reference.mergeCommit));
 const prPath=base+'pulls/'+reference.pr,issuePath=base+'issues/'+reference.pr;
 const pull=await github.get(prPath);mergeIdentity(pull,reference,target,grant);
 const [files,checks,comments,timeline,threads]=await Promise.all([github.pages(prPath+'/files'),github.pages(base+'commits/'+reference.head+'/check-runs','check_runs'),github.pages(issuePath+'/comments'),github.pages(issuePath+'/timeline'),github.reviewThreads(reference.pr)]);
 validateRequiredChecks([...DELEGATED_CHECKS,'simulate','pr-policy'],checks,{expectedSha:reference.head});
 assert(timeline.every(e=>!['auto_merge_enabled','auto_merge_disabled'].includes(e.event)));
 assert.equal(threads.reviewThreads.pageInfo.hasNextPage,false);assert(threads.reviewThreads.nodes.every(t=>t.isResolved));assert(threads.reviews.nodes.every(r=>r.state!=='CHANGES_REQUESTED'));
 const headGrant=JSON.parse(await githubFile(github,GRANT_PATH,reference.head));assert.equal(grantDigest(headGrant),grantDigest(grant));
 const decision=validateDelegatedDecision({decision:selectDelegatedDecision(comments,grant.authenticatedActors),grant,repository,actor,base:target,changedFiles:files.map(f=>f.filename),reasons:['production','audited-repository-tooling'],headSha:reference.head,pullRequestNumber:reference.pr,requiredChecks:DELEGATED_CHECKS,checkRuns:checks,mergedAt:pull.merged_at,headGrantDigest:grantDigest(headGrant)});
 return {pull,files,comments,decisionCommentId:decision.decisionCommentId,codeReview:observeOptionalCodexReview(comments,reference.head)};
}
export async function verifySource(github,source,entry){
 assert.deepEqual({commit:source.commit,tree:source.tree,clean:source.clean,files:source.files},{commit:entry.driver.mergeCommit,tree:entry.driver.tree,clean:true,files:entry.driver.files});
 async function verifyBatch(offset){
  if(offset>=source.files.length){return;}
  await Promise.all(source.files.slice(offset,offset+4).map(async f=>{assert.match(f.sha256,/^[a-f0-9]{64}$/u);const bytes=await githubFile(github,f.path,source.commit);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,'PROTECTED_IMAGE_EXTENSION_BYTES');}));
  return verifyBatch(offset+4);
 }
 await verifyBatch(0);
}
