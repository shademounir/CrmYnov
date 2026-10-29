import {createHash} from 'node:crypto';

export const productionSources = Object.freeze([
  'scripts/telephony-agent/install-windows-agent.ps1',
  'scripts/telephony-agent/installer-transactions.psm1',
  'scripts/telephony-agent/package-windows-agent.ps1',
  'scripts/telephony-agent/package-notices.psm1',
]);
const testSource = 'scripts/telephony-agent/test-installer-transactions.ps1';
const maximumCommands = 20000;
const maximumObservations = 100;
const fail = code => { throw new Error(`POWERSHELL_COVERAGE_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const coordinate = command => `${command.line}:${command.column}`;

function boundedArray(value, maximum, code) {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= maximum, code);
}

function checkCases(cases) {
  boundedArray(cases, 1000, 'CASES_REQUIRED');
  const ids = new Set();
  for (const item of cases) {
    requireValue(item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(item.id) && item.status === 'PASS', 'CASE_NOT_PASS');
    requireValue(!ids.has(item.id), 'DUPLICATE_CASE');
    ids.add(item.id);
  }
}

function checkCommand(command, lines) {
  requireValue(command && Number.isSafeInteger(command.line) && command.line > 0 && command.line <= lines.length, 'LINE_INVALID');
  requireValue(Number.isSafeInteger(command.column) && command.column > 0 && command.column <= lines[command.line - 1].length, 'COLUMN_INVALID');
}

function sourceInventory(source, readSource) {
  const expectedClass = productionSources.includes(source?.path) ? 'PRODUCTION' : 'TEST';
  requireValue(productionSources.includes(source?.path) || source?.path === testSource, 'SOURCE_NOT_ALLOWED');
  requireValue(source.classification === expectedClass, 'SOURCE_CLASSIFICATION');
  requireValue(typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(source.sha256), 'SOURCE_HASH_INVALID');
  const bytes = readSource(source.path);
  requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1048576, 'SOURCE_BYTES_INVALID');
  requireValue(digest(bytes) === source.sha256, 'SOURCE_HASH_MISMATCH');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const lines = text.split(/\r?\n/u);
  requireValue(source.lineCount === lines.length, 'SOURCE_LINE_COUNT');
  boundedArray(source.commands, maximumCommands, 'COMMAND_INVENTORY_REQUIRED');
  const commands = new Map();
  for (const command of source.commands) {
    checkCommand(command, lines);
    const key = coordinate(command);
    requireValue(!commands.has(key), 'DUPLICATE_COMMAND');
    commands.set(key, {line: command.line, column: command.column, hitCount: 0});
  }
  return {source, lines, commands, observations: 0};
}

function executedPathKey(value) {
  requireValue(typeof value === 'string' && value.length <= 4096 && /^[A-Za-z]:[\\/]/u.test(value), 'EXECUTED_PATH_INVALID');
  const parts = value.replaceAll('/', '\\').split('\\');
  requireValue(parts.slice(1).every(validPathPart), 'EXECUTED_PATH_INVALID');
  return value.replaceAll('/', '\\').toLowerCase();
}

function validPathPart(part) {
  return Boolean(part) && !['.', '..'].includes(part) && !/[\x00-\x1f<>:"|?*]/u.test(part)
    && !/[. ]$/u.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part);
}

function addObservation(observation, inventories, aliases) {
  requireValue(observation && inventories.has(observation.sourcePath), 'OBSERVATION_SOURCE_UNKNOWN');
  const inventory = inventories.get(observation.sourcePath);
  const alias = executedPathKey(observation.executedPath);
  requireValue(!aliases.has(alias) || aliases.get(alias) === observation.sourcePath, 'ALIAS_SOURCE_CONFLICT');
  aliases.set(alias, observation.sourcePath);
  requireValue(observation.sha256Before === inventory.source.sha256 && observation.sha256After === inventory.source.sha256, 'OBSERVATION_HASH_MISMATCH');
  boundedArray(observation.commands, maximumCommands, 'OBSERVATION_COMMANDS_REQUIRED');
  requireValue(observation.commands.length === inventory.commands.size, 'INCOMPLETE_COMMAND_INVENTORY');
  const seen = new Set();
  for (const command of observation.commands) {
    checkCommand(command, inventory.lines);
    const key = coordinate(command);
    requireValue(inventory.commands.has(key) && !seen.has(key), 'COMMAND_INVENTORY_MISMATCH');
    requireValue(Number.isSafeInteger(command.hitCount) && command.hitCount >= 0, 'HIT_COUNT_INVALID');
    seen.add(key);
    const item = inventory.commands.get(key);
    requireValue(Number.isSafeInteger(item.hitCount + command.hitCount), 'HIT_COUNT_OVERFLOW');
    item.hitCount += command.hitCount;
  }
  inventory.observations++;
}

function productionFile(inventory) {
  requireValue(inventory.observations > 0, 'PRODUCTION_OBSERVATION_MISSING');
  const byLine = new Map();
  for (const command of inventory.commands.values()) {
    const row = byLine.get(command.line) ?? [];
    row.push(command);
    byLine.set(command.line, row);
  }
  const rows = [...byLine].sort(([left], [right]) => left - right);
  const lines = rows.map(([line, commands]) => ({line, covered: commands.every(command => command.hitCount > 0)}));
  return {
    path: inventory.source.path,
    commands: inventory.commands.size,
    commandsHit: [...inventory.commands.values()].filter(command => command.hitCount > 0).length,
    observations: inventory.observations,
    lines,
  };
}

/** Converts observed counters, not an authenticator of the runner or artifact. */
export function convertPowerShellCoverage(report, readSource) {
  requireValue(report?.schemaVersion === 1 && report.status === 'PASS', 'REPORT_NOT_PASS');
  requireValue(report.evidenceKind === 'NATIVE_POWERSHELL_COMMAND_BREAKPOINTS' && report.sourceBeforeAfterVerified === true, 'EVIDENCE_KIND_INVALID');
  requireValue(typeof report.head === 'string' && /^[a-f0-9]{40}$/u.test(report.head) && typeof report.tree === 'string' && /^[a-f0-9]{40}$/u.test(report.tree), 'REVISION_INVALID');
  requireValue(typeof readSource === 'function', 'SOURCE_READER_REQUIRED');
  checkCases(report.testCases);
  boundedArray(report.sources, productionSources.length + 1, 'SOURCES_REQUIRED');
  const inventories = new Map();
  for (const source of report.sources) {
    requireValue(source && typeof source === 'object' && !Array.isArray(source), 'SOURCE_NOT_ALLOWED');
    requireValue(!inventories.has(source?.path), 'DUPLICATE_SOURCE');
    inventories.set(source.path, sourceInventory(source, readSource));
  }
  requireValue(productionSources.every(source => inventories.has(source)), 'PRODUCTION_SOURCE_MISSING');
  boundedArray(report.observations, maximumObservations, 'OBSERVATIONS_REQUIRED');
  const aliases = new Map();
  for (const observation of report.observations) addObservation(observation, inventories, aliases);
  const files = productionSources.map(source => productionFile(inventories.get(source)));
  const lineXml = line => `    <lineToCover lineNumber="${line.line}" covered="${line.covered}"/>`;
  const xmlFiles = files.map(file => {
    const lines = file.lines.map(lineXml).join('\n');
    return `  <file path="${file.path}">\n${lines}\n  </file>`;
  });
  return {
    xml: `<coverage version="1">\n${xmlFiles.join('\n')}\n</coverage>\n`,
    head: report.head,
    tree: report.tree,
    files,
    lineCoveragePolicy: 'ALL_COMMANDS_ON_LINE_AFTER_SOURCE_IDENTICAL_OBSERVATIONS',
    branchCoverageMeasured: false,
    officialEvidenceAuthenticated: false,
    nativeAcceptance: false,
    testsExcludedFromProductionReport: inventories.has(testSource) ? [testSource] : [],
  };
}
