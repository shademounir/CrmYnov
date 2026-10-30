// Concrete protected READ_ONLY_INVENTORY objective. No future plan or mutation authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {approvedMerge,verifySource} from './protected-gates.mjs';
import {githubFile,assertAuthorityCurrent} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {validateNativeJiraReadObservation} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {GRANT_PATH,grantDigest,validateGrant} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH,validateProtectedCodeReviewPolicy} from '../../pr-policy/github-code-review.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {OPERATIONAL_HUMAN_SHA256,validateImageResourcesV2} from './late-binding-v2.mjs';
import {validateImageCatalogueReviewV2,resolveImageCatalogueReviewV2} from './catalogue-origin-v2.mjs';
const REPO='shademounir/CrmYnov',API='/repos/'+REPO+'/',CATALOG='docs/governance/runtime-image-only-objectives-v1.json',H=/^[a-f0-9]{64}$/u,S=/^[a-f0-9]{40}$/u;
const actions=new Set(['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']);
const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateImageInventoryObjective(entry,{objectiveId,source,action,now}){
 assert.equal(entry.schemaVersion,2);assert.equal(entry.kind,'RC48_NATIVE_INVENTORY_OBJECTIVE_V2');assert.equal(entry.id,objectiveId);assert.match(entry.id,/^rc48-image-only-inventory-[a-z0-9-]{8,64}$/u);
 assert.equal(entry.status,'approved');assert.equal(entry.scope,'READ_ONLY_INVENTORY');assert.equal(entry.preparationMode,'READ_ONLY_INVENTORY');assert.equal(entry.ticket,'CRMY-63');
 assert.equal(entry.project,'crmynov-prod-n7x4q2');assert.equal(entry.region,'europe-west1');assert.equal(entry.googleAccount,'casablancaynovcampus@gmail.com');
 assert.equal(entry.businessMutation,false);assert.equal(entry.runtimeImageMutation,false);assert.equal(entry.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);
 assert.deepEqual([...entry.actions].toSorted((a,b)=>a.localeCompare(b,'en')),[...actions].toSorted((a,b)=>a.localeCompare(b,'en')));assert(actions.has(action));validateImageResourcesV2(entry.resourceBindings);
 assert.equal(entry.planSha256,undefined,'INVENTORY_MUST_NOT_FABRICATE_FUTURE_PLAN');assert.equal(entry.preparationReceiptSha256,undefined);assert(H.test(entry.journalDirectorySha256));
 assert(source.clean&&source.commit===entry.driver.mergeCommit&&source.tree===entry.driver.tree);assert.deepEqual(source.files,entry.driver.files);validateImageCatalogueReviewV2(entry.objectiveReview);
 assert(Number.isSafeInteger(now)&&Date.parse(entry.validFrom)<=now&&now<Date.parse(entry.expiresAt));return true;
}
export function validateImageInventoryMarker(comments,{entry,source,jiraBytes,grant,actor,action,now}){
 const prefix='<!-- codex-runtime-inventory-authorization:v2';
 const rows=comments.filter(c=>grant.authenticatedActors.includes(c.user?.login)&&c.user.type==='User'&&typeof c.body==='string'&&c.body.includes(prefix)).sort((a,b)=>b.id-a.id);assert(rows.length);
 const comment=rows[0],start=comment.body.indexOf(prefix),end=comment.body.indexOf('-->',start+prefix.length);assert(comment.body.length<=65536&&start===comment.body.lastIndexOf(prefix)&&end>start);const v=JSON.parse(comment.body.slice(start+prefix.length,end).trim());
 assert.equal(v.schemaVersion,2);assert.equal(v.executor,'Codex');assert.equal(v.objectiveId,entry.id);assert.equal(v.scope,'READ_ONLY_INVENTORY');
 for(const[k,value]of Object.entries({authorityRecordSha256:digest(entry),driverCommit:source.commit,grantDigest:grantDigest(grant),humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,resourceBindingSha256:digest(entry.resourceBindings)})){assert.equal(v[k],value);}
 assert.equal(v.productionRuntimeMutation,false);assert.equal(v.productionBusinessMutation,false);assert.equal(v.runAuthorized,false);assert(Array.isArray(v.actions)&&v.actions.includes(action)&&v.actions.every(a=>actions.has(a)));
 assert.equal(v.jiraEvidenceVersion,1);const jira=validateNativeJiraReadObservation(jiraBytes,{expectedSha256:v.jiraObservationSha256,actor,grantSha256:grantDigest(grant),now});
 const issued=Date.parse(comment.updated_at??comment.created_at),expires=Date.parse(v.expiresAt);assert(issued<=now&&now-issued<600000&&expires>now&&expires-issued<=600000);
 return{commentId:comment.id,markerSha256:byteHash(Buffer.from(comment.body,'utf8')),markerObservedUpdatedAt:comment.updated_at??comment.created_at,jira,expiresAt:Math.min(expires,Date.parse(entry.expiresAt),Date.parse(jira.observedAt)+600000)};
}
export async function authorizeImageInventory({github,objectiveId,localSource:source,jiraBytes,action='READ_METADATA',clock=Date.now}){
 const began=clock();assert(Number.isSafeInteger(began)&&actions.has(action));const user=await github.get('/user');assert.equal(user.type,'User');const actor=user.login;
 const branch=await github.get(API+'branches/develop'),revision=branch.commit.sha;assert(branch.protected&&S.test(revision));
 const protection=await github.get(API+'branches/develop/protection');assert(protection.enforce_admins.enabled&&protection.required_status_checks.strict&&protection.required_conversation_resolution.enabled);assert(protection.required_status_checks.contexts.includes('pr-policy'));assert(!protection.allow_force_pushes.enabled&&!protection.allow_deletions.enabled);
 const grant=JSON.parse(await githubFile(github,GRANT_PATH,revision));validateGrant(grant,{repository:REPO,actor,base:'develop',reasons:['production','audited-repository-tooling']});assert.equal(grant.id,'crm-ynov-po-delegation-20261001');
 const policy=await githubFile(github,GITHUB_CODE_REVIEW_POLICY_PATH,revision);validateProtectedCodeReviewPolicy(JSON.parse(policy),REPO);
 const catalog=JSON.parse(await githubFile(github,CATALOG,revision));assert.equal(catalog.schemaVersion,2);assert(Array.isArray(catalog.entries)&&catalog.entries.length>0&&catalog.entries.length<=100);const rows=catalog.entries.filter(e=>e.id===objectiveId);assert.equal(rows.length,1,'PROTECTED_CONCRETE_INVENTORY_OBJECTIVE_REQUIRED');const entry=rows[0];
 validateImageInventoryObjective(entry,{objectiveId,source,action,now:began});await verifySource(github,source,entry);
 const driver=await approvedMerge(github,entry.driver,{grant,actor,base:'develop'}),objectiveRef=await resolveImageCatalogueReviewV2(github,{descriptor:entry.objectiveReview,revision});
 const objective=await approvedMerge(github,objectiveRef,{grant,actor,base:'develop'});assert(objective.files.some(f=>f.filename===CATALOG));
 const origin=JSON.parse(await githubFile(github,CATALOG,objectiveRef.mergeCommit));assert.equal(digest(origin.entries.filter(e=>e.id===objectiveId)),digest([entry]));
 await [source.commit,objectiveRef.mergeCommit].reduce(async(previous,commit)=>{await previous;const comparison=await github.get(API+'compare/'+commit+'...'+revision);assert.equal(comparison.merge_base_commit.sha,commit);assert(['ahead','identical'].includes(comparison.status));},Promise.resolve());
 const marker=validateImageInventoryMarker(objective.comments,{entry,source,jiraBytes,grant,actor,action,now:clock()});assert.equal((await github.get(API+'branches/develop')).commit.sha,revision);
 const now=clock();assert(now>=began&&now-began<60000);validateImageInventoryObjective(entry,{objectiveId,source,action,now});assert(now<marker.expiresAt);
 const fields={authorityRecordSha256:digest(entry),resourceBindingSha256:digest(entry.resourceBindings),scope:entry.scope,project:entry.project,region:entry.region,validFrom:entry.validFrom,preparationPhase:'READ_ONLY_INVENTORY'};
 const authority={entry:{...structuredClone(entry),...fields,objectiveId},receipt:{schemaVersion:2,executor:'Codex',actor,authorityRevision:revision,grantDigest:grantDigest(grant),objectiveId,...fields,driverCommit:source.commit,driverPr:driver.pull.number,objectivePr:objectiveRef.pr,operationalCommentId:marker.commentId,operationalMarkerSha256:marker.markerSha256,operationalMarkerUpdatedAt:marker.markerObservedUpdatedAt,verifiedAt:new Date(now).toISOString(),expiresAt:new Date(marker.expiresAt).toISOString(),businessMutationAuthorized:false,runtimeImageMutationAuthorized:false,runAuthorized:false,codeReviewRequired:false,codeReviewPolicySha256:byteHash(policy)}};
 assertAuthorityCurrent(authority,now);return Object.freeze(authority);
}
