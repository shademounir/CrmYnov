// Additive public preparation rules. No native facts, future execution IDs or authority on import.
import assert from 'node:assert/strict';
import path from 'node:path';
import {imageJournalDigest as digest} from './journal.mjs';
import {validateImagePlan,imagePlanScope,isImageRollback} from './plan-mode.mjs';
import {validateNativeJiraReadObservation} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {validateImageCatalogueReviewV2} from './catalogue-origin-v2.mjs';
export const OPERATIONAL_HUMAN_SHA256='64b91382c47403e88dedfa3a3c9241a3231a99d636312ae2a888619c65729fe6';
const LOCATION='projects/crmynov-prod-n7x4q2/locations/europe-west1',H=/^[a-f0-9]{64}$/u;
export const IMAGE_OPERATIONAL_RESOURCES_V2=Object.freeze({services:[
 {name:LOCATION+'/services/crm-prod-api',uid:'a45fd6a6-f0d7-40e2-a9e5-da8a6f5fba81'},
 {name:LOCATION+'/services/crm-prod-web',uid:'a133df26-0ae0-4a0c-80c2-e42f387db4db'}],
 jobsParent:LOCATION,schedulersParent:LOCATION,projectIamResource:'projects/crmynov-prod-n7x4q2',sqlInstance:'projects/crmynov-prod-n7x4q2/instances/crm-ynov-prod-pg17',
 generalJob:LOCATION+'/jobs/crm-prod-preservation-pre-20261028-147f390728',generalUid:'6333afa0-3af3-4916-9aa1-e1093ce0bea0',
 secretPayloadReads:false,jobOrSchedulerMutation:false,iamMutation:false});
export const IMAGE_GENERAL_BINDING_V2=Object.freeze({job:IMAGE_OPERATIONAL_RESOURCES_V2.generalJob,uid:IMAGE_OPERATIONAL_RESOURCES_V2.generalUid,
 objectiveId:'rc48-general-pre-20261028-147f390728',purpose:'GENERAL_PRESERVATION_READ_ONLY_V1',
 sourceSha256:'f2bdf90d80078a428a5a50bdf4d993592e9bac07dea798c13877c40030c71051',bundleSha256:'a05a141fb58ed22f9a3107dce73fcfee2df3bebb276c221d8b5f9702b4b63ad5',selectCount:13});
