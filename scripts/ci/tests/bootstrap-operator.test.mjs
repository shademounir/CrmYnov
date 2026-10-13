import test from 'node:test';
import assert from 'node:assert/strict';
import { decideOperatorBlock, validateOperatorPlan, readOperatorRows } from '../bootstrap-operator.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = () => ({ schemaVersion: 1, packageId: id(1), campusId: id(2), excelSha256: 'a'.repeat(64), packageVersion: 4,
  rows: [{ id: id(3), fingerprint: 'b'.repeat(64), version: 1, decision: { action: 'CREATE_DOSSIER', reason: 'Synthetic explicit decision', overrides: { program: '', educationLevel: '' } } }] });
function harness() {
  const p = plan(); let row = { id: id(3), fingerprint: 'b'.repeat(64), version: 1, state: 'REVIEW' }, persisted, calls = 0, lost = false, body;
  return { p, get journal() { return persisted; }, get calls() { return calls; }, set state(value) { row.state = value; }, lose() { lost = true; },
    persist: async s => { persisted = structuredClone(s); },
    request: async (url, init) => {
      if (url.endsWith('/decision')) {
        calls++; assert.equal(persisted.decisions[id(3)].phase, 'INTENT');
        if (body) assert.equal(init.body, body); else body = init.body;
        row = { ...row, version: 2, state: 'READY' };
        if (lost) { lost = false; throw Error('response_lost'); }
        return row;
      }
      if (url.includes('/rows?')) return { items: [row], nextAfter: null };
      return { id: p.packageId, campusId: p.campusId, sha256: p.excelSha256, version: 4, state: 'PARTIAL', counts: { total: 1 } };
    } };
}
test('bounded plans reject duplicates, oversized blocks, supplied replay keys and implicit deferral', () => {
  const p = plan(); assert.equal(validateOperatorPlan(p).length, 64);
  assert.throws(() => validateOperatorPlan({ ...p, rows: [...p.rows, ...p.rows] }));
  assert.throws(() => validateOperatorPlan({ ...p, rows: Array.from({ length: 26 }, (_, n) => ({ ...p.rows[0], id: id(n + 10) })) }));
  p.rows[0].decision.idempotencyKey = 'untrusted'; assert.throws(() => validateOperatorPlan(p));
  delete p.rows[0].decision.idempotencyKey; p.rows[0].decision.action = 'DEFER'; assert.throws(() => validateOperatorPlan(p));
});
test('decision is journalled before official POST, without confirm or SQL', async () => {
  const h = harness(); const result = await decideOperatorBlock({ plan: h.p, ...h, exclusiveLockHeld: true });
  assert.equal(result.complete, true); assert.equal(result.decisions[id(3)].phase, 'PERSISTED'); assert.equal(h.calls, 1);
});
test('lost response resumes same intent/key; no cursor is advanced on uncertainty', async () => {
  const h = harness(); h.lose();
  await assert.rejects(decideOperatorBlock({ plan: h.p, ...h, exclusiveLockHeld: true }), /response_lost/);
  assert.equal(h.journal.complete, false); assert.equal(h.journal.decisions[id(3)].phase, 'INTENT');
  const result = await decideOperatorBlock({ plan: h.p, request: h.request, persist: h.persist, journal: h.journal, exclusiveLockHeld: true });
  assert.equal(result.complete, true); assert.equal(h.calls, 2);
});
test('preserves existing accepted rows without replay', async () => {
  const h = harness(); h.state = 'ACCEPTED';
  const result = await decideOperatorBlock({ plan: h.p, ...h, exclusiveLockHeld: true });
  assert.equal(h.calls, 0); assert.equal(result.decisions[id(3)].phase, 'PRESERVED_TERMINAL');
});
test('requires exclusive lock and exact package binding', async () => {
  const h = harness(); await assert.rejects(decideOperatorBlock({ plan: h.p, ...h }), /lock_required/);
  const changed = { ...h.p, packageVersion: 5 };
  await assert.rejects(decideOperatorBlock({ plan: changed, ...h, exclusiveLockHeld: true }), /package_changed/);
  assert.equal(h.calls, 0);
});
test('cursor cycles and duplicate rows fail closed', async () => {
  await assert.rejects(readOperatorRows(async () => ({ items: [{ id: id(3) }], nextAfter: id(3) }), id(1)), /collision/);
});
test('authentication failure stops without manufacturing a result', async () => {
  const h = harness(); const request = (url, init) => init ? Promise.reject(Object.assign(Error('denied'), { status: 403 })) : h.request(url);
  await assert.rejects(decideOperatorBlock({ plan: h.p, request, persist: h.persist, exclusiveLockHeld: true }), /denied/);
  assert.equal(h.journal.complete, false);
});
