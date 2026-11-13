// Versioned use of the existing AUTH_ONLY composed *readiness* evidence for
// GENERAL PRE and POST. This does not re-label the original envelope, invent
// a provider invocation ID, or grant native RUN/deployment authority.
import assert from 'node:assert/strict';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {validateAuthOnlyComposedJiraObservation} from '../pool-reconciliation/auth-only-jira-evidence-v2.mjs';

export const OPERATIONAL_JIRA_V2_HUMAN_SHA256 = 'a6841d98791e159a5fc8adea4394f50ec7ba1089ffa1202fff0a34e774c68921';
const scopes = new Set(['GENERAL_PRE_READINESS', 'POST_READINESS']);

export function validateOperationalJiraV2HumanScope(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length <= 65536 && byteHash(bytes) === OPERATIONAL_JIRA_V2_HUMAN_SHA256, 'EXACT_OPERATIONAL_JIRA_V2_HUMAN_SCOPE_REQUIRED');
  const value = JSON.parse(bytes);
  assert.equal(value.kind, 'DIRECT_HUMAN_JIRA_V2_GENERAL_POST_READINESS_EXTENSION_V1');
  assert.equal(value.answer, 'Autoriser cette extension ciblée');
  assert.deepEqual(value.permittedUse, ['GENERAL_PRE_READINESS', 'POST_READINESS']);
  assert.equal(value.providerInvocationId, null);
  assert.equal(value.providerSignatureAsserted, false);
  assert.equal(value.commonProviderSnapshotAsserted, false);
  assert.equal(value.jiraReadinessIsNotRunAuthority, true);
  assert.equal(value.productionRunOrDeploymentAuthorityAddedByThisReceipt, false);
  return value;
}

export function validateOperationalJiraComposedReadinessV1({jiraBytes, expectedSha256, actor, grantSha256, now, scope, humanScopeBytes}) {
  assert(scopes.has(scope), 'OPERATIONAL_JIRA_V2_SCOPE_REFUSED');
  validateOperationalJiraV2HumanScope(humanScopeBytes);
  const observed = validateAuthOnlyComposedJiraObservation(jiraBytes, {expectedSha256, actor, grantSha256, now});
  assert.equal(observed.providerInvocationId, null);
  assert.equal(observed.runAuthorized, false);
  assert.equal(observed.gcpResourceAccessAuthorized, false);
  assert.equal(observed.productionDeploymentAuthorized, false);
  return Object.freeze({
    schemaVersion: 1,
    kind: 'OPERATIONAL_JIRA_COMPOSED_SOURCE_READINESS_V1',
    scope,
    sourceEvidenceKind: observed.kind,
    sourceEvidenceSha256: expectedSha256,
    observedAt: observed.observedAt,
    expiresAt: observed.expiresAt,
    accountId: observed.accountId,
    cloudId: observed.cloudId,
    ticket: observed.ticket,
    providerInvocationId: null,
    localObservationId: observed.localObservationId,
    localObservationIdOrigin: 'LOCAL_GENERATED_NOT_PROVIDER',
    atomicProviderSnapshotAsserted: false,
    sourceReadinessOnly: true,
    runAuthorized: false,
    productionDeploymentAuthorized: false,
    nativeAuthority: false,
  });
}
