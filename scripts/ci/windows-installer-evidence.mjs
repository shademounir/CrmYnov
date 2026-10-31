import {createHash} from 'node:crypto';
import {convertPowerShellCoverage, productionSources} from './powershell-command-coverage.mjs';

export const fixtureCases = Object.freeze(['fresh-off', 'upgrade-off', 'rollback-off', 'uninstall', 'explicit-uninstall-repeat-not-interruption-proof', 'new-cycle-fresh-off', 'upgrade-on', 'final-uninstall']);
export const fixtureRootFiles = Object.freeze(['coverage-evidence.json', 'source-manifest.json', 'probe-evidence.json', 'framework-provenance.json', 'FIXTURE-INTENT.json']);
export const probeSource = 'scripts/telephony-agent/tests/child-exit-semantics.ps1';
export const guardSource = 'scripts/telephony-agent/tests/windows-fixture-guards.psm1';
export const noticeTestSource = 'scripts/telephony-agent/tests/package-notices.test.ps1';
export const noticePlannerCases = Object.freeze([
  'complete-provenance-plan', 'empty-upstream-copying-not-license-proof', 'libjpeg-name-not-global-sdk-license',
  'runtime-notices-version-bound', 'missing-included-framework', 'duplicate-included-framework', 'additional-framework',
  'malformed-version-path', 'runtime-assets-version-mismatch', 'duplicate-download-dependency', 'wrong-asset-framework',
  'missing-runtime-pack', 'missing-ijg-required', 'wrong-libjpeg-identity', 'missing-core-transitive-notices',
  'empty-runtime-license', 'oversized-notice',
]);
const testSource = 'scripts/telephony-agent/test-installer-transactions.ps1';
const sourcePaths = [...productionSources, testSource];
const requiredFiles = [...fixtureRootFiles, ...fixtureCases.flatMap(id => [`${id}.INTENT.json`, `${id}.RESULT.json`])].sort((a,b)=>a.localeCompare(b,'en'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const demand = (condition, code) => { if (!condition) throw new Error(`WINDOWS_FIXTURE_${code}`); };
const hashValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

function jsonFile(files, name) {
  const bytes = files.get(name);
  demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 4194304, 'FILE_MISSING_OR_OVERSIZE');
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

function expectedBinding(expected) {
  demand(/^[a-f0-9]{40}$/u.test(expected.head ?? '') && /^[a-f0-9]{40}$/u.test(expected.tree ?? ''), 'REVISION_INVALID');
  for (const key of ['runId', 'runAttempt', 'artifactId']) demand(typeof expected[key] === 'string' && /^[1-9]\d*$/u.test(expected[key]), 'RUN_OR_ARTIFACT_ID_INVALID');
  for (const key of ['artifactDigest', 'manifestSha256', 'reportSha256']) demand(hashValue(expected[key]), 'EXPECTED_DIGEST_INVALID');
}

function manifestBinding(manifest, expected, files) {
  demand(manifest.schemaVersion === 1 && manifest.kind === 'WINDOWS_INSTALLER_FIXTURE_EVIDENCE', 'MANIFEST_KIND_INVALID');
  for (const key of ['head', 'tree', 'runId', 'runAttempt']) demand(manifest[key] === expected[key], 'MANIFEST_CONTEXT_MISMATCH');
  demand(Array.isArray(manifest.files) && manifest.files.length === requiredFiles.length, 'MANIFEST_FILES_INVALID');
  const paths = manifest.files.map(file => file.path).sort((a,b)=>a.localeCompare(b,'en'));
  demand(JSON.stringify(paths) === JSON.stringify(requiredFiles), 'MANIFEST_FILE_SET');
  demand(JSON.stringify([...files.keys()].sort((a,b)=>a.localeCompare(b,'en'))) === JSON.stringify([...requiredFiles, 'artifact-manifest.json'].sort((a,b)=>a.localeCompare(b,'en'))), 'UNLISTED_FILE');
  let total = 0;
  for (const item of manifest.files) {
    const bytes = files.get(item.path);
    demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 4194304, 'FILE_MISSING_OR_OVERSIZE');
    demand(Number.isSafeInteger(item.bytes) && item.bytes === bytes.length && hashValue(item.sha256) && digest(bytes) === item.sha256, 'FILE_DIGEST_MISMATCH');
    total += bytes.length;
  }
  demand(total <= 16777216, 'ARTIFACT_OVERSIZE');
}

function sourceBinding(manifest, report, expected, readSource) {
  demand(manifest.schemaVersion === 1 && manifest.head === expected.head && manifest.tree === expected.tree, 'SOURCE_MANIFEST_CONTEXT');
  demand(Array.isArray(manifest.sources) && manifest.sources.length === sourcePaths.length && Array.isArray(report.sources) && report.sources.length === sourcePaths.length, 'SOURCE_INVENTORY');
  for (const path of sourcePaths) {
    const records = manifest.sources.filter(source => source.path === path);
    const observations = report.sources.filter(source => source.path === path);
    demand(records.length === 1 && observations.length === 1, 'SOURCE_INVENTORY');
    const bytes = readSource(path);
    demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1048576, 'LOCAL_SOURCE_BYTES');
    demand(hashValue(records[0].sha256) && records[0].sha256 === digest(bytes) && observations[0].sha256 === records[0].sha256, 'LOCAL_SOURCE_CHANGED');
  }
}

