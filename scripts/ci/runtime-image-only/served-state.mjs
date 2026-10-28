// Strict post-PATCH metadata comparison only. Not a transport, source authority or native-origin verifier.
import assert from 'node:assert/strict';
import {imageJournalDigest as digest} from './journal.mjs';
import {LOCATION,validateRc48ServiceImagePlanDraft} from './plan.mjs';

const writableFields=['name','description','labels','annotations','client','clientVersion','ingress','launchStage','binaryAuthorization','template','traffic','scaling','invokerIamDisabled','defaultUriDisabled','iapEnabled','multiRegionSettings','customAudiences','buildConfig','sshEnabled'];
function shortRevision(value,name){assert.equal(typeof value,'string');const prefix=name+'/revisions/';const short=value.startsWith(prefix)?value.slice(prefix.length):value;assert.match(short,/^crm-prod-(?:api|web)-[a-z0-9-]+$/u);assert.equal(short.startsWith(name.split('/').at(-1)+'-'),true);return short;}
export function imageServiceConfiguration(service){return Object.fromEntries(writableFields.filter(k=>Object.hasOwn(service,k)).map(k=>[k,structuredClone(service[k])]));}
export function validateImageOnlyServedState({plan,candidate,baseline,kind,service,revision,observedAt},now){
  assert(['api','web'].includes(kind));assert(Number.isSafeInteger(now));const observed=Date.parse(observedAt);assert(Number.isFinite(observed)&&now>=observed&&now-observed<=300000,'CURRENT_SERVED_STATE_REQUIRED');
  // Revalidate the source-bound original plan at its recorded preparation time; this
  // does not claim that its historical native baseline is current or authorize a PATCH.
  validateRc48ServiceImagePlanDraft(plan,candidate,baseline,Date.parse(plan.baselineObservedAt));
  const before=baseline.services[kind],patch=plan.patches.find(p=>p.resource===before.name);assert(patch);assert.equal(service.name,LOCATION+'/services/crm-prod-'+kind);assert.equal(service.uid,before.uid);assert.equal(service.reconciling??false,false);assert.equal(service.deleteTime,undefined);assert.equal(service.terminalCondition?.state,'CONDITION_SUCCEEDED');assert.equal(typeof service.etag,'string');assert(service.etag.length>0);assert.match(service.generation,/^[1-9]\d*$/u);assert(BigInt(service.generation)>BigInt(before.generation));assert.equal(service.observedGeneration,service.generation);
  const next=shortRevision(service.latestReadyRevision,service.name),old=shortRevision(before.latestReadyRevision,before.name);assert.notEqual(next,old,'NEW_IMAGE_REVISION_REQUIRED');assert.equal(shortRevision(service.latestCreatedRevision,service.name),next);assert.equal(service.trafficStatuses.length,1);assert.equal(service.trafficStatuses[0].percent,100);assert.equal(service.trafficStatuses[0].type,'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST');assert.equal(shortRevision(service.trafficStatuses[0].revision,service.name),next);
  assert.equal(revision.name,service.name+'/revisions/'+next);assert.equal(revision.reconciling??false,false);assert.equal(revision.deleteTime,undefined);assert.equal(revision.conditions?.some(c=>c.type==='Ready'&&c.state==='CONDITION_SUCCEEDED'),true,'REVISION_READY_REQUIRED');assert.equal(revision.containers.length,1);assert.equal(revision.containers[0].image,candidate.images[kind].destination);
  const expected=imageServiceConfiguration(before),actual=imageServiceConfiguration(service);expected.template.containers=structuredClone(patch.body.template.containers);
  // The API generates a linked revision name during image reconciliation. It is
  // not a caller-controlled permission to alter any other template field.
  if(Object.hasOwn(expected.template,'revision')){assert.equal(shortRevision(expected.template.revision,before.name),old);assert.equal(shortRevision(actual.template.revision,service.name),next);expected.template.revision=actual.template.revision;}
  assert.deepEqual(actual,expected,'NON_IMAGE_SERVICE_CONFIGURATION_DRIFT');
  return {kind,resource:service.name,uid:service.uid,revision:revision.name,image:candidate.images[kind].destination,configurationSha256:digest(actual),nativeMetadataClaimsChecked:true,nativeOriginAuthenticated:false,httpRuntimeServedVerified:false,sqlPreservationVerified:false,sheetsActivated:false,activationAuthorized:false};
}
