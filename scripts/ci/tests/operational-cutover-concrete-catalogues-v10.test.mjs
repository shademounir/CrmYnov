import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';
import {validateImageInventoryInputs} from '../runtime-image-only/operational-cli-v2.mjs';
import {imageJournalDigest as digest} from '../runtime-image-only/journal.mjs';
import {OPERATIONAL_HUMAN_SHA256,IMAGE_OPERATIONAL_RESOURCES_V2} from '../runtime-image-only/late-binding-v2.mjs';

const catalog=JSON.parse(fs.readFileSync(new URL('../../../docs/governance/runtime-image-only-objectives-v1.json',import.meta.url)));
const prior=catalog.entries[7],renewed=catalog.entries[8];
const omit=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const journal='C:\\Crm Ynov\\output\\casablanca-pilot-20261022\\v5-inventory-v2-authority-20261109-v14\\journal';
const pathHash=value=>createHash('sha256').update(value).digest('hex');
function input(entry,journalDirectory){
  const source={commit:entry.driver.mergeCommit,tree:entry.driver.tree,clean:true,files:entry.driver.files};
  const authority={entry:{...entry,objectiveId:entry.id,authorityRecordSha256:digest(entry)}};
  const dossier={schemaVersion:2,kind:'RC48_NATIVE_INVENTORY_DOSSIER_V2',objectiveId:entry.id,humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,source:{commit:source.commit,tree:source.tree},resourceBindings:IMAGE_OPERATIONAL_RESOURCES_V2,journalDirectorySha256:pathHash(journalDirectory)};
  const binding={sessionId:'local:12345678-1234-4234-8234-123456789abc',authorityRecordSha256:digest(entry),resourceBindingSha256:digest(IMAGE_OPERATIONAL_RESOURCES_V2),scope:'READ_ONLY_INVENTORY',windowStart:entry.validFrom,windowEnd:new Date(Date.parse(entry.validFrom)+900000).toISOString(),sourceCommit:source.commit,project:entry.project,region:entry.region};
  return {objectiveId:entry.id,dossier,binding,source,authority,journalDirectory};
}

test('V10 appends a distinct bounded read-only objective and preserves prior entries',()=>{
  // Later objectives are append-only; the historical V10 prefix remains nine entries.
  assert.equal(catalog.entries.slice(0,9).length,9);
  assert.equal(renewed.id,'rc48-image-only-inventory-20261109-v5-renewal-v5');
  assert.deepEqual(omit(renewed,['id','journalDirectorySha256','validFrom','expiresAt']),omit(prior,['id','journalDirectorySha256','validFrom','expiresAt']));
  assert.equal(renewed.journalDirectorySha256,pathHash(journal));
  assert.notEqual(renewed.journalDirectorySha256,prior.journalDirectorySha256);
  assert.equal(Date.parse(renewed.expiresAt)-Date.parse(renewed.validFrom),86400000);
  assert.deepEqual(renewed.actions,['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']);
  assert.equal(renewed.driver.files.length,84);
  assert.equal(renewed.driver.mergeCommit,'c4dfed68baa4b750256285032761f0f09aea5a8e');
  assert.equal(renewed.sourceBinding.mergeCommit,'ba4a1a2caf6196a4b2e2447b6971f107ea76779c');
  assert.equal(renewed.adapterBinding.mergeCommit,'1dc7e42607860269364f8be7d8b616646e7ab6e4');
});

test('V10 real runner input validator accepts canonical objective and rejects old noncanonical dates',()=>{
  assert.equal(validateImageInventoryInputs(input(renewed,journal)),true);
  const oldJournal='C:\\Crm Ynov\\output\\casablanca-pilot-20261022\\v5-inventory-v2-authority-20261109-v13\\journal';
  assert.throws(()=>validateImageInventoryInputs(input(prior,oldJournal)));
});

test('V10 objective refuses RUN and expiration',()=>{
  const source={commit:renewed.driver.mergeCommit,tree:renewed.driver.tree,clean:true,files:renewed.driver.files};
  const now=Date.parse(renewed.validFrom)+1000;
  for(const action of renewed.actions)assert.equal(validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action,now}),true);
  assert.throws(()=>validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action:'RUN',now}));
  assert.throws(()=>validateImageInventoryObjective(renewed,{objectiveId:renewed.id,source,action:'READ_METADATA',now:Date.parse(renewed.expiresAt)}));
});