function checkedReferences(report) {
  const roles = ['SOURCE_MANIFEST', 'EXIT_PROBE_EVIDENCE', 'EXIT_PROBE_SOURCE', 'POWERSHELL_INTERPRETER', 'TEST_TOOLING_GUARD'];
  demand(Array.isArray(report.inputReferences) && report.inputReferences.length === roles.length, 'INPUT_REFERENCES');
  const refs = new Map();
  for (const role of roles) {
    const matches = report.inputReferences.filter(reference => reference.role === role);
    demand(matches.length === 1, 'INPUT_REFERENCES');
    const reference = matches[0];
    demand(typeof reference.path === 'string' && /^[A-Za-z]:[\\/]/u.test(reference.path) && reference.path.length <= 4096, 'INPUT_PATH');
    demand(hashValue(reference.sha256Before) && reference.sha256After === reference.sha256Before, 'INPUT_CHANGED');
    refs.set(role, reference);
  }
  return refs;
}

function inputBinding(files, report, refs, readSource) {
  demand(refs.get('SOURCE_MANIFEST').sha256Before === digest(files.get('source-manifest.json')), 'INPUT_MANIFEST_DIGEST');
  demand(refs.get('EXIT_PROBE_EVIDENCE').sha256Before === digest(files.get('probe-evidence.json')), 'INPUT_PROBE_DIGEST');
  demand(refs.get('EXIT_PROBE_SOURCE').sha256Before === digest(readSource(probeSource)), 'PROBE_SOURCE_CHANGED');
  demand(refs.get('TEST_TOOLING_GUARD').sha256Before === digest(readSource(guardSource)), 'GUARD_SOURCE_CHANGED');
  const intent = jsonFile(files, 'FIXTURE-INTENT.json');
  demand(intent.head === report.head && intent.tree === report.tree && intent.status === 'INTENT_ONLY_NOT_RESULT' && intent.syntheticPackageOnly === true && intent.packagedExeTested === false, 'FIXTURE_INTENT');
  demand(Array.isArray(intent.inputReferences) && intent.inputReferences.length === refs.size, 'INTENT_REFERENCES');
  for (const [role, reference] of refs) {
    const matches = intent.inputReferences.filter(item => item.role === role);
    demand(matches.length === 1 && matches[0].path === reference.path && matches[0].sha256Before === reference.sha256Before, 'INTENT_INPUT_MISMATCH');
  }
}

function probeBinding(probe, report, refs) {
  demand(probe.sourceAndInterpreterBeforeAfterVerified === true && Array.isArray(probe.references) && probe.references.length <= 100, 'PROBE_BINDING');
  const record = probe.record;
  demand(record?.schemaVersion === 1 && record.status === 'PASS' && record.parentContinued === true && record.childExitCode === 0, 'PROBE_NOT_PASS');
  demand(Number.isSafeInteger(record.childBreakpointHits) && record.childBreakpointHits > 0 && record.installerExecuted === false && record.registryOrSdkUsed === false, 'PROBE_SCOPE');
  demand(typeof record.powerShellVersion === 'string' && record.powerShellVersion.startsWith('5.1.') && record.powerShellVersion === report.interpreterVersionObserved, 'INTERPRETER_VERSION');
  for (const role of ['EXIT_PROBE_SOURCE', 'POWERSHELL_INTERPRETER']) {
    const reference = refs.get(role);
    const key = reference.path.replaceAll('/', '\\').toLowerCase();
    const matches = probe.references.filter(item => typeof item.path === 'string' && item.path.replaceAll('/', '\\').toLowerCase() === key);
    demand(matches.length > 0 && matches.every(item => item.sha256 === reference.sha256Before), 'PROBE_REFERENCE_MISMATCH');
  }
}

function caseBinding(files, report) {
  demand(Array.isArray(report.testCases) && report.testCases.length === fixtureCases.length, 'CASES_INCOMPLETE');
  let previousEnd = -Infinity;
  for (const [index, id] of fixtureCases.entries()) {
    const intent = jsonFile(files, `${id}.INTENT.json`), result = jsonFile(files, `${id}.RESULT.json`), reported = report.testCases[index];
    demand(intent.id === id && intent.head === report.head && intent.status === 'INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT', 'CASE_INTENT');
    demand(result.id === id && result.status === 'PASS' && result.installerLeaseReleased === true && JSON.stringify(result) === JSON.stringify(reported), 'CASE_RESULT');
    const start = Date.parse(result.startUtc), end = Date.parse(result.endUtc);
    demand(typeof result.startUtc === 'string' && result.startUtc === intent.startUtc && Number.isFinite(start) && Number.isFinite(end) && start >= previousEnd && end >= start, 'CASE_TIME');
    previousEnd = end;
  }
}

