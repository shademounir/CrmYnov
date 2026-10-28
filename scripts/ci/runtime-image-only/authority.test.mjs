// Existing governance fixture, synthetic image inputs. No native requests.
import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
import {authorityFixture} from '../readonly-probe/tests/probe-driver-fixtures-v1.mjs';
import {scopeDigest,GRANT_PATH} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH} from '../../pr-policy/github-code-review.mjs';
import {fixture} from './synthetic-fixtures.mjs';
import {makeRc48ServiceImagePlanDraft} from './plan.mjs';
import {imageJournalDigest as digest} from './journal.mjs';
import {authorizeImageOnlyDriver,IMAGE_CATALOG,IMAGE_SCOPE} from './authority.mjs';
import {rollbackFixture} from './rollback-synthetic-fixtures.mjs';
import {makeRc48ImageRollbackPlanDraft} from './rollback-plan.mjs';
const policy=JSON.parse(fs.readFileSync(new URL('../../../docs/governance/github-code-review-policy.json',import.meta.url)));
function imageFixture(){
 const f=authorityFixture(),v=fixture();v.b.observedAt=new Date(f.now-1000).toISOString();v.now=f.now;f.plan=makeRc48ServiceImagePlanDraft(v.c,v.b,v.now);f.candidate=v.c;f.baseline=v.b;
 const e=f.entry;e.id='rc48-image-only-synthetic-0001';e.scope=IMAGE_SCOPE;e.project='crmynov-prod-n7x4q2';e.googleAccount='casablancaynovcampus@gmail.com';e.runtimeImageMutation=true;e.actions=['READ_METADATA','CREATE_BACKUP','PATCH_API','PATCH_WEB','OBSERVE_OPERATION'];e.preparationReceiptSha256='b'.repeat(64);e.release.sourceTree=v.c.tree;
 for(let i=10;i<15;i++){const path='scripts/ci/readonly-probe/synthetic-'+i+'.mjs',bytes=Buffer.from('// SYNTHETIC '+i);f.localSource.files.push({path,sha256:f.hash(bytes)});f.responses.set(f.base+'contents/'+path+'?ref='+f.localSource.commit,f.blob(bytes.toString()));}
 f.dossier={schemaVersion:1,id:e.id,scope:IMAGE_SCOPE,candidate:v.c,preservedJobs:f.plan.preservedJobs,preservedSchedulers:f.plan.preservedSchedulers,humanAuthorityReceiptSha256:e.humanAuthorityReceiptSha256,preparationReceiptSha256:e.preparationReceiptSha256,noDatabaseRestore:true,noMigration:true,noFlagActivation:true,noJobOrSchedulerMutation:true,preserveInterveningWrites:true};e.dossierSha256=digest(f.dossier);
 f.responses.set(f.base+'branches/develop/protection',{enforce_admins:{enabled:true},required_status_checks:{strict:true,contexts:['pr-policy']},required_conversation_resolution:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}});
 f.responses.set(f.base+'contents/'+GITHUB_CODE_REVIEW_POLICY_PATH+'?ref='+'6'.repeat(40),f.blob(policy));
 for(const head of ['1','4','7'].map(x=>x.repeat(40))){f.responses.get(f.base+'commits/'+head+'/check-runs').push({id:90000+Number(head[0]),name:'simulate',status:'completed',conclusion:'success',head_sha:head});}
 f.responses.set(f.base+'pulls/302/files',[{filename:IMAGE_CATALOG}]);
 const decision=f.responses.get(f.base+'issues/302/comments')[0],d=JSON.parse(decision.body.slice(decision.body.indexOf('\n'),decision.body.lastIndexOf('\n')));d.scopeDigest=scopeDigest([IMAGE_CATALOG]);decision.body='<!-- codex-delegated-decision\n'+JSON.stringify(d)+'\n-->';
 Object.assign(f.authorization,{objectiveId:e.id,driverCommit:f.localSource.commit,actions:e.actions,productionRuntimeMutation:true,productionBusinessMutation:false,planSha256:digest(f.plan),preparationReceiptSha256:e.preparationReceiptSha256});
 f.refreshImage=()=>{e.dossierSha256=digest(f.dossier);Object.assign(f.authorization,{catalogEntrySha256:digest(e),dossierSha256:e.dossierSha256});for(const revision of ['6'.repeat(40),'5'.repeat(40)]){f.responses.set(f.base+'contents/'+IMAGE_CATALOG+'?ref='+revision,f.blob({schemaVersion:1,entries:[e]}));}f.responses.get(f.base+'issues/302/comments').find(c=>c.id===102).body='<!-- codex-runtime-image-authorization:v1\n'+JSON.stringify(f.authorization)+'\n-->';};f.refreshImage();return f;
}
const run=f=>authorizeImageOnlyDriver({github:f.github,objectiveId:f.entry.id,dossier:f.dossier,plan:f.plan,candidate:f.candidate,baseline:f.baseline,rollbackContext:f.rollbackContext,localSource:f.localSource,jiraBytes:f.jiraBytes,action:'PATCH_API',clock:()=>f.now});
test('existing protected governance gates specialize to exact image authority',async()=>{const f=imageFixture(),r=await run(f);assert.equal(r.entry.scope,IMAGE_SCOPE);assert.equal(r.entry.planSha256,digest(f.plan));assert.equal(r.receipt.runtimeImageMutationAuthorized,true);assert.equal(r.receipt.businessMutationAuthorized,false);assert.equal(r.receipt.codeReviewRequired,false);assert.equal(r.receipt.driverPr,301);});
for(const [name,change]of [
 ['READ ONLY scope cannot upgrade',f=>f.entry.scope='GENERAL_PRESERVATION_READ_ONLY_V1'],
 ['foreign project',f=>f.entry.project='other'],['foreign account',f=>f.entry.googleAccount='other@example.test'],
 ['business write authority',f=>f.entry.businessMutation=true],['image action missing',f=>f.entry.actions.pop()],
 ['empty concrete catalog',f=>f.emptyCatalog=true],['unmerged source',f=>f.responses.get(f.base+'pulls/301').merged=false],
 ['unmerged objective',f=>f.responses.get(f.base+'pulls/302').merged=false],['unresolved real finding',f=>f.github.reviewThreads=async()=>({reviewThreads:{pageInfo:{hasNextPage:false},nodes:[{isResolved:false}]},reviews:{nodes:[]}})],
 ['pending technical CI',f=>f.responses.get(f.base+'commits/'+'1'.repeat(40)+'/check-runs')[0].status='in_progress'],
 ['foreign RC48 target',f=>f.candidate.images.api.digest='sha256:'+'a'.repeat(64)],
 ['job configuration changed',f=>f.dossier.preservedJobs[0].configurationSha256='a'.repeat(64)],
 ['Scheduler configuration changed',f=>f.dossier.preservedSchedulers[0].configurationSha256='a'.repeat(64)],
 ['missing qualified preparation',f=>delete f.entry.preparationReceiptSha256],
 ['changed fresh plan marker',f=>f.authorization.planSha256='a'.repeat(64)],
 ['expired operation marker',f=>f.authorization.expiresAt=new Date(f.now-1).toISOString()],
 ['weakened protections',f=>f.responses.get(f.base+'branches/develop/protection').allow_force_pushes.enabled=true],
 ['changed Jira',f=>f.jiraBytes=Buffer.from('{}')],['SQL restore',f=>f.dossier.noDatabaseRestore=false],
 ['migration',f=>f.dossier.noMigration=false],['ingestion enable',f=>f.dossier.noFlagActivation=false],
 ['job write',f=>f.dossier.noJobOrSchedulerMutation=false],['lost intervening writes',f=>f.dossier.preserveInterveningWrites=false],
 ['dirty source',f=>f.localSource.clean=false],['changed source hash',f=>f.localSource.files[0].sha256='a'.repeat(64)],
 ['expired catalog',f=>f.entry.expiresAt=new Date(f.now-1).toISOString()]
]){test('image authority refuses '+name,async()=>{const f=imageFixture();change(f);f.refreshImage();if(f.emptyCatalog){f.responses.set(f.base+'contents/'+IMAGE_CATALOG+'?ref='+'6'.repeat(40),f.blob({schemaVersion:1,entries:[]}));}await assert.rejects(run(f));});}
for(const state of ['absent','running','stale']){test('optional '+state+' bot summary is not an image authority prerequisite',async()=>{const f=imageFixture();for(const pr of [301,302,243]){const key=f.base+'issues/'+pr+'/comments',comments=f.responses.get(key);if(state==='absent'){f.responses.set(key,comments.filter(c=>c.user.type!=='Bot'));}else{const b=comments.find(c=>c.user.type==='Bot');b.body=b.body.replace('completed','running');if(state==='stale'){b.body=b.body.replace(/"commit_sha":"[a-f0-9]+"/u,'"commit_sha":"'+'a'.repeat(40)+'"');}}}await run(f);});}
for(const delta of [-1,60000,600000]){test('authority collection clock boundary '+delta,async()=>{const f=imageFixture(),get=f.github.get;let n=0;f.github.get=async p=>{const v=await get(p);if(p===f.base+'branches/develop'&&++n===2){f.now+=delta;}return v;};await assert.rejects(run(f));});}

