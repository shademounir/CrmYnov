import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {byteHash} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {simulateReadCutoverProtectedSourceV1} from './cutover-protected-source-v1.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cutover-source-synthetic-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = args => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', timeout: 15000}).trim();
  git(['init', '-q']);
  for (const [name, body] of [['docs/governance/synthetic.json', '{}\n'],
    ['scripts/ci/synthetic.mjs', 'export const synthetic = true;\n']]) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, body);
  }
  git(['add', '--', 'docs/governance/synthetic.json', 'scripts/ci/synthetic.mjs']);
  git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic']);
  const expected = {pr: 900, head: 'a'.repeat(40), mergeCommit: git(['rev-parse', 'HEAD']),
    tree: git(['show', '-s', '--format=%T', 'HEAD']), files: [
      {path: 'docs/governance/synthetic.json', sha256: byteHash(fs.readFileSync(path.join(root, 'docs/governance/synthetic.json')))},
      {path: 'scripts/ci/synthetic.mjs', sha256: byteHash(fs.readFileSync(path.join(root, 'scripts/ci/synthetic.mjs')))},
    ]};
  return {root, git, expected};
}

test('synthetic source verifier checks clean HEAD/tree/tracked paths and exact file bytes', t => {
  const f = fixture(t);
  const result = simulateReadCutoverProtectedSourceV1({syntheticOnly: true, ...f});
  assert.equal(result.commit, f.expected.mergeCommit);
  assert.equal(result.files.length, 2); assert.equal(result.clean, true);
  assert.equal(result.nativeAuthority, false);
  const wrongHash = structuredClone(f.expected); wrongHash.files[0].sha256 = '0'.repeat(64);
  assert.throws(() => simulateReadCutoverProtectedSourceV1({syntheticOnly: true, root: f.root,
    git: f.git, expected: wrongHash}), /CUTOVER_SOURCE_FILE_HASH/u);
  const wrongTree = structuredClone(f.expected); wrongTree.tree = '0'.repeat(40);
  assert.throws(() => simulateReadCutoverProtectedSourceV1({syntheticOnly: true, root: f.root,
    git: f.git, expected: wrongTree}), /CUTOVER_SOURCE_TREE_MISMATCH/u);
  fs.writeFileSync(path.join(f.root, 'scripts/ci/synthetic.mjs'), 'changed\n');
  assert.throws(() => simulateReadCutoverProtectedSourceV1({syntheticOnly: true, ...f}),
    /CUTOVER_SOURCE_CLEAN_CHECKOUT_REQUIRED/u);
});
