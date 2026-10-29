import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {selectOperationalRoute, runOperationalDriver} from '../../operational-driver-v3.mjs';

test('new entry selects offline preparation before any historical native authority or driver', () => {
  assert.equal(selectOperationalRoute(['general-unknown-prepare']), 'OFFLINE_GENERAL_PREPARATION');
  assert.equal(selectOperationalRoute(['diagnostic-read-only']), 'VERSIONED_READONLY_DIAGNOSTIC');
  assert.equal(selectOperationalRoute(['image-only', 'inspect']), 'HISTORICAL_OPERATIONAL_V2');
  assert.equal(selectOperationalRoute(['verify']), 'HISTORICAL_OPERATIONAL_V2');
  assert.throws(() => selectOperationalRoute([]));
  assert.throws(() => selectOperationalRoute(['verify', null]));
});

test('offline route rejects execution capabilities without contacting native services', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => {calls++; throw Error('NATIVE_CALL_FORBIDDEN');});
  await assert.rejects(runOperationalDriver(['general-unknown-prepare', '--initialize', 'yes']));
  assert.equal(calls, 0);
});

test('CLI refusal remains exit1, explicitly not authorization for an automatic retry', () => {
  const result = spawnSync(process.execPath, ['scripts/ci/operational-driver-v3.mjs', 'general-unknown-prepare', '--token', 'SYNTHETIC_SECRET_NOT_TO_ECHO'], {encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 1);
  const value = JSON.parse(result.stderr.trim().split(/\r?\n/u).find(line => line.startsWith('{')));
  assert.equal(value.operationOutcome, 'REFUSED');
  assert.equal(value.commandCompleted, true);
  assert.equal(value.resumeAuthorized, false);
  assert.equal(value.diagnostic.reason, 'VALIDATION_REFUSED');
  assert.equal(value.canRetry, false);
  assert(!result.stderr.includes('SYNTHETIC_SECRET_NOT_TO_ECHO'));
});

test('new route does not import native clients before offline dispatch and does not replace old pins', () => {
  const source = readFileSync(new URL('../../operational-driver-v3.mjs', import.meta.url), 'utf8');
  assert(!source.includes('createOfficialAccessToken'));
  assert(!source.includes('openReadOnlyTransactionJournal'));
  assert(!source.includes('read-only-objectives-v'));
  assert(source.indexOf("import('./pool-reconciliation/general-unknown-preparation-v1.mjs')") < source.indexOf("import('./pool-reconciliation/pool-operational-driver-v2.mjs')"));
});
