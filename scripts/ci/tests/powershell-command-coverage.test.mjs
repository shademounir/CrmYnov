import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {convertPowerShellCoverage, productionSources} from '../powershell-command-coverage.mjs';

const testPath = 'scripts/telephony-agent/test-installer-transactions.ps1';
const bytes = Buffer.from('Write-Output 1; Write-Output 2\r\nWrite-Output 3\r\n');
const sha = createHash('sha256').update(bytes).digest('hex');
const inventory = [{line: 1, column: 1}, {line: 1, column: 17}, {line: 2, column: 1}];
const fixture = () => ({
  schemaVersion: 1, status: 'PASS', evidenceKind: 'NATIVE_POWERSHELL_COMMAND_BREAKPOINTS',
  sourceBeforeAfterVerified: true, head: 'a'.repeat(40), tree: 'b'.repeat(40),
  testCases: [{id: 'synthetic-converter-only', status: 'PASS'}],
  sources: productionSources.map(path => ({path, sha256: sha, lineCount: 3, classification: 'PRODUCTION', commands: structuredClone(inventory)})),
  observations: productionSources.map((sourcePath, index) => ({sourcePath, executedPath: `C:\\synthetic\\${index}.ps1`, sha256Before: sha, sha256After: sha, commands: inventory.map(command => ({...command, hitCount: 0}))})),
});
const convert = report => convertPowerShellCoverage(report, () => bytes);
const rejects = (mutate, code) => {
  const report = fixture();
  mutate(report);
  assert.throws(() => convert(report), {message: `POWERSHELL_COVERAGE_${code}`});
};

test('converter preserves real zero observations without claiming native or authenticated evidence', () => {
  const result = convert(fixture());
  assert.equal(result.files.length, 3);
  assert(result.files.every(file => file.commandsHit === 0));
  assert.equal((result.xml.match(/covered="false"/gu) ?? []).length, 6);
  assert.equal(result.branchCoverageMeasured, false);
  assert.equal(result.officialEvidenceAuthenticated, false);
  assert.equal(result.nativeAcceptance, false);
  assert.doesNotMatch(result.xml, /branchesToCover|coveredBranches/u);
});

test('partial lines remain uncovered; identical-source observations can accumulate genuine commands', () => {
  const report = fixture();
  report.observations[0].commands[0].hitCount = 5;
  assert.equal(convert(report).files[0].lines[0].covered, false);
  const second = structuredClone(report.observations[0]);
  second.executedPath = 'C:\\synthetic\\installed-copy.ps1';
  second.commands[0].hitCount = 0;
  second.commands[1].hitCount = 1;
  report.observations.push(second);
  assert.equal(convert(report).files[0].lines[0].covered, true);
  assert.equal(convert(report).files[0].lines[1].covered, false);
});

test('actual test source cannot inflate production coverage', () => {
  const report = fixture();
  report.sources.push({...structuredClone(report.sources[0]), path: testPath, classification: 'TEST'});
  report.observations.push({...structuredClone(report.observations[0]), sourcePath: testPath, executedPath: 'C:\\synthetic\\test.ps1', commands: inventory.map(command => ({...command, hitCount: 1000}))});
  const result = convert(report);
  assert.deepEqual(result.testsExcludedFromProductionReport, [testPath]);
  assert(result.files.every(file => file.commandsHit === 0));
  assert(!result.xml.includes(testPath));
});

