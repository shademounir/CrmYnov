import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('draft fixture refuses local/self-hosted/forks before any native fixture mutation',()=>{
 const source=read('scripts/telephony-agent/tests/windows-installer.integration.ps1');
 for(const marker of ['HOSTED_ACTIONS_REQUIRED','SELF_HOSTED_OR_LOCAL_REFUSED','WINDOWS_X64_REQUIRED','ACTOR_OR_EVENT_REFUSED','FORK_REFUSED','SOURCE_HASH_MISMATCH','EXIT_PROBE_REQUIRED','PREEXISTING_PRODUCT_REFUSED','PREEXISTING_SHORTCUT_REFUSED','PREEXISTING_PROTOCOL_REFUSED','PREEXISTING_REGISTRATION_REFUSED','PREEXISTING_STARTUP_REFUSED'])assert(source.includes(marker));
 const guardOffset=source.indexOf('Assert-HostedContext\n'),effectOffset=source.indexOf('[IO.Directory]::CreateDirectory($out)');
 assert(guardOffset>=0&&effectOffset>guardOffset);
 assert.doesNotMatch(source,/-ExecutionPolicy\s+Bypass|Set-ExecutionPolicy|Unblock-File|Start-Process|Invoke-Expression|Remove-Item|Kill\(/iu);
 assert.match(source,/Version=\$Version;NoLaunch=\$true/u);assert.match(source,/SYNTHETIC-INERT-NEVER-EXECUTE/u);
});
test('trusted PR and strict main-push contexts retain recorded run identity',()=>{
 const source=read('scripts/telephony-agent/tests/windows-installer.integration.ps1');
 for(const marker of ["@('develop','main')","refs/heads/main",'$githubEvent.after','$env:GITHUB_SHA','$env:GITHUB_RUN_ID','$env:GITHUB_RUN_ATTEMPT'])assert(source.includes(marker),marker);
 assert.doesNotMatch(source,/\$(?:event|matches)\s*=/iu);
 assert.doesNotMatch(source,/fix\/CRMY-183-desktop-ui-recovery/u);
});
test('startup absence is decided by actual pure name inventory guard, not nullable data',()=>{
 const source=read('scripts/telephony-agent/tests/windows-installer.integration.ps1');
 const guard=read('scripts/telephony-agent/tests/windows-fixture-guards.psm1');
 const wrapper=source.slice(source.indexOf('function Startup-NameAbsent'),source.indexOf("Require (-not (Test-Path -LiteralPath $productRoot))"));
 assert.match(wrapper,/GetValueNames\(\)/u);assert.match(wrapper,/Test-FixtureStartupNameAbsent/u);assert.doesNotMatch(wrapper,/GetValue\(/u);
 assert.match(source,/Require \(Startup-NameAbsent\) 'PREEXISTING_STARTUP_REFUSED'/u);
 assert.match(guard,/StringComparison\]::OrdinalIgnoreCase/u);
 assert.doesNotMatch(guard,/Microsoft\.Win32|GetValue\(|System\.IO|\[IO\.|Get-Item|Get-Process|New-Object/iu);
});
test('execution inputs and exit status are bound before effects and after every invocation',()=>{
 const source=read('scripts/telephony-agent/tests/windows-installer.integration.ps1');
 for(const marker of ['SOURCE_MANIFEST','EXIT_PROBE_EVIDENCE','EXIT_PROBE_SOURCE','POWERSHELL_INTERPRETER','TEST_TOOLING_GUARD','EXECUTION_INPUT_CHANGED_BEFORE_EFFECTS','BOUND_PROBE_EVIDENCE_REQUIRED','PROBE_REFERENCE_HASH_MISMATCH','INSTALLER_EXIT_NONZERO'])assert(source.includes(marker),marker);
 assert(source.indexOf('$sourceManifestBefore=Sha $SourceManifest')<source.indexOf('$manifest=Get-Content'));
 const call=source.slice(source.indexOf('function Invoke-FixtureScript'),source.indexOf('function Assert-Uninstalled'));
 assert(call.indexOf('$global:LASTEXITCODE=0')<call.indexOf('& $Path @Parameters'));
 assert(call.indexOf('$exitCode=$LASTEXITCODE')>call.indexOf('& $Path @Parameters'));
 assert.match(source,/\$reference\.sha256After=Sha \$reference\.path/u);
 assert.match(source,/probeAuthorityAuthenticatedByThisReport=\$false/u);
});
test('draft evidence requires exact actual sources and copies, with genuine counters including zero',()=>{
 const source=read('scripts/telephony-agent/tests/windows-installer.integration.ps1');
 for(const marker of ['ALIAS_BYTES_MISMATCH','ALIAS_COORDINATES_MISMATCH','SOURCE_AFTER_NOT_PROVEN','Command-Inventory','Set-PSBreakpoint','HitCount','NATIVE_POWERSHELL_COMMAND_BREAKPOINTS','githubIdentityAuthenticatedByThisReport=$false','interruptedUninstallTested=$false'])assert(source.includes(marker),marker);
 assert.match(source,/Instrument-Path \$relative \$path/u);
 assert(source.includes('scripts/telephony-agent/package-windows-agent.ps1'));
 assert.doesNotMatch(source,/&[^\r\n]*package-windows-agent/u);
 assert(source.includes('explicit-uninstall-repeat-not-interruption-proof'));
});
test('draft host wrapper is explicit File-only and is not a standard-user qualification',()=>{
 const source=read('scripts/telephony-agent/tests/windows-installer.integration.ps1');
 assert.match(source,/\[Environment\]::GetCommandLineArgs\(\)/u);
 for(const marker of ['HOST_WRAPPER_ARGS_REFUSED','HOST_POLICY_OR_COMMAND_OVERRIDE_REFUSED','INHERITED_PROCESS_POLICY_OVERRIDE_REFUSED','runnerAdminObserved','standardUserOrUacAcceptance=$false','actualHistorical0413UpgradeTested=$false','GIT_READ_FAILED','PESTER_MODULE_ROOT_MISMATCH','framework-provenance.json','[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None'])assert(source.includes(marker),marker);
 const cases=source.slice(source.indexOf('function Case('),source.indexOf("$status='FAILED';$errorCode=$null"));
 assert(cases.indexOf("$Id+'.INTENT.json'")<cases.indexOf('& $Action'));
 assert(cases.includes("$Id+'.RESULT.json'"));
 assert.doesNotMatch(source,/Get-ExecutionPolicy|Set-ExecutionPolicy|Registry.*Policies/iu);
 assert.match(source,/if\(-not \$sourceAfterVerified\)\{\$status='FAILED'/u);
});
