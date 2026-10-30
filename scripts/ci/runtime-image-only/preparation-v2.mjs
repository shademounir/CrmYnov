// Additive late-bound preparation. Static reviewed evidence stays immutable;
// only source-checked GENERAL and live POST readiness are bound after approval.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imageJournalDigest as digest,inspectImageMutationDomainV2} from './journal.mjs';
import {IMAGE_PREPARATION_RULES_V2,IMAGE_PREPARATION_RULES_SHA256_V2,IMAGE_GENERAL_BINDING_V2,IMAGE_OPERATIONAL_RESOURCES_V2,OPERATIONAL_HUMAN_SHA256,imagePublicRefV2} from './late-binding-v2.mjs';
import {validateImagePostReadiness} from './post-preservation.mjs';
import {validateImagePostReadinessV2,imagePostRecipeContractProjectionV2 as plannedPostProjection} from './post-readiness-v2.mjs';
import {validateUnpatchedResourceClaims,LOCATION,PROJECT} from './plan.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2} from './rollback-plan.mjs';

const H=/^[a-f0-9]{64}$/u;
const LEGACY=Object.freeze({
  POOL:'68c6362f589b1576bbb638ef5c0b7f06830b0cc743a62422986cfe0793188321',
  LEDGER:'22473074732d44870b4a554be7e5f61f0d63db63698721188488b9ec55ad567b',
  ROLLBACK:'b686a45703562e7d67466c6b93e6805047b7fc6b88debf5dfe09766ff9c0eb04',
  LOCAL_RESTORE:'e7dbbddeedafc0d928313686ebd47f43b261262d14295bdd66cc4e05b154c766',
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function exact(value,names){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype,'PREPARATION_V2_PLAIN_DATA');
  assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(row=>Object.hasOwn(row,'value')),'PREPARATION_V2_DATA_FIELDS');
  assert.deepEqual(Object.keys(value).sort(),[...names].sort(),'PREPARATION_V2_FIELDS');
}
function time(value){assert.equal(typeof value,'string');const n=Date.parse(value);assert(Number.isSafeInteger(n));return n;}
function readJson(reference,readEvidence){
  imagePublicRefV2(reference);const bytes=readEvidence(reference.path);
  assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576,'PREPARATION_V2_EVIDENCE_BOUND');
  assert.equal(sha(bytes),reference.sha256,'PREPARATION_V2_EVIDENCE_CHANGED');return JSON.parse(bytes);
}
function independentRef(row,readEvidence){
  exact(row,['kind','path','sha256']);return readJson({path:row.path,sha256:row.sha256},readEvidence);
}
function legacyEvidence(family,row,value,pins){
  assert.equal(row.sha256,pins[family],'EXACT_REUSABLE_HISTORICAL_EVIDENCE');
  if(family==='LEDGER'){
    assert.equal(value.status,'NEW_ACTUAL_LEDGER_56_AND_BUSINESS_SCHEMA_MATCH_PROTECTED_RC48');
    assert.equal(value.sameSnapshotAsGeneralOrPool,false);assert.equal(value.activation,false);
  }
  return {family,sha256:row.sha256,currentSqlSnapshotClaimed:false,ledgerReplayed:false};
}
function permissionEvidence(value,readEvidence,consumerPins){
  exact(value,['schemaVersion','kind','configuration','decision','comparison']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'RC48_PROSPECTIVE_PERMISSION_RULE_READY_V2');
  for(const [key,pin]of Object.entries({configuration:consumerPins.configurationSha256,decision:consumerPins.decisionSha256,comparison:consumerPins.currentComparisonSha256})){
    assert.equal(value[key].sha256,pin);readJson(value[key],readEvidence);
  }
  const decision=readJson(value.decision,readEvidence),comparison=readJson(value.comparison,readEvidence);
  assert.equal(decision.noPermissionWrite,true);assert.equal(decision.historicalOriginAuditUnproved,true);
  assert.equal(comparison.all49MatchCapturedAndProspectivelyRequalifiedConfiguration,true);
  assert.equal(comparison.noPermissionWrite,true);assert.equal(comparison.notCommonSqlSnapshot,true);
  assert.equal(comparison.grants.length,49);
  return {family:'PERMISSIONS',freshConfigurationProved:false,freshComparisonRequiredInGeneral:true,historicalOriginUnproved:true};
}
function inventoryEvidence(value,{plan,baseline}){
  exact(value,['schemaVersion','kind','baselineSha256','baseline']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'RC48_NATIVE_INVENTORY_PINNED_BASELINE_V2');
  assert.equal(value.baselineSha256,digest(value.baseline));assert.deepEqual(value.baseline,baseline);
  assert.equal(value.baseline.readOnly,true);assert.equal(value.baseline.observedAt,plan.baselineObservedAt);
  for(const kind of ['api','web']){
    assert.equal(value.baseline.services[kind].name,LOCATION+'/services/crm-prod-'+kind);
    assert.equal(value.baseline.services[kind].uid,plan.patches.find(p=>p.resource===LOCATION+'/services/crm-prod-'+kind)?.expectedUid);
  }
  validateUnpatchedResourceClaims(plan,{jobs:baseline.jobs,schedulers:baseline.schedulers,observedAt:baseline.observedAt});
  return {family:'JOB_INVENTORY',pinnedObservedAt:baseline.observedAt,liveConfigurationRevalidationRequiredBeforeIntent:true};
}
function recoverabilityEvidence(value,readEvidence,now,pins,currentSource){
  exact(value,['schemaVersion','kind','observedAt','inventoryObservation','instance','backups','localRestoreRecipe','isolatedRecoveryPlan','nativeRestoreDrillPerformed','productionRestorePerformed','limitations']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'RC48_NATIVE_AVAILABILITY_AND_QUALIFIED_RECOVERY_PATH_V2');
  const observed=time(value.observedAt);assert(observed<=now&&now-observed<=86400000,'RECOVERABILITY_ASSESSMENT_EXPIRED');
  const instance=readJson(value.instance,readEvidence),backups=readJson(value.backups,readEvidence);
  const native=readJson(value.inventoryObservation,readEvidence);
  assert.equal(native.kind,'NATIVE_READ_ONLY_INVENTORY_OBSERVATION_V2');
  assert.equal(native.state,'FIN_READ_ONLY_INVENTORY_NOT_BASELINE_OR_PRE');
  assert.equal(native.scope,'READ_ONLY_INVENTORY');assert.equal(native.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);
  assert.deepEqual(native.source,currentSource,'RECOVERABILITY_CURRENT_SOURCE_REQUIRED');
  assert.equal(native.binding.scope,'READ_ONLY_INVENTORY');assert.equal(native.binding.sourceCommit,currentSource.commit);
  assert.equal(native.binding.resourceBindingSha256,digest(IMAGE_OPERATIONAL_RESOURCES_V2));
  assert.equal(native.binding.project,PROJECT);assert.equal(native.binding.region,'europe-west1');
  for(const receipt of [native.authority.initial,native.authority.final]){
    assert.equal(receipt.schemaVersion,2);assert.equal(receipt.driverCommit,currentSource.commit);
    assert.equal(receipt.authorityRecordSha256,native.binding.authorityRecordSha256);
    assert.equal(receipt.resourceBindingSha256,native.binding.resourceBindingSha256);assert.equal(receipt.scope,native.binding.scope);
  }
  assert.equal(native.authority.initial.authorityRevision,native.authority.final.authorityRevision);
  assert.deepEqual(native.observations.sqlInstance,instance);assert.deepEqual(native.observations.backups,backups.items);
  const resource='https://sqladmin.googleapis.com/sql/v1beta4/projects/'+PROJECT+'/instances/crm-ynov-prod-pg17';
  const exchanges=native.exchanges.filter(row=>row.request?.method==='GET'&&(row.request.url===resource||row.request.url.startsWith(resource+'/backupRuns?')));
  assert(exchanges.some(row=>row.request.url===resource)&&exchanges.some(row=>row.request.url.startsWith(resource+'/backupRuns?')),'RECOVERABILITY_NATIVE_METADATA_COVERAGE');
  for(const row of exchanges){assert.equal(row.kind,'EXPURGATED_IMAGE_NATIVE_EXCHANGE_OBSERVATION_V2');assert.equal(row.status,200);assert.equal(row.outcome,'HTTP_200_RECEIVED_NOT_SEMANTIC_ACCEPTANCE');assert(time(row.requestStartedAt)<=time(row.responseObservedAt)&&time(row.responseObservedAt)<=now);
    assert.equal(row.sessionId,native.binding.sessionId);assert.equal(row.authorityRecordSha256,native.binding.authorityRecordSha256);assert.equal(row.resourceBindingSha256,native.binding.resourceBindingSha256);
    assert(time(native.authority.initial.verifiedAt)<=time(row.requestStartedAt)&&time(row.responseObservedAt)<=time(native.authority.final.verifiedAt));
    if(row.request.url===resource){assert.equal(row.responseSha256,digest(instance));}
  }
  assert.equal(observed,Math.min(...exchanges.map(row=>time(row.requestStartedAt))),'RECOVERABILITY_AGE_FROM_NATIVE_METADATA_NOT_CALLER_TIMESTAMP');
  assert.equal(instance.project,PROJECT);assert.equal(instance.name,'crm-ynov-prod-pg17');
  assert.equal(instance.databaseVersion,'POSTGRES_17');assert.equal(instance.state,'RUNNABLE');
  assert.equal(instance.settings?.backupConfiguration?.enabled,true);
  assert.equal(instance.settings?.backupConfiguration?.pointInTimeRecoveryEnabled,true);
  assert(Array.isArray(backups.items)&&backups.items.length>0&&backups.items.length<=2000);
  assert(!backups.nextPageToken,'RECOVERABILITY_COMPLETE_BACKUP_METADATA');
  const available=backups.items.filter(row=>row.instance==='crm-ynov-prod-pg17'&&row.status==='SUCCESSFUL'&&row.endTime&&time(row.endTime)<=observed);
  assert(available.length>0,'NATIVE_AVAILABLE_BACKUP_REQUIRED');
  assert.equal(value.localRestoreRecipe.sha256,pins.LOCAL_RESTORE);
  const recipe=readJson(value.localRestoreRecipe,readEvidence);
  assert.equal(recipe.initiallyEmpty,true);assert.equal(recipe.expectedRowsSha256,recipe.restoredRowsSha256);
  assert.equal(recipe.auditStreamsConnectorsSessionsIdentical,true);assert.equal(recipe.productionRestored,false);
  const recoveryPlan=readJson(value.isolatedRecoveryPlan,readEvidence);
  exact(recoveryPlan,['schemaVersion','kind','sourceInstance','restoreTargetKind','localRestoreProof','nativeRecoveryProcedureQualified','productionRestoreAuthorized','preserveInterveningWrites','sourceBackupMustBeRevalidated','nativeExecutionPerformed']);
  assert.equal(recoveryPlan.schemaVersion,2);assert.equal(recoveryPlan.kind,'RC48_ISOLATED_RECOVERY_PROCEDURE_V2');
  assert.equal(recoveryPlan.sourceInstance,'projects/'+PROJECT+'/instances/crm-ynov-prod-pg17');
  assert.equal(recoveryPlan.restoreTargetKind,'SEPARATELY_AUTHORIZED_ISOLATED_TARGET_NOT_PROD');
  assert.deepEqual(recoveryPlan.localRestoreProof,value.localRestoreRecipe);
  assert.equal(recoveryPlan.nativeRecoveryProcedureQualified,false);assert.equal(recoveryPlan.productionRestoreAuthorized,false);
  assert.equal(recoveryPlan.preserveInterveningWrites,true);assert.equal(recoveryPlan.sourceBackupMustBeRevalidated,true);
  assert.equal(recoveryPlan.nativeExecutionPerformed,false);assert.equal(value.nativeRestoreDrillPerformed,false);assert.equal(value.productionRestorePerformed,false);
  assert.deepEqual(value.limitations,['NO_NATIVE_CLOUD_SQL_RESTORE_DRILL','NO_PROD_SQL_RESTORE_AUTHORITY','METADATA_AND_RECIPE_ARE_DISTINCT_OBSERVATIONS']);
  return {family:'RECOVERABILITY',coverage:'NATIVE_BACKUP_PITR_AVAILABILITY_AND_QUALIFIED_LOCAL_RECOVERY_PROCEDURE',nativeCloudSqlRestoreDrill:false,productionRestoreAuthorized:false,newJustInTimeBackupStillRequired:true};
}
function rollbackEvidence(value,readEvidence,currentSource,pins){
  exact(value,['schemaVersion','kind','compatibility','rollbackSource','completionRulesSha256','operationalSource','rulesFiles','databaseRestore','preserveInterveningWrites','forwardFinRequired','afterSheetsActivationAuthorized']);
  assert.equal(value.schemaVersion,2);assert.equal(value.kind,'RC48_TO_CAPTURED_RC44_RETURN_RULE_READY_V2');
  assert.equal(value.compatibility.sha256,pins.ROLLBACK);const compatibility=readJson(value.compatibility,readEvidence);
  assert.equal(compatibility.comparison.prismaSchemaBytesIdentical,true);
  assert.equal(compatibility.comparison.migrationNamesAndChecksumsIdentical,true);
  assert.deepEqual(compatibility.comparison.migrationCounts,{rc44:56,rc48:56});
  const source=readJson(value.rollbackSource,readEvidence);assert.equal(source.head,'75f1422bdff08690733e4e52f39473a6056bdfe4');
  assert.equal(source.all36QualifiedExtensionBytesRetained,true);
  assert.equal(value.completionRulesSha256,IMAGE_ROLLBACK_COMPLETION_RULES_SHA256_V2);
  assert.deepEqual(value.operationalSource,{commit:currentSource.commit,tree:currentSource.tree,inputManifestSha256:digest(currentSource.files)},'ROLLBACK_CURRENT_OPERATIONAL_SOURCE_REQUIRED');
  const paths=['rollback-plan','rollback-context','preparation-jobs','plan','journal'].map(name=>'scripts/ci/runtime-image-only/'+name+'.mjs');
  assert.deepEqual(value.rulesFiles,currentSource.files.filter(row=>paths.includes(row.path)));assert.equal(value.rulesFiles.length,paths.length);
  assert.equal(value.databaseRestore,false);assert.equal(value.preserveInterveningWrites,true);
  assert.equal(value.forwardFinRequired,true);assert.equal(value.afterSheetsActivationAuthorized,false);
  return {family:'ROLLBACK',kind:'CONDITIONAL_IMAGE_ONLY_RETURN_RULE',forwardFinAndFreshAuthorityStillRequired:true,databaseRestore:false};
}
function independentEvidence(dossier,context,pins,consumerPins){
  const rows=dossier.independentEvidence;assert(Array.isArray(rows)&&rows.length===6);
  assert.deepEqual(rows.map(row=>row.kind).sort(),[...IMAGE_PREPARATION_RULES_V2.independentFamilies].sort());
  return rows.map(row=>{
    const value=independentRef(row,context.readEvidence);
    if(['POOL','LEDGER'].includes(row.kind)){return legacyEvidence(row.kind,row,value,pins);}
    if(row.kind==='PERMISSIONS'){return permissionEvidence(value,context.readEvidence,consumerPins);}
    if(row.kind==='JOB_INVENTORY'){return inventoryEvidence(value,context);}
    if(row.kind==='RECOVERABILITY'){return recoverabilityEvidence(value,context.readEvidence,context.now,pins,context.source);}
    return rollbackEvidence(value,context.readEvidence,context.source,pins);
  });
}
export function validateImageIndependentEvidenceV2(dossier,context){return independentEvidence(dossier,context,LEGACY,CONSUMER_PINS);}
// Fake public receipts only. This cannot replace the native entry's fixed pins
// or create a preparation, governance, SDK or execution capability.
export function simulateImageIndependentEvidenceV2({syntheticOnly,dossier,context,pins,consumerPins}){
  assert.equal(syntheticOnly,true);return{families:independentEvidence(dossier,context,pins,consumerPins),syntheticOnly:true,nativeAuthority:false};
}
export function validateImageGeneralPreEvidenceV2(reference,{dossier,readEvidence,now}){
  const proof=readJson(reference,readEvidence);
  exact(proof,['schemaVersion','kind','binding','authorityRecordSha256','semanticReceipt','nativeCapture','preFin','completionContext']);
  assert.equal(proof.schemaVersion,3);assert.equal(proof.kind,'VERIFIED_OPERATIONAL_GENERAL_PRE_V3');
  assert.deepEqual(proof.binding,IMAGE_GENERAL_BINDING_V2);
  assert.equal(proof.authorityRecordSha256,dossier.pendingGeneral.prospectiveAuthoritySha256);
  const semantic=readJson(proof.semanticReceipt,readEvidence),capture=readJson(proof.nativeCapture,readEvidence),fin=readJson(proof.preFin,readEvidence);
  assert.equal(semantic.kind,'GENERAL-SEMANTIC-FIN');assert.equal(semantic.comparison.semanticAccepted,true);
  assert.equal(semantic.comparison.originalRunState,'UNKNOWN');assert.equal(semantic.comparison.freshnessMs,300000);
  assert.equal(semantic.comparison.historicalBaselineSha256,CONSUMER_PINS.baselineSha256);
  assert.equal(capture.kind,'VERIFIED-NEW-ENCRYPTED-OUTPUT');assert.equal(capture.jobUid,IMAGE_GENERAL_BINDING_V2.uid);
  assert.equal(fin.state,'FRESH_PROSPECTIVE_GENERAL_PRE_OBSERVED');assert.equal(fin.jobUid,capture.jobUid);
  assert.equal(fin.metadataSha256,capture.metadataSha256);assert.equal(fin.sealedOutputSha256,capture.sealedOutputSha256);
  assert.equal(fin.transactionCompletedAt,capture.transactionCompletedAt);
  const age=now-time(capture.transactionCompletedAt);assert(age>=0&&age<=300000,'CURRENT_GENERAL_SQL_FIN_AGE');
  assert.equal(proof.completionContext.schemaVersion,2);assert(Array.isArray(proof.completionContext.completions));
  const completions=proof.completionContext.completions.filter(row=>row.objectiveId===IMAGE_GENERAL_BINDING_V2.objectiveId);
  assert.equal(completions.length,1,'EXACT_GENERAL_COMPLETION_REQUIRED');const completed=completions[0];
  assert.equal(completed.authorityRecordSha256,proof.authorityRecordSha256);
  assert.equal(completed.job?.uid,IMAGE_GENERAL_BINDING_V2.uid);
  assert.equal(completed.execution?.name,fin.execution);assert.equal(completed.operation?.name,fin.operation);
  assert.equal(completed.operation?.response?.name,completed.execution.name);
  assert.equal(completed.operation?.done,true);assert.equal(completed.operation?.error,undefined);
  return {proof,transactionCompletedAt:capture.transactionCompletedAt,generalAgeMs:age,completionContext:proof.completionContext};
}
export function validateImagePreparationV2(input){
  const {bytes,entry,dossier,plan,baseline,source,readEvidence,readSource,journalDirectory,historicalGeneralPins,action,now}=input;
  assert(Buffer.isBuffer(bytes)&&bytes.length<=1048576);assert.equal(typeof readEvidence,'function');assert.equal(typeof readSource,'function');assert(Number.isSafeInteger(now));
  const p=JSON.parse(bytes);exact(p,['schemaVersion','kind','preparationPhase','objectiveId','staticDossierSha256','planSha256','preparationRulesSha256','humanAuthorityReceiptSha256','source','qualifiedAt','expiresAt','general','postReadiness']);
  assert.equal(p.schemaVersion,2);assert.equal(p.kind,'RC48_LATE_BOUND_IMAGE_PREPARATION_V2');
  assert.equal(entry.schemaVersion,2);assert.equal(entry.preparationMode,'LATE_BOUND_V2');
  assert.equal(p.objectiveId,entry.id);assert.equal(p.staticDossierSha256,digest(dossier));assert.equal(p.staticDossierSha256,entry.dossierSha256);
  assert.equal(p.planSha256,digest(plan));assert.equal(p.planSha256,entry.planSha256);
  assert.equal(p.preparationRulesSha256,IMAGE_PREPARATION_RULES_SHA256_V2);assert.equal(entry.preparationRulesSha256,p.preparationRulesSha256);
  assert.equal(p.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);
  assert.deepEqual(p.source,{commit:source.commit,tree:source.tree,inputManifestSha256:digest(source.files)});
  const issued=time(p.qualifiedAt),expires=time(p.expiresAt);assert(issued<=now&&now<expires&&expires-issued<=1800000,'CURRENT_V2_PREPARATION_REQUIRED');
  assert(['BACKUP_READY','FORWARD_FINAL'].includes(p.preparationPhase));
  assert.equal(p.preparationPhase,entry.preparationPhase,'PREPARATION_AND_AUTHORITY_PHASE_MISMATCH');
  const final=p.preparationPhase==='FORWARD_FINAL';assert(final||['CREATE_BACKUP','READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'].includes(action),'BACKUP_READY_CANNOT_PATCH');
  if(final){assert(['PATCH_API','PATCH_WEB','READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'].includes(action),'FINAL_CANNOT_CREATE_BACKUP');}
  assert.equal(p.general===null,!final,'GENERAL_REQUIRED_ONLY_FOR_FINAL_IMAGE_PREPARATION');
  const general=final?validateImageGeneralPreEvidenceV2(p.general,{dossier,readEvidence,now}):null;
  const context={plan,baseline,source,completionContext:general?.completionContext,readEvidence,now};
  const checked=validateImageIndependentEvidenceV2(dossier,context);
  // Static recipe is protected before CI; the fresh proof is acquired only
  // afterwards. Its exact static contract is additionally checked by the CLI.
  imagePublicRefV2(dossier.postReadiness);const staticPost=readJson(dossier.postReadiness,readEvidence);
  exact(staticPost,['schemaVersion','kind','planSha256','source','liveReadinessContractSha256']);
  assert.equal(staticPost.schemaVersion,2);
  assert.equal(staticPost.kind,'RC48_STATIC_POST_RECIPE_CONTRACT_V2');
  assert.equal(staticPost.planSha256,digest(plan));assert.deepEqual(staticPost.source,p.source);
  const live=readJson(p.postReadiness,readEvidence);assert.equal(live.staticPostContractSha256,dossier.postReadiness.sha256);
  const liveBytes=readEvidence(p.postReadiness.path),liveProjection={...live};delete liveProjection.staticPostContractSha256;
  assert(H.test(staticPost.liveReadinessContractSha256));
  assert.equal(staticPost.liveReadinessContractSha256,digest(imagePostRecipeContractProjectionV2(live)));
  const canonicalLive=Buffer.from(JSON.stringify(liveProjection));
  const validatePost=liveProjection.kind==='RC48_POST_PRESERVATION_READY_V2'?validateImagePostReadinessV2:validateImagePostReadiness;
  const post=validatePost({bytes:canonicalLive,expectedSha256:sha(canonicalLive),plan,source:p.source,baseline,readSource,readEvidence,now});
  assert(Buffer.isBuffer(liveBytes));
  const imageDomain=inspectImageMutationDomainV2(journalDirectory,{objectiveId:entry.id,objectiveSha256:digest(dossier),planSha256:digest(plan),sourceHead:source.commit},historicalGeneralPins);
  assert.equal(imageDomain.imageMutationUnresolved,false,'IMAGE_MUTATION_UNKNOWN_OR_RUNNING');
  return Object.freeze({schemaVersion:2,preparationPhase:p.preparationPhase,generalPendingOnly:!final,staticDossierSha256:p.staticDossierSha256,planSha256:p.planSha256,preparationRulesSha256:p.preparationRulesSha256,preparationReceiptSha256:sha(bytes),qualifiedAt:p.qualifiedAt,expiresAt:new Date(Math.min(expires,time(post.expiresAt),general?time(general.transactionCompletedAt)+300000:Infinity)).toISOString(),families:checked,general:general?{transactionCompletedAt:general.transactionCompletedAt,generalAgeMs:general.generalAgeMs}:null,imageMutationDomain:imageDomain,historicalGeneralRemainsUnknown:true,ledgerFinReplayed:false,sameSqlSnapshotClaimed:false,providerOriginAuthenticatedByThisPureFunction:false});
}

