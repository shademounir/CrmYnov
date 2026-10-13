import { open, readdir, readFile, lstat, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { operatorHash, validateOperatorPlan, decideOperatorBlock } from './bootstrap-operator.mjs';

// The caller supplies a pre-existing private directory. No automatic stale-lock
// recovery: a crash must be reconciled before another writer can acquire it.
export async function withOperatorJournal(directory, packageId, run) {
  if (!/^[a-f0-9-]{36}$/i.test(packageId)) throw Error('operator_package_invalid');
  const root = resolve(directory);
  for (let cursor = root;; cursor = dirname(cursor)) {
    const stat = await lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('operator_journal_directory_invalid');
    if (dirname(cursor) === cursor) break;
  }
  const prefix = `operator-${packageId}-`;
  const lockPath = join(root, `${prefix}lock`);
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync();
    const names = (await readdir(root)).filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort();
    let sequence = 0, previousHash = null, journal = null;
    for (const name of names) {
      const expected = `${prefix}${String(sequence + 1).padStart(6, '0')}.json`;
      if (name !== expected || (await lstat(join(root, name))).isSymbolicLink()) throw Error('operator_journal_sequence_invalid');
      const record = JSON.parse(await readFile(join(root, name), 'utf8'));
      const { hash, ...content } = record;
      if (hash !== operatorHash(content) || content.sequence !== sequence + 1 || content.previousHash !== previousHash) throw Error('operator_journal_integrity_invalid');
      sequence++; previousHash = hash; journal = content.state;
    }
    const persist = async state => {
      const content = { sequence: sequence + 1, previousHash, state: structuredClone(state) };
      const hash = operatorHash(content);
      const file = await open(join(root, `${prefix}${String(sequence + 1).padStart(6, '0')}.json`), 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ ...content, hash })); await file.sync(); } finally { await file.close(); }
      sequence++; previousHash = hash; journal = structuredClone(state);
    };
    return await run({ journal, persist, exclusiveLockHeld: true });
  } finally { await lock.close(); await unlink(lockPath); }
}

export async function runJournalledDecisionBlock({ directory, plan, request }) {
  validateOperatorPlan(plan);
  return withOperatorJournal(directory, plan.packageId, state => decideOperatorBlock({ plan, request, ...state }));
}
