// Explicit versioned native entry. It cannot select the historical GENERAL
// UNKNOWN or Ledger FIN paths and has no implicit objective or source root.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {byteHash, digest} from '../pool-reconciliation/controlled-pool-contract-v1.mjs';
import {readPoolPrivateFile} from '../pool-reconciliation/pool-operational-driver-v1.mjs';
import {createReadOnlyGithubReader} from '../pool-reconciliation/pool-driver-github-v1.mjs';
import {createOfficialAccessToken} from '../readonly-probe/rc47-probe-official-auth-v1.mjs';
import {createReadOnlyNativeTransport} from '../pool-reconciliation/pool-native-transaction-v2.mjs';
import {validateReadOnlyObjective} from '../pool-reconciliation/pool-native-output-v1.mjs';
import {readCutoverProtectedSourceV1} from './cutover-protected-source-v1.mjs';
import {authorizeCutoverNativePhaseV1, validateCutoverNativeObjectiveV1} from './cutover-native-authority-v1.mjs';
import {executeCutoverNativeRunV1, openCutoverNativeRunJournalV1} from './cutover-native-run-v1.mjs';

const modes = Object.freeze({'general-pre-v4': 'GENERAL_PRE', 'post-v4': 'POST'});
const names = Object.freeze(['--objective-id', '--objective-file', '--dossier', '--jira-evidence', '--human-scope',
  '--actor', '--grant-digest', '--driver-root', '--adapter-root', '--runner-root', '--journal-dir']);
const H = /^[a-f0-9]{64}$/u;

export function parseCutoverNativeArgumentsV1(args) {
  assert(Array.isArray(args) && Object.hasOwn(modes, args[0]), 'CUTOVER_NATIVE_EXPLICIT_MODE_REQUIRED');
  assert.equal(args.length, 1 + names.length * 2, 'CUTOVER_NATIVE_ARGUMENT_COUNT');
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    assert(names.includes(key) && !Object.hasOwn(options, key) && typeof value === 'string' && value.length > 0,
      'CUTOVER_NATIVE_ARGUMENT_UNKNOWN_OR_DUPLICATE');
    options[key] = value;
  }
  assert(names.every(key => Object.hasOwn(options, key)), 'CUTOVER_NATIVE_ARGUMENT_MISSING');
  for (const key of ['--objective-file', '--dossier', '--jira-evidence', '--human-scope', '--driver-root',
    '--adapter-root', '--runner-root', '--journal-dir']) {
    assert(path.isAbsolute(options[key]) && fs.realpathSync(options[key]) === path.resolve(options[key]),
      'CUTOVER_NATIVE_CANONICAL_PATH_REQUIRED');
  }
  assert.equal(new Set(['--driver-root', '--adapter-root', '--runner-root'].map(key => options[key])).size, 3,
    'CUTOVER_NATIVE_DISTINCT_SOURCE_ROOTS_REQUIRED');
  assert(H.test(options['--grant-digest']) && /^[a-zA-Z0-9-]{3,80}$/u.test(options['--actor']),
    'CUTOVER_NATIVE_ACTOR_OR_GRANT_REQUIRED');
  return {phase: modes[args[0]], options};
}

export function validateCutoverNativeHostV1({nodeVersion, environment}) {
  assert.equal(nodeVersion, '22.23.3', 'CUTOVER_NATIVE_NODE_PIN');
  assert(!environment.NODE_OPTIONS && !environment.NODE_PATH, 'CUTOVER_NATIVE_NODE_OVERRIDE_REFUSED');
  assert(!Object.keys(environment).some(key => /^GIT_/iu.test(key)), 'CUTOVER_NATIVE_GIT_OVERRIDE_REFUSED');
}

