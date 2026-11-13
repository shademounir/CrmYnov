// Versioned RUN authority for the new GENERAL PRE and POST entrypoints only.
// Jira V2 is independently checked as readiness; this module requires a
// protected objective and a fresh, phase-specific official GitHub marker.
import assert from 'node:assert/strict';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {githubFile} from '../readonly-probe/probe-driver-authority-v1.mjs';
import {GRANT_PATH, grantDigest, validateGrant} from '../../pr-policy/delegation.mjs';
import {GITHUB_CODE_REVIEW_POLICY_PATH, validateProtectedCodeReviewPolicy} from '../../pr-policy/github-code-review.mjs';
import {approvedMerge, verifySource} from './protected-gates.mjs';
import {READONLY_CATALOGUE_PATH_V2, resolveImageCatalogueReviewV2, validateImageCatalogueReviewV2} from './catalogue-origin-v2.mjs';
import {validateOperationalJiraComposedReadinessV1} from './cutover-jira-readiness-v1.mjs';

const REPO = 'shademounir/CrmYnov';
const API = `/repos/${REPO}/`;
const MARKER = '<!-- codex-cutover-native-run-authorization:v1';
const H = /^[a-f0-9]{64}$/u, S = /^[a-f0-9]{40}$/u;
const scopes = Object.freeze({GENERAL_PRE: 'GENERAL_PRE_READINESS', POST: 'POST_READINESS'});
const jobs = Object.freeze({GENERAL_PRE: /^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/jobs\/crm-prod-preservation-pre-[a-z0-9-]+$/u,
  POST: /^projects\/crmynov-prod-n7x4q2\/locations\/europe-west1\/jobs\/crm-prod-preservation-post-[a-z0-9-]+$/u});
const objective = Object.freeze({GENERAL_PRE: /^rc48-general-operational-pre-v4-[a-z0-9-]{8,63}$/u,
  POST: /^rc48-general-post-[a-z0-9-]{8,63}$/u});

export function makeCutoverNativeMarkerV1({entry, grant, jiraObservationSha256, expiresAt}) {
  assert(H.test(jiraObservationSha256), 'CUTOVER_AUTHORITY_JIRA_HASH');
  time(expiresAt);
  const payload = {schemaVersion: 1, executor: 'Codex', phase: entry.phase,
    objectiveId: entry.id, entrySha256: digest(entry), resourceBindingSha256: entry.resourceBindingSha256,
    driverCommit: entry.driver.mergeCommit, adapterCommit: entry.adapter.mergeCommit,
    runnerCommit: entry.runner.mergeCommit, grantDigest: grantDigest(grant), jiraEvidenceVersion: 2,
    jiraObservationSha256, actions: ['RUN'], maximumRunPosts: 1,
    runAuthorized: true, businessMutationAuthorized: false, expiresAt};
  return `<!-- codex-cutover-native-run-authorization:v1 ${JSON.stringify(payload)} -->`;
}

function exact(value, keys) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, 'CUTOVER_AUTHORITY_PLAIN_OBJECT');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'CUTOVER_AUTHORITY_EXACT_FIELDS');
}
function time(value) {
  assert.equal(typeof value, 'string');
  const n = Date.parse(value);
  assert(Number.isSafeInteger(n) && new Date(n).toISOString() === value, 'CUTOVER_AUTHORITY_CANONICAL_TIME');
  return n;
}
function descriptor(value) {
  exact(value, ['pr', 'head', 'mergeCommit', 'tree', 'files']);
  assert(Number.isSafeInteger(value.pr) && value.pr > 0 && S.test(value.head) && S.test(value.mergeCommit) && S.test(value.tree), 'CUTOVER_AUTHORITY_SOURCE');
  assert(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 250, 'CUTOVER_AUTHORITY_SOURCE_FILES');
  const names = value.files.map(file => {
    exact(file, ['path', 'sha256']);
    assert(/^(?:scripts|docs)\/[a-zA-Z0-9_./-]+\.(?:mjs|json|yml|md)$/u.test(file.path) && !file.path.includes('..') && H.test(file.sha256), 'CUTOVER_AUTHORITY_FILE');
    return file.path;
  });
  assert.deepEqual(names, [...new Set(names)].sort((a, b) => a.localeCompare(b, 'en')), 'CUTOVER_AUTHORITY_FILE_ORDER');
}