export function imagePostRecipeContractProjectionV2(readiness){
  if(readiness.kind==='RC48_POST_PRESERVATION_READY_V2'){return plannedPostProjection(readiness);}
  assert.equal(readiness.kind,'RC48_POST_PRESERVATION_READY_V1');
  return {postDossierRef:readiness.postDossierRef,objectiveOriginRef:readiness.objectiveOriginRef,
    postJob:readiness.postJob,postJobUid:readiness.postJobUid,postSourceSha256:readiness.postSourceSha256,
    postBundleSha256:readiness.postBundleSha256,queryContractSha256:readiness.queryContractSha256,
    recipe:{apiOrigin:readiness.recipe.apiOrigin,webOrigin:readiness.recipe.webOrigin,
      actors:readiness.recipe.actors.map(({sessionObservation,...actor})=>{assert(sessionObservation);return actor;})},
    sevenFamilyRefs:readiness.sevenFamilyRefs,startupRuleSourceSha256:readiness.startupRuleSourceSha256};
}

// Only the recipe/identities/resource/source rules are protected administratively.
// These pure builders never turn the earlier observations into fresh evidence.
export function makeImageStaticPostContractV2(readiness){
  assert(H.test(readiness.planSha256));
  return {schemaVersion:2,kind:'RC48_STATIC_POST_RECIPE_CONTRACT_V2',planSha256:readiness.planSha256,
    source:structuredClone(readiness.source),liveReadinessContractSha256:digest(imagePostRecipeContractProjectionV2(readiness))};
}
export function bindImageLivePostReadinessV2(readiness,staticContractReference,readEvidence){
  const contract=readJson(staticContractReference,readEvidence);
  assert.deepEqual(contract,makeImageStaticPostContractV2(readiness),'LIVE_POST_RECIPE_CHANGED_FROM_PROTECTED_STATIC_CONTRACT');
  return {...structuredClone(readiness),staticPostContractSha256:staticContractReference.sha256};
}
