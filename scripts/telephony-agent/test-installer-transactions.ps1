$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'installer-transactions.psm1') -Force
$checks = 0
function Check([bool]$Value) { $script:checks++; if (-not $Value) { throw "SYNTHETIC_ASSERT_$script:checks" } }
foreach ($name in @('install-windows-agent.ps1','installer-transactions.psm1','package-windows-agent.ps1','build-windows-installer.ps1')) {
    $tokens=$null; $errors=$null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors) | Out-Null
    Check ($errors.Count -eq 0)
}
function Refuses([scriptblock]$Action, [string]$Code) {
    try { & $Action; throw 'EXPECTED_REFUSAL_MISSING' }
    catch { Check ($_.Exception.Message -ceq $Code) }
}
function MemoryInstall([string]$Fail = '') {
    $state = @{ Protocol='old-protocol'; Shortcut='old-shortcut-bytes'; Startup='exact-old-run-value'; Registration='old-registration'; Script='old-script'; Module=$null; Active='old'; Candidate=$false; Profile='private-synthetic-profile'; Journal='private-synthetic-journal'; OtherRun='do-not-touch'; Recovery='NONE'; Events=[System.Collections.Generic.List[string]]::new() }
    $original = ($state | Select-Object Protocol,Shortcut,Startup,Registration,Script,Module,Active | ConvertTo-Json -Compress)
    $effects = @{
        Capture = { $state.Events.Add('capture'); if ($Fail -eq 'Capture') { throw 'SYNTHETIC_CAPTURE' }; $state.Recovery='PENDING'; return @{Protocol=$state.Protocol;Shortcut=$state.Shortcut;Startup=$state.Startup;Registration=$state.Registration;Script=$state.Script;Module=$state.Module;Active=$state.Active} }.GetNewClosure()
        Stage = { $state.Events.Add('stage'); $state.Candidate=$true; $state.Script='new-script';$state.Module='new-module'; if ($Fail -eq 'Stage') { throw 'SYNTHETIC_STAGE' } }.GetNewClosure()
        Activate = { $state.Events.Add('activate'); $state.Protocol='new';$state.Shortcut='new';$state.Startup='new';$state.Registration='new';$state.Active='new';if ($Fail -eq 'Activate') { throw 'SYNTHETIC_ACTIVATE' } }.GetNewClosure()
        Verify = { $state.Events.Add('verify');if ($Fail -eq 'VerifyThrow') {throw 'SYNTHETIC_VERIFY'};if ($Fail -eq 'VerifyFalse') {return $false};$state.Recovery='COMMITTED';return $true }.GetNewClosure()
        Restore = { param($before) $state.Events.Add('restore');$state.Recovery='RESTORING';if ($Fail -eq 'Restore') {throw 'SYNTHETIC_RESTORE'}; foreach($name in $before.Keys){$state[$name]=$before[$name]} }.GetNewClosure()
        VerifyRestored = { param($before) $state.Events.Add('verify-restored');if ($Fail -eq 'RestoreVerify') {return $false};return (($before|ConvertTo-Json -Compress) -ceq (@{Protocol=$state.Protocol;Shortcut=$state.Shortcut;Startup=$state.Startup;Registration=$state.Registration;Script=$state.Script;Module=$state.Module;Active=$state.Active}|ConvertTo-Json -Compress)) }.GetNewClosure()
        Cleanup = { $state.Events.Add('cleanup');if($Fail -eq 'Cleanup'){throw 'SYNTHETIC_CLEANUP'};$state.Candidate=$false }.GetNewClosure()
        VerifyCleaned = { $state.Events.Add('verify-cleaned');if($Fail -eq 'CleanupVerify'){return $false};return (-not $state.Candidate) }.GetNewClosure()
        FinalizeRestored = { $state.Events.Add('finalize-restored');if($Fail -eq 'Finalize'){throw 'SYNTHETIC_FINALIZE'};$state.Recovery='RESTORED' }.GetNewClosure()
    }
    if ($Fail -in @('Restore','RestoreVerify','Cleanup','CleanupVerify','Finalize')) { $effects.Activate={ $state.Protocol='partial';throw 'SYNTHETIC_ACTIVATE' }.GetNewClosure() }
    return @{State=$state;Effects=$effects;Original=$original}
}
$good=MemoryInstall
Invoke-AgentInstallTransaction $good.Effects
Check ($good.State.Recovery -ceq 'COMMITTED' -and $good.State.Candidate)
Check (($good.State.Events -join ',') -ceq 'capture,stage,activate,verify')
foreach($failure in @('Stage','Activate','VerifyThrow','VerifyFalse')) {
    $f=MemoryInstall $failure
    try{Invoke-AgentInstallTransaction $f.Effects;throw 'MISSING_FAILURE'}catch{Check ($_.Exception.Message -ne 'MISSING_FAILURE')}
    Check ($f.State.Recovery -ceq 'RESTORED' -and -not $f.State.Candidate)
    Check ($f.State.Protocol -ceq 'old-protocol' -and $f.State.Startup -ceq 'exact-old-run-value' -and $null -eq $f.State.Module)
    Check ($f.State.Profile -ceq 'private-synthetic-profile' -and $f.State.Journal -ceq 'private-synthetic-journal' -and $f.State.OtherRun -ceq 'do-not-touch')
}
$capture=MemoryInstall 'Capture';Refuses {Invoke-AgentInstallTransaction $capture.Effects} 'SYNTHETIC_CAPTURE';Check (($capture.State.Events -join ',') -ceq 'capture')
foreach($failure in @('Restore','RestoreVerify')) {
    $f=MemoryInstall $failure;Refuses {Invoke-AgentInstallTransaction $f.Effects} 'INSTALLER_ROLLBACK_UNPROVEN'
    Check ($f.State.Candidate -and 'cleanup' -notin $f.State.Events -and $f.State.Recovery -ceq 'RESTORING')
}
foreach($failure in @('Cleanup','CleanupVerify')) {
    $cleanup=MemoryInstall $failure;Refuses {Invoke-AgentInstallTransaction $cleanup.Effects} 'INSTALLER_FAILED_CLEANUP_UNPROVEN'
    Check ($cleanup.State.Recovery -ceq 'RESTORING' -and 'finalize-restored' -notin $cleanup.State.Events)
    Refuses {Assert-AgentRecoveryTerminal ('a'*32) $cleanup.State.Recovery} 'INSTALLER_RECOVERY_PENDING'
}
$finalize=MemoryInstall 'Finalize';Refuses {Invoke-AgentInstallTransaction $finalize.Effects} 'INSTALLER_RECOVERY_FINALIZE_UNPROVEN';Check($finalize.State.Recovery -ceq 'RESTORING')
Check($finalize.State.Events.IndexOf('finalize-restored') -gt $finalize.State.Events.IndexOf('verify-cleaned'))
Refuses {Invoke-AgentInstallTransaction @{}} 'INSTALLER_EFFECT_REQUIRED'
function MemoryUninstall([string]$Fail='', [bool]$FalseCheck=$false) {
    $state=@{Protocol=$true;Shortcut=$true;Startup=$true;Files=$true;Registration=$true;Engine=$true;OtherRun='untouched';Profile='untouched';Journal='untouched';Recovery='COMMITTED';Events=[System.Collections.Generic.List[string]]::new()};$effects=@{}
    foreach($name in @('Protocol','Shortcut','Startup','Files','Registration')) {
        $effects['Remove'+$name]={ $state.Events.Add('remove-'+$name);if($Fail -ceq $name -and -not $FalseCheck){throw 'SYNTHETIC_REMOVE'};if($Fail -cne $name){$state[$name]=$false} }.GetNewClosure()
        $effects[$name+'Absent']={ $state.Events.Add('absent-'+$name);return (-not $state[$name]) }.GetNewClosure()
    }
    return @{State=$state;Effects=$effects}
}
$u=MemoryUninstall;Invoke-AgentUninstallTransaction $u.Effects;Check(-not $u.State.Files -and -not $u.State.Registration -and $u.State.Engine);Check(($u.State.Events -join ',') -ceq 'remove-Protocol,absent-Protocol,remove-Shortcut,absent-Shortcut,remove-Startup,absent-Startup,remove-Files,absent-Files,remove-Registration,absent-Registration')
foreach($failure in @('Protocol','Shortcut','Startup','Files','Registration')) {
    foreach($falseCheck in @($false,$true)) {
        $u=MemoryUninstall $failure $falseCheck
        $expected=if($failure -in @('Protocol','Shortcut','Startup')){'INSTALLER_UNINSTALL_ACTIVATION_INCOMPLETE'}elseif($failure -eq 'Files'){'INSTALLER_UNINSTALL_FILES_INCOMPLETE'}else{'INSTALLER_UNINSTALL_REGISTRATION_INCOMPLETE'}
        Refuses {Invoke-AgentUninstallTransaction $u.Effects} $expected
        if($failure -in @('Protocol','Shortcut','Startup')){Check($u.State.Files -and $u.State.Registration)}
        if($failure -eq 'Files'){Check($u.State.Registration)}
        Check($u.State.OtherRun -ceq 'untouched' -and $u.State.Profile -ceq 'untouched' -and $u.State.Journal -ceq 'untouched' -and $u.State.Recovery -ceq 'COMMITTED' -and $u.State.Engine)
    }
}
$retry=MemoryUninstall 'Registration';Refuses {Invoke-AgentUninstallTransaction $retry.Effects} 'INSTALLER_UNINSTALL_REGISTRATION_INCOMPLETE';Check($retry.State.Engine -and $retry.State.Registration)
$s=$retry.State;$retry.Effects.RemoveRegistration={ $s.Registration=$false }.GetNewClosure();Invoke-AgentUninstallTransaction $retry.Effects;Check(-not $retry.State.Registration -and $retry.State.Engine)
$root='C:\synthetic\product\versions\0.4.14-pilot'
Check((Resolve-AgentManifestPath $root 'share/doc/LICENSE.txt') -ceq ($root+'\share\doc\LICENSE.txt'))
foreach($bad in @('../outside','a/../outside','./a','/absolute','C:/absolute','C:relative','\\server\share','a\b','a//b','a/','a/file:stream','a./b','a /b','a/b.','a/b ','CON.txt','x/NUL','x/LPT1.txt','x/COM9','a?b','a|b','a*','a/<b','a/"b','')) {
    Refuses {Resolve-AgentManifestPath $root $bad} 'INSTALLER_MANIFEST_PATH_INVALID'
}
foreach($badRoot in @('C:\','relative','\\server\share','C:\synthetic\..\product')){Refuses {Resolve-AgentManifestPath $badRoot 'good.dll'} 'INSTALLER_MANIFEST_ROOT_INVALID'}
$entries=@([pscustomobject]@{path='agent.exe';bytes=1;sha256=('a'*64)},[pscustomobject]@{path='share/license.txt';bytes=2;sha256=('b'*64)})
Assert-AgentOwnedInventory $root $entries @('agent.exe','share/license.txt','manifest.json') @('share');Check($true)
foreach($extra in @('user.txt','../outside','C:/outside')){Refuses {Assert-AgentOwnedInventory $root $entries @('agent.exe','share/license.txt','manifest.json',$extra) @('share')} 'INSTALLER_VERSION_INVENTORY_UNKNOWN'}
Refuses {Assert-AgentOwnedInventory $root $entries @('agent.exe','manifest.json') @('share')} 'INSTALLER_VERSION_INVENTORY_UNKNOWN'
Refuses {Assert-AgentOwnedInventory $root $entries @('agent.exe','share/license.txt','manifest.json') @('share','user-empty-dir')} 'INSTALLER_VERSION_INVENTORY_UNKNOWN'
Refuses {Assert-AgentOwnedInventory $root @($entries[0],[pscustomobject]@{path='AGENT.EXE';bytes=1;sha256=('a'*64)}) @('agent.exe','manifest.json') @()} 'INSTALLER_VERSION_INVENTORY_UNKNOWN'
Refuses {Assert-AgentOwnedInventory $root @([pscustomobject]@{path='manifest.JSON';bytes=1;sha256=('a'*64)}) @('manifest.json') @()} 'INSTALLER_VERSION_INVENTORY_UNKNOWN'
Refuses {Assert-AgentOwnedInventory $root @([pscustomobject]@{path='agent.exe';bytes=$true;sha256=('a'*64)}) @('agent.exe','manifest.json') @()} 'INSTALLER_VERSION_INVENTORY_UNKNOWN'
foreach($terminal in @('COMMITTED','RESTORED')){Assert-AgentRecoveryTerminal ('a'*32) $terminal;Check($true)}
foreach($unknown in @('PENDING','RESTORING','FAILED','','committed')){Refuses {Assert-AgentRecoveryTerminal ('a'*32) $unknown} 'INSTALLER_RECOVERY_PENDING'}
Refuses {Assert-AgentRecoveryTerminal 'ambiguous' 'COMMITTED'} 'INSTALLER_RECOVERY_PENDING'
[pscustomobject]@{passed=$true;checks=$checks;effects='synthetic-memory-only';installerScriptExecuted=$false;registryTouched=$false;profileTouched=$false;agentOrSdkStarted=$false;networkUsed=$false;nativeAcceptance=$false}|ConvertTo-Json -Compress
