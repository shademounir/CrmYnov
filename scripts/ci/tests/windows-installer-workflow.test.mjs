import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
const workflow = () => load(readFileSync(new URL('../../../.github/workflows/application-quality.yml', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Semantic baseline read from immutable published PR244 commit919e3ab.
// These hashes preserve all existing jobs, not just selected regex fragments.
const originalJobs = {
  'trusted-source':'5a3db352fcf11681319c29b5ae01271623a463f7e4d85b36441a8a3454dd3426',
  lint:'ce2119dcd7f2353a20a87d74d5313d17b2df50965e9793ba652e469f3a73011a',
  'type-check':'270bcb9f1ad85013cd8d21f3fc07147fdadece9fda2e1cdb20cd27bb87ecb62e',
  'unit-tests':'882680b4400d83ccc9cc8b4309dbe287071670177f18ba5edafb7550f1d910fb',
  'integration-tests':'8063d8289f0a51af8829dcf872d3075bed666daf4c5f17476b2812ebccc7a2e0',
  playwright:'da8bf4c91a4ba5ec82793d9902d5292d8d96c6277cbe0197b07821d87f24187c',
  build:'b66cb9fa82044c22c778f082f26f93fa947d89902679859a260a9e6ebb2ad7b0',
  'dependency-review':'7544253d50de8cebc583e3a41d45afa6b63e9b5541551ac6341d2ea34903ebb5',
  sbom:'e9cd440a3a14e8db030291dfff4f6578ad74fc081e8e54e5617e36d91cf73eeb',
  'secret-scan':'8339f2e0690b0d549ddeaa0219082877bb4968fe3d0d77519a1869c71d089dc6',
  'container-scan':'049fa1e7d9f37441fbcfda152c5d024615d4ec430dbf59586c5e463d54da1943',
  'trivy-iac':'4c8af6dfd3226a82fa537150599cecb4d8fcca9fd3e50a11980856aa53560ffa',
  codeql:'7a170ee97efadaa65603b520346e5316de680af1ef4d3cf1bf12142cd257474b',
};
const exactHead = '${{ github.event.pull_request.head.sha || github.sha }}';

test('Windows evidence preserves all original triggers, permissions, concurrency and integration jobs', () => {
  const w = workflow();
  assert.equal(hash({name:w.name,on:w.on,permissions:w.permissions,concurrency:w.concurrency}), 'f713494b6120aa0d4fdefca58d6732f6cd02048191a7c5ac5a3318ed71f389c1');
  assert.deepEqual(Object.keys(w.jobs).sort(), [...Object.keys(originalJobs), 'sonarcloud', 'quality-gate', 'windows_installer_fixture'].sort());
  for (const [name, digest] of Object.entries(originalJobs)) assert.equal(hash(w.jobs[name]), digest, name);
});

test('Sonar changes only exact source selection, required Windows evidence and its checked import', () => {
  const sonar = structuredClone(workflow().jobs.sonarcloud);
  assert.deepEqual(sonar.needs, ['trusted-source','windows_installer_fixture']);
  sonar.needs = 'trusted-source';
  const checkout = sonar.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, exactHead);
  delete checkout.with.ref;
  const added = ['Download exact same-run Windows fixture artifact','Verify source and artifact bindings before generic coverage import'];
  assert.equal(sonar.steps.filter(step => added.includes(step.name)).length, 2);
  sonar.steps = sonar.steps.filter(step => !added.includes(step.name));
  assert.equal(hash(sonar), '311cbde6c04df142b728048c23370d508ff7768b9e1da05ba49ec2c542f3f11c');
  const gate = structuredClone(workflow().jobs['quality-gate']);
  assert.equal(gate.needs.filter(name => name === 'windows_installer_fixture').length, 1);
  gate.needs = gate.needs.filter(name => name !== 'windows_installer_fixture');
  assert.equal(hash(gate), '2b0e73d30d5431b842dda0115bb0361f4dd09a14ba11b43843171c3ca4384062');
});

test('Windows fixture is hosted, owner-gated, bounded and uses no token, SDK, deployment or policy bypass', () => {
  const job = workflow().jobs.windows_installer_fixture;
  assert.equal(job.needs, 'trusted-source');
  assert.equal(job['runs-on'], 'windows-2025');
  assert.equal(job['timeout-minutes'], 20);
  assert.equal(job.permissions, undefined);
  assert.equal(job.if, undefined);
  assert.equal(job.steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref, exactHead);
  const measure = job.steps.find(step => step.id === 'fixture');
  assert.equal(measure.shell, 'cmd');
  assert.match(measure.run, /node scripts\/ci\/windows-installer-fixture-ci\.mjs produce/u);
  assert.match(measure.run, /if errorlevel 1 exit \/b %errorlevel%/u);
  assert.doesNotMatch(JSON.stringify(job), /secrets\.|id-token|contents: write|powershell .*ExecutionPolicy|gcloud |terraform |dotnet |self-hosted|continue-on-error/iu);
});

test('artifact transfer is exact same-run ID only, pinned and never broad fallback', () => {
  const w = workflow(), job = w.jobs.windows_installer_fixture;
  const upload = job.steps.find(step => step.id === 'evidence');
  assert.equal(upload.uses,'actions/upload-artifact@65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08');
  assert.equal(upload.if, "always() && steps.fixture.outputs.artifact-path != ''");
  assert.equal(upload.with.path, '${{ steps.fixture.outputs.artifact-path }}');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 3);
  const download = w.jobs.sonarcloud.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.uses, 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
  assert.equal(download.with['artifact-ids'], '${{ needs.windows_installer_fixture.outputs.artifact-id }}');
  assert.equal(download.with['github-token'], undefined);
  assert.equal(download.with['run-id'], undefined);
  assert.equal(download.with.pattern, undefined);
  assert.equal(download.with.name, undefined);
  const verify = w.jobs.sonarcloud.steps.find(step => step.name.startsWith('Verify source and artifact'));
  for (const field of ['HEAD','TREE','REPORT_SHA256','MANIFEST_SHA256','ARTIFACT_ID','ARTIFACT_DIGEST']) assert.equal(typeof verify.env['WINDOWS_FIXTURE_'+field], 'string');
  assert.match(verify.run, /test -s coverage\/powershell\.xml/u);
});

test('Sonar classifies actual PS test files precisely and keeps production and LCOV in scope', () => {
  const text = readFileSync(new URL('../../../sonar-project.properties', import.meta.url),'utf8');
  const properties = Object.fromEntries(text.trim().split(/\r?\n/u).map(line => {const index=line.indexOf('=');return[line.slice(0,index),line.slice(index+1)];}));
  assert.equal(properties['sonar.sources'],'apps,packages,scripts');
  assert.equal(properties['sonar.javascript.lcov.reportPaths'],'coverage/lcov.info');
  assert.equal(properties['sonar.coverageReportPaths'],'coverage/powershell.xml');
  assert.equal(properties['sonar.coverage.exclusions'],'apps/api/src/app.module.ts,apps/api/src/application.ts,apps/api/src/correlation.middleware.ts,apps/api/src/main.ts,apps/web/app/layout.tsx,apps/web/app/page.tsx,apps/web/next.config.ts,apps/web/next-env.d.ts,scripts/jira-sync/history-scan.mjs');
  assert.equal(properties['sonar.test.inclusions'],'apps/**/test/**/*.ts,apps/web/e2e/**/*.spec.ts,**/test/**/*.test.ts,**/tests/**/*.test.mjs,**/tests/**/*.test.ts,scripts/telephony-agent/test-installer-transactions.ps1,scripts/telephony-agent/tests/**/*.ps1,scripts/telephony-agent/tests/**/*.psm1');
  for (const name of ['install-windows-agent.ps1','installer-transactions.psm1','package-windows-agent.ps1']) assert(!properties['sonar.test.inclusions'].split(',').includes('scripts/telephony-agent/'+name));
  assert.doesNotMatch(text, /sonar\.coverage\.exclusions=.*telephony|sonar\.qualitygate|sonar\.coverage\.exclusions=.*scripts\/\*\*/u);
});
