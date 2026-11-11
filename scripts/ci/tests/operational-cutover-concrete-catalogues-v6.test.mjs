import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';
import {IMAGE_OPERATIONAL_DRIVER_INPUTS_V4} from '../runtime-image-only/local-source.mjs';
import {readPr282ProtectedBytes} from './pr282-protected-preimages.mjs';

const root=new URL('../../../',import.meta.url);
const read=relative=>fs.readFileSync(new URL(relative,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historical=JSON.parse(read('scripts/ci/runtime-image-only/fixtures/pre-v6-image.json'));
const current=JSON.parse(read('docs/governance/runtime-image-only-objectives-v1.json'));
const prior=historical.entries.at(-1);
const renewed=current.entries[4];
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));

test('V6 appends one new bounded inventory objective without changing any historical objective',()=>{
  assert.equal(historical.schemaVersion,2);
  assert.equal(current.schemaVersion,2);
  assert.equal(historical.entries.length,4);
  assert.ok(current.entries.length>=5);
  assert.deepEqual(current.entries.slice(0,4),historical.entries);
  assert.equal(sha(read('scripts/ci/runtime-image-only/fixtures/pre-v6-image.json')),'1b03a1d77f8587b432859f66ea744f4b3e07911aceb6ac4c74d0a314ad6f5e96');
  assert.equal(renewed.id,'rc48-image-only-inventory-20261105-v5-renewal-v1');
  assert.equal(current.entries.filter(row=>row.id===renewed.id).length,1);
  assert.deepEqual(without(renewed,['id','journalDirectorySha256','validFrom','expiresAt']),without(prior,['id','journalDirectorySha256','validFrom','expiresAt']));
  assert.deepEqual([renewed.validFrom,renewed.expiresAt],['2026-11-05T15:45:00.000Z','2026-11-06T15:45:00.000Z']);
  assert.equal(Date.parse(renewed.expiresAt)-Date.parse(renewed.validFrom),86400000);
  assert.equal(renewed.journalDirectorySha256,'fcc5fd53a394c3d2f4483f56c8dbde5f0766e74e715ad075a78190dae6fd7431');
  assert.deepEqual(renewed.actions,['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']);
  assert.equal(renewed.businessMutation,false);
  assert.equal(renewed.runtimeImageMutation,false);
});

test('V6 retains the exact 84-file PR282 driver closure and role-separated V5 bindings',()=>{
  const driver=renewed.driver;
  assert.equal(driver.mergeCommit,'c4dfed68baa4b750256285032761f0f09aea5a8e');
  assert.equal(driver.tree,'b1ada64f5833e1afeaa8e03bbb58d081bf15f13c');
  assert.equal(driver.role,'INVENTORY_DRIVER');
  assert.equal(renewed.sourceBinding.mergeCommit,'ba4a1a2caf6196a4b2e2447b6971f107ea76779c');
  assert.equal(renewed.sourceBinding.role,'PROTECTED_SOURCE_BINDING');
  assert.equal(renewed.adapterBinding.mergeCommit,'1dc7e42607860269364f8be7d8b616646e7ab6e4');
  assert.equal(renewed.adapterBinding.role,'V5_ADAPTER');
  assert.equal(driver.files.length,84);
  assert.deepEqual(driver.files.map(row=>row.path),IMAGE_OPERATIONAL_DRIVER_INPUTS_V4);
  for(const row of driver.files)assert.equal(sha(readPr282ProtectedBytes(row.path)),row.sha256,row.path);
  const source={commit:driver.mergeCommit,tree:driver.tree,clean:true,files:driver.files};
  const inside=Date.parse('2026-11-05T16:00:00.000Z');
  for(const action of renewed.actions){
    assert.equal(validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action,now:inside}),true);
  }
  assert.throws(()=>validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action:'PATCH_API',now:inside}));
  assert.throws(()=>validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action:'READ_METADATA',now:Date.parse(renewed.expiresAt)}));
});
