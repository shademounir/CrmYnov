import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {imageJournalDigest as digest} from './journal.mjs';
import {validatePostMetadataBindingV1} from './post-metadata-contract-v1.mjs';

const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Canonical builder kept outside the protected PR282 source closure.
export function buildImageInventoryMarkerV2({objectiveId,entry,source,grantDigest,humanAuthorityReceiptSha256,jiraBytes,expiresAt}){
  assert.equal(typeof objectiveId,'string');
  assert.equal(typeof entry?.id,'string');
  assert.equal(entry.id,objectiveId);
  assert(source&&typeof source.commit==='string');
  assert.equal(source.commit,entry.driver?.mergeCommit,'marker source must be the protected inventory driver');
  assert.equal(source.tree,entry.driver.tree,'marker source tree must match the protected inventory driver');
  assert.deepEqual(source.files,entry.driver.files,'marker source files must match the protected inventory driver');
  assert.equal(typeof grantDigest,'string');
  assert.equal(typeof humanAuthorityReceiptSha256,'string');
  assert(Buffer.isBuffer(jiraBytes)||jiraBytes instanceof Uint8Array);
  assert.equal(typeof expiresAt,'string');
  const actions=['READ_METADATA'];
  if(Object.hasOwn(entry,'postMetadata')){validatePostMetadataBindingV1(entry.postMetadata);}
  else{actions.push('TEST_PERMISSIONS','OBSERVE_OPERATION');}
  return {schemaVersion:2,executor:'Codex',scope:'READ_ONLY_INVENTORY',objectiveId,authorityRecordSha256:digest(entry),driverCommit:source.commit,grantDigest,humanAuthorityReceiptSha256,resourceBindingSha256:digest(entry.resourceBindings),productionRuntimeMutation:false,productionBusinessMutation:false,runAuthorized:false,actions,jiraEvidenceVersion:1,jiraObservationSha256:byteHash(jiraBytes),expiresAt};
}