function rollbackAuthorityFixture(){
 const f=imageFixture(),forward=structuredClone(f.entry),r=rollbackFixture(),newHead='c'.repeat(40),newMerge='b'.repeat(40),current='6'.repeat(40);
 r.input.originalBaseline.observedAt=f.baseline.observedAt;r.input.currentBaseline.observedAt=f.baseline.observedAt;
 r.input.forwardPlan=f.plan;r.input.forwardEvidence.planSha256=digest(f.plan);r.input.forwardEvidence.sourceHead=f.localSource.commit;
 f.rollbackContext={forwardPlan:f.plan,originalBaseline:f.baseline,forwardEvidence:r.input.forwardEvidence,forwardObjectiveId:forward.id,forwardDossierSha256:forward.dossierSha256,originalJournalDirectory:'C:/SYNTHETIC-FORWARD-JOURNAL'};
 forward.journalDirectorySha256=f.hash(f.rollbackContext.originalJournalDirectory);
 const originalComments=structuredClone(f.responses.get(f.base+'issues/302/comments'));
 const pull=structuredClone(f.responses.get(f.base+'pulls/302'));pull.number=303;pull.head.sha=newHead;pull.merge_commit_sha=newMerge;
 f.responses.set(f.base+'pulls/303',pull);f.responses.set(f.base+'pulls/303/files',[{filename:IMAGE_CATALOG}]);f.responses.set(f.base+'issues/303/timeline',[]);
 const checks=structuredClone(f.responses.get(f.base+'commits/'+'4'.repeat(40)+'/check-runs')).map(c=>({...c,id:c.id+1000,head_sha:newHead}));
 f.responses.set(f.base+'commits/'+newHead+'/check-runs',checks);
 const comment=originalComments[0],decision=JSON.parse(comment.body.slice(comment.body.indexOf('\n'),comment.body.lastIndexOf('\n')));
 decision.pullRequest=303;decision.headSha=newHead;decision.checks=decision.checks.map(c=>{const check=checks.find(row=>row.name===c.name);if(check===undefined){throw new Error('SYNTHETIC_REQUIRED_CHECK_MISSING');}return{...c,id:check.id};});
 comment.body='<!-- codex-delegated-decision\n'+JSON.stringify(decision)+'\n-->';f.responses.set(f.base+'issues/303/comments',originalComments);
 f.responses.set(f.base+'contents/'+GRANT_PATH+'?ref='+newHead,f.blob(f.grant));
 f.responses.set(f.base+'compare/'+newMerge+'...'+current,{merge_base_commit:{sha:newMerge},status:'ahead'});
 f.plan=makeRc48ImageRollbackPlanDraft(r.input,f.now);f.baseline=r.input.currentBaseline;
 f.entry.id='rc48-image-only-rollback-synthetic-0001';f.entry.scope='RC48_SERVICE_IMAGE_ROLLBACK_V1';f.entry.direction='RESTORE_CAPTURED_RC44';f.entry.objectiveReview={pr:303};
 Object.assign(f.dossier,{id:f.entry.id,scope:f.entry.scope,direction:f.entry.direction});
 Object.assign(f.authorization,{objectiveId:f.entry.id,scope:f.entry.scope,planSha256:digest(f.plan)});
 f.forwardEntry=forward;
 f.refreshRollback=()=>{
   const contextSha=digest(f.rollbackContext);Object.assign(f.entry,{forwardContextSha256:contextSha,forwardObjectiveId:forward.id,forwardCatalogEntrySha256:digest(forward)});
   Object.assign(f.dossier,{forwardContextSha256:contextSha,forwardCatalogEntrySha256:digest(forward)});
   f.entry.dossierSha256=digest(f.dossier);Object.assign(f.authorization,{catalogEntrySha256:digest(f.entry),dossierSha256:f.entry.dossierSha256,forwardContextSha256:contextSha});
   f.responses.set(f.base+'contents/'+IMAGE_CATALOG+'?ref='+'5'.repeat(40),f.blob({schemaVersion:1,entries:[forward]}));
   for(const revision of [current,newMerge]){f.responses.set(f.base+'contents/'+IMAGE_CATALOG+'?ref='+revision,f.blob({schemaVersion:1,entries:[forward,f.entry]}));}
   f.responses.get(f.base+'issues/303/comments').find(c=>c.id===102).body='<!-- codex-runtime-image-authorization:v1\n'+JSON.stringify(f.authorization)+'\n-->';
 };
 f.refreshRollback();return f;
}
test('rollback authority requires its distinct protected objective, forward lineage and source gates',async()=>{
 const f=rollbackAuthorityFixture(),result=await run(f);
 assert.equal(result.entry.scope,'RC48_SERVICE_IMAGE_ROLLBACK_V1');assert.equal(result.entry.objectiveId,f.entry.id);
 assert.equal(result.receipt.objectivePr,303);assert.equal(result.receipt.runtimeImageMutationAuthorized,true);assert.equal(result.receipt.businessMutationAuthorized,false);
});
for(const [name,change]of [
 ['forward objective revoked',f=>f.forwardEntry.status='revoked'],
 ['forward READ ONLY scope cannot upgrade',f=>f.forwardEntry.scope='SCHEMA_LEDGER_READ_ONLY_V1'],
 ['forward source mismatch',f=>f.rollbackContext.forwardEvidence.sourceHead='a'.repeat(40)],
 ['forward dossier mismatch',f=>f.rollbackContext.forwardDossierSha256='a'.repeat(64)],
 ['forward journal mismatch',f=>f.rollbackContext.originalJournalDirectory='C:/OTHER-JOURNAL'],
 ['unmerged original objective',f=>f.responses.get(f.base+'pulls/302').merged=false],
 ['missing explicit reverse direction',f=>f.entry.direction='PROMOTE_RC48'],
 ['same objective replay',f=>f.rollbackContext.forwardObjectiveId=f.entry.id],
 ['forward authority used for inverse plan',f=>f.entry.scope=IMAGE_SCOPE]
]){
 test('rollback authorization refuses '+name,async()=>{const f=rollbackAuthorityFixture();change(f);f.refreshRollback();await assert.rejects(run(f));});
}
