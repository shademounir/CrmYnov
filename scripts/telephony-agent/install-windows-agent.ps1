[CmdletBinding(DefaultParameterSetName = 'Install')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Install')][string]$PackageDirectory,
    [Parameter(Mandatory = $true, ParameterSetName = 'Install')][string]$Version,
    [Parameter(ParameterSetName = 'Install')][switch]$NoLaunch,
    [Parameter(Mandatory = $true, ParameterSetName = 'Rollback')][string]$RollbackVersion,
    [Parameter(Mandatory = $true, ParameterSetName = 'Uninstall')][switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$productName = 'CRM Ynov Telephony Agent'
$scheme = 'crmynov-telephony'
$installRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\CRM Ynov Telephony Agent'
$versionsRoot = Join-Path $installRoot 'versions'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CRM Ynov Telephony Agent.lnk'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent'
$protocolKey = "HKCU:\Software\Classes\$scheme"
$transactionModule = Join-Path $PSScriptRoot 'installer-transactions.psm1'
Import-Module -Name $transactionModule -Force
$recoveryRoot = Join-Path $installRoot '.recovery'
$activeRecovery = $null
$uninstallRecoveryRoot = Join-Path $installRoot '.uninstall-recovery'
$activeUninstallRecovery = $null
$uninstallPlan = $null

function Assert-ManagedPath([string]$Path) {
    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Path))
    $expectedParent = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'))
    if (-not $resolvedParent.Equals($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'INSTALL_PATH_OUTSIDE_MANAGED_ROOT' }
}

function Assert-NoReparseTree([string]$Path) {
    try { [System.IO.File]::GetAttributes($Path) | Out-Null }
    catch [System.IO.FileNotFoundException] { return }
    catch [System.IO.DirectoryNotFoundException] { return }
    $pending = [System.Collections.Generic.Stack[string]]::new(); $pending.Push([System.IO.Path]::GetFullPath($Path)); $count = 0
    while ($pending.Count -gt 0) {
        $item = $pending.Pop(); $count++
        if ($count -gt 20000) { throw 'INSTALLER_TREE_BOUND' }
        $attributes = [System.IO.File]::GetAttributes($item)
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALLER_REPARSE_REFUSED' }
        if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
            foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries($item)) { $pending.Push($child) }
        }
    }
}
function Assert-NoReparseAncestors([string]$Path) {
    $current = [System.IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrEmpty($current)) {
        try { $attributes = [System.IO.File]::GetAttributes($current) }
        catch [System.IO.FileNotFoundException] { $attributes = $null }
        catch [System.IO.DirectoryNotFoundException] { $attributes = $null }
        if ($null -ne $attributes -and ($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALLER_REPARSE_REFUSED' }
        $current = [System.IO.Path]::GetDirectoryName($current)
    }
}
function Assert-ProductRoot {
    Assert-ManagedPath $installRoot
    Assert-NoReparseAncestors $installRoot
    Assert-NoReparseAncestors $startMenu
    Assert-NoReparseTree $installRoot
    Assert-NoReparseTree $startMenu
}
function Assert-VersionPath([string]$Path) {
    $full = [System.IO.Path]::GetFullPath($Path)
    if (-not ([System.IO.Path]::GetDirectoryName($full)).Equals([System.IO.Path]::GetFullPath($versionsRoot), [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($full) -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'INSTALLER_VERSION_PATH_REFUSED' }
    Assert-ProductRoot
    Assert-NoReparseTree $full
}

function Read-RegistryTree($Key, [int]$Depth = 0) {
    if ($Depth -gt 8) { throw 'INSTALLER_REGISTRY_SNAPSHOT_BOUND' }
    $names = @($Key.GetValueNames() | Sort-Object); $children = @($Key.GetSubKeyNames() | Sort-Object)
    if ($names.Count -gt 128 -or $children.Count -gt 32) { throw 'INSTALLER_REGISTRY_SNAPSHOT_BOUND' }
    $values = @($names | ForEach-Object { [pscustomobject]@{ Name = $_; Kind = $Key.GetValueKind($_).ToString(); Data = $Key.GetValue($_, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } })
    $subkeys = @($children | ForEach-Object {
        $child = $Key.OpenSubKey($_)
        try { [pscustomobject]@{ Name = $_; Node = Read-RegistryTree $child ($Depth + 1) } } finally { $child.Dispose() }
    })
    return [pscustomobject]@{ Values = $values; Children = $subkeys }
}
function Get-RegistrySnapshot([string]$Relative) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Relative)
    if ($null -eq $key) { return [pscustomobject]@{ Exists = $false; Node = $null } }
    try { return [pscustomobject]@{ Exists = $true; Node = Read-RegistryTree $key } } finally { $key.Dispose() }
}
function Restore-RegistryNode($Key, $Node) {
    foreach ($name in $Key.GetValueNames()) { if ($name -notin @($Node.Values | ForEach-Object { $_.Name })) { $Key.DeleteValue($name, $false) } }
    foreach ($name in $Key.GetSubKeyNames()) { if ($name -notin @($Node.Children | ForEach-Object { $_.Name })) { $Key.DeleteSubKeyTree($name, $false) } }
    foreach ($value in $Node.Values) {
        $kind = [Microsoft.Win32.RegistryValueKind][System.Enum]::Parse([Microsoft.Win32.RegistryValueKind], $value.Kind)
        $data = $value.Data
        switch ($value.Kind) { 'Binary' { $data = [byte[]]$data }; 'MultiString' { $data = [string[]]$data }; 'DWord' { $data = [int]$data }; 'QWord' { $data = [long]$data } }
        $Key.SetValue($value.Name, $data, $kind)
    }
    foreach ($child in $Node.Children) { $keyChild = $Key.CreateSubKey($child.Name); try { Restore-RegistryNode $keyChild $child.Node } finally { $keyChild.Dispose() } }
}
function Restore-RegistrySnapshot([string]$Relative, $Snapshot) {
    if (-not $Snapshot.Exists) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($Relative, $false); return }
    # Existing keys stay in place: preserve their existing ACLs and unrelated siblings.
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Relative)
    try { Restore-RegistryNode $key $Snapshot.Node } finally { $key.Dispose() }
}
function Get-StartupSnapshot {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
    try {
        if ($null -eq $key -or $productName -notin $key.GetValueNames()) { return [pscustomobject]@{ Exists = $false; Kind = $null; Data = $null } }
        return [pscustomobject]@{ Exists = $true; Kind = $key.GetValueKind($productName).ToString(); Data = $key.GetValue($productName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    } finally { if ($null -ne $key) { $key.Dispose() } }
}
function Restore-StartupSnapshot($Snapshot) {
    if (-not $Snapshot.Exists) { Remove-Startup; return }
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
    try { $key.SetValue($productName, $Snapshot.Data, [Microsoft.Win32.RegistryValueKind][System.Enum]::Parse([Microsoft.Win32.RegistryValueKind], $Snapshot.Kind)) } finally { $key.Dispose() }
}
function Get-ActivationFiles {
    return [ordered]@{ Shortcut = $startMenu; ActiveVersion = (Join-Path $installRoot 'active-version.txt'); Script = (Join-Path $installRoot 'install-windows-agent.ps1'); Module = (Join-Path $installRoot 'installer-transactions.psm1') }
}
function Get-ActivationSnapshot {
    Assert-ProductRoot
    $files = [ordered]@{}
    foreach ($entry in (Get-ActivationFiles).GetEnumerator()) {
        if ([System.IO.Directory]::Exists($entry.Value)) { throw 'INSTALLER_ACTIVATION_FILE_SHAPE_UNKNOWN' }
        $exists = [System.IO.File]::Exists($entry.Value); $bytes = $null
        if ($exists) { if ((Get-Item -LiteralPath $entry.Value).Length -gt 1048576) { throw 'INSTALLER_FILE_SNAPSHOT_BOUND' }; $bytes = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($entry.Value)) }
        $files[$entry.Key] = [pscustomobject]@{ Exists = $exists; Bytes = $bytes }
    }
    return [pscustomobject]@{ Protocol = (Get-RegistrySnapshot "Software\Classes\$scheme"); Registration = (Get-RegistrySnapshot 'Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent'); Startup = (Get-StartupSnapshot); Files = $files }
}
function Restore-ActivationSnapshot($Snapshot) {
    Assert-ProductRoot
    Restore-RegistrySnapshot "Software\Classes\$scheme" $Snapshot.Protocol
    Restore-RegistrySnapshot 'Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent' $Snapshot.Registration
    Restore-StartupSnapshot $Snapshot.Startup
    foreach ($entry in (Get-ActivationFiles).GetEnumerator()) {
        $file = $Snapshot.Files[$entry.Key]
        if ($file.Exists) { [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($entry.Value)) | Out-Null; [System.IO.File]::WriteAllBytes($entry.Value, [Convert]::FromBase64String($file.Bytes)) }
        elseif ([System.IO.File]::Exists($entry.Value)) { [System.IO.File]::Delete($entry.Value) }
    }
}
function Assert-NoPendingRecovery {
    Assert-ProductRoot
    if (-not [System.IO.Directory]::Exists($recoveryRoot)) { return }
    foreach ($dir in [System.IO.Directory]::EnumerateDirectories($recoveryRoot)) {
        $state = Join-Path $dir 'state.txt'
        if (-not [System.IO.File]::Exists($state)) { throw 'INSTALLER_RECOVERY_PENDING' }
        Assert-AgentRecoveryTerminal ([System.IO.Path]::GetFileName($dir)) ([System.IO.File]::ReadAllText($state))
    }
    if (@([System.IO.Directory]::EnumerateFiles($recoveryRoot)).Count -gt 0) { throw 'INSTALLER_RECOVERY_PENDING' }
}
function Save-RecoverySnapshot {
    Assert-NoPendingRecovery
    $snapshot = Get-ActivationSnapshot
    $script:activeRecovery = Join-Path $recoveryRoot ([Guid]::NewGuid().ToString('N'))
    if ([System.IO.Directory]::Exists($script:activeRecovery)) { throw 'INSTALLER_RECOVERY_EXISTS' }
    [System.IO.Directory]::CreateDirectory($script:activeRecovery) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $script:activeRecovery 'state.txt'), 'PENDING')
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($snapshot | ConvertTo-Json -Depth 32 -Compress))
    if ($bytes.Length -gt 1048576) { throw 'INSTALLER_ACTIVATION_SNAPSHOT_BOUND' }
    $stream = [System.IO.File]::Open((Join-Path $script:activeRecovery 'activation.json'), [System.IO.FileMode]::CreateNew)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    return $snapshot
}
function Set-RecoveryState([string]$State) {
    $stream = [System.IO.File]::Open((Join-Path $script:activeRecovery 'state.txt'), [System.IO.FileMode]::Create)
    try { $bytes = [System.Text.Encoding]::UTF8.GetBytes($State); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Test-RestoredSnapshot($Snapshot) {
    $equal = ($Snapshot | ConvertTo-Json -Depth 32 -Compress) -ceq ((Get-ActivationSnapshot) | ConvertTo-Json -Depth 32 -Compress)
    return $equal
}
function Remove-Startup {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true)
    if ($null -eq $key) { return }; try { $key.DeleteValue($productName, $false) } finally { $key.Dispose() }
}

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Get-StartupPreference {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
    if ($null -eq $key) { return $null }
    try { return $key.GetValue($productName, $null) }
    finally { $key.Dispose() }
}

function Set-Activation([string]$Executable, [string]$ActiveVersion) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "AGENT_EXECUTABLE_MISSING: $Executable" }
    try {
        $protocol = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$scheme")
        if ($null -eq $protocol) { throw 'PROTOCOL_KEY_UNAVAILABLE' }
        try {
            $protocol.SetValue('', "URL:$productName", [Microsoft.Win32.RegistryValueKind]::String)
            $protocol.SetValue('URL Protocol', '', [Microsoft.Win32.RegistryValueKind]::String)
            $icon = $protocol.CreateSubKey('DefaultIcon')
            $command = $protocol.CreateSubKey('shell\open\command')
            if ($null -eq $icon -or $null -eq $command) { throw 'PROTOCOL_CHILD_KEY_UNAVAILABLE' }
            try {
                $icon.SetValue('', ('"{0}",0' -f $Executable), [Microsoft.Win32.RegistryValueKind]::String)
                $command.SetValue('', ('"{0}" "%1"' -f $Executable), [Microsoft.Win32.RegistryValueKind]::String)
            }
            finally { $icon.Dispose(); $command.Dispose() }
        }
        finally { $protocol.Dispose() }
    }
    catch { throw 'INSTALLER_PROTOCOL_REGISTRATION_FAILED' }

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($startMenu)
        $shortcut.TargetPath = $Executable
        $shortcut.WorkingDirectory = Split-Path -Parent $Executable
        $shortcut.IconLocation = "$Executable,0"
        $shortcut.Description = $productName
        $shortcut.Save()
    }
    catch { throw 'INSTALLER_START_MENU_FAILED' }

    # Preserve the user's explicit startup preference on upgrades and rollbacks.
    # A fresh installation must not silently opt the user into Windows startup;
    # the checkbox in the agent remains the single source of that choice.
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $startupValue = Get-StartupPreference
    if (-not [string]::IsNullOrWhiteSpace($startupValue)) {
        New-ItemProperty -Path $runKey -Name $productName -Value ('"{0}"' -f $Executable) -PropertyType String -Force | Out-Null
    }

    try {
        $installedScript = Join-Path $installRoot 'install-windows-agent.ps1'
        $uninstall = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent')
        if ($null -eq $uninstall) { throw 'UNINSTALL_KEY_UNAVAILABLE' }
        try {
            $uninstall.SetValue('DisplayName', $productName, [Microsoft.Win32.RegistryValueKind]::String)
            $uninstall.SetValue('DisplayVersion', $ActiveVersion, [Microsoft.Win32.RegistryValueKind]::String)
            $uninstall.SetValue('Publisher', 'CRM Ynov', [Microsoft.Win32.RegistryValueKind]::String)
            $uninstall.SetValue('DisplayIcon', $Executable, [Microsoft.Win32.RegistryValueKind]::String)
            $uninstall.SetValue('InstallLocation', (Split-Path -Parent $Executable), [Microsoft.Win32.RegistryValueKind]::String)
            $uninstall.SetValue('NoModify', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
            $uninstall.SetValue('NoRepair', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
            $uninstall.SetValue('UninstallString', ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -Uninstall' -f $installedScript), [Microsoft.Win32.RegistryValueKind]::String)
        }
        finally { $uninstall.Dispose() }
        Set-Content -LiteralPath (Join-Path $installRoot 'active-version.txt') -Value $ActiveVersion -Encoding ascii
    }
    catch { throw 'INSTALLER_UNINSTALL_REGISTRATION_FAILED' }
}

function Test-ActivationRegistry([string]$Executable, [string]$ActiveVersion) {
    $protocol = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Classes\$scheme")
    $command = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Classes\$scheme\shell\open\command")
    $registration = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent')
    try {
        if ($null -eq $protocol -or $null -eq $command -or $null -eq $registration) { return $false }
        if ($protocol.GetValue('') -cne "URL:$productName" -or 'URL Protocol' -notin $protocol.GetValueNames() -or $command.GetValue('') -cne ('"{0}" "%1"' -f $Executable)) { return $false }
        if ($registration.GetValue('DisplayVersion') -cne $ActiveVersion -or $registration.GetValue('InstallLocation') -cne (Split-Path -Parent $Executable)) { return $false }
    } finally { foreach ($key in @($protocol,$command,$registration)) { if ($null -ne $key) { $key.Dispose() } } }
    return $true
}
function Test-ActivationStartup([string]$Executable, $Before) {
    $startup = Get-StartupSnapshot
    if ($Before.Startup.Exists -and -not [string]::IsNullOrWhiteSpace([string]$Before.Startup.Data)) {
        return ($startup.Exists -and $startup.Data -ceq ('"{0}"' -f $Executable))
    }
    return (($startup | ConvertTo-Json -Compress) -ceq ($Before.Startup | ConvertTo-Json -Compress))
}
function Test-Activation([string]$Executable, [string]$ActiveVersion, $Before) {
    if (-not (Test-ActivationRegistry $Executable $ActiveVersion)) { return $false }
    if (-not [System.IO.File]::Exists($startMenu)) { return $false }
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($startMenu)
    if (-not $shortcut.TargetPath.Equals($Executable, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ([System.IO.File]::ReadAllText((Join-Path $installRoot 'active-version.txt')).Trim() -cne $ActiveVersion) { return $false }
    return (Test-ActivationStartup $Executable $Before)
}
function Invoke-ActivationUpdate([string]$Executable, [string]$ActiveVersion, [scriptblock]$Stage, [scriptblock]$Cleanup, [scriptblock]$Cleaned) {
    $script:desiredExecutable = $Executable; $script:desiredVersion = $ActiveVersion
    Invoke-AgentInstallTransaction @{
        Capture = { $script:activationBefore = Save-RecoverySnapshot; return $script:activationBefore }
        Stage = $Stage
        Activate = { Set-Activation $script:desiredExecutable $script:desiredVersion }
        Verify = { $ok = Test-Activation $script:desiredExecutable $script:desiredVersion $script:activationBefore; if ($ok) { Set-RecoveryState 'COMMITTED' }; return $ok }
        Restore = { param($snapshot) Set-RecoveryState 'RESTORING'; Restore-ActivationSnapshot $snapshot }
        VerifyRestored = { param($snapshot) Test-RestoredSnapshot $snapshot }
        Cleanup = $Cleanup
        VerifyCleaned = $Cleaned
        FinalizeRestored = { Set-RecoveryState 'RESTORED' }
    }
}

function Get-OwnedFileEntry([string]$Root, [string]$Path) {
    $absolute = Resolve-AgentManifestPath $Root $Path
    return [pscustomobject]@{ path=$Path; bytes=(Get-Item -LiteralPath $absolute).Length; sha256=(Get-Sha256 $absolute) }
}
function Get-VersionDeletionEntries([string]$VersionPath) {
    Assert-VersionPath $VersionPath
    $manifestFile = Join-Path $VersionPath 'manifest.json'
    if (-not [System.IO.File]::Exists($manifestFile) -or (Get-Item -LiteralPath $manifestFile).Length -gt 1048576) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    $manifest = [System.IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.product -cne $productName -or $manifest.version -cne [System.IO.Path]::GetFileName($VersionPath)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    $actualFiles = @([System.IO.Directory]::EnumerateFiles($VersionPath, '*', [System.IO.SearchOption]::AllDirectories) | ForEach-Object { $_.Substring($VersionPath.Length + 1).Replace('\','/') })
    $actualDirs = @([System.IO.Directory]::EnumerateDirectories($VersionPath, '*', [System.IO.SearchOption]::AllDirectories) | ForEach-Object { $_.Substring($VersionPath.Length + 1).Replace('\','/') })
    Assert-AgentOwnedInventory $VersionPath $manifest.files $actualFiles $actualDirs
    $prefix = 'versions/' + [System.IO.Path]::GetFileName($VersionPath) + '/'
    # The manifest is itself owned and recorded before it can be removed first.
    Get-OwnedFileEntry $installRoot ($prefix + 'manifest.json')
    foreach ($file in $manifest.files) {
        $observed = Get-OwnedFileEntry $VersionPath $file.path
        if ($observed.bytes -ne $file.bytes -or $observed.sha256 -cne $file.sha256) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
        [pscustomobject]@{ path=($prefix + $file.path); bytes=$observed.bytes; sha256=$observed.sha256 }
    }
}
function Get-DeletionFileMetadata([string]$Relative, [bool]$WithHash) {
    if ($WithHash) { return (Get-OwnedFileEntry $installRoot $Relative) }
    $path=Resolve-AgentManifestPath $installRoot $Relative
    return [pscustomobject]@{ path=$Relative; bytes=(Get-Item -LiteralPath $path).Length }
}
function Get-DeletionObservation([bool]$WithHash = $true) {
    Assert-ProductRoot
    if ([System.IO.File]::Exists($versionsRoot)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    $files = @(); $dirs = @()
    if ([System.IO.Directory]::Exists($versionsRoot)) {
        $files = @([System.IO.Directory]::EnumerateFiles($versionsRoot, '*', [System.IO.SearchOption]::AllDirectories) | ForEach-Object { Get-DeletionFileMetadata ($_.Substring($installRoot.Length + 1).Replace('\','/')) $WithHash })
        $dirs = @('versions') + @([System.IO.Directory]::EnumerateDirectories($versionsRoot, '*', [System.IO.SearchOption]::AllDirectories) | ForEach-Object { $_.Substring($installRoot.Length + 1).Replace('\','/') })
    }
    $activeFile = Join-Path $installRoot 'active-version.txt'
    if ([System.IO.Directory]::Exists($activeFile)) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
    if ([System.IO.File]::Exists($activeFile)) { $files += Get-DeletionFileMetadata 'active-version.txt' $WithHash }
    return [pscustomobject]@{ root=$installRoot; files=@($files); directories=@($dirs) }
}
function New-UninstallPlan {
    $observation = Get-DeletionObservation
    $files = @()
    if ([System.IO.Directory]::Exists($versionsRoot)) {
        $versions = @([System.IO.Directory]::EnumerateDirectories($versionsRoot))
        if ($versions.Count -gt 100 -or @([System.IO.Directory]::EnumerateFiles($versionsRoot)).Count -ne 0) { throw 'INSTALLER_VERSION_INVENTORY_UNKNOWN' }
        foreach ($versionPath in $versions) { $files += @(Get-VersionDeletionEntries $versionPath) }
    }
    if ([System.IO.File]::Exists((Join-Path $installRoot 'active-version.txt'))) { $files += Get-OwnedFileEntry $installRoot 'active-version.txt' }
    return [pscustomobject]@{ schemaVersion=1; root=$installRoot; files=@($files); directories=@($observation.directories) }
}
function Write-DurableNewFile([string]$Path, [byte[]]$Bytes) {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Get-PlanDigest([byte[]]$Bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Read-UninstallRecord([string]$Directory) {
    $names = @([System.IO.Directory]::EnumerateFiles($Directory) | ForEach-Object { [System.IO.Path]::GetFileName($_) } | Sort-Object)
    if (@([System.IO.Directory]::EnumerateDirectories($Directory)).Count -ne 0) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    $path = Join-Path $Directory 'plan.json'
    foreach ($file in $names) { if ((Get-Item -LiteralPath (Join-Path $Directory $file)).Length -gt 1048576) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' } }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $digest = [System.IO.File]::ReadAllText((Join-Path $Directory 'sha256.txt'))
    $completeText=$null; $pendingLength=0
    if ('complete.txt' -cin $names) { $completeText=[System.IO.File]::ReadAllText((Join-Path $Directory 'complete.txt')) }
    if ('complete.pending' -cin $names) { $pendingLength=(Get-Item -LiteralPath (Join-Path $Directory 'complete.pending')).Length }
    $record=Read-AgentDeletionRecord $installRoot ([System.IO.Path]::GetFileName($Directory)) $names $bytes $digest $completeText $pendingLength
    return [pscustomobject]@{ Plan=$record.Plan; Complete=$record.Complete; Digest=$record.Digest; Directory=$Directory }
}
function Read-PendingUninstallPlan {
    Assert-ProductRoot
    $script:activeUninstallRecovery = $null
    if ([System.IO.File]::Exists($uninstallRecoveryRoot)) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    if (-not [System.IO.Directory]::Exists($uninstallRecoveryRoot)) { return $null }
    if (@([System.IO.Directory]::EnumerateFiles($uninstallRecoveryRoot)).Count -ne 0) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    $directories = @([System.IO.Directory]::EnumerateDirectories($uninstallRecoveryRoot))
    if ($directories.Count -gt 1000) { throw 'INSTALLER_UNINSTALL_PLAN_BOUND' }
    $pending = @()
    foreach ($directory in $directories) {
        $record = Read-UninstallRecord $directory
        if (-not $record.Complete) { $pending += $record }
    }
    if ($pending.Count -gt 1) { throw 'INSTALLER_UNINSTALL_PLAN_AMBIGUOUS' }
    if ($pending.Count -eq 0) { return $null }
    $script:activeUninstallRecovery = $pending[0].Directory
    return $pending[0].Plan
}
function Save-UninstallPlan($Plan) {
    Assert-AgentDeletionPlan $installRoot $Plan
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Plan | ConvertTo-Json -Depth 12 -Compress))
    if ($bytes.Length -gt 1048576) { throw 'INSTALLER_UNINSTALL_PLAN_BOUND' }
    $directory = Join-Path $uninstallRecoveryRoot ([Guid]::NewGuid().ToString('N'))
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    Write-DurableNewFile (Join-Path $directory 'plan.json') $bytes
    Write-DurableNewFile (Join-Path $directory 'sha256.txt') ([System.Text.Encoding]::UTF8.GetBytes((Get-PlanDigest $bytes)))
    # An incomplete write remains a blocking record, never regenerated/removed.
}
function Remove-PlannedFile($Entry) {
    Assert-ProductRoot
    $path = Resolve-AgentManifestPath $installRoot $Entry.path
    if ([System.IO.Directory]::Exists($path)) { throw 'INSTALLER_UNINSTALL_REMAINING_DRIFT' }
    if (-not [System.IO.File]::Exists($path)) { return }
    if ((Get-Item -LiteralPath $path).Length -ne $Entry.bytes -or (Get-Sha256 $path) -cne $Entry.sha256) { throw 'INSTALLER_UNINSTALL_REMAINING_DRIFT' }
    [System.IO.File]::Delete($path)
}
function Remove-PlannedDirectory([string]$Relative) {
    Assert-ProductRoot
    $path = Resolve-AgentManifestPath $installRoot $Relative
    if ([System.IO.File]::Exists($path)) { throw 'INSTALLER_UNINSTALL_REMAINING_DRIFT' }
    if ([System.IO.Directory]::Exists($path)) { [System.IO.Directory]::Delete($path, $false) }
}
function Get-UninstallEffects {
    return @{ ReadPlan={ Read-PendingUninstallPlan }; CapturePlan={ New-UninstallPlan }; PersistPlan={ param($plan) Save-UninstallPlan $plan }; Observe={ Get-DeletionObservation }; InspectStructure={ Get-DeletionObservation $false }; DeleteFile={ param($entry) Remove-PlannedFile $entry }; DeleteDirectory={ param($relative) Remove-PlannedDirectory $relative } }
}
function Remove-OwnedVersions {
    Invoke-AgentPlannedDeletion $installRoot $script:uninstallPlan (Get-UninstallEffects)
}
function Complete-UninstallPlan {
    Assert-ProductRoot
    $record = Read-UninstallRecord $script:activeUninstallRecovery
    if ($record.Complete) { throw 'INSTALLER_UNINSTALL_PLAN_INVALID' }
    if (($record.Plan | ConvertTo-Json -Depth 12 -Compress) -cne ($script:uninstallPlan | ConvertTo-Json -Depth 12 -Compress)) { throw 'INSTALLER_UNINSTALL_PLAN_DRIFT' }
    # A torn final-marker write is explicitly nonterminal; after all absence
    # proofs are rechecked on an explicit retry it can be replaced, not trusted.
    $pending = Join-Path $script:activeUninstallRecovery 'complete.pending'
    $stream = [System.IO.File]::Open($pending, [System.IO.FileMode]::Create)
    try { $bytes=[System.Text.Encoding]::UTF8.GetBytes($record.Digest); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    [System.IO.File]::Move($pending, (Join-Path $script:activeUninstallRecovery 'complete.txt'))
    if (-not (Read-UninstallRecord $script:activeUninstallRecovery).Complete) { throw 'INSTALLER_UNINSTALL_FINALIZE_UNPROVEN' }
}
function Test-OwnedFilesAbsent {
    if ([System.IO.Directory]::Exists($versionsRoot) -or [System.IO.File]::Exists($versionsRoot)) { return $false }
    if ([System.IO.File]::Exists((Join-Path $installRoot 'active-version.txt'))) { return $false }
    # Retain the recovery engine even after successful uninstall, so a failed
    # registration removal and later explicit retries remain executable.
    foreach ($name in @('install-windows-agent.ps1','installer-transactions.psm1')) { if (-not [System.IO.File]::Exists((Join-Path $installRoot $name))) { return $false } }
    return $true
}

Assert-ProductRoot
[System.IO.Directory]::CreateDirectory($installRoot) | Out-Null
$installerLease = [System.IO.File]::Open((Join-Path $installRoot '.installer.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
Assert-NoPendingRecovery
$pendingUninstall = Read-PendingUninstallPlan
Assert-AgentUninstallMode $PSCmdlet.ParameterSetName $pendingUninstall

if ($PSCmdlet.ParameterSetName -eq 'Uninstall') {
    Invoke-AgentUninstallTransaction @{
        PrepareFiles = { $script:uninstallPlan = Get-AgentPreparedDeletionPlan $installRoot (Get-UninstallEffects) }
        RemoveProtocol = { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\Classes\$scheme", $false) }
        ProtocolAbsent = { -not (Get-RegistrySnapshot "Software\Classes\$scheme").Exists }
        RemoveShortcut = { if ([System.IO.File]::Exists($startMenu)) { [System.IO.File]::Delete($startMenu) } }
        ShortcutAbsent = { -not [System.IO.File]::Exists($startMenu) }
        RemoveStartup = { Remove-Startup }
        StartupAbsent = { -not (Get-StartupSnapshot).Exists }
        RemoveFiles = { Remove-OwnedVersions }
        FilesAbsent = { Test-OwnedFilesAbsent }
        RemoveRegistration = { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent', $false) }
        RegistrationAbsent = { -not (Get-RegistrySnapshot 'Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent').Exists }
        Finalize = { Complete-UninstallPlan }
    }
    Write-Output 'Agent désinstallé : activation et fichiers applicatifs vérifiés absents. Profil, journal, moteur de maintenance et récupération conservés.'
    exit 0
}

if ($PSCmdlet.ParameterSetName -eq 'Rollback') {
    if ($RollbackVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'ROLLBACK_VERSION_INVALID' }
    $target = Join-Path (Join-Path $versionsRoot $RollbackVersion) 'CrmYnov.TelephonyAgent.exe'
    Assert-VersionPath (Split-Path -Parent $target)
    Invoke-ActivationUpdate $target $RollbackVersion {} {} { $true }
    Write-Output "Version active restaurée : $RollbackVersion"
    exit 0
}

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'PACKAGE_VERSION_INVALID' }
$source = (Resolve-Path -LiteralPath $PackageDirectory).Path
Assert-NoReparseAncestors $source
Assert-NoReparseTree $source
$destination = Join-Path $versionsRoot $Version
Assert-VersionPath $destination
$manifestPath = Join-Path $source 'manifest.json'
$sourceExecutable = Join-Path $source 'CrmYnov.TelephonyAgent.exe'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) { throw 'PACKAGE_INCOMPLETE' }
if ((Get-Item -LiteralPath $manifestPath).Length -gt 1048576) { throw 'INSTALLER_MANIFEST_FILES_INVALID' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw "PACKAGE_VERSION_MISMATCH: manifest=$($manifest.version) requested=$Version" }
if ($manifest.schemaVersion -ne 1 -or $manifest.product -cne $productName) { throw 'INSTALLER_MANIFEST_FILES_INVALID' }
if ($manifest.files -isnot [array] -or $manifest.files.Count -lt 1 -or $manifest.files.Count -gt 5000) { throw 'INSTALLER_MANIFEST_FILES_INVALID' }
$packageFiles = @([System.IO.Directory]::EnumerateFiles($source, '*', [System.IO.SearchOption]::AllDirectories) | ForEach-Object { $_.Substring($source.Length + 1).Replace('\','/') })
$packageDirs = @([System.IO.Directory]::EnumerateDirectories($source, '*', [System.IO.SearchOption]::AllDirectories) | ForEach-Object { $_.Substring($source.Length + 1).Replace('\','/') })
Assert-AgentOwnedInventory $source $manifest.files $packageFiles $packageDirs
$manifestNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$validatedFiles = @(foreach ($file in $manifest.files) {
    $path = Resolve-AgentManifestPath $source $file.path
    $targetPath = Resolve-AgentManifestPath $destination $file.path
    if (-not $manifestNames.Add($file.path) -or $file.sha256 -isnot [string] -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'INSTALLER_MANIFEST_FILES_INVALID' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "PACKAGE_FILE_MISSING: $($file.path)" }
    if ((Get-Item -LiteralPath $path).Length -ne $file.bytes) { throw 'INSTALLER_MANIFEST_SIZE_MISMATCH' }
    $hash = Get-Sha256 $path
    if ($hash -ne $file.sha256) { throw "PACKAGE_HASH_MISMATCH: $($file.path)" }
    [pscustomobject]@{ Source=$path; Destination=$targetPath; Sha256=$file.sha256; Bytes=$file.bytes }
})

if (Test-Path -LiteralPath $destination) { throw "VERSION_ALREADY_INSTALLED: $Version" }
Assert-VersionPath $destination
$installedExecutable = Join-Path $destination 'CrmYnov.TelephonyAgent.exe'
Invoke-ActivationUpdate $installedExecutable $Version {
    New-Item -ItemType Directory -Path $versionsRoot -Force | Out-Null
    Assert-VersionPath $destination
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -ErrorAction Stop
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $installRoot 'install-windows-agent.ps1') -Force -ErrorAction Stop
    Copy-Item -LiteralPath $transactionModule -Destination (Join-Path $installRoot 'installer-transactions.psm1') -Force -ErrorAction Stop
    foreach ($file in $validatedFiles) {
        if ((Get-Item -LiteralPath $file.Destination).Length -ne $file.Bytes -or (Get-Sha256 $file.Destination) -cne $file.Sha256) { throw 'INSTALLER_COPY_HASH_OR_SIZE_MISMATCH' }
    }
} {
    Assert-VersionPath $destination
    if ([System.IO.Directory]::Exists($destination)) { Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction Stop }
} { -not (Test-Path -LiteralPath $destination) }

Write-Warning "Le binaire pilote n'est pas signé. Un certificat de signature est requis avant diffusion générale."
Write-Output ("Agent installé pour l'utilisateur courant : " + $installedExecutable)
Write-Output ('Protocole enregistré : ' + $scheme + '://command/{id}')
$startupEnabled = -not [string]::IsNullOrWhiteSpace((Get-StartupPreference))
Write-Output $(if ($startupEnabled) { 'Préférence de démarrage Windows conservée : activée.' } else { "Démarrage Windows désactivé jusqu’au choix explicite de l’utilisateur." })
if (-not $NoLaunch) {
    Start-Process -FilePath $installedExecutable -WorkingDirectory (Split-Path -Parent $installedExecutable)
    Write-Output "Agent lancé. Le premier démarrage ouvre l’assistant d’association et de configuration audio."
}
}
finally { $installerLease.Dispose() }
