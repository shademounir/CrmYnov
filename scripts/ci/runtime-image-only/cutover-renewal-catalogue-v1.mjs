// Additive catalogue boundary for future GENERAL/POST capacities. This module
// cannot issue authority, arm a claim, invoke a job, or authorize deployment.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {GENERAL_OPERATIONAL_BINDING, GENERAL_OPERATIONAL_HUMAN_SHA256, GENERAL_OPERATIONAL_DIRECTORY, validateHistoricalReadOnlyEntriesV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {validateImagePostCatalogueV2} from './post-operational-v2.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {validateImageCatalogueReviewV2, READONLY_CATALOGUE_PATH_V2} from './catalogue-origin-v2.mjs';
import {readImageOperationalSourceV4} from './local-source.mjs';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';

const OLD_POST_ID = 'rc48-general-post-20261030-operational-v1';
const OLD_POST_SHA256 = 'ddbe1c32645d6c4fd45e207b8620eea6068a8435c30c0bf5c64ab89672fc7449';
const OLD_GENERAL_ID = 'rc48-general-operational-pre-v3-64b91382c474';
const OLD_GENERAL_SHA256 = 'bc9c078dc7532ec441b3a0ef4ef35a3bc46ef1a075ec29aa10600b352eca06ef';
const HASH = /^[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const order = (left, right) => left.localeCompare(right, 'en');
const historicalPostFields = ['schemaVersion', 'id', 'status', 'scope', 'phase', 'businessMutation', 'ticket', 'actions', 'validFrom', 'expiresAt', 'dossierSha256', 'humanAuthorityReceiptSha256', 'journalDirectorySha256', 'googleAccount', 'driver', 'objectiveReview', 'release', 'post'];
const historicalGeneralFields = ['schemaVersion', 'authorityId', 'objectiveId', 'status', 'scope', 'ticket', 'authorityRecordSha256', 'humanAuthorityReceiptSha256', 'driver', 'origin'];
const generalRecordFields = ['schemaVersion', 'kind', 'authorityId', 'capabilityId', 'humanAuthorityReceiptSha256', 'binding', 'validFrom', 'expiresAt', 'source', 'evidenceDirectory', 'directorySha256', 'consumerSha256', 'oldUnknownUnchanged', 'closedClaimsRemainClosed'];
const root = path.resolve(import.meta.dirname, '../../..');
export const CUTOVER_RENEWAL_ADDITIVE_FILES_V1 = Object.freeze([
  'scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs',
  'scripts/ci/runtime-image-only/cutover-renewal-catalogue-v1.mjs',
  'scripts/ci/runtime-image-only/cutover-jira-readiness-v1.mjs',
  'scripts/ci/runtime-image-only/post-operational-renewal-v3.mjs',
  'scripts/ci/runtime-image-only/post-preservation-v3.mjs',
]);

export function readCutoverRenewalSourceV1(protectedOldDriver) {
  assert(protectedOldDriver && Array.isArray(protectedOldDriver.files) && protectedOldDriver.files.length === 84, 'RENEWAL_EXACT_84_HISTORICAL_FILES_REQUIRED');
  const base = readImageOperationalSourceV4();
  assert.deepEqual(base.files, protectedOldDriver.files, 'RENEWAL_HISTORICAL_SOURCE_BYTES_CHANGED');
  const files = [...base.files, ...CUTOVER_RENEWAL_ADDITIVE_FILES_V1.map(relative => ({path: relative, sha256: createHash('sha256').update(readPoolPrivateFile(path.join(root, relative))).digest('hex')}))].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assert.equal(new Set(files.map(row => row.path)).size, files.length, 'RENEWAL_DUPLICATE_SOURCE_PATH');
  return {...base, files};
}

function exactFields(value, names) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, 'RENEWAL_OBJECT_REQUIRED');
  assert.deepEqual(Object.keys(value).sort(order), [...names].sort(order), 'RENEWAL_FIELDS');
}

function window(entry, now) {
  const start = Date.parse(entry.validFrom), end = Date.parse(entry.expiresAt);
  assert(Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start && end - start <= 86400000, 'RENEWAL_WINDOW');
  assert(Number.isSafeInteger(now) && start <= now && now < end, 'RENEWAL_EXPIRED');
}

