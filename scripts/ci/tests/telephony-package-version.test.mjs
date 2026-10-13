import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('SDK debug symbols are excluded from build and publish runtime copies', () => {
  const project = read('apps/telephony-agent-windows/CrmYnov.TelephonyAgent.csproj');
  for (const item of ['LiblinphoneRuntime', 'PublishedLiblinphoneRuntime']) {
    const declaration = project.match(new RegExp(`<${item}\\s[^>]+/>`))?.[0];
    assert.ok(declaration);
    assert.ok(declaration.includes('Exclude="$(LiblinphoneSdkRoot)\\bin\\**\\*.pdb"'));
    assert.ok(declaration.includes('Include="$(LiblinphoneSdkRoot)\\bin\\**\\*"'));
  }
});
test('agent and installer expose the same exact pilot version', () => {
  const agent = read('apps/telephony-agent-windows/CrmYnov.TelephonyAgent.csproj');
  const installer = read('apps/telephony-agent-installer-windows/CrmYnov.TelephonyAgent.Installer.csproj');
  for (const tag of ['Version', 'AssemblyVersion', 'FileVersion', 'InformationalVersion']) {
    const pattern = new RegExp(`<${tag}>([^<]+)</${tag}>`);
    assert.equal(installer.match(pattern)?.[1], agent.match(pattern)?.[1]);
  }
  assert.match(installer, /<InformationalVersion>0\.4\.12-pilot<\/InformationalVersion>/);
});
test('packaging uses committed tracked sources and checks executable version', () => {
  const pack = read('scripts/telephony-agent/package-windows-agent.ps1');
  const install = read('scripts/telephony-agent/build-windows-installer.ps1');
  assert.match(pack, /git -C \$repositoryRoot ls-files/);
  assert.match(pack, /PACKAGE_COMMITTED_SOURCE_REQUIRED/);
  assert.match(pack, /PACKAGE_GENERATED_SOURCE_REFUSED/);
  assert.match(pack, /sourceCommit = \$sourceCommit/);
  assert.doesNotMatch(pack.slice(pack.indexOf('$sourceFiles =')), /Get-ChildItem/);
  assert.match(install, /INSTALLER_EXECUTABLE_VERSION_MISMATCH/);
});
