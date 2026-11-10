// Historical PR280/V4 concrete source-only data, not candidate source admission.
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
const read=p=>{
 const actual=readPr282ProtectedBytes(p);
 if(p!=='scripts/ci/runtime-image-only/operational-transport-v2.mjs'){return actual;}
 const raw=fs.readFileSync(new URL('scripts/ci/runtime-image-only/fixtures/pre-http-diagnostic-transport.json',root));
 assert.equal(sha(raw),'7cf36c27f939528e3c5e476ecebe384765fef5e51cfee236101b75ff9f017f2b');
 const fixture=JSON.parse(raw);assert.equal(fixture.nativeAuthority,false);assert.equal(fixture.sourceExecutionPerformed,false);
 const old=Buffer.from(fixture.sourceUtf8);assert.equal(sha(old),'08a3f9d941904dda24aa72d06125ea9cc514f4e849bb6c70bf275b15e3f4c346');return old;
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const roPath='docs/governance/readonly-probe-objectives-v1.json',imagePath='docs/governance/runtime-image-only-objectives-v1.json';
const raw=read('scripts/ci/runtime-image-only/fixtures/pre-v5-readonly.json'),imageRaw=read('scripts/ci/runtime-image-only/fixtures/pre-v5-image.json'),ro=JSON.parse(raw),images=JSON.parse(imageRaw);
const oldRaw=read('scripts/ci/runtime-image-only/fixtures/pre-v4-readonly.json');
const old=JSON.parse(oldRaw),oldImages=JSON.parse(read('scripts/ci/runtime-image-only/fixtures/pre-v4-image.json'));
const post=ro.entries[7],inventory=images.entries[1],descriptor=ro.operationalPreAuthoritiesV3[0];
const window={validFrom:'2026-11-02T12:32:37.722Z',expiresAt:'2026-11-03T12:32:37.722Z'};
const now=Date.parse(window.validFrom)+43200000;
const identity={pr:280,head:'d3136c7523c5036626649e9701629e2eecdc737d',mergeCommit:'ba019e155bce3618279315898d5af22a0a3397d4',tree:'b82ad20e4661928d21230caa86d1f01256a13181'};
const source={commit:identity.mergeCommit,tree:identity.tree,clean:true,files:inventory.driver.files};
const record=(driver,w)=>({schemaVersion:3,kind:'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V3',authorityId:GENERAL_OPERATIONAL_AUTHORITY_ID,capabilityId:GENERAL_OPERATIONAL_CAPABILITY_ID,humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,binding:structuredClone(GENERAL_OPERATIONAL_BINDING),...w,source:{commit:driver.mergeCommit,tree:driver.tree,head:driver.head,pr:driver.pr,files:driver.files},evidenceDirectory:GENERAL_OPERATIONAL_DIRECTORY,directorySha256:sha(GENERAL_OPERATIONAL_DIRECTORY),consumerSha256:digest(CONSUMER_PINS),oldUnknownUnchanged:true,closedClaimsRemainClosed:true});
const without=(v,keys)=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
test('V4 retained raw fixture has exact assembly hashes and preserved historical prefix',()=>{
 assert.equal(sha(raw),'77eab75994182c4b08f90288971c34bf69a34b4b828e5a78526f7e2463d0b09b');
 assert.equal(sha(imageRaw),'541f77f786e2ed893cab402dca946212f5b0b4830346b3c8e8b72e07b52a42c7');
 assert.equal(sha(oldRaw),'09009dedca366cb334a9f24f8e85a760e01158660e8f3be50b067222fc6a4849');
 assert.equal(sha(read('scripts/ci/runtime-image-only/fixtures/pre-v4-image.json')),'f60638310e81e8adbee53734e459b755ea8e1f54d089e4dc25dbebc531ae27ed');
 assert.equal(sha(raw.subarray(0,65280)),'22367c1d65441fe1c61226505bc83452031869283b95e6140aa455ef6928d3b0');
 assert.equal(ro.entries.length,8);assert.equal(images.entries.length,2);assert.deepEqual(ro.entries.slice(0,7),old.entries.slice(0,7));assert.deepEqual(images.entries[0],oldImages.entries[0]);validateHistoricalReadOnlyEntriesV3(ro);
});
test('V4 descriptors bind all 84 exact protected operational bytes without self-reference',()=>{
 for(const driver of [post.driver,inventory.driver,descriptor.driver]){
  const {files,...actualIdentity}=driver;assert.deepEqual(actualIdentity,identity);assert.equal(files.length,84);assert.deepEqual(files.map(r=>r.path),IMAGE_OPERATIONAL_DRIVER_INPUTS_V4);
  assert.equal(sha(JSON.stringify(files)),'664907dda0bce11f0f865e947ced17a03bc6d68b11c930476166b69f4aa6ab76');
  for(const r of files){assert.equal(sha(read(r.path)),r.sha256,r.path);}assert(!files.some(r=>[roPath,imagePath].includes(r.path)));
 }
});
test('V4 POST keeps exact identity, bundle, SELECT contract, dossier and actions',()=>{
 assert.equal(validateImagePostCatalogueV2(ro,post.id),post);assert.equal(post.id,old.entries[7].id);
 assert.deepEqual(without(post,['driver','validFrom','expiresAt']),without(old.entries[7],['driver','validFrom','expiresAt']));
 assert.equal(digest(post),'2d68aa947b143f0f7bf57a39d8cb5ab9d0966779760544a9205a5c3b1f7b2b6f');assert.equal(post.post.selectCount,13);
});
test('V4 same GENERAL capability, job UID and consumers, only source/window renewed',()=>{
 const current=record(descriptor.driver,window),priorExact=record(old.operationalPreAuthoritiesV3[0].driver,{validFrom:old.entries[7].validFrom,expiresAt:old.entries[7].expiresAt});
 assert.equal(digest(priorExact),old.operationalPreAuthoritiesV3[0].authorityRecordSha256);
 assert.deepEqual(without(current,['source','validFrom','expiresAt']),without(priorExact,['source','validFrom','expiresAt']));
 assert.equal(validateGeneralOperationalRecordV3(current,now),current);assert.equal(digest(current),'09b75018923f5c5ada3bd021fe3168e7fdfd76d9dbf583337671d5761d91f1b7');assert.equal(descriptor.authorityRecordSha256,digest(current));
 assert.deepEqual(without(descriptor,['driver','authorityRecordSha256']),without(old.operationalPreAuthoritiesV3[0],['driver','authorityRecordSha256']));
 assert.throws(()=>validateGeneralOperationalRecordV3(current,Date.parse(window.expiresAt)));
});
test('V4 inventory is distinct and read-only; old N02 objective remains exact',()=>{
 assert.equal(inventory.id,'rc48-image-only-inventory-20261102-v4-ba019e1');assert.notEqual(inventory.id,images.entries[0].id);
 assert.deepEqual(without(inventory,['id','journalDirectorySha256','driver','validFrom','expiresAt']),without(images.entries[0],['id','journalDirectorySha256','driver','validFrom','expiresAt']));
 assert.equal(digest(inventory),'104d8ffc98c23286518029ac532148b17d99f2f0317733ec8bbb57d524cae9d0');
 for(const action of ['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION'])assert.equal(validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source,action,now}),true);
 const selected=images.entries.filter(e=>e.id===inventory.id);assert.equal(selected.length,1);assert.equal(selected[0],inventory);
 assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source,action:'PATCH_API',now}));
 assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source,action:'READ_METADATA',now:Date.parse(window.expiresAt)}));
});

test('protected V4 catalogue does not admit the changed diagnostic transport',()=>{
 const actualFiles=IMAGE_OPERATIONAL_DRIVER_INPUTS_V4.map(path=>({path,sha256:sha(fs.readFileSync(new URL(path,root)))}));
 const actualTransport=actualFiles.find(r=>r.path==='scripts/ci/runtime-image-only/operational-transport-v2.mjs');
 assert.notEqual(actualTransport.sha256,inventory.driver.files.find(r=>r.path===actualTransport.path).sha256);
 assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:inventory.id,source:{...source,files:actualFiles},action:'READ_METADATA',now}));
});