function frameworkBinding(files, report) {
  demand(report.frameworkProvenanceSha256 === digest(files.get('framework-provenance.json')), 'FRAMEWORK_DIGEST');
  const framework = jsonFile(files, 'framework-provenance.json');
  demand(framework.version === '3.4.0' && framework.payloadAuthenticatedByThisReport === false && Array.isArray(framework.files) && framework.files.length > 0 && framework.files.length <= 1000, 'FRAMEWORK_METADATA');
  const names = new Set();
  for (const file of framework.files) {
    demand(typeof file.path === 'string' && file.path.length <= 1024 && /^[A-Za-z0-9._/-]+$/u.test(file.path) && !file.path.startsWith('/') && file.path.split('/').every(part => part && part !== '.' && part !== '..') && hashValue(file.sha256), 'FRAMEWORK_FILE');
    demand(!names.has(file.path.toLowerCase()), 'FRAMEWORK_DUPLICATE');
    names.add(file.path.toLowerCase());
  }
}

/** Binds the existing synthetic planner suite separately from the eight installer cases. */
export function validateNoticePlannerEvidence(record, readSource) {
  demand(record?.sourcePath === noticeTestSource && typeof readSource === 'function', 'NOTICE_TEST_SOURCE');
  const bytes = readSource(noticeTestSource);
  demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1048576, 'NOTICE_TEST_BYTES');
  demand(hashValue(record.sha256Before) && record.sha256Before === digest(bytes) && record.sha256After === record.sha256Before, 'NOTICE_TEST_CHANGED');
  const result = record.result;
  demand(result?.synthetic === true && result.plannerOnly === true && result.productSdkInstallerNetworkNotExecuted === true, 'NOTICE_SCOPE');
  demand(result.tests === noticePlannerCases.length && result.pass === noticePlannerCases.length && result.failures === 0, 'NOTICE_COUNTS');
  demand(Array.isArray(result.results) && result.results.length === noticePlannerCases.length, 'NOTICE_CASES');
  demand(result.results.every((item, index) => item?.name === noticePlannerCases[index] && item.status === 'PASS'), 'NOTICE_CASES');
  return {sourcePath: noticeTestSource, sha256: record.sha256Before, tests: result.tests, pass: result.pass, failures: 0,
    plannerOnly: true, productSdkInstallerNetworkNotExecuted: true, cases: [...noticePlannerCases]};
}

/** Structural/source binding only; official job/artifact identity is external. */
export function verifyWindowsFixtureArtifact({expected, files, readSource}) {
  expectedBinding(expected);
  demand(files instanceof Map && typeof readSource === 'function', 'READERS_REQUIRED');
  demand(digest(files.get('artifact-manifest.json') ?? Buffer.alloc(0)) === expected.manifestSha256, 'MANIFEST_DIGEST');
  manifestBinding(jsonFile(files, 'artifact-manifest.json'), expected, files);
  demand(digest(files.get('coverage-evidence.json')) === expected.reportSha256, 'REPORT_DIGEST');
  const report = jsonFile(files, 'coverage-evidence.json');
  demand(report.head === expected.head && report.tree === expected.tree && report.status === 'PASS' && report.sourceBeforeAfterVerified === true, 'REPORT_CONTEXT');
  demand(report.githubIdentityAuthenticatedByThisReport === false && report.probeAuthorityAuthenticatedByThisReport === false && report.syntheticPackageOnly === true && report.packagedExeTested === false && report.standardUserOrUacAcceptance === false && report.sdkSipUserOrProductionAcceptance === false && report.actualHistorical0413UpgradeTested === false && report.interruptedUninstallTested === false && report.unknownOutcomeCleanupAttempted === false, 'SCOPE_CLAIM');
  sourceBinding(jsonFile(files, 'source-manifest.json'), report, expected, readSource);
  const refs = checkedReferences(report);
  inputBinding(files, report, refs, readSource);
  probeBinding(jsonFile(files, 'probe-evidence.json'), report, refs);
  caseBinding(files, report);
  frameworkBinding(files, report);
  const noticePlannerResult = validateNoticePlannerEvidence(report.noticePlannerResult, readSource);
  const converted = convertPowerShellCoverage(report, readSource);
  return {...converted, noticePlannerResult, artifactId: expected.artifactId, artifactDigestMetadata: expected.artifactDigest, officialEvidenceAuthenticated: false, nativeAcceptance: false};
}
