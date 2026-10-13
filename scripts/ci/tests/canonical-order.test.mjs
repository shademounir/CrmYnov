import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compareCanonicalStrings } from '../../canonical-order.mjs';
import { createManifest, validateManifest } from '../../release-manifest/index.mjs';

test('canonical comparator preserves historical UTF-16 ordering, not locale/numeric collation', () => {
  const values = ['CRMY-62', 'CRMY-176', 'z', 'Z', 'é', 'e', '02', '2', '10', '', '😀', '\uE000', 'a-b', 'a_b', 'a.b'];
  const oldOrder = [...values].sort();
  assert.deepEqual([...values].sort(compareCanonicalStrings), oldOrder);
  assert.equal(compareCanonicalStrings('same', 'same'), 0);
  for (const left of values) for (const right of values) {
    assert.equal(compareCanonicalStrings(left, right), left === right ? 0 : left < right ? -1 : 1);
  }
});

test('release manifest digest remains compatible with historically sorted ticket lists', () => {
  const manifest = createManifest({version:'v0.1.0-rc.18',profile:'application',targetCommit:'e97cfb2c0f0e7bf3448fa69bd785b17a5e7314f3',tickets:['CRMY-62','CRMY-176',' crmy-62 ']});
  assert.deepEqual(manifest.tickets, ['CRMY-176','CRMY-62']);
  assert.equal(manifest.sha256, '29c5aca4dcce668148f5e2916feb50285d283f1fb64e30dec424d2994e9973de');
  assert.deepEqual(validateManifest(manifest), manifest);
});

test('journal filenames and audit label bytes retain their old digest', () => {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const values of [['operator-000010.json','operator-000002.json','operator-000001.json'],['codex-ready','sensitive-scope','CRMY-62','a_b','a-b']]) {
    assert.equal(hash([...values].sort(compareCanonicalStrings)), hash([...values].sort()));
  }
});
