import test from 'node:test';import assert from 'node:assert/strict';
import {operationalPreparationFixtureV2,completedPreparationFixtureV2} from './operational-preparation-fixtures-v2.mjs';
import {validateImagePreparationJobs,validatePreparedReadOnlyJob} from './preparation-jobs.mjs';
import {makeRc48ServiceImagePlanDraft,validateUnpatchedResourceClaims} from './plan.mjs';
test('SYNTHETIC V2 admits exact13 + historical Ledger + prospective General + distinct unusedPOST',()=>{const f=operationalPreparationFixtureV2(),rows=validateImagePreparationJobs(f.c),plan=makeRc48ServiceImagePlanDraft(f.c,f.b,f.now);assert.equal(rows.length,3);assert.equal(plan.schemaVersion,2);assert.equal(plan.preservedJobs.length,16);assert.equal(plan.readOnlyPreparationJobs.length,2);assert.equal(plan.readOnlyPostJob.objectiveId,f.c.readOnlyPostJob.objectiveId);assert.equal(validateUnpatchedResourceClaims(plan,f.b).claimsChecked,true);});
for(const kind of ['general','post']){
 test('SYNTHETIC '+kind+' accepts only bound0→1 nativeFIN and leaves patch plan/config unchanged',()=>{const f=operationalPreparationFixtureV2(),plan=makeRc48ServiceImagePlanDraft(f.c,f.b,f.now),v=completedPreparationFixtureV2(f,kind),after=structuredClone(f.b);after.observedAt=new Date(f.now).toISOString();after.jobs=after.jobs.map(j=>j.name===v.job.name?v.job:j);assert.throws(()=>validateUnpatchedResourceClaims(plan,after));assert.equal(validateUnpatchedResourceClaims(plan,after,v.context).claimsChecked,true);assert.equal(v.completion.operation.name===v.completion.execution.name,false);});
}
const failures=[
 ['count2 is never completion',v=>{v.job.executionCount=2;v.completion.job.executionCount=2;}],
 ['foreignUID',v=>{v.job.uid='44444444-4444-4444-8444-444444444444';v.completion.job.uid=v.job.uid;}],
 ['differentGeneralAuthority',v=>{v.completion.authorityRecordSha256='f'.repeat(64);}],
 ['executionoutsideauthority',v=>{v.completion.authority.expiresAt=v.completion.execution.startTime;}],
 ['futureobservation',v=>{v.completion.observedAt='2099-01-01T00:00:00.000Z';}],
 ['wrongoperationresponse',v=>{v.completion.operation.response.name=v.completion.operation.name;}],
 ['missingexecutionUID',v=>{delete v.completion.operation.response.uid;}],
 ['differentexecutionUID',v=>{v.completion.operation.response.uid='OTHER-SYNTHETIC-uid';}],
 ['operationnotdone',v=>{v.completion.operation.done=false;}],
 ['operationerror',v=>{v.completion.operation.error={code:7};}],
 ['taskretry',v=>{v.completion.execution.retriedCount=1;}],
 ['configdrift',v=>{v.job.template.template.containers[0].args.push('bad');v.completion.job=structuredClone(v.job);}],
 ['unknowncompletionfield',v=>{v.completion.success=true;}],
 ['changednativejobprojection',v=>{v.completion.job.etag='different';}]
];
for(const [name,change] of failures){test('SYNTHETIC V2 refuses '+name,()=>{const f=operationalPreparationFixtureV2(),v=completedPreparationFixtureV2(f);change(v);assert.throws(()=>validatePreparedReadOnlyJob(v.job,v.row,new Date(f.now).toISOString(),v.context));});}
test('SYNTHETIC V2 refuses premature/duplicate/unknown completions and Ledger replay',()=>{const f=operationalPreparationFixtureV2(),plan=makeRc48ServiceImagePlanDraft(f.c,f.b,f.now),v=completedPreparationFixtureV2(f);assert.throws(()=>validateUnpatchedResourceClaims(plan,f.b,v.context));const after=structuredClone(f.b);after.observedAt=new Date(f.now).toISOString();after.jobs=after.jobs.map(j=>j.name===v.job.name?v.job:j);assert.throws(()=>validateUnpatchedResourceClaims(plan,after,{schemaVersion:2,completions:[v.completion,v.completion]}));assert.throws(()=>validateUnpatchedResourceClaims(plan,after,{schemaVersion:2,completions:[{...v.completion,objectiveId:f.c.readOnlyPreparationJobs[1].objectiveId}]}));const ledger=structuredClone(f.b.jobs.at(-2));ledger.executionCount=2;assert.throws(()=>validatePreparedReadOnlyJob(ledger,f.c.readOnlyPreparationJobs[1],f.b.observedAt));});
test('SYNTHETIC V2 keeps historical Ledger exactFIN without any fresh RUN',()=>{const f=operationalPreparationFixtureV2(),row=f.c.readOnlyPreparationJobs[1],job=f.b.jobs.at(-2);assert.equal(validatePreparedReadOnlyJob(job,row,new Date(f.now+86400000).toISOString()),true);const changed=structuredClone(row);changed.admission.completedAt=new Date(f.now).toISOString();assert.throws(()=>validatePreparedReadOnlyJob(job,changed,new Date(f.now+86400000).toISOString()));});
test('SYNTHETIC V1 cannot silently accept V2 or an unreviewed16thjob',()=>{const f=operationalPreparationFixtureV2();delete f.c.readOnlyPreparationVersion;assert.throws(()=>validateImagePreparationJobs(f.c));});
test('SYNTHETIC V2 rejectsPOST as PRE/foreignpurpose/reusedUID/missingorigin',()=>{for(const change of [f=>f.c.readOnlyPostJob.dossier=f.c.readOnlyPreparationJobs[0].dossier,f=>f.c.readOnlyPostJob.uid=f.c.readOnlyPreparationJobs[0].uid,f=>delete f.c.readOnlyPostJob.objectiveOrigin]){const f=operationalPreparationFixtureV2();change(f);assert.throws(()=>validateImagePreparationJobs(f.c));}});
test('SYNTHETIC prospective GENERAL record pin is independent of plan and readiness',()=>{const f=operationalPreparationFixtureV2(),a=f.c.readOnlyPreparationJobs[0].admission;assert.deepEqual(Object.keys(a).sort(),['authorityRecordSha256','kind']);assert.equal(Object.hasOwn(a,'execution'),false);assert.equal(Object.hasOwn(a,'planSha256'),false);});
