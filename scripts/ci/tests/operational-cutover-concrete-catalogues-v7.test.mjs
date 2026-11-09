import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';

const catalog=JSON.parse(fs.readFileSync(new URL('../../../docs/governance/runtime-image-only-objectives-v1.json',import.meta.url)));
const prior=catalog.entries[4];
const renewed=catalog.entries[5];
const omit=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));

test('V7 adds only one bounded read-only objective with unchanged protected bindings',()=>{
  assert.equal(catalog.entries.length,6);
  assert.equal(renewed.id,'rc48-image-only-inventory-20261109-v5-renewal-v2');
  assert.deepEqual(omit(renewed,['id','journalDirectorySha256','validFrom','expiresAt']),omit(prior,['id','journalDirectorySha256','validFrom','expiresAt']));
  assert.equal(Date.parse(renewed.expiresAt)-Date.parse(renewed.validFrom),86400000);
  assert.deepEqual(renewed.actions,['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']);
  assert.equal(renewed.driver.files.length,84);
  assert.equal(renewed.driver.mergeCommit,'c4dfed68baa4b750256285032761f0f09aea5a8e');
  assert.equal(renewed.sourceBinding.mergeCommit,'ba4a1a2caf6196a4b2e2447b6971f107ea76779c');
  assert.equal(renewed.adapterBinding.mergeCommit,'1dc7e42607860269364f8be7d8b616646e7ab6e4');
});

test('V7 binds a distinct journal hash and refuses expiration or mutation',()=>{
  assert.equal(renewed.journalDirectorySha256,'67676ae6213cf765d0903d2cc26b325856399dcd3572040fb5e9ea0eaa3aff96');
  assert.notEqual(renewed.journalDirectorySha256,prior.journalDirectorySha256);
  const source={commit:renewed.driver.mergeCommit,tree:renewed.driver.tree,clean:true,files:renewed.driver.files};
  const now=Date.parse('2026-11-09T17:00:00.000Z');
  for(const action of renewed.actions)assert.equal(validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action,now}),true);
  assert.throws(()=>validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action:'RUN',now}));
  assert.throws(()=>validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action:'READ_METADATA',now:Date.parse(renewed.expiresAt)}));
});
