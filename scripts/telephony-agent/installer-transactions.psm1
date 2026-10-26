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
function Assert-AgentOwnedInventory([string]$Root, $Entries, $ActualFiles, $ActualDirectories) {
    if ($Entries -isnot [array] -or $Entries.Count -lt 1 -or $Entries.Count -gt 5000 -or $ActualFiles -isnot [array] -or $ActualDirectories -isnot [array] -or $ActualFiles.Count -gt 5001 -or $ActualDirectories.Count -gt 20000) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    $files = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $dirs = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Entries) {
        $fields = @($entry.PSObject.Properties.Name | Sort-Object)
        if (($fields -join ',') -cne 'bytes,path,sha256') { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
        Resolve-AgentManifestPath $Root $entry.path | Out-Null
        if ($entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or ($entry.bytes -isnot [int] -and $entry.bytes -isnot [long]) -or $entry.bytes -lt 0 -or $entry.bytes -gt 1073741824 -or -not $files.Add($entry.path)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
        $parts = $entry.path.Split('/')
        for ($i=1; $i -lt $parts.Length; $i++) { $dirs.Add(($parts[0..($i-1)] -join '/')) | Out-Null }
    }
    if (-not $files.Add('manifest.json') -or $ActualFiles.Count -ne $files.Count -or $ActualDirectories.Count -ne $dirs.Count) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    foreach ($file in $ActualFiles) { Resolve-AgentManifestPath $Root $file | Out-Null; if (-not $files.Remove($file)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' } }
    foreach ($dir in $ActualDirectories) { Resolve-AgentManifestPath $Root $dir | Out-Null; if (-not $dirs.Remove($dir)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' } }
    if ($files.Count -ne 0 -or $dirs.Count -ne 0) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
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
    $names = @('RemoveFiles','FilesAbsent','RemoveRegistration','RegistrationAbsent')
    foreach ($name in $activation) { $names += 'Remove' + $name; $names += $name + 'Absent' }
    Assert-AgentEffects $Effects $names
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
}
Export-ModuleMember -Function Invoke-AgentInstallTransaction,Invoke-AgentUninstallTransaction,Assert-AgentRecoveryTerminal,Resolve-AgentManifestPath,Assert-AgentOwnedInventory
