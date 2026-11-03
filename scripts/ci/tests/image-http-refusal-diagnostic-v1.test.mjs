// SYNTHETIC ONLY. No SDK, GCP, RUN, SQL or journal replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectHttpRefusalDiagnosticV1 as project} from '../runtime-image-only/operational-transport-v2.mjs';
const SECRET = 'SYNTHETIC_PRIVATE_TOKEN';
function fixture() {
  return {error:{code:429, status:'RESOURCE_EXHAUSTED', message:SECRET, details:[{
    '@type':'type.googleapis.com/google.rpc.ErrorInfo', reason:'RATE_LIMIT_EXCEEDED', domain:'googleapis.com',
    metadata:{consumer:'projects/706512498094',service:'cloudresourcemanager.googleapis.com',quota_metric:'cloudresourcemanager.googleapis.com/read_requests',quota_limit:'ReadRequestsPerMinutePerProject',credential:SECRET}
  },{'@type':'type.googleapis.com/google.rpc.DebugInfo',detail:SECRET}]}};
}
test('structured rate reason and consumer retained without free text or credentials', () => {
  const result=project(fixture());
  assert.equal(result.status,'RESOURCE_EXHAUSTED');assert.equal(result.reason,'RATE_LIMIT_EXCEEDED');
  assert.equal(result.consumer,'projects/706512498094');assert.equal(result.service,'cloudresourcemanager.googleapis.com');
  assert.equal(result.quotaMetric,'cloudresourcemanager.googleapis.com/read_requests');
  assert.equal(result.quotaLimit,'ReadRequestsPerMinutePerProject');
  assert(!JSON.stringify(result).includes(SECRET));assert.equal(result.retryAuthorized,false);assert.equal(result.permissionResult,false);
});
for (const field of ['reason','domain']) { test('unknown '+field+' withheld', () => {
  const f=fixture();f.error.details[0][field]=SECRET;const result=project(f);
  assert.equal(result.reason,null);assert(!JSON.stringify(result).includes(SECRET));
}); }
for (const field of ['consumer','service','quota_metric','quota_limit']) { test('arbitrary metadata '+field+' withheld', () => {
  const f=fixture();f.error.details[0].metadata[field]=SECRET;assert(!JSON.stringify(project(f)).includes(SECRET));
}); }
for (const value of [null,{}, {error:SECRET}, {error:{message:SECRET}}, {error:{status:SECRET,details:SECRET}}]) {
  test('incomplete response is not an invented reason '+JSON.stringify(value), () => {
    const result=project(value);assert.equal(result.reason,null);assert.equal(result.consumer,null);assert(!JSON.stringify(result).includes(SECRET));
  });
}
test('duplicate error identities are not merged', () => {
  const f=fixture();f.error.details.push({...f.error.details[0],metadata:{consumer:'projects/123456789012'}});
  const result=project(f);assert.equal(result.errorInfoAmbiguous,true);assert.equal(result.reason,null);assert.equal(result.consumer,null);
});
test('too many details are withheld as a whole', () => {
  const f=fixture();f.error.details.push(...Array.from({length:16},()=>({})));assert.equal(project(f).reason,null);
});
test('accessors and inherited error data are never invoked', () => {
  const f={};Object.defineProperty(f,'error',{get(){throw new Error(SECRET);}});assert.equal(project(f).reason,null);
  assert.equal(project(Object.create(fixture())).reason,null);
});
test('numeric consumer is not inferred from target project', () => {
  const f=fixture();delete f.error.details[0].metadata.consumer;assert.equal(project(f).consumer,null);
});
test('array entry accessor is not invoked', () => {
  const details=[];Object.defineProperty(details,'0',{get(){throw new Error(SECRET);}});
  assert.equal(project({error:{details}}).reason,null);
});
test('known permission reason is a provider statement, not permission evidence', () => {
  const f=fixture();f.error.status='PERMISSION_DENIED';f.error.details[0].reason='IAM_PERMISSION_DENIED';
  const result=project(f);assert.equal(result.reason,'IAM_PERMISSION_DENIED');assert.equal(result.permissionResult,false);
});
