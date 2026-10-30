// Concrete repository data contract, not live authority, a native PRE, or an activation test.
// Only repository-relative public files are read. Actual dossier assembly was checked
// separately before these catalogue bytes were copied into the candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {BINDING,CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {GENERAL_OPERATIONAL_DIRECTORY,GENERAL_OPERATIONAL_BINDING,GENERAL_OPERATIONAL_AUTHORITY_ID,GENERAL_OPERATIONAL_CAPABILITY_ID,validateHistoricalReadOnlyEntriesV3,validateGeneralOperationalRecordV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {QUERY_CONTRACT_SHA256,QUERIES} from '../pool-reconciliation/general-preservation-read-only-collector-v1.mjs';
import {POOL_IMAGE} from '../pool-reconciliation/pool-native-output-v1.mjs';
import {IMAGE_OPERATIONAL_DRIVER_INPUTS_V2} from '../runtime-image-only/local-source.mjs';
import {OPERATIONAL_HUMAN_SHA256,IMAGE_OPERATIONAL_RESOURCES_V2} from '../runtime-image-only/late-binding-v2.mjs';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';
import {validateImagePostCatalogueV2} from '../runtime-image-only/post-operational-v2.mjs';

const root=new URL('../../../',import.meta.url);
const readonlyPath='docs/governance/readonly-probe-objectives-v1.json';
const imagePath='docs/governance/runtime-image-only-objectives-v1.json';
const fixturePath='scripts/ci/pool-reconciliation/tests/fixtures/readonly-probe-objectives-before-operational-273-20261030.json';
const readBytes=relative=>fs.readFileSync(new URL(relative,root));
const read=relative=>JSON.parse(readBytes(relative));
const sha=value=>createHash('sha256').update(value).digest('hex');
const raw=readBytes(readonlyPath),historicalRaw=readBytes(fixturePath);
const current=JSON.parse(raw),historical=JSON.parse(historicalRaw),images=read(imagePath);
const post=current.entries[7],inventory=images.entries[0],general=current.operationalPreAuthoritiesV3[0];
const POST_ID='rc48-general-post-20261030-operational-v1';
const INVENTORY_ID='rc48-image-only-inventory-20261030-operational-v1';
const sourceIdentity={pr:273,head:'e0a8a803dfbb0109087bdc76f77be653afa5f966',mergeCommit:'c3890630bad613e51ee6e38ae6aca5032a4fbb66',tree:'cf1d2e9d0ed3280e069ed8979472c7cc8ee919ea'};
const window={validFrom:'2026-10-30T16:54:24.466Z',expiresAt:'2026-10-31T16:54:24.466Z'};
const midpoint=Date.parse(window.validFrom)+(Date.parse(window.expiresAt)-Date.parse(window.validFrom))/2;
const review=relative=>({kind:'PROTECTED_CATALOGUE_PATH_HISTORY',path:relative});
const sourceProjection=()=>({commit:sourceIdentity.mergeCommit,tree:sourceIdentity.tree,clean:true,files:inventory.driver.files});
// These two exact RAW, non-executable fixtures retain PR273/c389 source bytes.
// The other77 source bytes still equal this checkout; this is not a new common
// native snapshot or a claim that the future V3 driver uses the c389 closure.
const historicalSourceFixtures={
 'scripts/ci/runtime-image-only/local-source.mjs':{path:'scripts/ci/runtime-image-only/fixtures/c389-local-source.mjs.fixture.txt',sha256:'e208f43237b89d53158576931e8b4c13acbb0577070c29c39233d1e0fd04237d'},
 'scripts/ci/runtime-image-only/operational-forward-cli-v2.mjs':{path:'scripts/ci/runtime-image-only/fixtures/c389-operational-forward-cli-v2.mjs.fixture.txt',sha256:'0f247ca4adb761dcec0ff19f8eea689fe282602464b8904f0380d0a085119ac3'},
};
function historicalSourceBytes(relative){
 const pin=historicalSourceFixtures[relative];if(!pin){return readBytes(relative);}
 const bytes=readBytes(pin.path);assert.equal(sha(bytes),pin.sha256);return bytes;
}

