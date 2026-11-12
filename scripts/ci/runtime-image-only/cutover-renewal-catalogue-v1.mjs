// Versioned additive source binding. The PR282 driver remains an exact
// historical 84-file source; only the new adapter belongs to the new commit.
// This pure boundary never issues native authority or starts a job.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {GENERAL_OPERATIONAL_BINDING, GENERAL_OPERATIONAL_HUMAN_SHA256, GENERAL_OPERATIONAL_DIRECTORY, validateHistoricalReadOnlyEntriesV3} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {validateImagePostCatalogueV2} from './post-operational-v2.mjs';
import {readImageOperationalSourceV4} from './local-source.mjs';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';

const OLD_POST_ID = 'rc48-general-post-20261030-operational-v1';
const OLD_POST_SHA256 = 'ddbe1c32645d6c4fd45e207b8620eea6068a8435c30c0bf5c64ab89672fc7449';
const OLD_GENERAL_ID = 'rc48-general-operational-pre-v3-64b91382c474';
const OLD_GENERAL_SHA256 = 'bc9c078dc7532ec441b3a0ef4ef35a3bc46ef1a075ec29aa10600b352eca06ef';
const HASH = /^[a-f0-9]{64}$/u, SHA = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const order = (left, right) => left.localeCompare(right, 'en');
const root = path.resolve(import.meta.dirname, '../../..');
const postFields = ['schemaVersion', 'id', 'status', 'scope', 'phase', 'businessMutation', 'ticket', 'actions', 'validFrom', 'expiresAt', 'dossierSha256', 'humanAuthorityReceiptSha256', 'journalDirectorySha256', 'googleAccount', 'driver', 'adapter', 'objectiveReview', 'release', 'post'];
const generalFields = ['schemaVersion', 'authorityId', 'objectiveId', 'status', 'scope', 'ticket', 'authorityRecordSha256', 'humanAuthorityReceiptSha256', 'driver', 'adapter', 'origin'];
const generalRecordFields = ['schemaVersion', 'kind', 'authorityId', 'capabilityId', 'humanAuthorityReceiptSha256', 'binding', 'validFrom', 'expiresAt', 'driverSource', 'adapterSource', 'evidenceDirectory', 'directorySha256', 'consumerSha256', 'oldUnknownUnchanged', 'closedClaimsRemainClosed'];

export const CUTOVER_RENEWAL_ADDITIVE_FILES_V1 = Object.freeze([
  'scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs',
  'scripts/ci/runtime-image-only/cutover-jira-readiness-v1.mjs',
  'scripts/ci/runtime-image-only/cutover-renewal-catalogue-v1.mjs',
  'scripts/ci/runtime-image-only/post-operational-renewal-v3.mjs',
  'scripts/ci/runtime-image-only/post-preservation-v3.mjs',
]);

function exact(value, fields) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, 'RENEWAL_OBJECT_REQUIRED');
  assert.deepEqual(Object.keys(value).sort(order), [...fields].sort(order), 'RENEWAL_FIELDS');
}

function window(value, now) {
  const start = Date.parse(value.validFrom), end = Date.parse(value.expiresAt);
  assert(Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start && end - start <= 86400000, 'RENEWAL_WINDOW');
  assert(Number.isSafeInteger(now) && start <= now && now < end, 'RENEWAL_EXPIRED');
}