export const IMAGE_PREPARATION_RULES_V2=Object.freeze({schemaVersion:2,kind:'RC48_CLOSED_IMAGE_PREPARATION_RULES_V2',humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,
 preparationMode:'LATE_BOUND_V2',requiredFamilies:['POOL','LEDGER','GENERAL','PERMISSIONS','JOB_INVENTORY','RECOVERABILITY','ROLLBACK'],
 independentFamilies:['POOL','LEDGER','PERMISSIONS','JOB_INVENTORY','RECOVERABILITY','ROLLBACK'],
 generalBinding:IMAGE_GENERAL_BINDING_V2,maxSqlPreAgeMs:300000,sqlAgeStartsAt:'ACTUAL_SQL_TRANSACTION_FIN',
 backupBeforeGeneral:true,backupReadyOnlyAuthorizesCreateBackup:true,legacyReceiptOrClaimReuse:false,sameSqlSnapshotClaimed:false,
 generalMustBeZeroToOneUnderNewAuthority:true,postReadinessRequiredBeforePre:true,unknownDomain:'IMAGE_JOURNAL_SEPARATE_FROM_HISTORICAL_GENERAL_READ_ONLY'});
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value)){freeze(child);}Object.freeze(value);}return value;}
freeze(IMAGE_OPERATIONAL_RESOURCES_V2);freeze(IMAGE_PREPARATION_RULES_V2);
export const IMAGE_PREPARATION_RULES_SHA256_V2=digest(IMAGE_PREPARATION_RULES_V2);
export function imagePublicRefV2(ref){assert(ref&&Object.getPrototypeOf(ref)===Object.prototype);assert.deepEqual(Object.keys(ref).sort(),['path','sha256']);assert(path.isAbsolute(ref.path)&&ref.path.endsWith('.json')&&!/private-key|credentials|\.private\.json/iu.test(ref.path));assert(H.test(ref.sha256));return ref;}
export function validateImageResourcesV2(resources){assert.deepEqual(resources,IMAGE_OPERATIONAL_RESOURCES_V2,'EXACT_OPERATIONAL_RESOURCE_BINDINGS_REQUIRED');return digest(resources);}
export function validateLateBoundImageObjective(entry,{id,dossier,plan,candidate,baseline,rollbackContext,source,action,preparationPhase,now}){
 assert.equal(entry.schemaVersion,2);assert.equal(entry.preparationMode,'LATE_BOUND_V2');assert.equal(entry.id,id);assert.match(id,/^rc48-image-only-[a-z0-9-]{8,80}$/u);
 assert.equal(entry.status,'approved');assert.equal(entry.scope,imagePlanScope(plan));assert.equal(entry.ticket,'CRMY-63');assert.equal(entry.project,'crmynov-prod-n7x4q2');assert.equal(entry.region,'europe-west1');assert.equal(entry.googleAccount,'casablancaynovcampus@gmail.com');
 assert.equal(entry.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);assert.equal(entry.businessMutation,false);assert.equal(entry.runtimeImageMutation,true);
 assert.deepEqual(entry.allowedPreparationPhases,['BACKUP_READY','FORWARD_FINAL']);assert(entry.allowedPreparationPhases.includes(preparationPhase),'EXPLICIT_IMAGE_PREPARATION_PHASE_REQUIRED');
 const permitted=['READ_METADATA','TEST_PERMISSIONS','CREATE_BACKUP','PATCH_API','PATCH_WEB','OBSERVE_OPERATION'];assert.deepEqual([...entry.actions].sort(),[...permitted].sort());assert(permitted.includes(action));
 if(preparationPhase==='BACKUP_READY'){assert(['READ_METADATA','TEST_PERMISSIONS','CREATE_BACKUP','OBSERVE_OPERATION'].includes(action),'BACKUP_READY_CANNOT_PATCH');}
 if(action==='CREATE_BACKUP'){assert.equal(preparationPhase,'BACKUP_READY','BACKUP_MUST_PRECEDE_FRESH_GENERAL');}
 assert.equal(entry.preparationRulesSha256,IMAGE_PREPARATION_RULES_SHA256_V2);assert.equal(entry.preparationReceiptSha256,undefined,'FUTURE_PREPARATION_HASH_MUST_NOT_BE_FABRICATED');
 validateImageResourcesV2(entry.resourceBindings);assert.equal(dossier.schemaVersion,2);assert.equal(dossier.id,id);assert.equal(dossier.scope,entry.scope);assert.equal(dossier.preparationMode,'LATE_BOUND_V2');
 assert.equal(dossier.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);assert.equal(dossier.preparationRulesSha256,entry.preparationRulesSha256);assert.equal(entry.dossierSha256,digest(dossier),'PROTECTED_STATIC_DOSSIER_REQUIRED');assert.equal(entry.planSha256,digest(plan),'PRE_PRE_PLAN_PIN_REQUIRED');
 assert.equal(dossier.preparationReceiptSha256,undefined);assert.deepEqual(dossier.candidate,candidate);assert.deepEqual(dossier.resourceBindings,entry.resourceBindings);assert.equal(candidate.readOnlyPreparationVersion,2,'LATE_BOUND_IMAGE_REQUIRES_EXPLICIT_COLLECTOR_V2');assert(candidate.readOnlyPostJob,'DISTINCT_POST_JOB_MUST_BE_READY_IN_PRE_PRE_PLAN');
 assert.deepEqual(dossier.readOnlyPreparationJobs??[],candidate.readOnlyPreparationJobs??[]);assert.deepEqual(dossier.preservedJobs,plan.preservedJobs);assert.deepEqual(dossier.preservedSchedulers,plan.preservedSchedulers);
 assert(Array.isArray(dossier.independentEvidence)&&dossier.independentEvidence.length===6);assert.deepEqual(dossier.independentEvidence.map(r=>r.kind).sort(),[...IMAGE_PREPARATION_RULES_V2.independentFamilies].sort());
 for(const row of dossier.independentEvidence){assert.deepEqual(Object.keys(row).sort(),['kind','path','sha256']);imagePublicRefV2({path:row.path,sha256:row.sha256});}
 imagePublicRefV2(dossier.postReadiness);assert.deepEqual(dossier.pendingGeneral.binding,IMAGE_GENERAL_BINDING_V2);assert(H.test(dossier.pendingGeneral.prospectiveAuthoritySha256));assert.equal(dossier.pendingGeneral.execution,undefined,'NO_FUTURE_EXECUTION_IDENTIFIER');
 const generalRows=(candidate.readOnlyPreparationJobs??[]).filter(r=>r.dossier.objective.purpose==='GENERAL_PRESERVATION_READ_ONLY_V1');assert.equal(generalRows.length,1);assert.equal(generalRows[0].admission?.authorityRecordSha256,dossier.pendingGeneral.prospectiveAuthoritySha256,'ONE_PROSPECTIVE_GENERAL_RECORD_ACROSS_PLAN_AND_DOSSIER');
 for(const key of ['noDatabaseRestore','noMigration','noFlagActivation','noJobOrSchedulerMutation','preserveInterveningWrites']){assert.equal(dossier[key],true);}
 validateImagePlan(plan,candidate,baseline,rollbackContext);assert(Date.parse(plan.baselineObservedAt)<=now);
 assert.equal(source.commit,entry.driver.mergeCommit);assert.equal(source.tree,entry.driver.tree);assert(source.clean);assert.deepEqual(source.files,entry.driver.files);
 assert.equal(entry.release.pr,243);assert.equal(entry.release.mergeCommit,'8253024ea35cee6be5636cc6b10a88ae7e177377');assert.equal(entry.release.releaseId,424492409);assert.equal(entry.release.tag,'v0.1.0-rc.48');assert.equal(entry.release.sourceTree,'8e6c456f091cab3c6f095665ae021badf85315c0');
 assert(H.test(entry.journalDirectorySha256));assert(Number.isSafeInteger(now)&&Date.parse(entry.validFrom)<=now&&now<Date.parse(entry.expiresAt));validateImageCatalogueReviewV2(entry.objectiveReview);
 if(isImageRollback(plan)){assert.equal(entry.direction,'RESTORE_CAPTURED_RC44');assert.equal(entry.forwardContextSha256,digest(rollbackContext));assert.equal(entry.forwardObjectiveId,rollbackContext.forwardObjectiveId);assert.notEqual(entry.id,entry.forwardObjectiveId);}else{assert.equal(entry.direction,'PROMOTE_RC48');}
 return true;
}
export function validateImageMarkerV2(comments,{actors,entry,dossier,plan,source,jiraBytes,grant,actor,action,preparationPhase,now},grantSha256,byteHash){
 const prefix='<!-- codex-runtime-image-authorization:v2';
 const rows=comments.filter(c=>actors.includes(c.user?.login)&&c.user.type==='User'&&typeof c.body==='string'&&c.body.includes(prefix)).sort((a,b)=>b.id-a.id);assert(rows.length);
 const comment=rows[0],start=comment.body.indexOf(prefix),end=comment.body.indexOf('-->',start+prefix.length);assert(comment.body.length<=65536&&start===comment.body.lastIndexOf(prefix)&&end>start);
 const v=JSON.parse(comment.body.slice(start+prefix.length,end).trim());assert.equal(v.schemaVersion,2);assert.equal(v.executor,'Codex');assert.equal(v.objectiveId,entry.id);assert.equal(v.preparationMode,'LATE_BOUND_V2');
 for(const [k,value]of Object.entries({catalogEntrySha256:digest(entry),staticDossierSha256:digest(dossier),planSha256:digest(plan),driverCommit:source.commit,grantDigest:grantSha256,humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,preparationRulesSha256:IMAGE_PREPARATION_RULES_SHA256_V2,resourceBindingSha256:digest(entry.resourceBindings)})){assert.equal(v[k],value);}
 assert.equal(v.preparationReceiptSha256,undefined);assert.equal(v.runAuthorized,false,'IMAGE_MARKER_DOES_NOT_AUTHORIZE_GENERAL_RUN');assert.equal(v.productionRuntimeMutation,true);assert.equal(v.productionBusinessMutation,false);assert.deepEqual(v.allowedPreparationPhases,entry.allowedPreparationPhases);assert(v.allowedPreparationPhases.includes(preparationPhase));assert(Array.isArray(v.actions)&&v.actions.includes(action)&&v.actions.every(a=>entry.actions.includes(a)));
 assert.equal(v.jiraEvidenceVersion,1,'IMAGE_V2_REQUIRES_EXPLICIT_UNCHANGED_NATIVE_JIRA_V1');const jira=validateNativeJiraReadObservation(jiraBytes,{expectedSha256:v.jiraObservationSha256,actor,grantSha256,now});
 assert.equal(byteHash(jiraBytes),v.jiraObservationSha256);const issued=Date.parse(comment.updated_at??comment.created_at),expires=Date.parse(v.expiresAt);assert(issued<=now&&now-issued<600000&&expires>now&&expires-issued<=600000);
 const markerObservation={id:comment.id,user:{login:comment.user.login,type:comment.user.type},...(comment.created_at?{created_at:comment.created_at}:{}),updated_at:comment.updated_at??comment.created_at,body:comment.body};
 return{commentId:comment.id,jira,expiresAt:Math.min(expires,Date.parse(jira.observedAt)+600000,Date.parse(entry.expiresAt)),planSha256:v.planSha256,authorizedActions:structuredClone(v.actions),allowedPreparationPhases:structuredClone(v.allowedPreparationPhases),markerSha256:byteHash(Buffer.from(comment.body,'utf8')),markerUpdatedAt:comment.updated_at??comment.created_at,markerObservation};
}