// clean:true is an explicit pure-validator input, not a Git/native observation.
function assertSourceClosure(driver){
 const {files,...identity}=driver;
 assert.deepEqual(identity,sourceIdentity);
 assert.equal(files.length,79);
 assert.deepEqual(files.map(file=>file.path),IMAGE_OPERATIONAL_DRIVER_INPUTS_V2);
 assert.equal(digest(files),'cd76dd409cdabf7153ba6bd9dee9dd0e5c064b15fef7f1cec7f3a699f8bfa20d');
 for(const file of files){assert.equal(sha(historicalSourceBytes(file.path)),file.sha256,file.path);}
 assert(!files.some(file=>file.path===readonlyPath||file.path===imagePath));
}

function generalRecord(){
 return {schemaVersion:3,kind:'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V3',
  authorityId:GENERAL_OPERATIONAL_AUTHORITY_ID,capabilityId:GENERAL_OPERATIONAL_CAPABILITY_ID,
  humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,binding:structuredClone(GENERAL_OPERATIONAL_BINDING),...window,
  source:{commit:sourceIdentity.mergeCommit,tree:sourceIdentity.tree,head:sourceIdentity.head,pr:sourceIdentity.pr,files:general.driver.files},
  evidenceDirectory:GENERAL_OPERATIONAL_DIRECTORY,directorySha256:sha(GENERAL_OPERATIONAL_DIRECTORY),consumerSha256:digest(CONSUMER_PINS),
  oldUnknownUnchanged:true,closedClaimsRemainClosed:true};
}

test('SOURCE ONLY current catalogues retain seven exact historical entries and one additive POST',()=>{
 assert.equal(sha(historicalRaw),'afb76023a6943f66f34f05c93aae0cf5455818984d19313551f61e24ddf6833e');
 assert.equal(sha(raw),'b962e15e7af24b02126748ad91cac0fb3d77d54fa054ab443b4376e00d965509');
 assert.equal(sha(readBytes(imagePath)),'04e5918d16c7d1616a190e03fe8c6195de4aaca226c65f4f5eb71805549fe025');
 assert.deepEqual(Object.keys(current).sort(),['entries','operationalPreAuthoritiesV3','schemaVersion']);
 assert.deepEqual(Object.keys(images).sort(),['entries','schemaVersion']);
 assert.equal(current.schemaVersion,1);assert.equal(images.schemaVersion,2);
 assert.equal(current.entries.length,8);assert.equal(current.operationalPreAuthoritiesV3.length,1);assert.equal(images.entries.length,1);
 assert.deepEqual(current.entries.slice(0,7),historical.entries);
 assert.equal(new Set(current.entries.map(entry=>entry.id)).size,8);
 const end=/\]\s*\}\s*$/u.exec(historicalRaw.toString('utf8'));assert(end);
 const prefix=Buffer.from(historicalRaw.toString('utf8').slice(0,end.index));
 assert(raw.subarray(0,prefix.length).equals(prefix),'HISTORICAL_RAW_PREFIX_CHANGED');
 assert.deepEqual(validateHistoricalReadOnlyEntriesV3(current),{historicalCount:7,historicalEntriesSha256:'27c33fb80406e3d41a6f23b04585dc6d782c3290787491996d0589ae2bb57adc'});
});

test('SOURCE ONLY all additive descriptors use the exact protected S01 source closure without catalogue cycles',()=>{
 for(const driver of [post.driver,inventory.driver,general.driver]){assertSourceClosure(driver);}
 assert.deepEqual(post.driver,inventory.driver);assert.deepEqual(general.driver,inventory.driver);
});

test('SOURCE ONLY POST pins actual assembled dossier metadata and the existing thirteen-SELECT contract',()=>{
 assert.equal(validateImagePostCatalogueV2(current,POST_ID),post);
 assert.equal(post.schemaVersion,2);assert.equal(post.id,POST_ID);assert.equal(post.phase,'POST');
 assert.equal(post.businessMutation,false);assert.equal(post.googleAccount,'casablancaynovcampus@gmail.com');
 assert.equal(post.dossierSha256,'60355bd69eb83c092d97b8469eca367569b410e5eb31da64af11ac0be292dd06');
 assert.equal(digest(post),'fb031da24a6bc8292d6b4b9cb39a2ebc8884f3f9ae6a510d2416a14d31b25058');
 assert.equal(QUERY_CONTRACT_SHA256,'5fc539ee53eb709e958e34306d7b04714f3d4b08aec4c340dde366fc15d31b60');
 assert.equal(Object.keys(QUERIES).length+1,13);
 assert.deepEqual(post.post,{job:'projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-post-20261030-op-v1',
  purpose:BINDING.purpose,queryContractSha256:QUERY_CONTRACT_SHA256,sourceSha256:BINDING.sourceSha256,
  bundleSha256:'f89d4f72c7976af74fbfc025c8d0ea4e62c2609ec3f5dd8f143c33de1826de46',image:POOL_IMAGE,role:'crm_runtime',
  selectCount:13,createBeforePre:true,runOnlyAfterImages:true,maximumCreatePosts:1,maximumRunPosts:1});
 assert.deepEqual(post.objectiveReview,review(readonlyPath));assert.equal(post.humanAuthorityReceiptSha256,OPERATIONAL_HUMAN_SHA256);
 assert.equal(post.post.uid,undefined);assert.equal(post.post.etag,undefined);
});

