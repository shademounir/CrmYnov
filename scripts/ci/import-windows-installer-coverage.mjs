import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {productionSources} from './powershell-command-coverage.mjs';
import {verifyWindowsFixtureArtifact, probeSource, guardSource} from './windows-installer-evidence.mjs';

const repoName = 'shademounir/CrmYnov';
const demand = (condition, code) => { if (!condition) throw new Error(`WINDOWS_FIXTURE_${code}`); };

export function consumerEnvironment(env, platform) {
  demand(platform === 'linux' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.RUNNER_OS === 'Linux', 'HOSTED_SONAR_REQUIRED');
  demand(env.GITHUB_REPOSITORY === repoName && env.GITHUB_REPOSITORY_OWNER === 'shademounir' && env.GITHUB_ACTOR === 'shademounir', 'OWNER_CONTEXT');
  demand(['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME), 'EVENT_CONTEXT');
}

export function consumerHead(env, event) {
  demand(['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME), 'EVENT_CONTEXT');
  demand(event.repository?.full_name === repoName, 'EVENT_REPOSITORY');
  let head;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const pr = event.pull_request;
    demand(pr?.head?.repo?.full_name === repoName && pr.head.repo.fork === false && pr.base?.repo?.full_name === repoName && ['develop', 'main'].includes(pr.base.ref), 'PR_CONTEXT');
    head = pr.head.sha;
  } else {
    demand(env.GITHUB_REF === 'refs/heads/main' && event.ref === 'refs/heads/main' && event.deleted !== true && event.after === env.GITHUB_SHA, 'PUSH_CONTEXT');
    head = event.after;
  }
  demand(typeof head === 'string' && /^[a-f0-9]{40}$/u.test(head) && head === env.WINDOWS_FIXTURE_HEAD, 'SOURCE_HEAD_CONTEXT');
  return head;
}

function ordinaryFile(file, maximum) {
  const stat = fs.lstatSync(file);
  demand(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum && fs.realpathSync(file) === path.resolve(file), 'UNSAFE_FILE');
  return fs.readFileSync(file);
}

function downloadedFiles(directory, runnerTemp) {
  const absolute = path.resolve(directory);
  demand(path.dirname(absolute) === path.resolve(runnerTemp) && path.basename(absolute) === 'windows-installer-evidence' && fs.realpathSync(absolute) === absolute, 'ARTIFACT_DIRECTORY');
  const entries = fs.readdirSync(absolute, {withFileTypes: true});
  demand(entries.length > 0 && entries.length <= 32, 'ARTIFACT_FILES');
  const files = new Map();
  for (const entry of entries) {
    demand(entry.isFile() && !entry.isSymbolicLink() && /^[A-Za-z0-9_.-]+\.json$/u.test(entry.name), 'ARTIFACT_FILES');
    files.set(entry.name, ordinaryFile(path.join(absolute, entry.name), 4194304));
  }
  return files;
}

function checkedGit(repo, ...args) {
  return execFileSync('/usr/bin/git', ['-C', repo, ...args], {encoding: 'utf8', timeout: 10000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

export function importFixtureCli(args = process.argv.slice(2), env = process.env, platform = process.platform) {
  consumerEnvironment(env, platform);
  demand(args.length === 2 && args[0] === '--artifact-dir', 'CLI_ARGUMENTS');
  const event = JSON.parse(ordinaryFile(env.GITHUB_EVENT_PATH, 4194304));
  const head = consumerHead(env, event);
  const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  demand(repo === path.resolve(env.GITHUB_WORKSPACE), 'WORKSPACE');
  const tree = checkedGit(repo, 'rev-parse', 'HEAD^{tree}');
  demand(checkedGit(repo, 'rev-parse', 'HEAD') === head && tree === env.WINDOWS_FIXTURE_TREE && checkedGit(repo, 'status', '--porcelain', '--untracked-files=all') === '', 'CHECKOUT_CHANGED');
  const sourcePaths = new Set([...productionSources, 'scripts/telephony-agent/test-installer-transactions.ps1', probeSource, guardSource]);
  const sources = new Map([...sourcePaths].map(relative => [relative, ordinaryFile(path.join(repo, relative), 1048576)]));
  const expected = {head, tree, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, artifactId: env.WINDOWS_FIXTURE_ARTIFACT_ID, artifactDigest: env.WINDOWS_FIXTURE_ARTIFACT_DIGEST, manifestSha256: env.WINDOWS_FIXTURE_MANIFEST_SHA256, reportSha256: env.WINDOWS_FIXTURE_REPORT_SHA256};
  const verified = verifyWindowsFixtureArtifact({expected, files: downloadedFiles(args[1], env.RUNNER_TEMP), readSource: relative => sources.get(relative)});
  demand(checkedGit(repo, 'rev-parse', 'HEAD') === head && checkedGit(repo, 'rev-parse', 'HEAD^{tree}') === tree && checkedGit(repo, 'status', '--porcelain', '--untracked-files=all') === '', 'CHECKOUT_CHANGED');
  for (const [relative, bytes] of sources) demand(ordinaryFile(path.join(repo, relative), 1048576).equals(bytes), 'SOURCE_CHANGED_DURING_IMPORT');
  const coverage = path.join(repo, 'coverage');
  fs.mkdirSync(coverage, {recursive: true});
  demand(fs.realpathSync(coverage) === coverage, 'COVERAGE_DIRECTORY');
  fs.writeFileSync(path.join(coverage, 'powershell.xml'), verified.xml, {flag: 'wx'});
  fs.writeFileSync(path.join(coverage, 'windows-installer-import.json'), JSON.stringify({head, tree, runId: expected.runId, runAttempt: expected.runAttempt, artifactId: expected.artifactId, artifactDigestMetadata: expected.artifactDigest, sourceAndContentDigestsChecked: true, officialEvidenceAuthenticatedByThisReport: false, nativeAcceptance: false, branchCoverageMeasured: false}, null, 2) + '\n', {flag: 'wx'});
  return {head, tree, report: 'coverage/powershell.xml', nativeAcceptance: false};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(importFixtureCli())); }
  catch (error) {
    const code = /^WINDOWS_FIXTURE_[A-Z_]+$/u.test(error.message) ? error.message : 'WINDOWS_FIXTURE_IMPORT_REFUSED';
    console.error(code);
    process.exitCode = 1;
  }
}
