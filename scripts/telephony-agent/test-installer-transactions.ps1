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
    $effects.PrepareFiles={ $state.Events.Add('prepare-files') }.GetNewClosure()
    $effects.Finalize={ $state.Events.Add('finalize');$state.Recovery='COMPLETE' }.GetNewClosure()
    return @{State=$state;Effects=$effects}
}
$u=MemoryUninstall;Invoke-AgentUninstallTransaction $u.Effects;Check(-not $u.State.Files -and -not $u.State.Registration -and $u.State.Engine);Check(($u.State.Events -join ',') -ceq 'prepare-files,remove-Protocol,absent-Protocol,remove-Shortcut,absent-Shortcut,remove-Startup,absent-Startup,remove-Files,absent-Files,remove-Registration,absent-Registration,absent-Protocol,absent-Shortcut,absent-Startup,absent-Files,absent-Registration,finalize')
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
function Copy-MemoryObject($Value) { return ($Value | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json) }
function MemoryDeletion {
    $r='C:\synthetic\product'
    $files=@(
        [pscustomobject]@{path='versions/0.4.13-pilot/manifest.json';bytes=100;sha256=('a'*64)},
        [pscustomobject]@{path='versions/0.4.13-pilot/agent.exe';bytes=300;sha256=('b'*64)},
        [pscustomobject]@{path='versions/0.4.14-pilot/manifest.json';bytes=101;sha256=('c'*64)},
        [pscustomobject]@{path='versions/0.4.14-pilot/lib/agent.dll';bytes=301;sha256=('d'*64)},
        [pscustomobject]@{path='active-version.txt';bytes=12;sha256=('e'*64)}
    )
    $dirs=@('versions','versions/0.4.13-pilot','versions/0.4.14-pilot','versions/0.4.14-pilot/lib')
    $plan=[pscustomobject]@{schemaVersion=1;root=$r;files=$files;directories=$dirs}
    $s=@{Root=$r;Plan=$null;Template=$plan;Files=@($files);Dirs=@($dirs);Events=[System.Collections.Generic.List[string]]::new();Fail='';Boundary=0;At=-1;After=$false;Reparse=$false;Complete=$false;GlobalHashes=0;FileHashes=0;InspectCalls=0}
    $effects=@{
        ReadPlan={ $s.Events.Add('read');if($s.Fail -eq 'Read'){throw 'SYNTHETIC_READ'};if($s.Fail -eq 'CorruptRead'){return [pscustomobject]@{unknown='bad'}};return $s.Plan }.GetNewClosure()
        CapturePlan={ $s.Events.Add('capture');if($s.Fail -eq 'Capture'){throw 'SYNTHETIC_CAPTURE'};return (Copy-MemoryObject $s.Template) }.GetNewClosure()
        PersistPlan={param($p) $s.Events.Add('persist');if($s.Fail -eq 'Persist'){throw 'SYNTHETIC_PERSIST'};$s.Plan=Copy-MemoryObject $p;if($s.Fail -eq 'ReadBack'){$s.Plan.files[0].bytes=999} }.GetNewClosure()
        Observe={ $s.Events.Add('observe');$s.GlobalHashes+=$s.Files.Count;if($s.Reparse){throw 'INSTALLER_REPARSE_REFUSED'};return [pscustomobject]@{root=$s.Root;files=@($s.Files);directories=@($s.Dirs)} }.GetNewClosure()
        InspectStructure={ $s.Events.Add('inspect');$s.InspectCalls++;if($s.Reparse){throw 'INSTALLER_REPARSE_REFUSED'};return [pscustomobject]@{root=$s.Root;files=@($s.Files|ForEach-Object{[pscustomobject]@{path=$_.path;bytes=$_.bytes}});directories=@($s.Dirs)} }.GetNewClosure()
        DeleteFile={param($entry) $s.Events.Add('file:'+ $entry.path);$s.Boundary++;if($s.At -eq $s.Boundary -and -not $s.After){throw 'SYNTHETIC_INTERRUPT'};$current=@($s.Files|Where-Object{$_.path -ceq $entry.path});if($current.Count -gt 0){$s.FileHashes++;if($current[0].sha256 -cne $entry.sha256 -or $current[0].bytes -ne $entry.bytes){throw 'INSTALLER_UNINSTALL_REMAINING_DRIFT'}};$s.Files=@($s.Files|Where-Object{$_.path -cne $entry.path});if($s.At -eq $s.Boundary -and $s.After){throw 'SYNTHETIC_INTERRUPT'} }.GetNewClosure()
        DeleteDirectory={param($path) $s.Events.Add('dir:'+ $path);$s.Boundary++;if($s.At -eq $s.Boundary -and -not $s.After){throw 'SYNTHETIC_INTERRUPT'};if(@($s.Files|Where-Object{$_.path.StartsWith($path+'/')}).Count -gt 0 -or @($s.Dirs|Where-Object{$_.StartsWith($path+'/')}).Count -gt 0){throw 'SYNTHETIC_NOT_EMPTY'};$s.Dirs=@($s.Dirs|Where-Object{$_ -cne $path});if($s.At -eq $s.Boundary -and $s.After){throw 'SYNTHETIC_INTERRUPT'} }.GetNewClosure()
    }
    return @{State=$s;Effects=$effects}
}
$m=MemoryDeletion;$p=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects
Check($m.State.Events.IndexOf('persist') -lt $m.State.Events.LastIndexOf('read'))
Check(@($m.State.Events|Where-Object{$_ -match '^(file|dir):'}).Count -eq 0)
$m.State.GlobalHashes=0;$m.State.Events.Clear()
Invoke-AgentPlannedDeletion $m.State.Root $p $m.Effects
Check($m.State.Files.Count -eq 0 -and $m.State.Dirs.Count -eq 0)
Check($m.State.GlobalHashes -eq 5 -and $m.State.FileHashes -eq 5 -and $m.State.InspectCalls -eq 9)
Check(@($m.State.Events|Where-Object{$_ -ceq 'observe'}).Count -eq 2)
Check(($m.State.Events|Where-Object{$_ -match '^file:'}|Select-Object -First 1) -ceq 'file:versions/0.4.13-pilot/manifest.json')
foreach($during in @('extra','size','hash','reparse')) {
    $m=MemoryDeletion;$p=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects
    $s=$m.State;$inspect=$m.Effects.InspectStructure
    $m.Effects.InspectStructure={
        if($s.Boundary -eq 1){
            switch($during){
                'extra' {$s.Dirs+='versions/0.4.14-pilot/unknown'}
                'size' {$s.Files=Copy-MemoryObject $s.Files;$s.Files[0].bytes=999}
                'hash' {$s.Files=Copy-MemoryObject $s.Files;$s.Files[0].sha256='f'*64}
                'reparse' {$s.Reparse=$true}
            }
        }
        return (& $inspect)
    }.GetNewClosure()
    try{Invoke-AgentPlannedDeletion $s.Root $p $m.Effects;throw 'MISSING_FAILURE'}catch{Check($_.Exception.Message -cne 'MISSING_FAILURE')}
    Check($s.Files.Count -eq 4 -and -not $s.Complete)
    Check($s.Files[0].path -ceq 'versions/0.4.13-pilot/agent.exe')
}
# Interrupt before AND after every individual file/directory effect. Retry uses
# the same persisted plan, including when its original manifest is already gone.
foreach($after in @($false,$true)) {
    foreach($boundary in 1..9) {
        $m=MemoryDeletion;$p=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects
        $m.State.At=$boundary;$m.State.After=$after
        Refuses {Invoke-AgentPlannedDeletion $m.State.Root $p $m.Effects} 'SYNTHETIC_INTERRUPT'
        Check($null -ne $m.State.Plan -and -not $m.State.Complete)
        $m.State.At=-1;$m.State.Events.Clear()
        $resumed=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects
        Check('capture' -notin $m.State.Events -and 'persist' -notin $m.State.Events)
        Invoke-AgentPlannedDeletion $m.State.Root $resumed $m.Effects
        Check($m.State.Files.Count -eq 0 -and $m.State.Dirs.Count -eq 0)
    }
}
foreach($failure in @('Read','Capture','Persist','ReadBack','CorruptRead')) {
    $m=MemoryDeletion;$m.State.Fail=$failure
    try {Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects|Out-Null;throw 'MISSING_FAILURE'}catch{Check($_.Exception.Message -cne 'MISSING_FAILURE')}
    Check(@($m.State.Events|Where-Object{$_ -match '^(file|dir):'}).Count -eq 0 -and $m.State.Files.Count -eq 5)
}
foreach($drift in @('extra-file','extra-directory','hash','size','root','reparse','missing-plan','corrupt-plan')) {
    $m=MemoryDeletion;$p=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects
    switch($drift) {
        'extra-file' {$m.State.Files+= [pscustomobject]@{path='versions/0.4.14-pilot/user.txt';bytes=1;sha256=('f'*64)}}
        'extra-directory' {$m.State.Dirs+='versions/0.4.14-pilot/private'}
        'hash' {$m.State.Files=Copy-MemoryObject $m.State.Files;$m.State.Files[1].sha256='f'*64}
        'size' {$m.State.Files=Copy-MemoryObject $m.State.Files;$m.State.Files[1].bytes=999}
        'root' {$m.State.Root='C:\synthetic\other'}
        'reparse' {$m.State.Reparse=$true}
        'missing-plan' {$m.State.Plan=$null;$m.State.Fail='Capture';$m.State.Files=@($m.State.Files|Where-Object{$_.path -notmatch 'manifest.json$'})}
        'corrupt-plan' {$m.State.Plan=[pscustomobject]@{schemaVersion=1}}
    }
    $m.State.Events.Clear()
    try {$p=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects;Invoke-AgentPlannedDeletion $m.State.Root $p $m.Effects;throw 'MISSING_FAILURE'}catch{Check($_.Exception.Message -cne 'MISSING_FAILURE')}
    Check(@($m.State.Events|Where-Object{$_ -match '^(file|dir):'}).Count -eq 0)
}
# Mode gating is the production pure predicate: no new install/rollback while
# any nonterminal record remains; completed records are not returned as pending.
$m=MemoryDeletion;$p=Get-AgentPreparedDeletionPlan $m.State.Root $m.Effects
foreach($mode in @('Install','Rollback')){Refuses {Assert-AgentUninstallMode $mode $p} 'INSTALLER_UNINSTALL_PENDING';Assert-AgentUninstallMode $mode $null;Check($true)}
Assert-AgentUninstallMode 'Uninstall' $p;Check($true)
# Persist failure precedes ALL activation mutations, not just file deletion.
$u=MemoryUninstall;$u.Effects.PrepareFiles={throw 'SYNTHETIC_PERSIST'}
Refuses {Invoke-AgentUninstallTransaction $u.Effects} 'SYNTHETIC_PERSIST';Check($u.State.Events.Count -eq 0)
# Registration failure after complete file removal retains plan/engine. Explicit
# retry reaches registration again; no repeated capture or autonomous retries.
$m=MemoryDeletion;$u=MemoryUninstall 'Registration';$s=$m.State;$e=$m.Effects
$u.Effects.PrepareFiles={ $s.Prepared=Get-AgentPreparedDeletionPlan $s.Root $e }.GetNewClosure()
$u.Effects.RemoveFiles={ Invoke-AgentPlannedDeletion $s.Root $s.Prepared $e }.GetNewClosure()
$u.Effects.FilesAbsent={ return ($s.Files.Count -eq 0 -and $s.Dirs.Count -eq 0) }.GetNewClosure()
$u.Effects.Finalize={ $s.Complete=$true }.GetNewClosure()
Refuses {Invoke-AgentUninstallTransaction $u.Effects} 'INSTALLER_UNINSTALL_REGISTRATION_INCOMPLETE'
Check(-not $m.State.Complete -and $m.State.Files.Count -eq 0 -and $u.State.Engine)
$us=$u.State;$u.Effects.RemoveRegistration={ $us.Registration=$false }.GetNewClosure()
$u.Effects.Finalize={throw 'SYNTHETIC_FINALIZE'}
Refuses {Invoke-AgentUninstallTransaction $u.Effects} 'SYNTHETIC_FINALIZE';Check(-not $m.State.Complete -and -not $u.State.Registration)
$u.Effects.Finalize={ $s.Complete=$true }.GetNewClosure();Invoke-AgentUninstallTransaction $u.Effects;Check($m.State.Complete)
# A new lifecycle gets a NEW plan rather than reusing a completed one.
$next=MemoryDeletion;$nextPlan=Get-AgentPreparedDeletionPlan $next.State.Root $next.Effects
Check($next.State.Events.Contains('capture') -and $next.State.Files.Count -eq 5 -and -not $next.State.Complete)
# Actual production record decoder, with bytes and names supplied from memory.
# The digest detects corruption; it is not an authentication/signature claim.
$planBytes=[System.Text.Encoding]::UTF8.GetBytes(($nextPlan|ConvertTo-Json -Depth 12 -Compress))
$sha=[System.Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($sha.ComputeHash($planBytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
$id='a'*32;$names=@('plan.json','sha256.txt');$r=$next.State.Root
$record=Read-AgentDeletionRecord $r $id $names $planBytes $digest $null 0
Check(-not $record.Complete)
$record=Read-AgentDeletionRecord $r $id @('plan.json','sha256.txt','complete.pending') $planBytes $digest $null 0
Check(-not $record.Complete)
$record=Read-AgentDeletionRecord $r $id @('plan.json','sha256.txt','complete.pending') $planBytes $digest $null 31
Check(-not $record.Complete)
$record=Read-AgentDeletionRecord $r $id @('plan.json','sha256.txt','complete.txt') $planBytes $digest $digest 0
Check($record.Complete)
foreach($badNames in @(@('sha256.txt'),@('plan.json'),@('plan.json','sha256.txt','unknown'),@('PLAN.JSON','sha256.txt'),@('plan.json','sha256.txt','complete.txt','complete.pending'))) {
    Refuses {Read-AgentDeletionRecord $r $id $badNames $planBytes $digest $null 0} 'INSTALLER_UNINSTALL_PLAN_INVALID'
}
Refuses {Read-AgentDeletionRecord $r 'not-an-id' $names $planBytes $digest $null 0} 'INSTALLER_UNINSTALL_PLAN_INVALID'
Refuses {Read-AgentDeletionRecord $r $id $names $planBytes ('f'*64) $null 0} 'INSTALLER_UNINSTALL_PLAN_INVALID'
Refuses {Read-AgentDeletionRecord $r $id @('plan.json','sha256.txt','complete.txt') $planBytes $digest '' 0} 'INSTALLER_UNINSTALL_PLAN_INVALID'
Refuses {Read-AgentDeletionRecord $r $id @('plan.json','sha256.txt','complete.pending') $planBytes $digest $null 65} 'INSTALLER_UNINSTALL_PLAN_INVALID'
Refuses {Read-AgentDeletionRecord 'C:\synthetic\other' $id $names $planBytes $digest $null 0} 'INSTALLER_UNINSTALL_PLAN_INVALID'
foreach($badPath in @('install-windows-agent.ps1','.recovery/data','versions/user/data','versions/0.4.14-pilot/../user','versions/0.4.14-pilot/private:stream')) {
    $bad=Copy-MemoryObject $nextPlan;$bad.files[0].path=$badPath
    try{Assert-AgentDeletionPlan $r $bad;throw 'MISSING_FAILURE'}catch{Check($_.Exception.Message -cne 'MISSING_FAILURE')}
}
[pscustomobject]@{passed=$true;checks=$checks;effects='synthetic-memory-only';installerScriptExecuted=$false;registryTouched=$false;profileTouched=$false;agentOrSdkStarted=$false;networkUsed=$false;nativeAcceptance=$false}|ConvertTo-Json -Compress
