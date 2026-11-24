import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateImageInventoryObjective} from '../runtime-image-only/inventory-authority-v2.mjs';
import {validateImageInventoryInputs} from '../runtime-image-only/operational-cli-v2.mjs';
import {imageJournalDigest as digest} from '../runtime-image-only/journal.mjs';
import {OPERATIONAL_HUMAN_SHA256, IMAGE_OPERATIONAL_RESOURCES_V2} from '../runtime-image-only/late-binding-v2.mjs';

const catalogue = JSON.parse(fs.readFileSync(new URL('../../../docs/governance/runtime-image-only-objectives-v1.json', import.meta.url)));
const prior = catalogue.entries[8];
const entry = catalogue.entries[10];
const journal = 'C:\\Crm Ynov\\output\\casablanca-pilot-20261022\\v5-inventory-v2-authority-20261124-v16\\journal';
const hash = value => createHash('sha256').update(value).digest('hex');
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

void test('V11 appends one distinct inventory objective without rewriting ten protected predecessors', () => {
  assert.equal(catalogue.entries.length, 11);
  assert.equal(digest(catalogue.entries.slice(0, 10)), 'c71d77e5958f1f692100fcee7cbc215e7939195b0b9aa0031bef1360784dac4a');
  assert.equal(entry.id, 'rc48-image-only-inventory-20261124-v5-renewal-v16');
  assert.deepEqual(omit(entry, ['id', 'journalDirectorySha256', 'validFrom', 'expiresAt']),
    omit(prior, ['id', 'journalDirectorySha256', 'validFrom', 'expiresAt']));
  assert.equal(entry.journalDirectorySha256, hash(journal));
  assert.notEqual(entry.journalDirectorySha256, prior.journalDirectorySha256);
  assert.equal(Date.parse(entry.expiresAt) - Date.parse(entry.validFrom), 86400000);
  assert.deepEqual(entry.actions, ['READ_METADATA', 'TEST_PERMISSIONS', 'OBSERVE_OPERATION']);
  assert.equal(entry.driver.mergeCommit, 'c4dfed68baa4b750256285032761f0f09aea5a8e');
  assert.equal(entry.driver.files.length, 84);
  assert.equal(entry.sourceBinding.mergeCommit, 'ba4a1a2caf6196a4b2e2447b6971f107ea76779c');
  assert.equal(entry.adapterBinding.mergeCommit, '1dc7e42607860269364f8be7d8b616646e7ab6e4');
});

void test('V11 objective and exact local input shape accept reads, refuse RUN and expiration', () => {
  const source = {commit: entry.driver.mergeCommit, tree: entry.driver.tree, clean: true, files: entry.driver.files};
  const now = Date.parse(entry.validFrom) + 1000;
  for (const action of entry.actions) {
    assert.equal(validateImageInventoryObjective(entry, {objectiveId: entry.id, source, action, now}), true);
  }
  for (const action of ['RUN', 'CREATE', 'PATCH_API']) {
    assert.throws(() => validateImageInventoryObjective(entry, {objectiveId: entry.id, source, action, now}));
  }
  assert.throws(() => validateImageInventoryObjective(entry, {objectiveId: entry.id, source,
    action: 'READ_METADATA', now: Date.parse(entry.expiresAt)}));
  const dossier = {schemaVersion: 2, kind: 'RC48_NATIVE_INVENTORY_DOSSIER_V2', objectiveId: entry.id,
    humanAuthorityReceiptSha256: OPERATIONAL_HUMAN_SHA256, source: {commit: source.commit, tree: source.tree},
    resourceBindings: IMAGE_OPERATIONAL_RESOURCES_V2, journalDirectorySha256: hash(journal)};
  const binding = {sessionId: 'local:12345678-1234-4234-8234-123456789abc',
    authorityRecordSha256: digest(entry), resourceBindingSha256: digest(IMAGE_OPERATIONAL_RESOURCES_V2),
    scope: 'READ_ONLY_INVENTORY', windowStart: entry.validFrom,
    windowEnd: new Date(Date.parse(entry.validFrom) + 900000).toISOString(),
    sourceCommit: source.commit, project: entry.project, region: entry.region};
  const authority = {entry: {...entry, objectiveId: entry.id, authorityRecordSha256: digest(entry)}};
  assert.equal(validateImageInventoryInputs({objectiveId: entry.id, dossier, binding, source, authority,
    journalDirectory: journal}), true);
});
