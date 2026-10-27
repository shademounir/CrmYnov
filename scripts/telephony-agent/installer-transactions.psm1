Set-StrictMode -Version Latest

# Coordination only. No filesystem, registry, COM, process or network access.
# The production script supplies narrow effects; tests supply memory effects.
function Assert-AgentEffects([hashtable]$Effects, [string[]]$Names) {
    foreach ($name in $Names) {
        if (-not $Effects.ContainsKey($name) -or $Effects[$name] -isnot [scriptblock]) { throw 'INSTALLER_EFFECT_REQUIRED' }
    }
}
function Assert-AgentPostcondition([scriptblock]$Check) {
    $result = & $Check
    if ($result -isnot [bool] -or -not $result) { throw 'INSTALLER_POSTCONDITION_FAILED' }
}
function Assert-AgentRecoveryTerminal([string]$Id, [string]$State) {
    if ($Id -notmatch '^[a-f0-9]{32}$' -or $State -cnotin @('COMMITTED','RESTORED')) { throw 'INSTALLER_RECOVERY_PENDING' }
}
function Resolve-AgentManifestPath([string]$Root, $Relative) {
    # Lexical Windows path validation only: no filesystem access.
    if ($Root -notmatch '^[A-Za-z]:\\' -or $Root.Length -le 3) { throw 'INSTALLER_MANIFEST_ROOT_INVALID' }
    try { $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') }
    catch { throw 'INSTALLER_MANIFEST_ROOT_INVALID' }
    if (-not $fullRoot.Equals($Root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'INSTALLER_MANIFEST_ROOT_INVALID' }
    if ($Relative -isnot [string] -or [string]::IsNullOrWhiteSpace($Relative) -or $Relative.Length -gt 1024 -or $Relative.Contains('\')) { throw 'INSTALLER_MANIFEST_PATH_INVALID' }
    $parts = $Relative.Split('/')
    foreach ($part in $parts) {
        if ([string]::IsNullOrEmpty($part) -or $part -in @('.','..') -or $part -match '[<>:"|?*\x00-\x1f]' -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'INSTALLER_MANIFEST_PATH_INVALID' }
    }
    try { $resolved = [System.IO.Path]::GetFullPath($fullRoot + '\' + ($parts -join '\')) }
    catch { throw 'INSTALLER_MANIFEST_PATH_INVALID' }
    if (-not $resolved.StartsWith($fullRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'INSTALLER_MANIFEST_PATH_INVALID' }
    return $resolved
}
function Assert-AgentFileEntry([string]$Root, $Entry) {
    $fields = @($Entry.PSObject.Properties.Name | Sort-Object)
    if (($fields -join ',') -cne 'bytes,path,sha256') { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    Resolve-AgentManifestPath $Root $Entry.path | Out-Null
    if ($Entry.sha256 -isnot [string] -or $Entry.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    if (($Entry.bytes -isnot [int] -and $Entry.bytes -isnot [long]) -or $Entry.bytes -lt 0 -or $Entry.bytes -gt 1073741824) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
}
function Add-AgentParentDirectories($Directories, [string]$Path) {
    $parts = $Path.Split('/')
    for ($i=1; $i -lt $parts.Length; $i++) { $Directories.Add(($parts[0..($i-1)] -join '/')) | Out-Null }
}
function Assert-AgentExactPaths([string]$Root, $Expected, $Actual) {
    if ($Actual.Count -ne $Expected.Count) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    foreach ($path in $Actual) {
        Resolve-AgentManifestPath $Root $path | Out-Null
        if (-not $Expected.Remove($path)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    }
    if ($Expected.Count -ne 0) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
}
function Assert-AgentOwnedInventory([string]$Root, $Entries, $ActualFiles, $ActualDirectories) {
    if ($Entries -isnot [array] -or $Entries.Count -lt 1 -or $Entries.Count -gt 5000 -or $ActualFiles -isnot [array] -or $ActualDirectories -isnot [array] -or $ActualFiles.Count -gt 5001 -or $ActualDirectories.Count -gt 20000) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    $files = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $dirs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Entries) {
        Assert-AgentFileEntry $Root $entry
        if (-not $files.Add($entry.path)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
        Add-AgentParentDirectories $dirs $entry.path
    }
    if (-not $files.Add('manifest.json') -or $ActualFiles.Count -ne $files.Count -or $ActualDirectories.Count -ne $dirs.Count) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    Assert-AgentExactPaths $Root $files $ActualFiles
    Assert-AgentExactPaths $Root $dirs $ActualDirectories
}
function Assert-AgentPlanShape([string]$Root, $Plan) {
    if ($null -eq $Plan -or (@($Plan.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'directories,files,root,schemaVersion') { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    if ($Plan.schemaVersion -isnot [int] -or $Plan.schemaVersion -ne 1 -or $Plan.root -cne $Root) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    if ($Plan.files -isnot [array] -or $Plan.directories -isnot [array]) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    if ($Plan.files.Count -gt 5000 -or $Plan.directories.Count -gt 20000) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
}
function Assert-AgentDeletionPath([string]$Path) {
    if ($Path -cne 'active-version.txt' -and $Path -cnotmatch '^versions/[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?/.+$') { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
}
function Assert-AgentDeletionPlan([string]$Root, $Plan) {
    Assert-AgentPlanShape $Root $Plan
    $files = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $dirs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $Plan.files) {
        Assert-AgentFileEntry $Root $file
        Assert-AgentDeletionPath $file.path
        if (-not $files.Add($file.path)) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
        Add-AgentParentDirectories $dirs $file.path
    }
    # An empty versions directory is permitted, but no arbitrary empty directory.
    if ('versions' -cin $Plan.directories) { $dirs.Add('versions') | Out-Null }
    Assert-AgentExactPaths $Root $dirs $Plan.directories
}
function Assert-AgentObservationShape([string]$Root, $Plan, $Observed) {
    if ($null -eq $Observed -or (@($Observed.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'directories,files,root' -or $Observed.root -cne $Root) { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
    if ($Observed.files -isnot [array] -or $Observed.directories -isnot [array] -or $Observed.files.Count -gt $Plan.files.Count -or $Observed.directories.Count -gt $Plan.directories.Count) { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
}
function Assert-AgentRemainingInventory([string]$Root, $Plan, $Observed) {
    Assert-AgentDeletionPlan $Root $Plan
    Assert-AgentObservationShape $Root $Plan $Observed
    $expected = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $Plan.files) { $expected.Add($file.path, $file) }
    foreach ($file in $Observed.files) {
        Assert-AgentFileEntry $Root $file
        if (-not $expected.ContainsKey($file.path)) { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
        $owned = $expected[$file.path]
        if ($owned.sha256 -cne $file.sha256 -or $owned.bytes -ne $file.bytes) { throw 'INSTALLER_UNINSTALL_REMAINING_DRIFT' }
        $expected.Remove($file.path) | Out-Null
    }
    $dirs = [System.Collections.Generic.HashSet[string]]::new([string[]]$Plan.directories, [StringComparer]::OrdinalIgnoreCase)
    foreach ($dir in $Observed.directories) {
        Resolve-AgentManifestPath $Root $dir | Out-Null
        if (-not $dirs.Remove($dir)) { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
    }
}
function Assert-AgentRemainingStructure([string]$Root, $Plan, $Observed) {
    Assert-AgentObservationShape $Root $Plan $Observed
    $expected = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $Plan.files) { $expected.Add($file.path, $file) }
    foreach ($file in $Observed.files) {
        if ((@($file.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'bytes,path') { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
        Resolve-AgentManifestPath $Root $file.path | Out-Null
        if (-not $expected.ContainsKey($file.path)) { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
        if (($file.bytes -isnot [int] -and $file.bytes -isnot [long]) -or $expected[$file.path].bytes -ne $file.bytes) { throw 'INSTALLER_UNINSTALL_REMAINING_DRIFT' }
        $expected.Remove($file.path) | Out-Null
    }
    $dirs = [System.Collections.Generic.HashSet[string]]::new([string[]]$Plan.directories, [StringComparer]::OrdinalIgnoreCase)
    foreach ($dir in $Observed.directories) {
        Resolve-AgentManifestPath $Root $dir | Out-Null
        if (-not $dirs.Remove($dir)) { throw 'INSTALLER_UNINSTALL_REMAINING_UNKNOWN' }
    }
}
function Get-AgentPreparedDeletionPlan([string]$Root, [hashtable]$Effects) {
    Assert-AgentEffects $Effects @('ReadPlan','CapturePlan','PersistPlan','Observe','DeleteFile','DeleteDirectory')
    $plan = & $Effects.ReadPlan
    if ($null -eq $plan) {
        $plan = & $Effects.CapturePlan
        Assert-AgentDeletionPlan $Root $plan
        Assert-AgentRemainingInventory $Root $plan (& $Effects.Observe)
        & $Effects.PersistPlan $plan | Out-Null
        $readBack = & $Effects.ReadPlan
        if (($plan | ConvertTo-Json -Depth 12 -Compress) -cne ($readBack | ConvertTo-Json -Depth 12 -Compress)) { throw 'INSTALLER_UNINSTALL_PLAN_READBACK_FAILED' }
        $plan = $readBack
    }
    Assert-AgentRemainingInventory $Root $plan (& $Effects.Observe)
    return $plan
}
function Invoke-AgentPlannedDeletion([string]$Root, $Plan, [hashtable]$Effects) {
    Assert-AgentEffects $Effects @('Observe','InspectStructure','DeleteFile','DeleteDirectory')
    Assert-AgentRemainingInventory $Root $Plan (& $Effects.Observe)
    # Full content hashes at entry/final proof; structure-only guards between
    # deletions. DeleteFile must recheck that individual file's size AND hash
    # immediately before deletion. No quadratic rereading of SDK contents.
    foreach ($file in $Plan.files) {
        Assert-AgentRemainingStructure $Root $Plan (& $Effects.InspectStructure)
        & $Effects.DeleteFile $file | Out-Null
    }
    foreach ($dir in @($Plan.directories | Sort-Object { $_.Split('/').Length } -Descending)) {
        Assert-AgentRemainingStructure $Root $Plan (& $Effects.InspectStructure)
        & $Effects.DeleteDirectory $dir | Out-Null
    }
    $remaining = & $Effects.Observe
    Assert-AgentRemainingInventory $Root $Plan $remaining
    if ($remaining.files.Count -ne 0 -or $remaining.directories.Count -ne 0) { throw 'INSTALLER_UNINSTALL_FILES_INCOMPLETE' }
}
function Assert-AgentUninstallMode([string]$Mode, $PendingPlan) {
    if ($Mode -cnotin @('Install','Rollback','Uninstall')) { throw 'INSTALLER_MODE_UNKNOWN' }
    if ($Mode -cne 'Uninstall' -and $null -ne $PendingPlan) { throw 'INSTALLER_UNINSTALL_PENDING' }
}
function Read-AgentDeletionRecord([string]$Root, [string]$Id, $Names, [byte[]]$PlanBytes, [string]$Digest, $CompleteText, [long]$PendingLength) {
    if ($Id -cnotmatch '^[a-f0-9]{32}$' -or $Names -isnot [array]) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    $namesText = (@($Names | Sort-Object) -join ',')
    if ($namesText -cnotin @('plan.json,sha256.txt','complete.pending,plan.json,sha256.txt','complete.txt,plan.json,sha256.txt')) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    if ($PlanBytes.Length -gt 1048576 -or $Digest -cnotmatch '^[a-f0-9]{64}$' -or $PendingLength -gt 64 -or $PendingLength -lt 0) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    $sha=[System.Security.Cryptography.SHA256]::Create()
    try { $actual=([BitConverter]::ToString($sha.ComputeHash($PlanBytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($actual -cne $Digest) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    $encoding=[System.Text.UTF8Encoding]::new($false,$true)
    $plan=$encoding.GetString($PlanBytes)|ConvertFrom-Json
    Assert-AgentDeletionPlan $Root $plan
    $complete='complete.txt' -cin $Names
    if ($complete -and $CompleteText -cne $Digest) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    return [pscustomobject]@{ Plan=$plan; Complete=$complete; Digest=$Digest }
}
function Invoke-AgentInstallTransaction([hashtable]$Effects) {
    Assert-AgentEffects $Effects @('Capture','Stage','Activate','Verify','Restore','VerifyRestored','Cleanup','VerifyCleaned','FinalizeRestored')
    $before = & $Effects.Capture
    if ($null -eq $before) { throw 'INSTALLER_SNAPSHOT_REQUIRED' }
    try {
        & $Effects.Stage | Out-Null
        & $Effects.Activate | Out-Null
        Assert-AgentPostcondition $Effects.Verify
    }
    catch {
        $original = $_
        try {
            & $Effects.Restore $before | Out-Null
            $restored = & $Effects.VerifyRestored $before
            if ($restored -isnot [bool] -or -not $restored) { throw 'INSTALLER_RESTORE_POSTCONDITION_FAILED' }
        }
        catch { throw 'INSTALLER_ROLLBACK_UNPROVEN' }
        # Never delete the candidate if restoration is uncertain: retain evidence.
        try { & $Effects.Cleanup | Out-Null; Assert-AgentPostcondition $Effects.VerifyCleaned }
        catch { throw 'INSTALLER_FAILED_CLEANUP_UNPROVEN' }
        try { & $Effects.FinalizeRestored | Out-Null }
        catch { throw 'INSTALLER_RECOVERY_FINALIZE_UNPROVEN' }
        throw $original
    }
}
function Invoke-AgentUninstallTransaction([hashtable]$Effects) {
    $activation = @('Protocol','Shortcut','Startup')
    $names = @('PrepareFiles','RemoveFiles','FilesAbsent','RemoveRegistration','RegistrationAbsent','Finalize')
    foreach ($name in $activation) { $names += 'Remove' + $name; $names += $name + 'Absent' }
    Assert-AgentEffects $Effects $names
    & $Effects.PrepareFiles | Out-Null
    $failed = $false
    foreach ($name in $activation) {
        try { & $Effects[('Remove' + $name)] | Out-Null; Assert-AgentPostcondition $Effects[($name + 'Absent')] }
        catch { $failed = $true }
    }
    if ($failed) { throw 'INSTALLER_UNINSTALL_ACTIVATION_INCOMPLETE' }
    # Keep uninstall registration until the previous phases are proven complete.
    try { & $Effects.RemoveFiles | Out-Null; Assert-AgentPostcondition $Effects.FilesAbsent }
    catch { throw 'INSTALLER_UNINSTALL_FILES_INCOMPLETE' }
    try { & $Effects.RemoveRegistration | Out-Null; Assert-AgentPostcondition $Effects.RegistrationAbsent }
    catch { throw 'INSTALLER_UNINSTALL_REGISTRATION_INCOMPLETE' }
    foreach ($name in $activation) { Assert-AgentPostcondition $Effects[($name + 'Absent')] }
    Assert-AgentPostcondition $Effects.FilesAbsent
    Assert-AgentPostcondition $Effects.RegistrationAbsent
    & $Effects.Finalize | Out-Null
}
Export-ModuleMember -Function Invoke-AgentInstallTransaction,Invoke-AgentUninstallTransaction,Assert-AgentRecoveryTerminal,Resolve-AgentManifestPath,Assert-AgentOwnedInventory,Assert-AgentDeletionPlan,Assert-AgentRemainingInventory,Get-AgentPreparedDeletionPlan,Invoke-AgentPlannedDeletion,Assert-AgentUninstallMode,Read-AgentDeletionRecord
