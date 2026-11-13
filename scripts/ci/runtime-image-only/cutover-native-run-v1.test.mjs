import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fixture} from '../pool-reconciliation/tests/readonly-native-output-fixture-v1.mjs';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {AUTH_JIRA_V2_KIND, AUTH_JIRA_NATIVE_READ_KIND, AUTH_JIRA_EXPECTED_BINDINGS,
  AUTH_JIRA_CONNECTION_ORIGIN, AUTH_JIRA_READ_TOOLS, AUTH_JIRA_TICKET_REQUEST,
  canonicalAuthJiraBytes} from '../pool-reconciliation/auth-only-jira-evidence-v2.mjs';
import {executeCutoverNativeRunV1, openCutoverNativeRunJournalV1} from './cutover-native-run-v1.mjs';

const now = Date.parse('2026-11-13T12:00:00.000Z'), iso = offset => new Date(now + offset).toISOString();
const humanScopeBytes = fs.readFileSync(new URL('./fixtures/operational-jira-v2-human-scope-v1.json', import.meta.url));
const hash = value => byteHash(canonicalAuthJiraBytes(value));
function read(role, response, start, end) {
  const receipt = {schemaVersion: 2, kind: AUTH_JIRA_NATIVE_READ_KIND, role, ...AUTH_JIRA_READ_TOOLS[role],
    connectionOrigin: {...AUTH_JIRA_CONNECTION_ORIGIN}, requestStartedAt: iso(start), responseReceivedAt: iso(end),
    request: role === 'ticket' ? structuredClone(AUTH_JIRA_TICKET_REQUEST) : {}, response, successfulRead: true,
    responseRepresentation: 'CONTENT_JSON', structuredContentReturned: false, providerInvocationId: null,
    providerContextAbsent: true, providerCryptographicSignatureAsserted: false, noCredentialsTokensCookiesOrHeadersStored: true};
  return {receipt, receiptSha256: hash(receipt), requestSha256: hash(receipt.request), responseSha256: hash(receipt.response)};
}
function jiraBytes() {
  return canonicalAuthJiraBytes({schemaVersion: 2, kind: AUTH_JIRA_V2_KIND, mode: 'AUTH_ONLY', observedBy: 'shademounir',
    grantDigest: 'a'.repeat(64), localObservationId: 'local:67b13329-7bb5-4c3b-84ce-6ba129132688',
    localObservationIdOrigin: 'LOCAL_GENERATED_NOT_PROVIDER', providerInvocationId: null, providerContextAbsent: true,
    providerCryptographicSignatureAsserted: false, atomicProviderSnapshotAsserted: false,
    commonCredentialIdentityAsserted: false,
    identity: read('identity', {accountId: AUTH_JIRA_EXPECTED_BINDINGS.accountId}, -1000, -900),
    tenant: read('tenant', {resources: [{cloudId: AUTH_JIRA_EXPECTED_BINDINGS.cloudId, url: AUTH_JIRA_EXPECTED_BINDINGS.tenantUrl}]}, -800, -700),
    ticket: read('ticket', {id: '10681', key: 'CRMY-63', issueType: 'Task', status: 'In Review', labels: ['codex-ready'],
      links: [{id: '11388', type: 'Blocks', inward: {key: 'CRMY-61', status: 'Done'}, outward: null}]}, -600, -500),
    expectedBindings: {...AUTH_JIRA_EXPECTED_BINDINGS}, oldestRequestStartedAt: iso(-1000), latestResponseReceivedAt: iso(-500),
    sourceReadinessOnly: true, notPersonalHumanApproval: true, noJiraMutation: true,
    businessMutationAuthorized: false, gcpResourceAccessAuthorized: false, runAuthorized: false, productionDeploymentAuthorized: false});
}

function setup(t, phase, change = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cutover-run-synthetic-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const f = fixture('general'), job = structuredClone(f.job);
  job.executionCount = 0; delete job.latestCreatedExecution; job.etag = 'synthetic-etag';
  const bytes = jiraBytes(), objectiveId = phase === 'POST' ? 'rc48-general-post-synthetic-1' : 'rc48-general-operational-pre-v4-synthetic-1';
  const entry = {id: objectiveId, phase, scope: f.objective.purpose, job: f.objective.jobName,
    uid: job.uid, resourceBindingSha256: 'b'.repeat(64)};
  const calls = {get: 0, list: 0, run: 0}, native = {
    async getJob() {calls.get++; return structuredClone(job);},
    async listExecutions() {calls.list++; return [];},
    async run(name, etag, {onOperationReference}) {
      calls.run++; assert.equal(name, entry.job); assert.equal(etag, job.etag);
      const response = {name: 'projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/synthetic-1'};
      onOperationReference(response.name, 'c'.repeat(64)); return response;
    },
  };
  const authority = {phase, objectiveId, resourceBindingSha256: entry.resourceBindingSha256,
    jiraObservationSha256: byteHash(bytes), authorityRecordSha256: 'd'.repeat(64),
    runAuthorized: true, businessMutationAuthorized: false, maximumRunPosts: 1, actions: ['RUN'],
    markerCommentId: 123, validFrom: iso(-1000), expiresAt: iso(60000)};
  change({authority, native, job});
  const journal = openCutoverNativeRunJournalV1(dir), input = {phase, entry, dossier: f.dossier,
    jiraBytes: bytes, humanScopeBytes, actor: 'shademounir', grantSha256: 'a'.repeat(64),
    authorize: async () => authority, native, journal, clock: () => now};
  return {dir, calls, input};
}

for (const phase of ['GENERAL_PRE', 'POST']) {
  test(`${phase}: versioned native dispatch calls simulated run once and durably refuses replay`, async t => {
    const {dir, calls, input} = setup(t, phase);
    const result = await executeCutoverNativeRunV1(input);
    assert.equal(result.state, 'CUTOVER_NATIVE_RUN_OPERATION_KNOWN_V1');
    assert.equal(result.nativeOutputVerified, false); assert.equal(calls.run, 1);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['CLAIM.json', 'RUN-INTENT.json', 'RUN-OPERATION.json']);
    await assert.rejects(executeCutoverNativeRunV1(input), /NATIVE_PHASE_ALREADY_CONSUMED/u);
    assert.equal(calls.run, 1);
  });
  test(`${phase}: proof only, crossed authority, expiry and prior execution refuse before native run`, async t => {
    for (const change of [({authority}) => {authority.runAuthorized = false;},
      ({authority}) => {authority.phase = phase === 'POST' ? 'GENERAL_PRE' : 'POST';},
      ({authority}) => {authority.expiresAt = iso(-1);},
      ({job}) => {job.executionCount = 1;}]) {
      const {calls, input} = setup(t, phase, change);
      await assert.rejects(executeCutoverNativeRunV1(input));
      assert.equal(calls.run, 0);
    }
  });
}