async function runCore(args, dependencies, syntheticOnly) {
  if (!syntheticOnly) validateCutoverNativeHostV1({nodeVersion: process.versions.node, environment: process.env});
  const {phase, options} = parseCutoverNativeArgumentsV1(args), clock = dependencies.clock ?? Date.now;
  const entry = JSON.parse(readPoolPrivateFile(options['--objective-file'], 262144));
  const dossier = JSON.parse(readPoolPrivateFile(options['--dossier'], 262144));
  const jiraBytes = readPoolPrivateFile(options['--jira-evidence'], 65536);
  const humanScopeBytes = readPoolPrivateFile(options['--human-scope'], 65536);
  validateReadOnlyObjective(dossier.objective);
  assert.equal(entry.id, options['--objective-id'], 'CUTOVER_NATIVE_OBJECTIVE_ARGUMENT_CROSSED');
  assert.equal(entry.dossierSha256, digest(dossier), 'CUTOVER_NATIVE_DOSSIER_HASH');
  assert.equal(entry.journalDirectorySha256, byteHash(options['--journal-dir']), 'CUTOVER_NATIVE_JOURNAL_HASH');
  validateCutoverNativeObjectiveV1(entry, {phase, objectiveId: entry.id,
    resourceBindingSha256: entry.resourceBindingSha256, expectedJob: dossier.objective.jobName,
    expectedUid: entry.uid, now: clock()});
  const readSource = dependencies.readSource ?? readCutoverProtectedSourceV1;
  const localDriver = readSource(options['--driver-root'], entry.driver);
  const localAdapter = readSource(options['--adapter-root'], entry.adapter);
  const localRunner = readSource(options['--runner-root'], entry.runner);
  const journal = openCutoverNativeRunJournalV1(options['--journal-dir']);
  const github = dependencies.github ?? createReadOnlyGithubReader();
  let authority;
  const authorize = dependencies.authorize ?? (async () => {
    authority = await authorizeCutoverNativePhaseV1({github, phase, objectiveId: entry.id,
      resourceBindingSha256: entry.resourceBindingSha256, expectedJob: entry.job, expectedUid: entry.uid,
      dossierSha256: entry.dossierSha256, journalDirectorySha256: entry.journalDirectorySha256,
      expectedEntry: entry, jiraBytes, humanScopeBytes, localDriver, localAdapter, localRunner, clock});
    return authority;
  });
  const accessToken = dependencies.native ? undefined : createOfficialAccessToken({account: 'casablancaynovcampus@gmail.com',
    gcloudPath: 'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/lib/gcloud.py',
    pythonPath: 'C:/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe'});
  const native = dependencies.native ?? createReadOnlyNativeTransport({purpose: entry.scope, accessToken,
    getAuthority: () => authority, clock, diagnostic: {objectiveId: entry.id,
      objectiveSha256: dossier.objective.objectiveSha256, stage: 'RUN'},
    saveDiagnostic: value => { if (journal.claimExists()) journal.stop({phase, objectiveId: entry.id,
      state: 'NATIVE_DIAGNOSTIC_AFTER_CLAIM', diagnostic: value, sheetsActivated: false}); }});
  return executeCutoverNativeRunV1({phase, entry, dossier, jiraBytes, humanScopeBytes,
    actor: options['--actor'], grantSha256: options['--grant-digest'],
    authorize: async (...input) => {authority = await authorize(...input); return authority;}, native, journal, clock});
}

export async function runCutoverNativeCliV1(args) { return runCore(args, {}, false); }

// No production CLI route can inject these dependencies. Simulations still
// traverse the exact parser, persisted inputs, objective validator and run
// boundary, but cannot accidentally be represented as native acceptance.
export async function simulateCutoverNativeCliV1({syntheticOnly, args, dependencies}) {
  assert.equal(syntheticOnly, true);
  assert(dependencies && typeof dependencies.readSource === 'function' &&
    typeof dependencies.authorize === 'function' && dependencies.native,
  'CUTOVER_NATIVE_SYNTHETIC_DEPENDENCIES_REQUIRED');
  return {...await runCore(args, dependencies, true), syntheticOnly: true, nativeAuthority: false};
}