function sourceClosure(driver, oldDriver, addedPath) {
  exactFields(driver, ['pr', 'head', 'mergeCommit', 'tree', 'files']);
  assert(Number.isSafeInteger(driver.pr) && driver.pr > 0 && SHA.test(driver.head) && SHA.test(driver.mergeCommit) && SHA.test(driver.tree), 'RENEWAL_DRIVER_IDENTITY');
  assert(driver.mergeCommit !== oldDriver.mergeCommit, 'RENEWAL_OLD_SOURCE_REPLAY');
  assert(Array.isArray(driver.files) && driver.files.length > oldDriver.files.length && driver.files.length <= 250, 'RENEWAL_SOURCE_CLOSURE');
  const names = driver.files.map(row => {
    exactFields(row, ['path', 'sha256']);
    assert(typeof row.path === 'string' && /^(?:scripts|docs)\/[a-zA-Z0-9_./-]+$/u.test(row.path) && !row.path.includes('..') && HASH.test(row.sha256), 'RENEWAL_SOURCE_FILE');
    return row.path;
  });
  assert.deepEqual(names, [...new Set(names)].sort(order), 'RENEWAL_SOURCE_ORDER');
  assert(names.includes(addedPath), 'RENEWAL_NEW_MODULE_NOT_IN_SOURCE');
  const files = new Map(driver.files.map(row => [row.path, row.sha256]));
  for (const old of oldDriver.files) assert.equal(files.get(old.path), old.sha256, 'RENEWAL_HISTORICAL_SOURCE_CHANGED');
}

export function validateGeneralRenewalRecordV4(generalRecord, now) {
  exactFields(generalRecord, generalRecordFields);
  assert.equal(generalRecord.schemaVersion, 4);
  assert.equal(generalRecord.kind, 'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V4');
  assert(/^rc48-general-operational-pre-v4-[a-z0-9-]{8,63}$/u.test(generalRecord.authorityId), 'RENEWAL_GENERAL_ID');
  assert(UUID.test(generalRecord.capabilityId) && generalRecord.capabilityId !== '64b91382-c474-53e8-8ded-fa3a3c9241a3', 'RENEWAL_GENERAL_CAPABILITY');
  assert.equal(generalRecord.humanAuthorityReceiptSha256, GENERAL_OPERATIONAL_HUMAN_SHA256);
  assert.deepEqual(generalRecord.binding, GENERAL_OPERATIONAL_BINDING, 'RENEWAL_GENERAL_IMMUTABLE_JOB_BINDING');
  assert(typeof generalRecord.evidenceDirectory === 'string' && /^C:\/Crm Ynov\/output\/casablanca-pilot-20261022\/general-operational-pre-native-[a-z0-9-]+$/u.test(generalRecord.evidenceDirectory), 'RENEWAL_GENERAL_DIRECTORY');
  assert.notEqual(generalRecord.evidenceDirectory, GENERAL_OPERATIONAL_DIRECTORY, 'RENEWAL_OLD_GENERAL_DIRECTORY_REPLAY');
  assert.equal(generalRecord.directorySha256, byteHash(generalRecord.evidenceDirectory), 'RENEWAL_GENERAL_DIRECTORY_HASH');
  assert.equal(generalRecord.consumerSha256, digest(CONSUMER_PINS), 'RENEWAL_GENERAL_CONSUMERS');
  assert.equal(generalRecord.oldUnknownUnchanged, true);
  assert.equal(generalRecord.closedClaimsRemainClosed, true);
  exactFields(generalRecord.source, ['commit', 'tree', 'head', 'pr', 'files']);
  for (const field of ['commit', 'tree', 'head']) assert(SHA.test(generalRecord.source[field]), 'RENEWAL_GENERAL_SOURCE_IDENTITY');
  assert(Number.isSafeInteger(generalRecord.source.pr) && generalRecord.source.pr > 0);
  assert(Array.isArray(generalRecord.source.files) && generalRecord.source.files.length > 84 && generalRecord.source.files.length <= 250, 'RENEWAL_GENERAL_SOURCE_SIZE');
  const names = generalRecord.source.files.map(row => {
    exactFields(row, ['path', 'sha256']);
    assert(typeof row.path === 'string' && /^(?:scripts|docs)\/[a-zA-Z0-9_./-]+$/u.test(row.path) && !row.path.includes('..') && HASH.test(row.sha256));
    return row.path;
  });
  assert.deepEqual(names, [...new Set(names)].sort(order), 'RENEWAL_GENERAL_SOURCE_ORDER');
  assert(names.includes('scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs'));
  assert(names.includes('scripts/ci/runtime-image-only/cutover-jira-readiness-v1.mjs'));
  window(generalRecord, now);
  return generalRecord;
}

