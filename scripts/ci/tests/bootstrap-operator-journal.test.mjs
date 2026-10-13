import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withOperatorJournal } from '../bootstrap-operator-journal.mjs';
const id = '00000000-0000-4000-8000-000000000001';
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'crm-operator-test-')); t.after(() => rm(dir, { recursive: true })); return dir; }

test('journal acquires package lock and reopens the exact persisted intent', async t => {
  const dir = await fixture(t);
  await withOperatorJournal(dir, id, async ({ persist }) => {
    await assert.rejects(withOperatorJournal(dir, id, async () => {}), { code: 'EEXIST' });
    await persist({ planHash: 'synthetic', decisions: { row: { phase: 'INTENT', body: { idempotencyKey: 'same-key' } } } });
  });
  await withOperatorJournal(dir, id, async ({ journal, persist }) => {
    assert.equal(journal.decisions.row.body.idempotencyKey, 'same-key');
    await persist({ ...journal, complete: true });
  });
  assert.equal((await readdir(dir)).length, 2);
});

test('altered or incomplete record refuses continuation without erasing evidence', async t => {
  const dir = await fixture(t);
  const path = join(dir, `operator-${id}-000001.json`);
  await writeFile(path, '{');
  let called = false;
  await assert.rejects(withOperatorJournal(dir, id, async () => { called = true; }));
  assert.equal(called, false); assert.deepEqual(await readdir(dir), [`operator-${id}-000001.json`]);
});

test('a stale lock is never automatically stolen', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, `operator-${id}-lock`), '{"pid":0}');
  await assert.rejects(withOperatorJournal(dir, id, async () => {}), { code: 'EEXIST' });
  assert.equal((await readdir(dir)).length, 1);
});