function adapter(descriptor, requiredPath) {
  exact(descriptor, ['pr', 'head', 'mergeCommit', 'tree', 'files']);
  assert(Number.isSafeInteger(descriptor.pr) && descriptor.pr > 0);
  for (const key of ['head', 'mergeCommit', 'tree']) assert(SHA.test(descriptor[key]), 'RENEWAL_ADAPTER_IDENTITY');
  assert(Array.isArray(descriptor.files) && descriptor.files.length >= CUTOVER_RENEWAL_ADDITIVE_FILES_V1.length && descriptor.files.length <= 40, 'RENEWAL_ADAPTER_FILE_COUNT');
  const names = descriptor.files.map(row => {
    exact(row, ['path', 'sha256']);
    assert(typeof row.path === 'string' && /^scripts\/ci\/(?:pool-reconciliation|runtime-image-only)\/[a-zA-Z0-9_./-]+\.mjs$/u.test(row.path) && !row.path.includes('..') && HASH.test(row.sha256), 'RENEWAL_ADAPTER_FILE');
    return row.path;
  });
  assert.deepEqual(names, [...new Set(names)].sort(order), 'RENEWAL_ADAPTER_ORDER');
  for (const name of CUTOVER_RENEWAL_ADDITIVE_FILES_V1) assert(names.includes(name), 'RENEWAL_ADAPTER_REQUIRED_FILE');
  assert(names.includes(requiredPath), 'RENEWAL_ADAPTER_ENTRYPOINT');
}

export function readCutoverRenewalAdapterSourceV1() {
  const clean = readImageOperationalSourceV4(); // Existing Git/tool/environment guard; do not claim its changed bytes equal PR282.
  const files = CUTOVER_RENEWAL_ADDITIVE_FILES_V1.map(relative => ({path: relative, sha256: createHash('sha256').update(readPoolPrivateFile(path.join(root, relative))).digest('hex')})).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {commit: clean.commit, tree: clean.tree, clean: true, files};
}

export function validateGeneralRenewalRecordV4(record, now, {syntheticOnly = false} = {}) {
  exact(record, generalRecordFields);
  assert.equal(record.schemaVersion, 4);
  assert.equal(record.kind, 'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V4');
  assert(/^rc48-general-operational-pre-v4-[a-z0-9-]{8,63}$/u.test(record.authorityId));
  assert(UUID.test(record.capabilityId) && record.capabilityId !== '64b91382-c474-53e8-8ded-fa3a3c9241a3', 'RENEWAL_GENERAL_CAPABILITY');
  assert.equal(record.humanAuthorityReceiptSha256, GENERAL_OPERATIONAL_HUMAN_SHA256);
  assert.deepEqual(record.binding, GENERAL_OPERATIONAL_BINDING, 'RENEWAL_GENERAL_IMMUTABLE_JOB_BINDING');
  const productionDirectory = typeof record.evidenceDirectory === 'string' && /^C:\/Crm Ynov\/output\/casablanca-pilot-20261022\/general-operational-pre-native-[a-z0-9-]+$/u.test(record.evidenceDirectory);
  assert(productionDirectory || syntheticOnly === true && typeof record.evidenceDirectory === 'string' && path.isAbsolute(record.evidenceDirectory), 'RENEWAL_GENERAL_DIRECTORY');
  assert.notEqual(record.evidenceDirectory, GENERAL_OPERATIONAL_DIRECTORY);
  assert.equal(record.directorySha256, byteHash(record.evidenceDirectory));
  assert.equal(record.consumerSha256, digest(CONSUMER_PINS));
  assert.equal(record.oldUnknownUnchanged, true);
  assert.equal(record.closedClaimsRemainClosed, true);
  exact(record.driverSource, ['commit', 'tree', 'head', 'pr', 'files']);
  assert.equal(record.driverSource.pr, 282);
  assert.equal(record.driverSource.commit, 'c4dfed68baa4b750256285032761f0f09aea5a8e');
  assert.equal(record.driverSource.tree, 'b1ada64f5833e1afeaa8e03bbb58d081bf15f13c');
  assert(Array.isArray(record.driverSource.files) && record.driverSource.files.length === 84);
  adapter({pr: record.adapterSource.pr, head: record.adapterSource.head, mergeCommit: record.adapterSource.commit, tree: record.adapterSource.tree, files: record.adapterSource.files}, 'scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs');
  window(record, now);
  return record;
}

