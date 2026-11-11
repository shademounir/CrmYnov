import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';
import {POST_METADATA_V1} from '../runtime-image-only/post-metadata-contract-v1.mjs';
const file='docs/governance/runtime-image-only-objectives-v1.json';
const catalogue=JSON.parse(fs.readFileSync(file));
const entry=catalogue.entries.at(-1);
const source={commit:entry.driver.mergeCommit,tree:entry.driver.tree,files:entry.driver.files,clean:true};
const now=Date.parse(entry.validFrom);
test('POST metadata appends one objective without rewriting historical entries',()=>{
 const prior=JSON.parse(execFileSync('git',['show','098907d323a2c96100dafc874d649dd2a680d072:'+file]));
 assert.deepEqual(catalogue.entries.slice(0,-1),prior.entries);
 assert.equal(entry.id,'rc48-image-only-inventory-20261111-post-metadata-v1');
 assert.equal(Date.parse(entry.expiresAt)-now,86400000);
 assert.equal(entry.driver.pr,292);assert.equal(entry.driver.mergeCommit,'098907d323a2c96100dafc874d649dd2a680d072');
 assert.equal(entry.driver.files.length,85);assert.deepEqual(entry.postMetadata,POST_METADATA_V1);
 assert.equal(entry.journalDirectorySha256,'eca9a54b1b9be480ce7226873d425b474ba0ae447d4d35ef645ba2f749943ffd');
});
test('POST metadata validates only READ_METADATA and refuses execution, wider inventory and expiry',()=>{
 assert.equal(validateImageInventoryObjective(entry,{objectiveId:entry.id,source,action:'READ_METADATA',now}),true);
 for(const action of ['TEST_PERMISSIONS','OBSERVE_OPERATION','RUN','CREATE','PATCH_API'])assert.throws(()=>validateImageInventoryObjective(entry,{objectiveId:entry.id,source,action,now}));
 assert.throws(()=>validateImageInventoryObjective(entry,{objectiveId:entry.id,source,action:'READ_METADATA',now:Date.parse(entry.expiresAt)}));
 assert.throws(()=>validateImageInventoryObjective({...entry,postMetadata:{...entry.postMetadata,uid:'foreign'}},{objectiveId:entry.id,source,action:'READ_METADATA',now}));
});
test('POST metadata closure bytes match protected PR292 exactly',()=>{
 for(const row of source.files){
  const bytes=execFileSync('git',['show',source.commit+':'+row.path],{maxBuffer:4194304});
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,row.path);
 }
});