export function validateCutoverNativeObjectiveV1(entry, {phase, objectiveId, resourceBindingSha256, expectedJob, expectedUid, now}) {
  exact(entry, ['schemaVersion', 'id', 'status', 'phase', 'scope', 'project', 'region', 'job', 'uid', 'ticket',
    'googleAccount', 'driver', 'adapter', 'runner', 'objectiveReview', 'resourceBinding', 'resourceBindingSha256', 'journalDirectorySha256', 'dossierSha256',
    'validFrom', 'expiresAt', 'actions', 'maximumRunPosts', 'runAuthorized', 'businessMutationAuthorized', 'jiraEvidenceVersion']);
  assert.equal(entry.schemaVersion, 1); assert.equal(entry.id, objectiveId); assert.equal(entry.status, 'approved');
  assert(Object.hasOwn(scopes, phase) && objective[phase].test(objectiveId), 'CUTOVER_AUTHORITY_OBJECTIVE');
  assert.equal(entry.phase, phase, 'CUTOVER_AUTHORITY_PHASE_CROSSED');
  assert.equal(entry.scope, 'GENERAL_PRESERVATION_READ_ONLY_V1');
  assert.equal(entry.project, 'crmynov-prod-n7x4q2'); assert.equal(entry.region, 'europe-west1');
  assert(jobs[phase].test(entry.job), 'CUTOVER_AUTHORITY_JOB_CROSSED');
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(entry.uid), 'CUTOVER_AUTHORITY_JOB_UID');
  assert.equal(entry.job, expectedJob, 'CUTOVER_AUTHORITY_EXACT_JOB');
  assert.equal(entry.uid, expectedUid, 'CUTOVER_AUTHORITY_EXACT_UID');
  assert.equal(entry.ticket, 'CRMY-63'); assert.equal(entry.googleAccount, 'casablancaynovcampus@gmail.com');
  exact(entry.resourceBinding, ['job', 'uid', 'purpose', 'taskCount', 'parallelism']);
  assert.deepEqual(entry.resourceBinding, {job: entry.job, uid: entry.uid, purpose: entry.scope, taskCount: 1, parallelism: 1}, 'CUTOVER_AUTHORITY_RESOURCE_BINDING');
  assert.equal(entry.resourceBindingSha256, digest(entry.resourceBinding), 'CUTOVER_AUTHORITY_RESOURCE_DIGEST');
  assert.equal(entry.resourceBindingSha256, resourceBindingSha256); assert(H.test(resourceBindingSha256) && H.test(entry.journalDirectorySha256) && H.test(entry.dossierSha256));
  assert.deepEqual(entry.actions, ['RUN']); assert.equal(entry.maximumRunPosts, 1); assert.equal(entry.runAuthorized, true);
  assert.equal(entry.businessMutationAuthorized, false); assert.equal(entry.jiraEvidenceVersion, 2);
  descriptor(entry.driver); descriptor(entry.adapter); descriptor(entry.runner);
  assert.equal(entry.driver.pr, 282); assert.equal(entry.driver.mergeCommit, 'c4dfed68baa4b750256285032761f0f09aea5a8e');
  assert.equal(entry.driver.tree, 'b1ada64f5833e1afeaa8e03bbb58d081bf15f13c'); assert.equal(entry.driver.files.length, 84);
  assert.equal(digest(entry.driver.files), '142578c541ba5b2312c09731439868de0bf6466611c81ad8635bb0d582763559',
    'CUTOVER_AUTHORITY_EXACT_PR282_CLOSURE');
  assert.equal(entry.adapter.pr, 294); assert.equal(entry.adapter.mergeCommit, 'e2535d2530ad52f58815457ee30644139fd67d49');
  assert.equal(entry.adapter.tree, '9df7be07f729f086f9ae02a9945383d8c25d9eb8');
  assert.equal(entry.adapter.files.length, 11, 'CUTOVER_AUTHORITY_EXACT_PR294_COUNT');
  assert.equal(digest(entry.adapter.files), 'a1d45109d0826e9713166812c1f46e8a953605d1c75d8b073941fd7cf4e1d7e0',
    'CUTOVER_AUTHORITY_EXACT_PR294_CLOSURE');
  for (const required of ['scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs',
    'scripts/ci/runtime-image-only/cutover-jira-readiness-v1.mjs',
    'scripts/ci/runtime-image-only/post-operational-renewal-v3.mjs']) {
    assert(entry.adapter.files.some(file => file.path === required), 'CUTOVER_AUTHORITY_ADAPTER_CLOSURE');
  }
  assert(entry.runner.pr > 294 && entry.runner.mergeCommit !== entry.driver.mergeCommit && entry.runner.mergeCommit !== entry.adapter.mergeCommit, 'CUTOVER_AUTHORITY_DISTINCT_RUNNER');
  const runnerFiles = new Set(entry.runner.files.map(file => file.path));
  for (const required of ['scripts/ci/operational-driver-v4.mjs',
    'scripts/ci/runtime-image-only/cutover-native-authority-v1.mjs',
    'scripts/ci/runtime-image-only/cutover-native-cli-v1.mjs',
    'scripts/ci/runtime-image-only/cutover-native-phase-boundary-v1.mjs',
    'scripts/ci/runtime-image-only/cutover-native-run-v1.mjs',
    'scripts/ci/runtime-image-only/cutover-protected-source-v1.mjs']) {
    assert(runnerFiles.has(required), 'CUTOVER_AUTHORITY_RUNNER_CLOSURE');
  }
  validateImageCatalogueReviewV2(entry.objectiveReview, READONLY_CATALOGUE_PATH_V2);
  const start = time(entry.validFrom), end = time(entry.expiresAt);
  assert(end > start && end - start <= 86400000 && start <= now && now < end, 'CUTOVER_AUTHORITY_EXPIRED');
  return entry;
}