export function validateAdditiveCutoverRenewalCatalogueV1(catalogue, record, now) {
  validateHistoricalReadOnlyEntriesV3(catalogue);
  assert(Array.isArray(catalogue.entries) && catalogue.entries.length === 9, 'RENEWAL_EXACTLY_ONE_NEW_POST');
  assert(Array.isArray(catalogue.operationalPreAuthoritiesV3) && catalogue.operationalPreAuthoritiesV3.length === 2, 'RENEWAL_EXACTLY_ONE_NEW_GENERAL');
  const oldPost = validateImagePostCatalogueV2({...catalogue, entries: catalogue.entries.slice(0, 8)}, OLD_POST_ID);
  assert.equal(digest(oldPost), OLD_POST_SHA256, 'RENEWAL_OLD_POST_CHANGED');
  const oldGeneral = catalogue.operationalPreAuthoritiesV3[0];
  exact(oldGeneral, generalFields.filter(key => key !== 'adapter'));
  assert.equal(oldGeneral.authorityId, OLD_GENERAL_ID);
  assert.equal(digest(oldGeneral), OLD_GENERAL_SHA256, 'RENEWAL_OLD_GENERAL_CHANGED');
  validateGeneralRenewalRecordV4(record, now);

  const post = catalogue.entries[8];
  exact(post, postFields);
  assert.equal(post.schemaVersion, 3);
  assert(post.id !== oldPost.id && /^rc48-general-post-[a-z0-9-]{8,63}$/u.test(post.id), 'RENEWAL_POST_ID');
  for (const key of Object.keys(oldPost).filter(key => !['schemaVersion', 'id', 'validFrom', 'expiresAt', 'journalDirectorySha256'].includes(key))) assert.deepEqual(post[key], oldPost[key], 'RENEWAL_POST_SEMANTICS');
  assert(HASH.test(post.journalDirectorySha256) && post.journalDirectorySha256 !== oldPost.journalDirectorySha256, 'RENEWAL_POST_JOURNAL');
  assert.deepEqual(post.driver, oldPost.driver, 'RENEWAL_PR282_DRIVER_CHANGED');
  adapter(post.adapter, 'scripts/ci/runtime-image-only/post-operational-renewal-v3.mjs');
  window(post, now);

  const general = catalogue.operationalPreAuthoritiesV3[1];
  exact(general, generalFields);
  assert.equal(general.schemaVersion, 4);
  assert(general.authorityId !== oldGeneral.authorityId && general.authorityId === record.authorityId, 'RENEWAL_GENERAL_ID');
  for (const key of Object.keys(oldGeneral).filter(key => !['schemaVersion', 'authorityId', 'authorityRecordSha256'].includes(key))) assert.deepEqual(general[key], oldGeneral[key], 'RENEWAL_GENERAL_SEMANTICS');
  assert.deepEqual(general.driver, oldGeneral.driver, 'RENEWAL_PR282_DRIVER_CHANGED');
  assert(HASH.test(general.authorityRecordSha256) && general.authorityRecordSha256 === digest(record), 'RENEWAL_GENERAL_RECORD_BYTES');
  adapter(general.adapter, 'scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs');
  assert.deepEqual(record.driverSource, {commit: oldGeneral.driver.mergeCommit, tree: oldGeneral.driver.tree, head: oldGeneral.driver.head, pr: oldGeneral.driver.pr, files: oldGeneral.driver.files}, 'RENEWAL_GENERAL_DRIVER_SOURCE');
  assert.deepEqual(record.adapterSource, {commit: general.adapter.mergeCommit, tree: general.adapter.tree, head: general.adapter.head, pr: general.adapter.pr, files: general.adapter.files}, 'RENEWAL_GENERAL_ADAPTER_SOURCE');
  assert.deepEqual(post.adapter, general.adapter, 'RENEWAL_ONE_EXACT_ADAPTER_SOURCE');
  return Object.freeze({post, general, historicalDriver: oldPost.driver, adapter: post.adapter, nativeAuthority: false});
}
