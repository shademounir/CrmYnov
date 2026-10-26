import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
test('installer composes the tested transaction module and preserves private recovery evidence',()=>{
 const script=read('scripts/telephony-agent/install-windows-agent.ps1'),module=read('scripts/telephony-agent/installer-transactions.psm1'),pack=read('scripts/telephony-agent/package-windows-agent.ps1');
 assert.match(script,/Invoke-AgentInstallTransaction/u);assert.match(script,/Invoke-AgentUninstallTransaction/u);assert.match(script,/Save-RecoverySnapshot/u);assert.match(module,/Assert-AgentRecoveryTerminal/u);
 assert.doesNotMatch(module,/Microsoft\.Win32|New-Object|Start-Process|Remove-Item/u);
 const ioCalls=[...module.matchAll(/\[System\.IO\.([A-Za-z0-9.]+)\]::([A-Za-z0-9]+)/gu)];
 assert(ioCalls.length>0);assert(ioCalls.every(m=>m[1]==='Path'&&m[2]==='GetFullPath'));
 assert.equal([...module.matchAll(/System\.IO\./gu)].length,ioCalls.length,'only explicit lexical Path.GetFullPath is permitted');
 assert.match(module,/Resolve-AgentManifestPath/u);assert.match(module,/Assert-AgentOwnedInventory/u);
 assert.doesNotMatch(script,/Remove-RegistryActivation|ErrorAction SilentlyContinue/u);
 assert.match(pack,/Copy-Item -LiteralPath \$transactionModule -Destination \$packageDirectory/u);assert.match(pack,/scripts\/telephony-agent\/installer-transactions\.psm1/u);
 assert.match(script,/Assert-NoReparseAncestors \$installRoot/u);assert.match(script,/Assert-VersionPath \$destination/u);
 assert.match(script,/\.installer\.lock/u);assert.match(script,/\[System\.IO\.FileShare\]::None/u);assert.match(script,/finally \{ \$installerLease\.Dispose\(\) \}/u);
 assert.doesNotMatch(script,/Remove-Item -LiteralPath \$installRoot -Recurse/u);
 assert.match(script,/\(Get-Item -LiteralPath \$path\)\.Length -ne \$file\.bytes/u);
 assert.match(script,/\(Get-Item -LiteralPath \$file\.Destination\)\.Length -ne \$file\.Bytes/u);
});
test('actual production coordination runs with memory-only synthetic effects on Windows',{skip:process.platform!=='win32'},()=>{
 const file=fileURLToPath(new URL('scripts/telephony-agent/test-installer-transactions.ps1',root));
 const output=execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-File',file],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1048576});
 const result=JSON.parse(output.trim());assert.equal(result.passed,true);assert(result.checks>=65);assert.equal(result.installerScriptExecuted,false);assert.equal(result.registryTouched,false);assert.equal(result.profileTouched,false);assert.equal(result.agentOrSdkStarted,false);assert.equal(result.networkUsed,false);assert.equal(result.nativeAcceptance,false);
});
