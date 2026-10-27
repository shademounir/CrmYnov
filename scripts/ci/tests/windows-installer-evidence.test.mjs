import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixtureCases, fixtureRootFiles, probeSource, guardSource, verifyWindowsFixtureArtifact} from '../windows-installer-evidence.mjs';
import {productionSources} from '../powershell-command-coverage.mjs';

// These documents are SYNTHETIC unit inputs, never official/native receipts.
const h = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));
const sourceBytes = Buffer.from('Write-Output 1\r\nWrite-Output 2\r\n');
const commands = [{line: 1, column: 1}, {line: 2, column: 1}];
const sourcePaths = [...productionSources, 'scripts/telephony-agent/test-installer-transactions.ps1'];
const windows = path => `C:\\synthetic\\repo\\${path.replaceAll('/', '\\')}`;
const get = (f, name) => JSON.parse(f.files.get(name));
const set = (f, name, data) => f.files.set(name, encode(data));
const edit = (f, name, mutate) => { const data = get(f, name); mutate(data); set(f, name, data); };

function seal(f) {
  const names = [...fixtureRootFiles, ...fixtureCases.flatMap(id => [`${id}.INTENT.json`, `${id}.RESULT.json`])].sort();
  const manifest = {schemaVersion: 1, kind: 'WINDOWS_INSTALLER_FIXTURE_EVIDENCE', head: f.expected.head, tree: f.expected.tree, runId: f.expected.runId, runAttempt: f.expected.runAttempt, files: names.map(path => ({path, bytes: f.files.get(path).length, sha256: h(f.files.get(path))}))};
  set(f, 'artifact-manifest.json', manifest);
  f.expected.manifestSha256 = h(f.files.get('artifact-manifest.json'));
  f.expected.reportSha256 = h(f.files.get('coverage-evidence.json'));
  return f;
}

function rebind(f, role, name) {
  const sha = h(f.files.get(name));
  edit(f, 'coverage-evidence.json', report => { const r = report.inputReferences.find(item => item.role === role); r.sha256Before = sha; r.sha256After = sha; });
  edit(f, 'FIXTURE-INTENT.json', intent => {intent.inputReferences.find(item => item.role === role).sha256Before = sha;});
}

