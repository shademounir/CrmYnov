import test from 'node:test';
import assert from 'node:assert/strict';
import {compareImagePostUsingPrivateGeneralV3} from './post-preservation-v3.mjs';

await test('V3 POST comparison refuses a reconstructed or legacy private PRE capability before any SQL data is read', async () => {
  await assert.rejects(compareImagePostUsingPrivateGeneralV3({
    privatePreCapability: {schemaVersion: 4, kind: 'IN_PROCESS_VERIFIED_GENERAL_PRE_CAPABILITY_V4'},
    postChecked: {}, consumerInputs: {}, expectedGeneralAuthorityRecordSha256: 'f'.repeat(64),
    postCapturedAt: '2026-11-12T12:00:00.000Z', afterImageObservedAt: '2026-11-12T11:59:00.000Z', now: Date.parse('2026-11-12T12:00:00.000Z'),
  }));
});