export function validateAdditiveCutoverRenewalCatalogueV1(catalogue, generalRecord, now) {
  validateHistoricalReadOnlyEntriesV3(catalogue);
  assert(Array.isArray(catalogue.entries) && catalogue.entries.length === 9, 'RENEWAL_EXACTLY_ONE_NEW_POST');
  assert(Array.isArray(catalogue.operationalPreAuthoritiesV3) && catalogue.operationalPreAuthoritiesV3.length === 2, 'RENEWAL_EXACTLY_ONE_NEW_GENERAL');
  const historical = {...catalogue, entries: catalogue.entries.slice(0, 8)};
  const oldPost = validateImagePostCatalogueV2(historical, OLD_POST_ID);
  assert.equal(digest(oldPost), OLD_POST_SHA256, 'RENEWAL_OLD_POST_CHANGED');
  const oldGeneral = catalogue.operationalPreAuthoritiesV3[0];
  exactFields(oldGeneral, historicalGeneralFields);
  assert.equal(oldGeneral.authorityId, OLD_GENERAL_ID);
  assert.equal(digest(oldGeneral), OLD_GENERAL_SHA256, 'RENEWAL_OLD_GENERAL_CHANGED');

  const post = catalogue.entries[8];
  exactFields(post, historicalPostFields);
  assert(post.id !== oldPost.id && /^rc48-general-post-[a-z0-9-]{8,63}$/u.test(post.id), 'RENEWAL_POST_ID');
  assert.deepEqual(Object.keys(post).filter(key => !['id', 'validFrom', 'expiresAt', 'journalDirectorySha256', 'driver', 'objectiveReview'].includes(key)).map(key => [key, post[key]]),
    Object.keys(oldPost).filter(key => !['id', 'validFrom', 'expiresAt', 'journalDirectorySha256', 'driver', 'objectiveReview'].includes(key)).map(key => [key, oldPost[key]]), 'RENEWAL_POST_SEMANTICS');
  assert(HASH.test(post.journalDirectorySha256) && post.journalDirectorySha256 !== oldPost.journalDirectorySha256, 'RENEWAL_POST_JOURNAL');
  assert.deepEqual(post.objectiveReview, oldPost.objectiveReview, 'RENEWAL_POST_REVIEW_ORIGIN');
  validateImageCatalogueReviewV2(post.objectiveReview, READONLY_CATALOGUE_PATH_V2);
  window(post, now);
  sourceClosure(post.driver, oldPost.driver, 'scripts/ci/runtime-image-only/post-operational-renewal-v3.mjs');

  const general = catalogue.operationalPreAuthoritiesV3[1];
  exactFields(general, historicalGeneralFields);
  assert(general.authorityId !== oldGeneral.authorityId && /^rc48-general-operational-pre-v4-[a-z0-9-]{8,63}$/u.test(general.authorityId), 'RENEWAL_GENERAL_ID');
  assert.equal(general.objectiveId, oldGeneral.objectiveId);
  assert.equal(general.status, oldGeneral.status);
  assert.equal(general.scope, oldGeneral.scope);
  assert.equal(general.ticket, oldGeneral.ticket);
  assert.equal(general.humanAuthorityReceiptSha256, oldGeneral.humanAuthorityReceiptSha256);
  assert.deepEqual(general.origin, oldGeneral.origin);
  assert(HASH.test(general.authorityRecordSha256) && general.authorityRecordSha256 !== oldGeneral.authorityRecordSha256, 'RENEWAL_GENERAL_RECORD');
  validateGeneralRenewalRecordV4(generalRecord, now);
  assert.equal(digest(generalRecord), general.authorityRecordSha256, 'RENEWAL_GENERAL_RECORD_BYTES');
  assert.equal(generalRecord.authorityId, general.authorityId);
  sourceClosure(general.driver, oldGeneral.driver, 'scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs');
  assert.deepEqual(generalRecord.source, {commit: general.driver.mergeCommit, tree: general.driver.tree, head: general.driver.head, pr: general.driver.pr, files: general.driver.files}, 'RENEWAL_GENERAL_SOURCE');
  return Object.freeze({post, general, historicalEntriesSha256: digest(catalogue.entries.slice(0, 8)), historicalGeneralSha256: digest(oldGeneral), nativeAuthority: false});
}
