import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {simulateOperationalDriverV4} from '../operational-driver-v4.mjs';
import {validateCutoverNativeHostV1} from './cutover-native-cli-v1.mjs';
import {buildReadOnlyJobDossier, READONLY_RUNTIME_FILES} from '../pool-reconciliation/pool-job-dossier-v1.mjs';
import {poolPrivateNetwork} from '../pool-reconciliation/pool-native-output-v1.mjs';
import {readOnlyDatabaseBinding} from '../pool-reconciliation/readonly-runtime-entry-v1.mjs';
import {QUERY_CONTRACT_SHA256} from '../pool-reconciliation/general-preservation-read-only-collector-v1.mjs';
import {keys} from '../pool-reconciliation/tests/readonly-native-output-fixture-v1.mjs';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {AUTH_JIRA_V2_KIND, AUTH_JIRA_NATIVE_READ_KIND, AUTH_JIRA_EXPECTED_BINDINGS,
  AUTH_JIRA_CONNECTION_ORIGIN, AUTH_JIRA_READ_TOOLS, AUTH_JIRA_TICKET_REQUEST,
  canonicalAuthJiraBytes} from '../pool-reconciliation/auth-only-jira-evidence-v2.mjs';
import {READONLY_CATALOGUE_PATH_V2} from './catalogue-origin-v2.mjs';

const now = Date.parse('2026-11-13T12:00:00.000Z'), iso = offset => new Date(now + offset).toISOString();
const H = 'a'.repeat(64), S = 'b'.repeat(40);
const historical = JSON.parse(fs.readFileSync(new URL('../../../docs/governance/runtime-image-only-objectives-v1.json', import.meta.url)));
const pinned = historical.entries.find(row => row.id === 'rc48-image-only-inventory-20261109-v5-renewal-v4').driver;
const pinnedAdapter = JSON.parse(fs.readFileSync(new URL('./fixtures/pr294-adapter-source-closure-v1.json', import.meta.url)));
const hash = value => byteHash(canonicalAuthJiraBytes(value));