test('SOURCE ONLY GENERAL V3 record binds the old job prospectively without altering UNKNOWN or closed claims',()=>{
 const record=generalRecord();
 assert.equal(validateGeneralOperationalRecordV3(record,midpoint),record);
 assert.equal(digest(record),'4f8439e6f3958fc947b9a6c571640ec31d63e8652147d3a226c7fffa6b970e1f');
 assert.deepEqual(general,{schemaVersion:3,authorityId:GENERAL_OPERATIONAL_AUTHORITY_ID,objectiveId:BINDING.objectiveId,
  status:'approved',scope:BINDING.purpose,ticket:'CRMY-63',authorityRecordSha256:digest(record),
  humanAuthorityReceiptSha256:OPERATIONAL_HUMAN_SHA256,driver:inventory.driver,origin:review(readonlyPath)});
 const old=current.entries.find(entry=>entry.id===BINDING.objectiveId);
 assert.equal(old.dossierSha256,BINDING.catalogueDossierSha256);assert.equal(old.expiresAt,BINDING.originalExpiresAt);
 assert.equal(record.binding.job,BINDING.job);assert.equal(record.binding.uid,BINDING.uid);
});

test('SOURCE ONLY N02 has concrete read-only targets and no future plan or runtime mutation authority',()=>{
 assert.equal(inventory.id,INVENTORY_ID);assert.equal(inventory.scope,'READ_ONLY_INVENTORY');
 for(const action of ['READ_METADATA','TEST_PERMISSIONS','OBSERVE_OPERATION']){
  assert.equal(validateImageInventoryObjective(inventory,{objectiveId:INVENTORY_ID,source:sourceProjection(),action,now:midpoint}),true);
 }
 assert.deepEqual(inventory.resourceBindings,IMAGE_OPERATIONAL_RESOURCES_V2);
 assert.equal(digest(inventory.resourceBindings),'ca4368937beda7b604f8ae87b574c99403f243bda02b3dd27c7a2a69126acc10');
 assert.equal(digest(inventory),'5d2800c92595b1cf8fad96f3eb7ed0bd4f8c2b1e83c4bea66b8ae74b27bcf51b');
 assert.deepEqual(inventory.objectiveReview,review(imagePath));
 assert.equal(inventory.planSha256,undefined);assert.equal(inventory.preparationReceiptSha256,undefined);
 assert.equal(inventory.runtimeImageMutation,false);assert.equal(inventory.businessMutation,false);
});

test('SOURCE ONLY explicit authority-window midpoint is not live freshness and expiry is rejected',()=>{
 for(const entry of [post,inventory]){assert.equal(entry.validFrom,window.validFrom);assert.equal(entry.expiresAt,window.expiresAt);}
 assert.equal(Date.parse(window.expiresAt)-Date.parse(window.validFrom),86400000);
 const expired=Date.parse(window.expiresAt);
 assert.throws(()=>validateGeneralOperationalRecordV3(generalRecord(),expired));
 assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:INVENTORY_ID,source:sourceProjection(),action:'READ_METADATA',now:expired}));
});

test('SOURCE ONLY existing pure guards reject a historical substitution, mutation action and changed GENERAL UID',()=>{
 const substituted=structuredClone(current);substituted.entries[0].status='changed';
 assert.throws(()=>validateImagePostCatalogueV2(substituted,POST_ID));
 assert.throws(()=>validateImageInventoryObjective(inventory,{objectiveId:INVENTORY_ID,source:sourceProjection(),action:'PATCH_API',now:midpoint}));
 const changed=generalRecord();changed.binding.uid='not-the-authorized-job-uid';
 assert.throws(()=>validateGeneralOperationalRecordV3(changed,midpoint));
});
