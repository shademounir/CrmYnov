import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {byteHash, digest} from './controlled-pool-contract-v1.mjs';
import {CONSUMER_PINS} from './general-prospective-pre-authority-v1.mjs';
import {GENERAL_OPERATIONAL_BINDING, GENERAL_OPERATIONAL_HUMAN_SHA256} from './general-operational-pre-v3.mjs';
import {simulateGeneralEvidenceStoreV4, simulateGeneralPrivateCapabilityV4, withVerifiedGeneralPreV4} from './general-operational-pre-v4.mjs';
import {CUTOVER_RENEWAL_ADDITIVE_FILES_V1, validateGeneralRenewalRecordV4} from '../runtime-image-only/cutover-renewal-catalogue-v1.mjs';

const now = Date.parse('2026-11-12T12:00:00.000Z');
const catalogue = JSON.parse(fs.readFileSync(new URL('../../../docs/governance/readonly-probe-objectives-v1.json', import.meta.url)));

function record(directory) {
  return {
    schemaVersion: 4, kind: 'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V4',
    authorityId: 'rc48-general-operational-pre-v4-test-only', capabilityId: randomUUID(),
    humanAuthorityReceiptSha256: GENERAL_OPERATIONAL_HUMAN_SHA256,
    binding: structuredClone(GENERAL_OPERATIONAL_BINDING),
    validFrom: '2026-11-12T11:00:00.000Z', expiresAt: '2026-11-12T20:00:00.000Z',
    driverSource: {commit: catalogue.entries[7].driver.mergeCommit, tree: catalogue.entries[7].driver.tree,
      head: catalogue.entries[7].driver.head, pr: 282, files: structuredClone(catalogue.entries[7].driver.files)},
    adapterSource: {commit: 'a'.repeat(40), tree: 'b'.repeat(40), head: 'c'.repeat(40), pr: 999,
      files: CUTOVER_RENEWAL_ADDITIVE_FILES_V1.map(path => ({path, sha256: 'f'.repeat(64)})).sort((a, b) => a.path.localeCompare(b.path, 'en'))},
    evidenceDirectory: directory, directorySha256: byteHash(directory), consumerSha256: digest(CONSUMER_PINS),
    oldUnknownUnchanged: true, closedClaimsRemainClosed: true,
  };
}

function isolated(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'general-operational-pre-native-test-'));
  assert(path.isAbsolute(directory));
  t.after(() => {
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, {recursive: true, force: false});
  });
  return directory;
}

test('V4 store requires a fresh empty directory and arms a durable one-use claim before RUN intent', t => {
  const directory = isolated(t), authority = record(directory);
  assert.throws(() => validateGeneralRenewalRecordV4(authority, now), /RENEWAL_GENERAL_DIRECTORY/u);
  const store = simulateGeneralEvidenceStoreV4({syntheticOnly: true, directory, record: authority, beforeArm: () => ({ready: true}), now: () => now}).store;
  assert.equal(store.isArmed(), false);
  store.append('LOCAL-PRECHECK', {state: 'PASS'});
  assert.equal(store.isArmed(), false);
  store.append('PROSPECTIVE-RUN-INTENT', {state: 'INTENT'});
  assert.equal(store.isArmed(), true);
  const claim = JSON.parse(fs.readFileSync(store.claimPath, 'utf8'));
  assert.equal(claim.authorityRecordSha256, digest(authority));
  assert.equal(claim.canRetry, false);
  assert.throws(() => store.append('PROSPECTIVE-RUN-INTENT', {state: 'DUPLICATE'}), /GENERAL_V4_SECOND_ARM_REFUSED/u);
  assert.throws(() => simulateGeneralEvidenceStoreV4({syntheticOnly: true, directory, record: authority, beforeArm: () => ({ready: true}), now: () => now}), /GENERAL_V4_NEW_EMPTY_DIRECTORY_REQUIRED/u);
});

test('V4 private PRE capability is single-use and never serializes checked SQL data', async () => {
  const checked = {secretSyntheticOnly: 'never-persist'}, sourceProofRef = {path: 'synthetic', sha256: 'f'.repeat(64)};
  const result = await simulateGeneralPrivateCapabilityV4({syntheticOnly: true, checked, sourceProofRef, capturedAt: '2026-11-12T12:00:00.000Z', consumer: value => value.checked === checked});
  assert.equal(result.result, true);
  assert.equal(result.nativeAuthority, false);
  assert(!JSON.stringify(result).includes('never-persist'));
  await assert.rejects(withVerifiedGeneralPreV4(result.publicShape, () => true));
});
