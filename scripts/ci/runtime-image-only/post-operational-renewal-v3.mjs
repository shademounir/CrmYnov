// Source-only POST renewal gate. The historical V2 entrypoint is immutable;
// this gate cannot acquire a token, issue a claim, or run the POST job.
import assert from 'node:assert/strict';
import {validateAdditiveCutoverRenewalCatalogueV1} from './cutover-renewal-catalogue-v1.mjs';
import {validateImagePostDossierV2} from './post-operational-v2.mjs';
import {imageJournalDigest} from './journal.mjs';

export function validatePostRenewalSourceV3({catalogue, generalRecord, objectiveId, dossier, driverSource, adapterSource, action, now, readSource}) {
  const renewal = validateAdditiveCutoverRenewalCatalogueV1(catalogue, generalRecord, now);
  assert.equal(renewal.post.id, objectiveId, 'POST_V3_EXACT_NEW_OBJECTIVE_REQUIRED');
  assert(renewal.post.actions.includes(action), 'POST_V3_ACTION_REFUSED');
  assert(driverSource?.clean && driverSource.commit === renewal.post.driver.mergeCommit && driverSource.tree === renewal.post.driver.tree, 'POST_V3_PROTECTED_DRIVER_REQUIRED');
  assert.deepEqual(driverSource.files, renewal.post.driver.files, 'POST_V3_DRIVER_CLOSURE_REQUIRED');
  assert(adapterSource?.clean && adapterSource.commit === renewal.post.adapter.mergeCommit && adapterSource.tree === renewal.post.adapter.tree, 'POST_V3_PROTECTED_ADAPTER_REQUIRED');
  assert.deepEqual(adapterSource.files, renewal.post.adapter.files, 'POST_V3_ADAPTER_CLOSURE_REQUIRED');
  validateImagePostDossierV2(dossier, readSource);
  assert.equal(renewal.post.dossierSha256, imageJournalDigest(dossier), 'POST_V3_DOSSIER_REQUIRED');
  return Object.freeze({entry: renewal.post, nativeAuthority: false, runAuthorized: false});
}
