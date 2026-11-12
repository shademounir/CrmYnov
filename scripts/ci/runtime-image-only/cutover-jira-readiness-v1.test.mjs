import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {AUTH_JIRA_V2_KIND, AUTH_JIRA_NATIVE_READ_KIND, AUTH_JIRA_EXPECTED_BINDINGS, AUTH_JIRA_CONNECTION_ORIGIN, AUTH_JIRA_READ_TOOLS, AUTH_JIRA_TICKET_REQUEST, canonicalAuthJiraBytes} from '../pool-reconciliation/auth-only-jira-evidence-v2.mjs';
import {validateOperationalJiraComposedReadinessV1, validateOperationalJiraV2HumanScope, OPERATIONAL_JIRA_V2_HUMAN_SHA256} from './cutover-jira-readiness-v1.mjs';

const now = Date.parse('2026-11-12T12:00:00.000Z');
const instant = delta => new Date(now + delta).toISOString();
const hash = value => byteHash(canonicalAuthJiraBytes(value));
const human = fs.readFileSync(new URL('./fixtures/operational-jira-v2-human-scope-v1.json', import.meta.url));

function read(role, response, start, end) {
  const receipt = {
    schemaVersion: 2, kind: AUTH_JIRA_NATIVE_READ_KIND, role, ...AUTH_JIRA_READ_TOOLS[role], connectionOrigin: {...AUTH_JIRA_CONNECTION_ORIGIN},
    requestStartedAt: instant(start), responseReceivedAt: instant(end), request: role === 'ticket' ? structuredClone(AUTH_JIRA_TICKET_REQUEST) : {}, response,
    successfulRead: true, responseRepresentation: 'CONTENT_JSON', structuredContentReturned: false, providerInvocationId: null, providerContextAbsent: true,
    providerCryptographicSignatureAsserted: false, noCredentialsTokensCookiesOrHeadersStored: true,
  };
  return {receipt, receiptSha256: hash(receipt), requestSha256: hash(receipt.request), responseSha256: hash(receipt.response)};
}

function envelope() {
  return {
    schemaVersion: 2, kind: AUTH_JIRA_V2_KIND, mode: 'AUTH_ONLY', observedBy: 'shademounir', grantDigest: 'a'.repeat(64),
    localObservationId: 'local:67b13329-7bb5-4c3b-84ce-6ba129132688', localObservationIdOrigin: 'LOCAL_GENERATED_NOT_PROVIDER',
    providerInvocationId: null, providerContextAbsent: true, providerCryptographicSignatureAsserted: false,
    atomicProviderSnapshotAsserted: false, commonCredentialIdentityAsserted: false,
    identity: read('identity', {accountId: AUTH_JIRA_EXPECTED_BINDINGS.accountId}, -1000, -900),
    tenant: read('tenant', {resources: [{cloudId: AUTH_JIRA_EXPECTED_BINDINGS.cloudId, url: AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl}]}, -800, -700),
    ticket: read('ticket', {id: '10681', key: 'CRMY-63', issueType: 'Task', status: 'In Review', labels: ['codex-ready'], links: [{id: '11388', type: 'Blocks', inward: {key: 'CRMY-61', status: 'Done'}, outward: null}]}, -600, -500),
    expectedBindings: {...AUTH_JIRA_EXPECTED_BINDINGS}, oldestRequestStartedAt: instant(-1000), latestResponseReceivedAt: instant(-500),
    sourceReadinessOnly: true, notPersonalHumanApproval: true, noJiraMutation: true, businessMutationAuthorized: false,
    gcpResourceAccessAuthorized: false, runAuthorized: false, productionDeploymentAuthorized: false,
  };
}

function verify(value, scope, observedAt = now) {
  const jiraBytes = canonicalAuthJiraBytes(value);
  return validateOperationalJiraComposedReadinessV1({jiraBytes, expectedSha256: byteHash(jiraBytes), actor: 'shademounir', grantSha256: 'a'.repeat(64), now: observedAt, scope, humanScopeBytes: human});
}

await test('explicit human scope is hash-pinned without becoming native RUN authority', () => {
  assert.equal(byteHash(human), OPERATIONAL_JIRA_V2_HUMAN_SHA256);
  validateOperationalJiraV2HumanScope(human);
  assert.throws(() => validateOperationalJiraV2HumanScope(Buffer.from('{}')));
  for (const scope of ['GENERAL_PRE_READINESS', 'POST_READINESS']) {
    const result = verify(envelope(), scope);
    assert.equal(result.scope, scope);
    assert.equal(result.providerInvocationId, null);
    assert.equal(result.runAuthorized, false);
    assert.equal(result.nativeAuthority, false);
  }
});

await test('operational readiness refuses stale, mismatched, or broadened composed Jira reads', () => {
  assert.throws(() => verify(envelope(), 'RUN'));
  assert.throws(() => verify(envelope(), 'GENERAL_PRE_READINESS', now + 600000));
  const wrong = envelope(); wrong.identity.receipt.response.accountId = 'different';
  wrong.identity.responseSha256 = hash(wrong.identity.receipt.response); wrong.identity.receiptSha256 = hash(wrong.identity.receipt);
  assert.throws(() => verify(wrong, 'POST_READINESS'));
  const broad = envelope(); broad.runAuthorized = true;
  assert.throws(() => verify(broad, 'POST_READINESS'));
});
