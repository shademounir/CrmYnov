// Resolve each protected source from its own clean checkout. A runner checkout
// cannot stand in for the PR282 driver or PR294 adapter even if files overlap.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {POOL_OFFICIAL_GIT} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {fixedToolEnvironment} from '../readonly-probe/probe-driver-github-v1.mjs';

const H = /^[a-f0-9]{64}$/u, S = /^[a-f0-9]{40}$/u;

function readSource(root, expected, git) {
  assert(typeof root === 'string' && path.isAbsolute(root), 'CUTOVER_SOURCE_ABSOLUTE_ROOT');
  const resolved = path.resolve(root);
  assert.equal(fs.realpathSync(root), resolved, 'CUTOVER_SOURCE_CANONICAL_ROOT');
  assert(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), 'CUTOVER_SOURCE_DIRECTORY');
  assert(expected && Object.getPrototypeOf(expected) === Object.prototype && S.test(expected.mergeCommit) &&
    S.test(expected.tree) && Array.isArray(expected.files) && expected.files.length > 0 && expected.files.length <= 250,
  'CUTOVER_SOURCE_EXPECTED_DESCRIPTOR');
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '', 'CUTOVER_SOURCE_CLEAN_CHECKOUT_REQUIRED');
  assert.equal(git(['rev-parse', 'HEAD']), expected.mergeCommit, 'CUTOVER_SOURCE_COMMIT_MISMATCH');
  assert.equal(git(['show', '-s', '--format=%T', 'HEAD']), expected.tree, 'CUTOVER_SOURCE_TREE_MISMATCH');
  const files = expected.files.map(file => {
    assert(file && Object.getPrototypeOf(file) === Object.prototype &&
      Object.keys(file).sort().join(',') === 'path,sha256' &&
      typeof file.path === 'string' && /^(?:scripts|docs)\/[a-zA-Z0-9_./-]+\.(?:mjs|json|yml|md)$/u.test(file.path) &&
      !file.path.includes('..') && H.test(file.sha256), 'CUTOVER_SOURCE_FILE_DESCRIPTOR');
    git(['ls-files', '--error-unmatch', '--', file.path]);
    const target = path.resolve(resolved, file.path);
    assert(target.startsWith(resolved + path.sep), 'CUTOVER_SOURCE_FILE_OUTSIDE_ROOT');
    assert(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), 'CUTOVER_SOURCE_FILE_TYPE');
    assert.equal(createHash('sha256').update(fs.readFileSync(target)).digest('hex'), file.sha256, 'CUTOVER_SOURCE_FILE_HASH');
    return {path: file.path, sha256: file.sha256};
  });
  assert.deepEqual(files.map(file => file.path), [...new Set(files.map(file => file.path))].sort((a, b) => a.localeCompare(b, 'en')),
    'CUTOVER_SOURCE_FILE_ORDER');
  return {commit: expected.mergeCommit, tree: expected.tree, head: expected.head,
    pr: expected.pr, files, clean: true};
}

export function readCutoverProtectedSourceV1(root, expected) {
  assert(!Object.keys(process.env).some(key => /^GIT_/iu.test(key)), 'CUTOVER_SOURCE_AMBIENT_GIT_REFUSED');
  assert.equal(fs.realpathSync(POOL_OFFICIAL_GIT), path.win32.normalize(POOL_OFFICIAL_GIT), 'CUTOVER_SOURCE_OFFICIAL_GIT');
  const git = args => execFileSync(POOL_OFFICIAL_GIT, ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1048576,
    env: fixedToolEnvironment(process.env),
  }).trim();
  return readSource(root, expected, git);
}

export function simulateReadCutoverProtectedSourceV1({syntheticOnly, root, expected, git}) {
  assert.equal(syntheticOnly, true);
  assert.equal(typeof git, 'function');
  return {...readSource(root, expected, git), syntheticOnly: true, nativeAuthority: false};
}
