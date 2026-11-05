import assert from 'node:assert/strict';
import test from 'node:test';
import {buildImageInventoryMarkerV2} from '../runtime-image-only/inventory-marker-builder-v2.mjs';

const validInput=()=>({
  objectiveId:'rc48-image-only-inventory-coverage-v2',
  entry:{id:'rc48-image-only-inventory-coverage-v2',resourceBindings:{project:'crmynov-prod-n7x4q2',region:'europe-west1'}},
  source:{commit:'c4dfed68baa4b750256285032761f0f09aea5a8e'},
  grantDigest:'a'.repeat(64),
  humanAuthorityReceiptSha256:'b'.repeat(64),
  jiraBytes:Buffer.from('{"schemaVersion":1,"key":"CRMY-63"}'),
  expiresAt:'2026-11-05T18:00:00.000Z',
});

test('canonical inventory marker builder is executed by the instrumented coverage suite',()=>{
  const marker=buildImageInventoryMarkerV2(validInput());
  assert.equal(marker.schemaVersion,2);
  assert.equal(marker.runAuthorized,false);
  assert.deepEqual(marker.actions,['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']);
  assert.match(marker.jiraObservationSha256,/^[0-9a-f]{64}$/u);
});

test('canonical inventory marker builder refuses an objective/source mismatch',()=>{
  const input=validInput();
  input.objectiveId='different-objective';
  assert.throws(()=>buildImageInventoryMarkerV2(input),{name:'AssertionError'});
});