test('native host pin refuses a different Node, a Node override or ambient Git override', () => {
  validateCutoverNativeHostV1({nodeVersion: '22.23.3', environment: {}});
  assert.throws(() => validateCutoverNativeHostV1({nodeVersion: '22.23.4', environment: {}}), /CUTOVER_NATIVE_NODE_PIN/u);
  assert.throws(() => validateCutoverNativeHostV1({nodeVersion: '22.23.3', environment: {NODE_OPTIONS: '--inspect'}}), /CUTOVER_NATIVE_NODE_OVERRIDE_REFUSED/u);
  assert.throws(() => validateCutoverNativeHostV1({nodeVersion: '22.23.3', environment: {GIT_PAGER: 'cat'}}), /CUTOVER_NATIVE_GIT_OVERRIDE_REFUSED/u);
});
const human = fs.readFileSync(new URL('./fixtures/operational-jira-v2-human-scope-v1.json', import.meta.url));
function read(role, response, start, end) {
  const receipt = {schemaVersion: 2, kind: AUTH_JIRA_NATIVE_READ_KIND, role, ...AUTH_JIRA_READ_TOOLS[role],
    connectionOrigin: {...AUTH_JIRA_CONNECTION_ORIGIN}, requestStartedAt: iso(start), responseReceivedAt: iso(end),
    request: role === 'ticket' ? structuredClone(AUTH_JIRA_TICKET_REQUEST) : {}, response,
    successfulRead: true, responseRepresentation: 'CONTENT_JSON', structuredContentReturned: false,
    providerInvocationId: null, providerContextAbsent: true, providerCryptographicSignatureAsserted: false,
    noCredentialsTokensCookiesOrHeadersStored: true};
  return {receipt, receiptSha256: hash(receipt), requestSha256: hash(receipt.request), responseSha256: hash(receipt.response)};
}
function jira() {
  return canonicalAuthJiraBytes({schemaVersion: 2, kind: AUTH_JIRA_V2_KIND, mode: 'AUTH_ONLY', observedBy: 'shademounir',
    grantDigest: H, localObservationId: 'local:67b13329-7bb5-4c3b-84ce-6ba129132688',
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
const files = list => list.map(name => ({path: name, sha256: H}));
const runnerFiles = files(['scripts/ci/operational-driver-v4.mjs',
  'scripts/ci/runtime-image-only/cutover-native-authority-v1.mjs',
  'scripts/ci/runtime-image-only/cutover-native-cli-v1.mjs',
  'scripts/ci/runtime-image-only/cutover-native-phase-boundary-v1.mjs',
  'scripts/ci/runtime-image-only/cutover-native-run-v1.mjs',
  'scripts/ci/runtime-image-only/cutover-protected-source-v1.mjs']);
function descriptor(pr, mergeCommit, tree, paths) {return {pr, head: S, mergeCommit, tree, files: paths};}

function setup(t, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cutover-cli-synthetic-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  for (const name of ['journal', 'driver', 'adapter', 'runner']) fs.mkdirSync(path.join(dir, name));
  const phase = mode === 'post-v4' ? 'POST' : 'GENERAL_PRE';
  const jobName = `crm-prod-preservation-${phase === 'POST' ? 'post' : 'pre'}-synthetic`;
  const sources = Object.fromEntries(Object.entries(READONLY_RUNTIME_FILES).map(([name, file]) =>
    [name, fs.readFileSync(new URL('../pool-reconciliation/' + file, import.meta.url), 'utf8')]));
  const request = {schemaVersion: 1, purpose: 'GENERAL_PRESERVATION_READ_ONLY_V1', phase: 'PRE',
    queryContractSha256: QUERY_CONTRACT_SHA256, campusId: '11111111-1111-4111-8111-111111111111'};
  const dossier = buildReadOnlyJobDossier({sources, request, jobName, nonce: H,
    databaseBindingSha256: readOnlyDatabaseBinding('postgresql://crm_runtime:synthetic@synthetic.invalid:5432/crmynov_prod', request.purpose),
    publicKeyPem: keys.publicKey, networkBinding: poolPrivateNetwork(), databaseSecretVersion: '1', intentAt: iso(-10000)});
  const job = {name: dossier.objective.jobName, uid: '6333afa0-3af3-4916-9aa1-e1093ce0bea0',
    labels: dossier.job.labels, template: dossier.job.template, executionCount: 0, etag: 'synthetic-etag'};
  const id = phase === 'POST' ? 'rc48-general-post-synthetic-1' : 'rc48-general-operational-pre-v4-synthetic-1';
  const binding = {job: job.name, uid: job.uid, purpose: request.purpose, taskCount: 1, parallelism: 1};
  const entry = {schemaVersion: 1, id, status: 'approved', phase, scope: request.purpose,
    project: 'crmynov-prod-n7x4q2', region: 'europe-west1', job: job.name, uid: job.uid,
    ticket: 'CRMY-63', googleAccount: 'casablancaynovcampus@gmail.com',
    driver: {pr: pinned.pr, head: pinned.head, mergeCommit: pinned.mergeCommit, tree: pinned.tree, files: pinned.files},
    adapter: structuredClone(pinnedAdapter),
    runner: descriptor(295, 'd'.repeat(40), 'e'.repeat(40), runnerFiles),
    objectiveReview: {kind: 'PROTECTED_CATALOGUE_PATH_HISTORY', path: READONLY_CATALOGUE_PATH_V2},
    resourceBinding: binding, resourceBindingSha256: digest(binding),
    dossierSha256: digest(dossier), journalDirectorySha256: byteHash(path.join(dir, 'journal')),
    validFrom: iso(-1000), expiresAt: iso(60000), actions: ['RUN'], maximumRunPosts: 1,
    runAuthorized: true, businessMutationAuthorized: false, jiraEvidenceVersion: 2};
  const paths = {objective: path.join(dir, 'objective.json'), dossier: path.join(dir, 'dossier.json'),
    jira: path.join(dir, 'jira.json'), human: path.join(dir, 'human.json')};
  fs.writeFileSync(paths.objective, JSON.stringify(entry)); fs.writeFileSync(paths.dossier, JSON.stringify(dossier));
  const jiraBytes = jira(); fs.writeFileSync(paths.jira, jiraBytes); fs.writeFileSync(paths.human, human);
  const args = ['image-only', mode, '--objective-id', id, '--objective-file', paths.objective,
    '--dossier', paths.dossier, '--jira-evidence', paths.jira, '--human-scope', paths.human,
    '--actor', 'shademounir', '--grant-digest', H, '--driver-root', path.join(dir, 'driver'),
    '--adapter-root', path.join(dir, 'adapter'), '--runner-root', path.join(dir, 'runner'), '--journal-dir', path.join(dir, 'journal')];
  const calls = {run: 0}, dependencies = {clock: () => now,
    readSource: (root, source) => ({commit: source.mergeCommit, tree: source.tree, head: source.head,
      pr: source.pr, files: source.files, clean: true}),
    authorize: async () => ({phase, objectiveId: id, resourceBindingSha256: entry.resourceBindingSha256,
      jiraObservationSha256: byteHash(jiraBytes), authorityRecordSha256: H, runAuthorized: true,
      businessMutationAuthorized: false, maximumRunPosts: 1, actions: ['RUN'], markerCommentId: 123,
      validFrom: iso(-1000), expiresAt: iso(60000)}),
    native: {async getJob() {return structuredClone(job);}, async listExecutions() {return [];},
      async run(name, etag, {onOperationReference}) {calls.run++; assert.equal(name, job.name); assert.equal(etag, job.etag);
        const response = {name: 'projects/crmynov-prod-n7x4q2/locations/europe-west1/operations/synthetic-1'};
        onOperationReference(response.name, H); return response;}}};
  return {args, dependencies, calls, dir, entry};
}

for (const mode of ['general-pre-v4', 'post-v4']) {
  test(`${mode}: exact final command route reaches the simulated native run once`, async t => {
    const f = setup(t, mode);
    const result = await simulateOperationalDriverV4({syntheticOnly: true, args: f.args, dependencies: f.dependencies});
    assert.equal(result.state, 'CUTOVER_NATIVE_RUN_OPERATION_KNOWN_V1');
    assert.equal(result.syntheticOnly, true); assert.equal(result.nativeAuthority, false);
    assert.equal(f.calls.run, 1);
    await assert.rejects(simulateOperationalDriverV4({syntheticOnly: true, args: f.args, dependencies: f.dependencies}));
    assert.equal(f.calls.run, 1);
  });
  test(`${mode}: final command refuses readiness-only, crossed, expired authority before transport`, async t => {
    for (const change of [authority => {authority.runAuthorized = false;},
      authority => {authority.phase = authority.phase === 'POST' ? 'GENERAL_PRE' : 'POST';},
      authority => {authority.expiresAt = iso(-1); }]) {
      const f = setup(t, mode), base = await f.dependencies.authorize(); change(base);
      f.dependencies.authorize = async () => base;
      await assert.rejects(simulateOperationalDriverV4({syntheticOnly: true, args: f.args, dependencies: f.dependencies}));
      assert.equal(f.calls.run, 0);
    }
  });
}
