// Closed reverse-image plan using the existing forward and metadata validators.
// A supplied plan is not authenticated provider evidence or execution authority.
import assert from 'node:assert/strict';
import {imageJournalDigest as digest} from './journal.mjs';
import {validateRc48ServiceImagePlanDraft,validateUnpatchedResourceClaims,LOCATION} from './plan.mjs';
import {imageServiceConfiguration,validateImageOnlyServedState,validateImageOnlyResourceState} from './served-state.mjs';

const stages=['API_IMAGE','BACKUP','WEB_IMAGE'],imageStages={api:'API_IMAGE',web:'WEB_IMAGE'},hash=/^[a-f0-9]{64}$/u;
function validateEvidence(evidence,forwardPlan){
  assert.equal(evidence.planSha256,digest(forwardPlan),'FORWARD_PLAN_BINDING');
  assert.match(evidence.sourceHead,/^[a-f0-9]{40}$/u);
  assert.deepEqual(Object.keys(evidence.stages).sort((a,b)=>a.localeCompare(b,'en')),stages);
  for(const stage of stages){
    const row=evidence.stages[stage];
    if(row.state==='UNUSED'){assert.deepEqual(row,{state:'UNUSED'});continue;}
    assert.equal(row.state,'FIN_NO_REPLAY','FORWARD_UNKNOWN_OR_RUNNING_REFUSED');
    assert(['SUCCEEDED','FAILED'].includes(row.outcome));
    assert.match(row.nativeReceiptSha256,hash);
  }
  assert.equal(evidence.stages.BACKUP.state,'FIN_NO_REPLAY');
  assert.equal(evidence.stages.BACKUP.outcome,'SUCCEEDED');
  if(evidence.stages.WEB_IMAGE.state!=='UNUSED'){
    assert.equal(evidence.stages.API_IMAGE.state,'FIN_NO_REPLAY');
    assert.equal(evidence.stages.API_IMAGE.outcome,'SUCCEEDED');
  }
}
function originalServiceUnchanged(before,current){
  for(const key of ['name','uid','etag','generation','observedGeneration','latestReadyRevision','latestCreatedRevision']){assert.equal(current[key],before[key],'UNPATCHED_SERVICE_DRIFT_'+key);}
  assert.equal(current.reconciling??false,false);assert.equal(current.deleteTime,undefined);
  assert.equal(current.terminalCondition?.state,'CONDITION_SUCCEEDED');
  assert.deepEqual(current.trafficStatuses,before.trafficStatuses);
  assert.deepEqual(imageServiceConfiguration(current),imageServiceConfiguration(before));
}
function shortRevision(value,name){
  assert.equal(typeof value,'string');const prefix=name+'/revisions/',short=value.startsWith(prefix)?value.slice(prefix.length):value;
  assert.match(short,/^crm-prod-(?:api|web)-[a-z0-9-]+$/u);
  assert(short.startsWith(name.split('/').at(-1)+'-'));return short;
}
function knownFailedService(kind,input){
  const {originalBaseline,currentBaseline,candidate}=input,before=originalBaseline.services[kind],current=currentBaseline.services[kind],revision=currentBaseline.revisions[kind];
  assert.equal(current.name,before.name);assert.equal(current.uid,before.uid);
  assert.equal(current.reconciling??false,false);assert.equal(current.deleteTime,undefined);
  assert.equal(current.terminalCondition?.state,'CONDITION_FAILED','ONLY_TERMINAL_KNOWN_FAILURE');
  assert.equal(typeof current.etag,'string');assert(current.etag.length>0);
  assert.match(current.generation,/^[1-9]\d*$/u);assert(BigInt(current.generation)>BigInt(before.generation));
  assert.equal(current.observedGeneration,current.generation);
  const old=shortRevision(before.latestReadyRevision,before.name),created=shortRevision(current.latestCreatedRevision,current.name);
  assert.equal(shortRevision(current.latestReadyRevision,current.name),old);assert.notEqual(created,old);
  assert.deepEqual(current.trafficStatuses,before.trafficStatuses);
  assert.equal(revision.name,current.name+'/revisions/'+created);
  assert.equal(revision.reconciling??false,false);assert.equal(revision.deleteTime,undefined);
  assert.equal(revision.conditions?.some(c=>c.type==='Ready'&&c.state==='CONDITION_FAILED'),true);
  assert.equal(revision.containers.length,1);
  assert.equal(revision.containers[0].image,candidate.images[kind].destination);
  const expected=imageServiceConfiguration(before),actual=imageServiceConfiguration(current);
  expected.template.containers[0].image=candidate.images[kind].destination;
  if(Object.hasOwn(expected.template,'revision')){
    assert.equal(shortRevision(expected.template.revision,before.name),old);
    assert.equal(shortRevision(actual.template.revision,current.name),created);
    expected.template.revision=actual.template.revision;
  }
  assert.deepEqual(actual,expected,'FAILED_IMAGE_NON_IMAGE_CONFIGURATION_DRIFT');
}
function currentNeedsRollback(kind,input,now){
  const {forwardPlan,candidate,originalBaseline,currentBaseline,forwardEvidence}=input;
  const row=forwardEvidence.stages[imageStages[kind]],before=originalBaseline.services[kind],current=currentBaseline.services[kind];
  if(row.state==='UNUSED'){originalServiceUnchanged(before,current);return false;}
  if(row.outcome==='FAILED'){
    if(current.template.containers[0].image===before.template.containers[0].image){originalServiceUnchanged(before,current);return false;}
    knownFailedService(kind,input);return true;
  }
  const served=validateImageOnlyServedState({plan:forwardPlan,candidate,baseline:originalBaseline,kind,service:current,revision:currentBaseline.revisions[kind],observedAt:currentBaseline.observedAt},now);
  assert.deepEqual(row.served,served,'FORWARD_FIN_AND_CURRENT_METADATA_MUST_AGREE');return true;
}
function rollbackPatch(kind,input,now){
  if(!currentNeedsRollback(kind,input,now)){return null;}
  const before=input.originalBaseline.services[kind],current=input.currentBaseline.services[kind],containers=structuredClone(current.template.containers);
  containers[0].image=before.template.containers[0].image;
  return{kind:'service',resource:current.name,method:'PATCH',updateMask:'template.containers',expectedUid:current.uid,expectedEtag:current.etag,expectedRevision:current.latestReadyRevision,beforeTemplateSha256:digest(current.template),body:{name:current.name,etag:current.etag,template:{containers}},allowedDifference:'containers[0].image only'};
}
export function makeRc48ImageRollbackPlanDraft(input,now){
  const {forwardPlan,candidate,originalBaseline,currentBaseline,forwardEvidence}=input;
  validateRc48ServiceImagePlanDraft(forwardPlan,candidate,originalBaseline,Date.parse(forwardPlan.baselineObservedAt));
  assert(Number.isSafeInteger(now));const observed=Date.parse(currentBaseline.observedAt);
  assert(Number.isFinite(observed)&&now>=observed&&now-observed<=300000,'FRESH_ROLLBACK_BASELINE_REQUIRED');
  assert.equal(currentBaseline.readOnly,true);validateEvidence(forwardEvidence,forwardPlan);
  validateUnpatchedResourceClaims(forwardPlan,{jobs:currentBaseline.jobs,schedulers:currentBaseline.schedulers});
  const patches=['web','api'].map(kind=>rollbackPatch(kind,input,now)).filter(Boolean);
  assert(patches.length>0,'NO_IMAGE_CHANGE_TO_ROLL_BACK');
  return{schemaVersion:1,kind:'UNPROTECTED_PURE_RC48_TO_RC44_IMAGE_ROLLBACK_DRAFT',
    originalForwardPlanSha256:digest(forwardPlan),forwardEvidenceSha256:digest(forwardEvidence),
    baselineObservedAt:currentBaseline.observedAt,patches,
    preservedJobs:structuredClone(forwardPlan.preservedJobs),preservedSchedulers:structuredClone(forwardPlan.preservedSchedulers),
    ...(forwardPlan.readOnlyPreparationJobs?{readOnlyPreparationJobs:structuredClone(forwardPlan.readOnlyPreparationJobs)}:{}),
    jobPatches:[],runJobs:[],schedulerChanges:[],migrations:[],iamChanges:[],databaseRestore:false,
    preserveInterveningWrites:true,afterSheetsActivationAuthorized:false,nativeOriginAuthenticated:false,
    forwardJournalAuthenticityVerified:false,executionAuthorized:false,activationAuthorized:false,executorProvided:false,
    requirements:['Distinct fresh protected rollback objective and exact forward context','Existing durable forward journal and native receipt bytes verified before provider operations','Actual recorded forward operations re-read terminal and hash-matched before rollback intent','Current preservation/compatible image-only rollback, fresh backup and single-use native operation reconciliation required']};
}
export function validateRc48ImageRollbackPlanDraft(plan,input,now){assert.deepEqual(plan,makeRc48ImageRollbackPlanDraft(input,now));return true;}
export function validateImageRollbackServedState({plan,candidate,baseline,rollbackContext,kind,service,revision,observedAt},now){
  validateRc48ImageRollbackPlanDraft(plan,{...rollbackContext,candidate,currentBaseline:baseline},Date.parse(plan.baselineObservedAt));
  const before=baseline.services[kind],patch=plan.patches.find(p=>p.resource===LOCATION+'/services/crm-prod-'+kind);
  assert(patch,'ONLY_PLANNED_ROLLBACK_SERVICE');
  return validateImageOnlyResourceState({before,patch,targetImage:patch.body.template.containers[0].image,kind,service,revision,observedAt},now);
}