export function validateCutoverNativeMarkerV1(comments, {entry, grant, jiraSha256, now}) {
  const rows = comments.filter(c => grant.authenticatedActors.includes(c.user?.login) && c.user?.type === 'User' &&
    typeof c.body === 'string' && c.body.includes(MARKER)).sort((a, b) => b.id - a.id);
  assert(rows.length > 0, 'CUTOVER_AUTHORITY_MARKER_MISSING');
  const comment = rows[0], at = comment.body.indexOf(MARKER), end = comment.body.indexOf('-->', at + MARKER.length);
  assert(Number.isSafeInteger(comment.id) && comment.id > 0, 'CUTOVER_AUTHORITY_MARKER_ID');
  assert(comment.body.length <= 65536 && at === comment.body.lastIndexOf(MARKER) && end > at, 'CUTOVER_AUTHORITY_MARKER_SHAPE');
  const marker = JSON.parse(comment.body.slice(at + MARKER.length, end).trim());
  exact(marker, ['schemaVersion', 'executor', 'phase', 'objectiveId', 'entrySha256', 'resourceBindingSha256',
    'driverCommit', 'adapterCommit', 'runnerCommit', 'grantDigest', 'jiraEvidenceVersion', 'jiraObservationSha256',
    'actions', 'maximumRunPosts', 'runAuthorized', 'businessMutationAuthorized', 'expiresAt']);
  assert.equal(marker.schemaVersion, 1); assert.equal(marker.executor, 'Codex');
  assert.equal(marker.phase, entry.phase); assert.equal(marker.objectiveId, entry.id);
  assert.equal(marker.entrySha256, digest(entry)); assert.equal(marker.resourceBindingSha256, entry.resourceBindingSha256);
  assert.equal(marker.driverCommit, entry.driver.mergeCommit); assert.equal(marker.adapterCommit, entry.adapter.mergeCommit);
  assert.equal(marker.runnerCommit, entry.runner.mergeCommit);
  assert.equal(marker.grantDigest, grantDigest(grant)); assert.equal(marker.jiraEvidenceVersion, 2);
  assert.equal(marker.jiraObservationSha256, jiraSha256); assert.deepEqual(marker.actions, ['RUN']);
  assert.equal(marker.maximumRunPosts, 1); assert.equal(marker.runAuthorized, true); assert.equal(marker.businessMutationAuthorized, false);
  const issued = Date.parse(comment.updated_at ?? comment.created_at), expiry = time(marker.expiresAt);
  assert(Number.isSafeInteger(issued) && issued <= now && now - issued < 600000 && issued < expiry && now < expiry && expiry - issued <= 600000, 'CUTOVER_AUTHORITY_MARKER_EXPIRED');
  return {commentId: comment.id, markerSha256: byteHash(comment.body), expiresAt: Math.min(expiry, time(entry.expiresAt))};
}

