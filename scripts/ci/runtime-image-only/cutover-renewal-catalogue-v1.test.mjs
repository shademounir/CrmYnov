import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {GENERAL_OPERATIONAL_BINDING} from '../pool-reconciliation/general-operational-pre-v3.mjs';
import {CONSUMER_PINS} from '../pool-reconciliation/general-prospective-pre-authority-v1.mjs';
import {validateAdditiveCutoverRenewalCatalogueV1} from './cutover-renewal-catalogue-v1.mjs';
import {validatePostRenewalSourceV3} from './post-operational-renewal-v3.mjs';

const old = JSON.parse(fs.readFileSync(new URL('../../../docs/governance/readonly-probe-objectives-v1.json', import.meta.url)));
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const hash = 'f'.repeat(64);
const window = {validFrom: '2026-11-12T11:00:00.000Z', expiresAt: '2026-11-12T20:00:00.000Z'};
const newFiles = ['scripts/ci/pool-reconciliation/general-operational-pre-v4.mjs', 'scripts/ci/runtime-image-only/cutover-jira-readiness-v1.mjs', 'scripts/ci/runtime-image-only/post-operational-renewal-v3.mjs'];

function fixture() {
  const catalogue = structuredClone(old);
  const priorPost = catalogue.entries[7], priorGeneral = catalogue.operationalPreAuthoritiesV3[0];
  const driver = {pr: 999, head: 'b'.repeat(40), mergeCommit: 'a'.repeat(40), tree: 'c'.repeat(40), files: [
    ...priorPost.driver.files.map(row => structuredClone(row)),
    ...newFiles.map(path => ({path, sha256: hash})),
  ].sort((a, b) => a.path.localeCompare(b.path, 'en'))};
  catalogue.entries.push({...structuredClone(priorPost), id: 'rc48-general-post-20261112-renewal-v1', ...window, journalDirectorySha256: 'e'.repeat(64), driver: structuredClone(driver)});
  const generalRecord = {
    schemaVersion: 4, kind: 'GENERAL_OPERATIONAL_PROSPECTIVE_PRE_AUTHORITY_V4',
    authorityId: 'rc48-general-operational-pre-v4-renewal-v1', capabilityId: '11111111-2222-4333-8444-555555555555',
    humanAuthorityReceiptSha256: priorGeneral.humanAuthorityReceiptSha256, ...window,
    binding: structuredClone(GENERAL_OPERATIONAL_BINDING),
    source: {commit: driver.mergeCommit, tree: driver.tree, head: driver.head, pr: driver.pr, files: structuredClone(driver.files)},
    evidenceDirectory: 'C:/Crm Ynov/output/casablanca-pilot-20261022/general-operational-pre-native-20261112-v1',
    consumerSha256: digest(CONSUMER_PINS),
    oldUnknownUnchanged: true, closedClaimsRemainClosed: true,
  };
  generalRecord.directorySha256 = byteHash(generalRecord.evidenceDirectory);
  catalogue.operationalPreAuthoritiesV3.push({...structuredClone(priorGeneral), authorityId: generalRecord.authorityId, authorityRecordSha256: digest(generalRecord), driver: structuredClone(driver)});
  return {catalogue, generalRecord};
}

test('additive renewal accepts one distinct POST and GENERAL while preserving all historical bytes', () => {
  const {catalogue, generalRecord} = fixture();
  const result = validateAdditiveCutoverRenewalCatalogueV1(catalogue, generalRecord, NOW);
  assert.equal(result.nativeAuthority, false);
  assert.equal(result.historicalGeneralSha256, digest(old.operationalPreAuthoritiesV3[0]));
  assert.deepEqual(catalogue.entries.slice(0, 8), old.entries);
});

test('renewal refuses historical changes, missing source modules, expiry and replayed identifiers', () => {
  const cases = [
    f => { f.catalogue.entries[7].status = 'revoked'; },
    f => { f.catalogue.operationalPreAuthoritiesV3[0].status = 'revoked'; },
    f => { f.catalogue.entries[8].driver.files = f.catalogue.entries[8].driver.files.filter(row => !newFiles.includes(row.path)); },
    f => { f.catalogue.entries[8].id = old.entries[7].id; },
    f => { f.generalRecord.capabilityId = '64b91382-c474-53e8-8ded-fa3a3c9241a3'; },
    f => { f.generalRecord.binding.uid = '00000000-0000-4000-8000-000000000000'; },
    f => { f.generalRecord.evidenceDirectory = 'C:/Crm Ynov/output/casablanca-pilot-20261022/general-operational-pre-native-20261030-v1'; },
    f => { f.catalogue.entries[8].actions.push('PATCH_API'); },
    f => { f.catalogue.entries[8].expiresAt = '2026-11-12T11:59:59.000Z'; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    assert.throws(() => validateAdditiveCutoverRenewalCatalogueV1(f.catalogue, f.generalRecord, NOW));
  }
});

test('POST renewal source gate refuses an old objective before inspecting a dossier or transport', () => {
  const {catalogue, generalRecord} = fixture();
  assert.throws(() => validatePostRenewalSourceV3({catalogue, generalRecord, objectiveId: old.entries[7].id, now: NOW}), /POST_V3_EXACT_NEW_OBJECTIVE_REQUIRED/u);
});
