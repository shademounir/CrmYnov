import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {
  AUTH_JIRA_V2_KIND, AUTH_JIRA_NATIVE_READ_KIND, AUTH_JIRA_EXPECTED_BINDINGS,
  AUTH_JIRA_CONNECTION_ORIGIN, AUTH_JIRA_READ_TOOLS, AUTH_JIRA_TICKET_REQUEST,
  canonicalAuthJiraBytes,
} from '../pool-reconciliation/auth-only-jira-evidence-v2.mjs';
import {runCutoverNativePhaseBoundaryV1} from './cutover-native-phase-boundary-v1.mjs';

const now = Date.parse('2026-11-13T12:00:00.000Z');
const iso = offset => new Date(now + offset).toISOString();
const hash = value => byteHash(canonicalAuthJiraBytes(value));
const humanScopeBytes = fs.readFileSync(new URL('./fixtures/operational-jira-v2-human-scope-v1.json', import.meta.url));
const objective = {
  GENERAL_PRE: 'rc48-general-operational-pre-v4-synthetic-1',
  POST: 'rc48-general-post-synthetic-1',
};

function read(role, response, start, end) {
  const receipt = {
    schemaVersion: 2, kind: AUTH_JIRA_NATIVE_READ_KIND, role, ...AUTH_JIRA_READ_TOOLS[role],
    connectionOrigin: {...AUTH_JIRA_CONNECTION_ORIGIN}, requestStartedAt: iso(start), responseReceivedAt: iso(end),
    request: role === 'ticket' ? structuredClone(AUTH_JIRA_TICKET_REQUEST) : {}, response,
    successfulRead: true, responseRepresentation: 'CONTENT_JSON', structuredContentReturned: false,
    providerInvocationId: null, providerContextAbsent: true,
    providerCryptographicSignatureAsserted: false, noCredentialsTokensCookiesOrHeadersStored: true,
  };
  return {receipt, receiptSha256: hash(receipt), requestSha256: hash(receipt.request), responseSha256: hash(receipt.response)};
}

function jiraBytes() {
  return canonicalAuthJiraBytes({
    schemaVersion: 2, kind: AUTH_JIRA_V2_KIND, mode: 'AUTH_ONLY', observedBy: 'shademounir', grantDigest: 'a'.repeat(64),
    localObservationId: 'local:67b13329-7bb5-4c3b-84ce-6ba129132688', localObservationIdOrigin: 'LOCAL_GENERATED_NOT_PROVIDER',
    providerInvocationId: null, providerContextAbsent: true, providerCryptographicSignatureAsserted: false,
    atomicProviderSnapshotAsserted: false, commonCredentialIdentityAsserted: false,
    identity: read('identity', {accountId: AUTH_JIRA_EXPECTED_BINDINGS.accountId}, -1000, -900),
    tenant: read('tenant', {resources: [{cloudId: AUTH_JIRA_EXPECTED_BINDINGS.cloudId, url: AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl}]}, -800, -700),
    ticket: read('ticket', {id: '10681', key: 'CRMY-63', issueType: 'Task', status: 'In Review', labels: ['codex-ready'], links: [{id: '11388', type: 'Blocks', inward: {key: 'CRMY-61', status: 'Done'}, outward: null}]}, -600, -500),
    expectedBindings: {...AUTH_JIRA_EXPECTED_BINDINGS}, oldestRequestStartedAt: iso(-1000), latestResponseReceivedAt: iso(-500),
    sourceReadinessOnly: true, notPersonalHumanApproval: true, noJiraMutation: true, businessMutationAuthorized: false,
    gcpResourceAccessAuthorized: false, runAuthorized: false, productionDeploymentAuthorized: false,
  });
}

function harness(phase) {
  const bytes = jiraBytes();
  const calls = {authorize: 0, preflight: 0, arm: 0, transport: 0};
  let consumed = false, time = now;
  const authority = {
    phase, objectiveId: objective[phase], resourceBindingSha256: 'b'.repeat(64),
    jiraObservationSha256: byteHash(bytes), authorityRecordSha256: 'c'.repeat(64),
    runAuthorized: true, businessMutationAuthorized: false, maximumRunPosts: 1,
    actions: ['RUN'], markerCommentId: 123, validFrom: iso(-3000), expiresAt: iso(300000),
  };
  const input = {
    phase, objectiveId: objective[phase], resourceBindingSha256: 'b'.repeat(64),
    jiraBytes: bytes, humanScopeBytes, actor: 'shademounir', grantSha256: 'a'.repeat(64),
    clock: () => time,
    async authorize() {calls.authorize++; return authority;},
    async claimExists() {return consumed;},
    async preflight() {calls.preflight++; return {etag: 'synthetic-etag'};},
    async arm() {calls.arm++; assert.equal(consumed, false); consumed = true;},
    async transport() {calls.transport++; return {state: 'SYNTHETIC_TRANSPORT_REACHED', phase};},
  };
  return {input, authority, calls, expire: () => {time = now + 600000;}, consume: () => {consumed = true;}};
}

for (const phase of ['GENERAL_PRE', 'POST']) {
  test(`${phase}: final boundary accepts own fresh RUN authority and reaches transport once`, async () => {
    const h = harness(phase);
    assert.deepEqual(await runCutoverNativePhaseBoundaryV1(h.input), {state: 'SYNTHETIC_TRANSPORT_REACHED', phase});
    assert.deepEqual(h.calls, {authorize: 1, preflight: 1, arm: 1, transport: 1});
    await assert.rejects(runCutoverNativePhaseBoundaryV1(h.input), /NATIVE_PHASE_ALREADY_CONSUMED/u);
    assert.deepEqual(h.calls, {authorize: 1, preflight: 1, arm: 1, transport: 1});
  });

  test(`${phase}: Jira readiness alone, crossed authority, expiry and prior claim refuse before transport`, async () => {
    const only = harness(phase); only.authority.runAuthorized = false;
    await assert.rejects(runCutoverNativePhaseBoundaryV1(only.input), /NATIVE_PHASE_RUN_AUTHORITY_REQUIRED/u);
    assert.equal(only.calls.arm, 0); assert.equal(only.calls.transport, 0);

    const crossed = harness(phase); crossed.authority.phase = phase === 'POST' ? 'GENERAL_PRE' : 'POST';
    await assert.rejects(runCutoverNativePhaseBoundaryV1(crossed.input), /NATIVE_PHASE_AUTHORITY_CROSSED/u);
    assert.equal(crossed.calls.arm, 0); assert.equal(crossed.calls.transport, 0);

    const stale = harness(phase); stale.expire();
    await assert.rejects(runCutoverNativePhaseBoundaryV1(stale.input));
    assert.deepEqual(stale.calls, {authorize: 0, preflight: 0, arm: 0, transport: 0});

    const replay = harness(phase); replay.consume();
    await assert.rejects(runCutoverNativePhaseBoundaryV1(replay.input), /NATIVE_PHASE_ALREADY_CONSUMED/u);
    assert.deepEqual(replay.calls, {authorize: 0, preflight: 0, arm: 0, transport: 0});
  });
}
