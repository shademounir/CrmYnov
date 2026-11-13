import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {grantDigest} from '../../pr-policy/delegation.mjs';
import {READONLY_CATALOGUE_PATH_V2} from './catalogue-origin-v2.mjs';
import {makeCutoverNativeMarkerV1, validateCutoverNativeObjectiveV1, validateCutoverNativeMarkerV1} from './cutover-native-authority-v1.mjs';

const now = Date.parse('2026-11-13T12:00:00.000Z');
const iso = offset => new Date(now + offset).toISOString();
const H = 'a'.repeat(64);
const historical = JSON.parse(fs.readFileSync(new URL('../../../docs/governance/runtime-image-only-objectives-v1.json', import.meta.url)));
const pinned = historical.entries.find(row => row.id === 'rc48-image-only-inventory-20261109-v5-renewal-v4').driver;
const driver = {pr: pinned.pr, head: pinned.head, mergeCommit: pinned.mergeCommit, tree: pinned.tree, files: pinned.files};
const adapter = JSON.parse(fs.readFileSync(new URL('./fixtures/pr294-adapter-source-closure-v1.json', import.meta.url)));
const runner = {pr: 295, head: 'c'.repeat(40), mergeCommit: 'd'.repeat(40), tree: 'e'.repeat(40),
  files: [
    {path: 'scripts/ci/operational-driver-v4.mjs', sha256: H},
    {path: 'scripts/ci/runtime-image-only/cutover-native-authority-v1.mjs', sha256: H},
    {path: 'scripts/ci/runtime-image-only/cutover-native-cli-v1.mjs', sha256: H},
    {path: 'scripts/ci/runtime-image-only/cutover-native-phase-boundary-v1.mjs', sha256: H},
    {path: 'scripts/ci/runtime-image-only/cutover-native-run-v1.mjs', sha256: H},
    {path: 'scripts/ci/runtime-image-only/cutover-protected-source-v1.mjs', sha256: H},
  ]};
const grant = {authenticatedActors: ['shademounir'], id: 'crm-ynov-po-delegation-20261001'};

function entry(phase) {
  const job = `projects/crmynov-prod-n7x4q2/locations/europe-west1/jobs/crm-prod-preservation-${phase === 'POST' ? 'post' : 'pre'}-synthetic-1`;
  const uid = '6333afa0-3af3-4916-9aa1-e1093ce0bea0';
  const resourceBinding = {job, uid, purpose: 'GENERAL_PRESERVATION_READ_ONLY_V1', taskCount: 1, parallelism: 1};
  return {schemaVersion: 1, id: phase === 'POST' ? 'rc48-general-post-synthetic-1' : 'rc48-general-operational-pre-v4-synthetic-1',
    status: 'approved', phase, scope: 'GENERAL_PRESERVATION_READ_ONLY_V1', project: 'crmynov-prod-n7x4q2', region: 'europe-west1',
    job, uid, ticket: 'CRMY-63', googleAccount: 'casablancaynovcampus@gmail.com',
    driver: structuredClone(driver), adapter: structuredClone(adapter), runner: structuredClone(runner),
    objectiveReview: {kind: 'PROTECTED_CATALOGUE_PATH_HISTORY', path: READONLY_CATALOGUE_PATH_V2},
    resourceBinding, resourceBindingSha256: digest(resourceBinding), journalDirectorySha256: H, dossierSha256: H, validFrom: iso(-3000), expiresAt: iso(300000),
    actions: ['RUN'], maximumRunPosts: 1, runAuthorized: true, businessMutationAuthorized: false, jiraEvidenceVersion: 2};
}

function marker(entryValue, change = value => value) {
  const value = change({schemaVersion: 1, executor: 'Codex', phase: entryValue.phase, objectiveId: entryValue.id,
    entrySha256: digest(entryValue), resourceBindingSha256: entryValue.resourceBindingSha256,
    driverCommit: entryValue.driver.mergeCommit, adapterCommit: entryValue.adapter.mergeCommit,
    runnerCommit: entryValue.runner.mergeCommit, grantDigest: grantDigest(grant), jiraEvidenceVersion: 2,
    jiraObservationSha256: H, actions: ['RUN'], maximumRunPosts: 1, runAuthorized: true, businessMutationAuthorized: false,
    expiresAt: iso(120000)});
  return [{id: 123, user: {login: 'shademounir', type: 'User'}, created_at: iso(-1000),
    body: `<!-- codex-cutover-native-run-authorization:v1 ${JSON.stringify(value)} -->`}];
}

for (const phase of ['GENERAL_PRE', 'POST']) {
  test(`${phase}: own objective and exact marker accepted`, () => {
    const value = entry(phase);
    validateCutoverNativeObjectiveV1(value, {phase, objectiveId: value.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: value.uid, now});
    const result = validateCutoverNativeMarkerV1(marker(value), {entry: value, grant, jiraSha256: H, now});
    assert.equal(result.commentId, 123);
    const generated = makeCutoverNativeMarkerV1({entry: value, grant, jiraObservationSha256: H, expiresAt: iso(120000)});
    assert.equal(generated, marker(value)[0].body);
  });

  test(`${phase}: crossed, stale or broadened objective and marker refused`, () => {
    const value = entry(phase), other = phase === 'POST' ? 'GENERAL_PRE' : 'POST';
    assert.throws(() => validateCutoverNativeObjectiveV1(value, {phase: other, objectiveId: value.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: value.uid, now}));
    assert.throws(() => validateCutoverNativeObjectiveV1(value, {phase, objectiveId: value.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: value.uid, now: now + 300000}));
    const broad = structuredClone(value); broad.actions = ['RUN', 'CREATE'];
    assert.throws(() => validateCutoverNativeObjectiveV1(broad, {phase, objectiveId: broad.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: value.uid, now}));
    const incomplete = structuredClone(value); delete incomplete.runAuthorized;
    assert.throws(() => validateCutoverNativeObjectiveV1(incomplete, {phase, objectiveId: value.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: value.uid, now}));
    const modifiedClosure = structuredClone(value); modifiedClosure.driver.files[0].sha256 = H;
    assert.throws(() => validateCutoverNativeObjectiveV1(modifiedClosure, {phase, objectiveId: value.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: value.uid, now}));
    assert.throws(() => validateCutoverNativeObjectiveV1(value, {phase, objectiveId: value.id, resourceBindingSha256: value.resourceBindingSha256, expectedJob: value.job, expectedUid: '0'.repeat(36), now}));
    assert.throws(() => validateCutoverNativeMarkerV1(marker(value, m => ({...m, phase: other})), {entry: value, grant, jiraSha256: H, now}));
    assert.throws(() => validateCutoverNativeMarkerV1(marker(value, m => ({...m, jiraEvidenceVersion: 1})), {entry: value, grant, jiraSha256: H, now}));
    assert.throws(() => validateCutoverNativeMarkerV1(marker(value, m => ({...m, runAuthorized: false})), {entry: value, grant, jiraSha256: H, now}));
    assert.throws(() => validateCutoverNativeMarkerV1(marker(value), {entry: value, grant, jiraSha256: H, now: now + 120000}));
  });
}