function fixture() {
  const f = {files: new Map(), expected: {head: 'a'.repeat(40), tree: 'b'.repeat(40), runId: '123', runAttempt: '2', artifactId: '456', artifactDigest: 'c'.repeat(64)}, sources: new Map([...sourcePaths, probeSource, guardSource].map(path => [path, sourceBytes]))};
  set(f, 'source-manifest.json', {schemaVersion: 1, head: f.expected.head, tree: f.expected.tree, sources: sourcePaths.map(path => ({path, sha256: h(sourceBytes)}))});
  const references = [
    {role: 'SOURCE_MANIFEST', path: 'C:\\synthetic\\source-manifest.json', sha256Before: h(f.files.get('source-manifest.json'))},
    {role: 'EXIT_PROBE_EVIDENCE', path: 'C:\\synthetic\\probe-evidence.json', sha256Before: ''},
    {role: 'EXIT_PROBE_SOURCE', path: windows(probeSource), sha256Before: h(sourceBytes)},
    {role: 'POWERSHELL_INTERPRETER', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', sha256Before: 'd'.repeat(64)},
    {role: 'TEST_TOOLING_GUARD', path: windows(guardSource), sha256Before: h(sourceBytes)},
  ];
  set(f, 'probe-evidence.json', {sourceAndInterpreterBeforeAfterVerified: true, record: {schemaVersion: 1, status: 'PASS', parentContinued: true, childExitCode: 0, childBreakpointHits: 1, installerExecuted: false, registryOrSdkUsed: false, powerShellVersion: '5.1.synthetic'}, references: references.filter(r => ['EXIT_PROBE_SOURCE', 'POWERSHELL_INTERPRETER'].includes(r.role)).map(r => ({path: r.path, sha256: r.sha256Before}))});
  references[1].sha256Before = h(f.files.get('probe-evidence.json'));
  const reportRefs = references.map(r => ({...r, sha256After: r.sha256Before}));
  set(f, 'FIXTURE-INTENT.json', {head: f.expected.head, tree: f.expected.tree, status: 'INTENT_ONLY_NOT_RESULT', syntheticPackageOnly: true, packagedExeTested: false, inputReferences: references});
  set(f, 'framework-provenance.json', {version: '3.4.0', payloadAuthenticatedByThisReport: false, files: [{path: 'Pester.psm1', sha256: 'e'.repeat(64)}]});
  const results = fixtureCases.map((id, index) => {
    const startUtc = new Date(index * 2000).toISOString(), endUtc = new Date(index * 2000 + 1000).toISOString();
    set(f, `${id}.INTENT.json`, {id, head: f.expected.head, status: 'INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT', startUtc});
    const result = {id, status: 'PASS', installerLeaseReleased: true, startUtc, endUtc};
    set(f, `${id}.RESULT.json`, result);
    return result;
  });
  set(f, 'coverage-evidence.json', {schemaVersion: 1, head: f.expected.head, tree: f.expected.tree, status: 'PASS', evidenceKind: 'NATIVE_POWERSHELL_COMMAND_BREAKPOINTS', sourceBeforeAfterVerified: true, sources: sourcePaths.map(path => ({path, sha256: h(sourceBytes), classification: productionSources.includes(path) ? 'PRODUCTION' : 'TEST', lineCount: 3, commands})), observations: sourcePaths.map(sourcePath => ({sourcePath, executedPath: windows(sourcePath), sha256Before: h(sourceBytes), sha256After: h(sourceBytes), commands: commands.map(command => ({...command, hitCount: 0}))})), inputReferences: reportRefs, testCases: results, interpreterVersionObserved: '5.1.synthetic', frameworkProvenanceSha256: h(f.files.get('framework-provenance.json')), githubIdentityAuthenticatedByThisReport: false, probeAuthorityAuthenticatedByThisReport: false, syntheticPackageOnly: true, packagedExeTested: false, standardUserOrUacAcceptance: false, sdkSipUserOrProductionAcceptance: false, actualHistorical0413UpgradeTested: false, interruptedUninstallTested: false, unknownOutcomeCleanupAttempted: false});
  return seal(f);
}

const verify = f => verifyWindowsFixtureArtifact({expected: f.expected, files: f.files, readSource: path => f.sources.get(path)});
const refuses = (change, code) => {const f = fixture(); change(f); seal(f); assert.throws(() => verify(f), {message: `WINDOWS_FIXTURE_${code}`});};

test('synthetic unit documents are consistent but never become native or official acceptance', () => {
  const result = verify(fixture());
  assert.equal(result.officialEvidenceAuthenticated, false);
  assert.equal(result.nativeAcceptance, false);
  assert.equal(result.files.length, 3);
  assert(result.files.every(file => file.commandsHit === 0));
});

const cases = [
  ['wrong artifact ID shape', f => {f.expected.artifactId = '-1';}, 'RUN_OR_ARTIFACT_ID_INVALID'],
  ['unclaimed native acceptance', f => edit(f, 'coverage-evidence.json', r => {r.packagedExeTested = true;}), 'SCOPE_CLAIM'],
  ['self-authenticated JSON', f => edit(f, 'coverage-evidence.json', r => {r.githubIdentityAuthenticatedByThisReport = true;}), 'SCOPE_CLAIM'],
  ['different report head', f => edit(f, 'coverage-evidence.json', r => {r.head = 'f'.repeat(40);}), 'REPORT_CONTEXT'],
  ['failed report', f => edit(f, 'coverage-evidence.json', r => {r.status = 'FAILED';}), 'REPORT_CONTEXT'],
  ['manifest source drift', f => edit(f, 'source-manifest.json', r => {r.sources[0].sha256 = 'f'.repeat(64);}), 'LOCAL_SOURCE_CHANGED'],
  ['duplicate source', f => edit(f, 'source-manifest.json', r => {r.sources[0] = r.sources[1];}), 'SOURCE_INVENTORY'],
  ['local byte drift', f => {f.sources.set(sourcePaths[0], Buffer.from('different'));}, 'LOCAL_SOURCE_CHANGED'],
  ['changed input after operation', f => edit(f, 'coverage-evidence.json', r => {r.inputReferences[0].sha256After = 'f'.repeat(64);}), 'INPUT_CHANGED'],
  ['duplicate input role', f => edit(f, 'coverage-evidence.json', r => {r.inputReferences[0] = r.inputReferences[1];}), 'INPUT_REFERENCES'],
  ['source manifest digest not bound', f => edit(f, 'source-manifest.json', r => {r.unboundExtra = true;}), 'INPUT_MANIFEST_DIGEST'],
  ['probe digest not bound', f => edit(f, 'probe-evidence.json', r => {r.unboundExtra = true;}), 'INPUT_PROBE_DIGEST'],
  ['changed probe source', f => {f.sources.set(probeSource, Buffer.from('different'));}, 'PROBE_SOURCE_CHANGED'],
  ['changed pure guard source', f => {f.sources.set(guardSource, Buffer.from('different'));}, 'GUARD_SOURCE_CHANGED'],
  ['intent mismatch', f => edit(f, 'FIXTURE-INTENT.json', r => {r.head = 'f'.repeat(40);}), 'FIXTURE_INTENT'],
  ['intent input mismatch', f => edit(f, 'FIXTURE-INTENT.json', r => {r.inputReferences[0].sha256Before = 'f'.repeat(64);}), 'INTENT_INPUT_MISMATCH'],
  ['missing cases', f => edit(f, 'coverage-evidence.json', r => {r.testCases.pop();}), 'CASES_INCOMPLETE'],
  ['case result disagrees with report', f => edit(f, 'fresh-off.RESULT.json', r => {r.status = 'FAILED';}), 'CASE_RESULT'],
  ['case intent from another head', f => edit(f, 'fresh-off.INTENT.json', r => {r.head = 'f'.repeat(40);}), 'CASE_INTENT'],
  ['nonmonotonic case time', f => {edit(f, 'fresh-off.RESULT.json', r => {r.endUtc = '1969-01-01T00:00:00Z';}); edit(f, 'coverage-evidence.json', r => {r.testCases[0].endUtc = '1969-01-01T00:00:00Z';});}, 'CASE_TIME'],
  ['framework unbound', f => edit(f, 'framework-provenance.json', r => {r.version = '999';}), 'FRAMEWORK_DIGEST'],
];
for (const [name, mutate, code] of cases) test(`refuses ${name}`, () => refuses(mutate, code));

test('probe must actually continue in the bound interpreter with a real counter', () => {
  for (const [field, value, code] of [['parentContinued', false, 'PROBE_NOT_PASS'], ['childBreakpointHits', 0, 'PROBE_SCOPE'], ['powerShellVersion', '7.0', 'INTERPRETER_VERSION']]) {
    const f = fixture(); edit(f, 'probe-evidence.json', p => {p.record[field] = value;}); rebind(f, 'EXIT_PROBE_EVIDENCE', 'probe-evidence.json'); seal(f);
    assert.throws(() => verify(f), {message: `WINDOWS_FIXTURE_${code}`});
  }
});

test('mismatched Windows interpreter/source references are rejected', () => {
  const f = fixture(); edit(f, 'probe-evidence.json', p => {p.references[0].sha256 = 'f'.repeat(64);}); rebind(f, 'EXIT_PROBE_EVIDENCE', 'probe-evidence.json'); seal(f);
  assert.throws(() => verify(f), /WINDOWS_FIXTURE_PROBE_REFERENCE_MISMATCH/u);
});

test('another run, unlisted files and manifest byte tampering cannot be imported', () => {
  const run = fixture(); run.expected.runId = '999'; assert.throws(() => verify(run), /MANIFEST_CONTEXT_MISMATCH/u);
  const extra = fixture(); extra.files.set('agent.exe', Buffer.from('inert')); assert.throws(() => verify(extra), /UNLISTED_FILE/u);
  const tampered = fixture(); edit(tampered, 'artifact-manifest.json', m => {m.runId = '999';}); assert.throws(() => verify(tampered), /MANIFEST_DIGEST/u);
});

test('missing and oversized data fail before conversion', () => {
  const missing = fixture(); missing.files.delete('fresh-off.INTENT.json'); assert.throws(() => verify(missing), /UNLISTED_FILE/u);
  const big = fixture(); big.files.set('probe-evidence.json', Buffer.alloc(4194305)); assert.throws(() => verify(big), /FILE_MISSING_OR_OVERSIZE/u);
});
