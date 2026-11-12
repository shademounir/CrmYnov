// Versioned in-process comparator for the new V4 GENERAL capability. It
// reuses the unchanged V2 semantic comparison, never serializing plaintext.
import assert from 'node:assert/strict';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {validateProspectiveConsumerInputs} from '../pool-reconciliation/general-prospective-pre-session-v1.mjs';
import {withVerifiedGeneralPreV4} from '../pool-reconciliation/general-operational-pre-v4.mjs';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {composeProspectiveGeneralPermissionBaseline} from './prospective-permissions.mjs';
import {compareVerifiedGeneralPostV2} from './post-preservation-v2.mjs';

const HASH = /^[a-f0-9]{64}$/u;

function jsonRef(ref) {
  assert(ref && typeof ref.path === 'string' && ref.path.endsWith('.json') && HASH.test(ref.sha256));
  const bytes = readPoolPrivateFile(ref.path);
  assert(bytes.length <= 1048576 && byteHash(bytes) === ref.sha256, 'PRIVATE_PRE_V4_REFERENCE_BYTES_CHANGED');
  return JSON.parse(bytes);
}

export async function compareImagePostUsingPrivateGeneralV3({privatePreCapability, postChecked, consumerInputs, expectedGeneralAuthorityRecordSha256, postCapturedAt, afterImageObservedAt, now}) {
  validateProspectiveConsumerInputs(consumerInputs);
  assert(HASH.test(expectedGeneralAuthorityRecordSha256));
  return withVerifiedGeneralPreV4(privatePreCapability, ({checked: preChecked, sourceProofRef, capturedAt}) => {
    const proof = jsonRef(sourceProofRef);
    assert.equal(proof.kind, 'VERIFIED_OPERATIONAL_GENERAL_PRE_V3');
    assert.equal(proof.authorityRecordSha256, expectedGeneralAuthorityRecordSha256, 'PRIVATE_PRE_V4_AUTHORITY_CHANGED');
    const capture = jsonRef(proof.nativeCapture);
    assert.equal(capture.kind, 'VERIFIED-NEW-ENCRYPTED-OUTPUT');
    assert.equal(capture.metadataSha256, preChecked.metadataSha256);
    assert.equal(capture.sealedOutputSha256, preChecked.sealedOutputSha256);
    assert.equal(capture.transactionCompletedAt, preChecked.output.observation.transactionCompletedAt);
    const {baselineSha256, cutoverIndexSha256, ...bindings} = CONSUMER_PINS;
    const composed = composeProspectiveGeneralPermissionBaseline({historicalBaseline: JSON.parse(consumerInputs.historicalBaselineBytes), observedPermissions: preChecked.output.observation.snapshot.permissions, evidence: consumerInputs.evidence, bindings});
    return compareVerifiedGeneralPostV2({preChecked, postChecked, baseline: composed.baseline, preSourceProofRef: sourceProofRef, preCapturedAt: capturedAt, postCapturedAt, afterImageObservedAt, now});
  });
}
