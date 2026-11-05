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

for (const [name,mutate] of [
  ['missing objective',input=>{input.objectiveId=undefined;}],
  ['missing entry',input=>{input.entry=undefined;}],
  ['non-string entry id',input=>{input.entry.id=42;}],
  ['missing source',input=>{input.source=undefined;}],
  ['non-string source commit',input=>{input.source.commit=42;}],
  ['non-string grant digest',input=>{input.grantDigest=42;}],
  ['non-string human authority hash',input=>{input.humanAuthorityReceiptSha256=42;}],
  ['non-byte Jira evidence',input=>{input.jiraBytes='not bytes';}],
  ['non-string expiry',input=>{input.expiresAt=42;}],
]) {
  test(`canonical inventory marker builder refuses ${name}`,()=>{
    const input=validInput();
    mutate(input);
    assert.throws(()=>buildImageInventoryMarkerV2(input),{name:'AssertionError'});
  });
}
