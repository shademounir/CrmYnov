// Current PR282/V5 source binding. Source-only data, never native authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {GENERAL_OPERATIONAL_DIRECTORY,GENERAL_OPERATIONAL_BINDING,GENERAL_OPERATIONAL_AUTHORITY_ID,GENERAL_OPERATIONAL_CAPABILITY_ID,validateHistoricalReadOnlyEntriesV3,validateGeneralOperationalRecordV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {IMAGE_OPERATIONAL_DRIVER_INPUTS_V4} from '../runtime-image-only/local-source.mjs';
import {OPERATIONAL_HUMAN_SHA256} from '../runtime-image-only/late-binding-v2.mjs';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';
import {validateImagePostCatalogueV2} from '../runtime-image-only/post-operational-v2.mjs';
import {readPr282ProtectedBytes} from './pr282-protected-preimages.mjs';

const root=new URL('../../../',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=relative=>fs.readFileSync(new URL(relative,root));
const roPath='docs/governance/readonly-probe-objectives-v1.json';
// Preserve the exact protected V5 catalogue bytes while later objectives append.
const raw=read(roPath),imageRaw=read('scripts/ci/runtime-image-only/fixtures/pre-v6-image.json'),readonly=JSON.parse(raw),images=JSON.parse(imageRaw);
const v4Raw=read('scripts/ci/runtime-image-only/fixtures/pre-v5-readonly.json'),v4ImageRaw=read('scripts/ci/runtime-image-only/fixtures/pre-v5-image.json'),v4=JSON.parse(v4Raw),v4Images=JSON.parse(v4ImageRaw);
const post=readonly.entries[7],descriptor=readonly.operationalPreAuthoritiesV3[0],inventory=images.entries[2],v4Inventory=images.entries[1];
const window={validFrom:'2026-11-02T12:32:37.722Z',expiresAt:'2026-11-03T12:32:37.722Z'};
const inventoryWindow={validFrom:'2026-11-03T15:30:00.000Z',expiresAt:'2026-11-04T15:30:00.000Z'};
const now=Date.parse('2026-11-03T08:55:00.000Z');
const inventoryNow=Date.parse('2026-11-03T15:35:00.000Z');
const identity={pr:282,head:'dde62dd3bd478310d64714bcf5a79b7d5f7221f9',mergeCommit:'c4dfed68baa4b750256285032761f0f09aea5a8e',tree:'b1ada64f5833e1afeaa8e03bbb58d081bf15f13c'};
const source={commit:identity.mergeCommit,tree:identity.tree,clean:true,files:inventory.driver.files};
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const record=driver=>({schemaVersion:3,kind:'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V3',authorityId:GENERAL_OPERATIONAL_AUTHORITY_ID,capabilityId:GENERAL_OPERATIONAL_CAPABILITY_ID,humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,binding:structuredClone(GENERAL_OPERATIONAL_BINDING),...window,source:{commit:driver.mergeCommit,tree:driver.tree,head:driver.head,pr:driver.pr,files:driver.files},evidenceDirectory:GENERAL_OPERATIONAL_DIRECTORY,directorySha256:sha(GENERAL_OPERATIONAL_DIRECTORY),consumerSha256:digest(CONSUMER_PINS),oldUnknownUnchanged:true,closedClaimsRemainClosed:true});

test('V5 raw catalogues preserve V4 and bind exact protected PR282 bytes',()=>{
  assert.equal(sha(raw),'3c07c113c46afdd4f7df2e6d369a339887fd2815dc73c541f248a09ea6a4f331');
  assert.equal(sha(imageRaw),'1b03a1d77f8587b432859f66ea744f4b3e07911aceb6ac4c74d0a314ad6f5e96');
  assert.equal(sha(v4Raw),'77eab75994182c4b08f90288971c34bf69a34b4b828e5a78526f7e2463d0b09b');
  assert.equal(sha(v4ImageRaw),'541f77f786e2ed893cab402dca946212f5b0b4830346b3c8e8b72e07b52a42c7');
  assert(raw.subarray(0,65280).equals(v4Raw.subarray(0,65280)));assert.deepEqual(readonly.entries.slice(0,7),v4.entries.slice(0,7));assert.deepEqual(images.entries.slice(0,2),v4Images.entries);
  assert.equal(readonly.entries.length,8);assert.equal(images.entries.length,4);validateHistoricalReadOnlyEntriesV3(readonly);
  for(const driver of [post.driver,descriptor.driver,inventory.driver]){
    const {files,...actualIdentity}=driver;assert.deepEqual(actualIdentity,identity);assert.equal(files.length,84);assert.deepEqual(files.map(row=>row.path),IMAGE_OPERATIONAL_DRIVER_INPUTS_V4);
    for(const row of files)assert.equal(sha(readPr282ProtectedBytes(row.path)),row.sha256,row.path);
  }
  assert.equal(inventory.driver.files.find(row=>row.path==='scripts/ci/runtime-image-only/operational-transport-v2.mjs').sha256,'53b70afca2b57e8952c26d03d8897c744ff94ad4fd49c88da73ef650124526e4');
});

test('V5 changes only protected source bindings and adds a distinct diagnostic inventory',()=>{
  assert.deepEqual(without(post,['driver']),without(v4.entries[7],['driver']));assert.deepEqual(post.validFrom,window.validFrom);assert.deepEqual(post.expiresAt,window.expiresAt);
  assert.equal(validateImagePostCatalogueV2(readonly,post.id),post);assert.equal(digest(post),'ddbe1c32645d6c4fd45e207b8620eea6068a8435c30c0bf5c64ab89672fc7449');
  assert.equal(inventory.id,'rc48-image-only-inventory-20261103-v5-c4dfed68');assert.notEqual(inventory.id,v4Inventory.id);
  assert.deepEqual(without(inventory,['id','journalDirectorySha256','driver','validFrom','expiresAt']),without(v4Inventory,['id','journalDirectorySha256','driver','validFrom','expiresAt']));assert.deepEqual(inventoryWindow,{validFrom:inventory.validFrom,expiresAt:inventory.expiresAt});assert.equal(digest(inventory),'8fc46f29d5e991f5a82566b9232980020e580bead3c00360141c644aa829350b');
  for(const action of ['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'])assert.equal(validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source,action,now:inventoryNow}),true);
  assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source,action:'PATCH_API',now:inventoryNow}));
});

test('V5 reuses the bounded window without renewing or arming GENERAL',()=>{
  const current=record(descriptor.driver);assert.equal(validateGeneralOperationalRecordV3(current,now),current);assert.equal(digest(current),'9a50c33855084326cff3a707d78a44f04d65beaa5f2d1235c5dc0e8f439c4b81');assert.equal(descriptor.authorityRecordSha256,digest(current));
  assert.deepEqual(window,{validFrom:v4.entries[7].validFrom,expiresAt:v4.entries[7].expiresAt});assert.equal(current.capabilityId,GENERAL_OPERATIONAL_CAPABILITY_ID);assert.equal(current.authorityId,GENERAL_OPERATIONAL_AUTHORITY_ID);
  assert.throws(()=>validateGeneralOperationalRecordV3(current,Date.parse(window.expiresAt)));assert.deepEqual(inventoryWindow,{validFrom:inventory.validFrom,expiresAt:inventory.expiresAt});assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source,action:'READ_METADATA',now:Date.parse(inventoryWindow.expiresAt)}));
});