const invalidReports = [
  ['failed report', r => {r.status = 'FAIL';}, 'REPORT_NOT_PASS'],
  ['wrong schema', r => {r.schemaVersion = 2;}, 'REPORT_NOT_PASS'],
  ['unverified sources', r => {r.sourceBeforeAfterVerified = false;}, 'EVIDENCE_KIND_INVALID'],
  ['non-native counters', r => {r.evidenceKind = 'ASSERTION_COUNT';}, 'EVIDENCE_KIND_INVALID'],
  ['head missing', r => {r.head = '';}, 'REVISION_INVALID'],
  ['tree invalid', r => {r.tree = 'b'.repeat(39);}, 'REVISION_INVALID'],
  ['no cases', r => {r.testCases = [];}, 'CASES_REQUIRED'],
  ['pending case', r => {r.testCases[0].status = 'PENDING';}, 'CASE_NOT_PASS'],
  ['numeric case ID', r => {r.testCases[0].id = 123;}, 'CASE_NOT_PASS'],
  ['duplicate cases', r => {r.testCases.push(structuredClone(r.testCases[0]));}, 'DUPLICATE_CASE'],
  ['missing production source', r => {r.sources.pop();}, 'PRODUCTION_SOURCE_MISSING'],
  ['duplicate source', r => {r.sources.push(structuredClone(r.sources[0]));}, 'DUPLICATE_SOURCE'],
  ['arbitrary source', r => {r.sources[0].path = '../private.ps1';}, 'SOURCE_NOT_ALLOWED'],
  ['null source', r => {r.sources[0] = null;}, 'SOURCE_NOT_ALLOWED'],
  ['production misclassified as test', r => {r.sources[0].classification = 'TEST';}, 'SOURCE_CLASSIFICATION'],
  ['bad source hash', r => {r.sources[0].sha256 = 'x';}, 'SOURCE_HASH_INVALID'],
  ['source changed', r => {r.sources[0].sha256 = 'c'.repeat(64);}, 'SOURCE_HASH_MISMATCH'],
  ['wrong lines', r => {r.sources[0].lineCount = 4;}, 'SOURCE_LINE_COUNT'],
  ['empty inventory', r => {r.sources[0].commands = [];}, 'COMMAND_INVENTORY_REQUIRED'],
  ['duplicate coordinate', r => {r.sources[0].commands.push({...inventory[0]});}, 'DUPLICATE_COMMAND'],
  ['line outside source', r => {r.sources[0].commands[0].line = 100;}, 'LINE_INVALID'],
  ['column outside source', r => {r.sources[0].commands[0].column = 100;}, 'COLUMN_INVALID'],
  ['missing observations', r => {r.observations = [];}, 'OBSERVATIONS_REQUIRED'],
  ['unobserved production', r => {r.observations.pop();}, 'PRODUCTION_OBSERVATION_MISSING'],
  ['unknown observation source', r => {r.observations[0].sourcePath = 'private.ps1';}, 'OBSERVATION_SOURCE_UNKNOWN'],
  ['copy changed before', r => {r.observations[0].sha256Before = 'c'.repeat(64);}, 'OBSERVATION_HASH_MISMATCH'],
  ['copy changed after', r => {r.observations[0].sha256After = 'c'.repeat(64);}, 'OBSERVATION_HASH_MISMATCH'],
  ['partial inventory', r => {r.observations[0].commands.pop();}, 'INCOMPLETE_COMMAND_INVENTORY'],
  ['different coordinate', r => {r.observations[0].commands[0].column = 2;}, 'COMMAND_INVENTORY_MISMATCH'],
  ['repeated coordinate', r => {r.observations[0].commands[1] = {...r.observations[0].commands[0]};}, 'COMMAND_INVENTORY_MISMATCH'],
  ['negative hits', r => {r.observations[0].commands[0].hitCount = -1;}, 'HIT_COUNT_INVALID'],
  ['fractional hits', r => {r.observations[0].commands[0].hitCount = 0.5;}, 'HIT_COUNT_INVALID'],
  ['unsafe hits', r => {r.observations[0].commands[0].hitCount = Number.MAX_SAFE_INTEGER + 1;}, 'HIT_COUNT_INVALID'],
  ['relative executed path', r => {r.observations[0].executedPath = 'local.ps1';}, 'EXECUTED_PATH_INVALID'],
  ['UNC executed path', r => {r.observations[0].executedPath = '\\\\host\\share\\x.ps1';}, 'EXECUTED_PATH_INVALID'],
  ['path traversal', r => {r.observations[0].executedPath = 'C:\\synthetic\\..\\x.ps1';}, 'EXECUTED_PATH_INVALID'],
  ['ambiguous dot path', r => {r.observations[0].executedPath = 'C:\\synthetic.\\x.ps1';}, 'EXECUTED_PATH_INVALID'],
  ['device path', r => {r.observations[0].executedPath = 'C:\\synthetic\\CON.ps1';}, 'EXECUTED_PATH_INVALID'],
  ['same alias for different sources', r => {r.observations[1].executedPath = r.observations[0].executedPath.toUpperCase();}, 'ALIAS_SOURCE_CONFLICT'],
  ['overflow across observations', r => {r.observations[0].commands[0].hitCount = Number.MAX_SAFE_INTEGER; const next = structuredClone(r.observations[0]); next.commands[0].hitCount = 1; r.observations.push(next);}, 'HIT_COUNT_OVERFLOW'],
];
for (const [name, mutate, code] of invalidReports) test(`refuses ${name}`, () => rejects(mutate, code));

test('source reader must return the exact bounded raw bytes', () => {
  assert.throws(() => convertPowerShellCoverage(fixture(), () => bytes.toString()), /SOURCE_BYTES_INVALID/u);
  assert.throws(() => convertPowerShellCoverage(fixture(), null), /SOURCE_READER_REQUIRED/u);
});
