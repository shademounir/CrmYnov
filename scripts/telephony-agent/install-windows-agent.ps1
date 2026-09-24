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

function Assert-ManagedPath([string]$Path) {
    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Path))
    $expectedParent = [System.IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'))
    if (-not $resolvedParent.StartsWith($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) { throw "INSTALL_PATH_OUTSIDE_MANAGED_ROOT: $Path" }
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

function Remove-RegistryActivation {
    try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\Classes\$scheme", $false) } catch { }
    try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent', $false) } catch { }
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
    $startupValue = Get-ItemPropertyValue -LiteralPath $runKey -Name $productName -ErrorAction SilentlyContinue
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

Assert-ManagedPath $installRoot

if ($PSCmdlet.ParameterSetName -eq 'Uninstall') {
    Remove-RegistryActivation
    Remove-Item -LiteralPath $startMenu -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CRM Ynov Telephony Agent' -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $installRoot) { Remove-Item -LiteralPath $installRoot -Recurse -Force }
    Write-Output 'Agent désinstallé. Le profil DPAPI et le journal local sont conservés dans LocalAppData\CRM Ynov\Telephony Agent.'
    exit 0
}

if ($PSCmdlet.ParameterSetName -eq 'Rollback') {
    if ($RollbackVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'ROLLBACK_VERSION_INVALID' }
    $target = Join-Path (Join-Path $versionsRoot $RollbackVersion) 'CrmYnov.TelephonyAgent.exe'
    Set-Activation $target $RollbackVersion
    Write-Output "Version active restaurée : $RollbackVersion"
    exit 0
}

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'PACKAGE_VERSION_INVALID' }
$source = (Resolve-Path -LiteralPath $PackageDirectory).Path
$manifestPath = Join-Path $source 'manifest.json'
$sourceExecutable = Join-Path $source 'CrmYnov.TelephonyAgent.exe'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) { throw 'PACKAGE_INCOMPLETE' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw "PACKAGE_VERSION_MISMATCH: manifest=$($manifest.version) requested=$Version" }
foreach ($file in $manifest.files) {
    $path = Join-Path $source ($file.path -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "PACKAGE_FILE_MISSING: $($file.path)" }
    $hash = Get-Sha256 $path
    if ($hash -ne $file.sha256) { throw "PACKAGE_HASH_MISMATCH: $($file.path)" }
}

New-Item -ItemType Directory -Path $versionsRoot -Force | Out-Null
$destination = Join-Path $versionsRoot $Version
if (Test-Path -LiteralPath $destination) { throw "VERSION_ALREADY_INSTALLED: $Version" }
Copy-Item -LiteralPath $source -Destination $destination -Recurse
Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $installRoot 'install-windows-agent.ps1') -Force
$installedExecutable = Join-Path $destination 'CrmYnov.TelephonyAgent.exe'
try { Set-Activation $installedExecutable $Version }
catch {
    Remove-RegistryActivation
    Remove-Item -LiteralPath $startMenu -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CRM Ynov Telephony Agent' -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    throw
}

Write-Warning "Le binaire pilote n'est pas signé. Un certificat de signature est requis avant diffusion générale."
Write-Output ("Agent installé pour l'utilisateur courant : " + $installedExecutable)
Write-Output ('Protocole enregistré : ' + $scheme + '://command/{id}')
$startupEnabled = -not [string]::IsNullOrWhiteSpace((Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $productName -ErrorAction SilentlyContinue))
Write-Output $(if ($startupEnabled) { 'Préférence de démarrage Windows conservée : activée.' } else { "Démarrage Windows désactivé jusqu’au choix explicite de l’utilisateur." })
if (-not $NoLaunch) {
    Start-Process -FilePath $installedExecutable -WorkingDirectory (Split-Path -Parent $installedExecutable)
    Write-Output "Agent lancé. Le premier démarrage ouvre l’assistant d’association et de configuration audio."
}
