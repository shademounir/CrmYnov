// Source-only POST renewal gate. The historical V2 entrypoint is immutable;
// this gate cannot acquire a token, issue a claim, or run the POST job.
import assert from 'node:assert/strict';
import {validateAdditiveCutoverRenewalCatalogueV1} from './cutover-renewal-catalogue-v1.mjs';
import {validateImagePostEntryV2} from './post-operational-v2.mjs';

export function validatePostRenewalSourceV3({catalogue, generalRecord, objectiveId, dossier, source, action, now, readSource}) {
  const renewal = validateAdditiveCutoverRenewalCatalogueV1(catalogue, generalRecord, now);
  assert.equal(renewal.post.id, objectiveId, 'POST_V3_EXACT_NEW_OBJECTIVE_REQUIRED');
  assert.equal(source?.commit, renewal.post.driver.mergeCommit, 'POST_V3_PROTECTED_SOURCE_REQUIRED');
  validateImagePostEntryV2(renewal.post, {objectiveId, dossier, source, action, now, readSource});
  return Object.freeze({entry: renewal.post, nativeAuthority: false, runAuthorized: false});
}