export async function authorizeCutoverNativePhaseV1({github, phase, objectiveId, resourceBindingSha256, expectedJob, expectedUid, dossierSha256, journalDirectorySha256, expectedEntry, jiraBytes,
  humanScopeBytes, localDriver, localAdapter, localRunner, clock = Date.now}) {
  const began = clock(); assert(Number.isSafeInteger(began));
  const user = await github.get('/user'); assert.equal(user.type, 'User');
  const branch = await github.get(API + 'branches/develop'), revision = branch.commit.sha;
  assert(branch.protected && S.test(revision), 'CUTOVER_AUTHORITY_PROTECTED_BRANCH');
  const protection = await github.get(API + 'branches/develop/protection');
  assert(protection.enforce_admins.enabled && protection.required_status_checks.strict &&
    protection.required_conversation_resolution.enabled && protection.required_status_checks.contexts.includes('pr-policy') &&
    !protection.allow_force_pushes.enabled && !protection.allow_deletions.enabled, 'CUTOVER_AUTHORITY_PROTECTIONS');
  const grant = JSON.parse(await githubFile(github, GRANT_PATH, revision));
  validateGrant(grant, {repository: REPO, actor: user.login, base: 'develop', reasons: ['production', 'audited-repository-tooling']});
  validateProtectedCodeReviewPolicy(JSON.parse(await githubFile(github, GITHUB_CODE_REVIEW_POLICY_PATH, revision)), REPO);
  const catalogue = JSON.parse(await githubFile(github, READONLY_CATALOGUE_PATH_V2, revision));
  const entries = catalogue.cutoverNativeAuthoritiesV1;
  assert(Array.isArray(entries) && entries.length <= 10, 'CUTOVER_AUTHORITY_PROTECTED_CATALOGUE_REQUIRED');
  const matches = entries.filter(value => value.id === objectiveId);
  assert.equal(matches.length, 1, 'CUTOVER_AUTHORITY_EXACT_OBJECTIVE_REQUIRED');
  const entry = validateCutoverNativeObjectiveV1(matches[0], {phase, objectiveId, resourceBindingSha256, expectedJob, expectedUid, now: began});
  assert.deepEqual(expectedEntry, entry, 'CUTOVER_AUTHORITY_LOCAL_OBJECTIVE_CROSSED');
  assert.equal(entry.dossierSha256, dossierSha256, 'CUTOVER_AUTHORITY_DOSSIER_CROSSED');
  assert.equal(entry.journalDirectorySha256, journalDirectorySha256, 'CUTOVER_AUTHORITY_JOURNAL_CROSSED');
  const local = source => ({commit: source.mergeCommit, tree: source.tree, head: source.head,
    pr: source.pr, files: source.files, clean: true});
  assert.deepEqual(localDriver, local(entry.driver), 'CUTOVER_AUTHORITY_LOCAL_DRIVER');
  assert.deepEqual(localAdapter, local(entry.adapter), 'CUTOVER_AUTHORITY_LOCAL_ADAPTER');
  assert.deepEqual(localRunner, local(entry.runner), 'CUTOVER_AUTHORITY_LOCAL_RUNNER');
  await verifySource(github, localDriver, entry);
  await verifySource(github, localAdapter, {driver: entry.adapter});
  await verifySource(github, localRunner, {driver: entry.runner});
  await Promise.all([entry.driver, entry.adapter, entry.runner].map(source => approvedMerge(github, source, {grant, actor: user.login, base: 'develop'})));
  const reference = await resolveImageCatalogueReviewV2(github, {descriptor: entry.objectiveReview, revision,
    expectedPath: READONLY_CATALOGUE_PATH_V2});
  const approved = await approvedMerge(github, reference, {grant, actor: user.login, base: 'develop'});
  assert(approved.files.some(file => file.filename === READONLY_CATALOGUE_PATH_V2), 'CUTOVER_AUTHORITY_OBJECTIVE_MERGE');
  const published = JSON.parse(await githubFile(github, READONLY_CATALOGUE_PATH_V2, reference.mergeCommit));
  assert.equal(digest(published.cutoverNativeAuthoritiesV1?.find(value => value.id === objectiveId)), digest(entry), 'CUTOVER_AUTHORITY_PUBLISHED_OBJECTIVE');
  for (const source of [entry.driver, entry.adapter, entry.runner, reference]) {
    const relation = await github.get(API + 'compare/' + source.mergeCommit + '...' + revision);
    assert.equal(relation.merge_base_commit.sha, source.mergeCommit, 'CUTOVER_AUTHORITY_SOURCE_ANCESTRY');
    assert(['ahead', 'identical'].includes(relation.status), 'CUTOVER_AUTHORITY_SOURCE_ANCESTRY');
  }
  const jiraSha256 = byteHash(jiraBytes), now = clock();
  assert(now >= began && now - began < 600000, 'CUTOVER_AUTHORITY_COLLECTION_BOUND');
  const readiness = validateOperationalJiraComposedReadinessV1({jiraBytes, expectedSha256: jiraSha256,
    actor: user.login, grantSha256: grantDigest(grant), now, scope: scopes[phase], humanScopeBytes});
  assert.equal(readiness.runAuthorized, false, 'CUTOVER_JIRA_IS_NOT_RUN_AUTHORITY');
  const marker = validateCutoverNativeMarkerV1(approved.comments, {entry, grant, jiraSha256, now});
  assert.equal((await github.get(API + 'branches/develop')).commit.sha, revision, 'CUTOVER_AUTHORITY_REVISION_DRIFT');
  const expiresAt = new Date(Math.min(marker.expiresAt, Date.parse(readiness.expiresAt))).toISOString();
  return Object.freeze({phase, objectiveId, resourceBindingSha256, jiraObservationSha256: jiraSha256,
    authorityRecordSha256: digest(entry), runAuthorized: true, businessMutationAuthorized: false,
    maximumRunPosts: 1, actions: ['RUN'], markerCommentId: marker.commentId,
    validFrom: entry.validFrom, expiresAt,
    entry: structuredClone(entry), receipt: Object.freeze({verifiedAt: new Date(now).toISOString(), expiresAt,
      actor: user.login, grantDigest: grantDigest(grant), authorityRecordSha256: digest(entry),
      authorizedActions: ['RUN'], operationalCommentId: marker.commentId})});
}
