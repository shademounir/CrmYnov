import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRc48ImageRollbackPlanDraft as make,validateImageRollbackServedState} from './rollback-plan.mjs';
import {rollbackFixture as setup} from './rollback-synthetic-fixtures.mjs';

test('full successful rollout drafts Web then API patches to the original exact images without input mutation', () => {
  const x = setup(), before = structuredClone(x.input), plan = make(x.input, x.now);
  assert.deepEqual(x.input, before);
  assert.deepEqual(plan.patches.map(p => p.resource.split('/').at(-1)), ['crm-prod-web', 'crm-prod-api']);
  for (const patch of plan.patches) {
    const kind = patch.resource.endsWith('-api') ? 'api' : 'web';
    assert.equal(patch.body.template.containers[0].image, x.input.originalBaseline.services[kind].template.containers[0].image);
    const expected = structuredClone(x.input.currentBaseline.services[kind].template.containers);
    expected[0].image = patch.body.template.containers[0].image;
    assert.deepEqual(patch.body.template.containers, expected);
  }
  assert.equal(plan.executionAuthorized, false); assert.equal(plan.nativeOriginAuthenticated, false);
  assert.equal(plan.databaseRestore, false); assert.equal(plan.afterSheetsActivationAuthorized, false);
  assert.deepEqual(plan.jobPatches, []); assert.deepEqual(plan.schedulerChanges, []);
});
test('clean interruption after API FIN does not patch untouched Web', () => {
  const x = setup(['api']), p = make(x.input, x.now);
  assert.equal(p.patches.length, 1); assert(p.patches[0].resource.endsWith('/crm-prod-api'));
});
for (const state of ['INTENT_ONLY_UNKNOWN_DO_NOT_RETRY', 'KNOWN_OPERATION_OBSERVE_ONLY', 'KNOWN_OPERATION_RUNNING']) {
  test('refuses forward stage ' + state, () => { const x = setup(); x.input.forwardEvidence.stages.WEB_IMAGE.state = state; assert.throws(() => make(x.input, x.now)); });
}
for (const [name, change] of [
  ['foreign forward plan', x => x.input.forwardEvidence.planSha256 = '0'.repeat(64)],
  ['missing backup FIN', x => x.input.forwardEvidence.stages.BACKUP = { state: 'UNUSED' }],
  ['failed forward operation needs explicit recovery', x => x.input.forwardEvidence.stages.WEB_IMAGE.outcome = 'FAILED'],
  ['missing native receipt hash', x => x.input.forwardEvidence.stages.API_IMAGE.nativeReceiptSha256 = null],
  ['stale current observation', x => x.now += 300001],
  ['future observation', x => x.now -= 2000],
  ['non-read-only baseline', x => x.input.currentBaseline.readOnly = false],
  ['new service UID', x => x.input.currentBaseline.services.api.uid = 'foreign'],
  ['ingestion activated', x => x.input.currentBaseline.services.api.template.containers[0].env[0].value = 'true'],
  ['job image fallback', x => x.input.currentBaseline.jobs[2].template.template.containers[0].image = 'foreign'],
  ['Scheduler paused', x => x.input.currentBaseline.schedulers[0].state = 'PAUSED'],
  ['mail target changed', x => x.input.currentBaseline.schedulers[0].httpTarget.uri = 'https://changed.invalid'],
  ['claimed FIN disagrees with current revision', x => x.input.forwardEvidence.stages.API_IMAGE.served.revision += '-other'],
  ['tampered original target image', x => x.input.originalBaseline.services.api.template.containers[0].image = 'foreign'],
]) {
  if(typeof name!=='string'){throw new TypeError('SYNTHETIC_CASE_NAME_REQUIRED');}
  test('refuses ' + name, () => { const x = setup(); change(x); assert.throws(() => make(x.input, x.now)); });
}
test('untouched Web drift cannot be smuggled through an API-only rollback', () => {
  const x = setup(['api']); x.input.currentBaseline.services.web.template.serviceAccount = 'foreign'; assert.throws(() => make(x.input, x.now));
});
test('no image deployment is not an authorization for a redundant patch', () => {
  const x = setup([]); assert.throws(() => make(x.input, x.now));
});


for(const [name,kinds,failed]of [['API failed',['api'],'api'],['Web failed after API FIN',['api','web'],'web']]){
  if(typeof name!=='string'){throw new TypeError('SYNTHETIC_CASE_NAME_REQUIRED');}
  test('known terminal '+name+' gets exact image repair while unknown operations remain refused',()=>{
    const x=setup(kinds,failed),plan=make(x.input,x.now);
    assert.equal(plan.patches.length,kinds.length);
    assert(plan.patches.some(p=>p.resource.endsWith('-'+failed)));
    assert.equal(plan.executionAuthorized,false);
    x.input.currentBaseline.services[failed].reconciling=true;
    assert.throws(()=>make(x.input,x.now));
  });
}
test('failed desired-image drift cannot be accepted as an old Ready revision',()=>{
  const x=setup(['api'],'api');x.input.currentBaseline.services.api.template.containers[0].args=['foreign'];
  assert.throws(()=>make(x.input,x.now));
});
test('a failed forward operation that changed nothing needs no redundant image patch',()=>{
  const x=setup(['api'],'api');x.input.currentBaseline.services.api=structuredClone(x.input.originalBaseline.services.api);
  assert.throws(()=>make(x.input,x.now),/NO_IMAGE_CHANGE_TO_ROLL_BACK/u);
});
test('rollback post-state compares the RC44 target and rejects RC48 or changed environment',()=>{
  const x=setup(['api']),plan=make(x.input,x.now),before=x.input.currentBaseline.services.api,service=structuredClone(before);
  const next=service.name+'/revisions/crm-prod-api-00025-rollback';
  Object.assign(service,{generation:'25',observedGeneration:'25',etag:'rollback-etag',latestReadyRevision:next,latestCreatedRevision:next});
  service.trafficStatuses[0].revision=next;service.template.containers=structuredClone(plan.patches[0].body.template.containers);
  const revision={name:next,conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}],containers:structuredClone(service.template.containers)};
  const args={plan,candidate:x.input.candidate,baseline:x.input.currentBaseline,rollbackContext:{forwardPlan:x.input.forwardPlan,originalBaseline:x.input.originalBaseline,forwardEvidence:x.input.forwardEvidence},kind:'api',service,revision,observedAt:x.input.currentBaseline.observedAt};
  assert.equal(validateImageRollbackServedState(args,x.now).image,x.input.originalBaseline.services.api.template.containers[0].image);
  revision.containers[0].image=x.input.candidate.images.api.destination;assert.throws(()=>validateImageRollbackServedState(args,x.now));
});
