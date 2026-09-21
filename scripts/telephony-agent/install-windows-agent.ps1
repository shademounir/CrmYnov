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

function Set-Activation([string]$Executable, [string]$ActiveVersion) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "AGENT_EXECUTABLE_MISSING: $Executable" }
    New-Item -Path $protocolKey -Force | Out-Null
    Set-Item -Path $protocolKey -Value "URL:$productName"
    New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-Item -Path "$protocolKey\DefaultIcon" -Force | Out-Null
    Set-Item -Path "$protocolKey\DefaultIcon" -Value ('"{0}",0' -f $Executable)
    New-Item -Path "$protocolKey\shell\open\command" -Force | Out-Null
    Set-Item -Path "$protocolKey\shell\open\command" -Value ('"{0}" "%1"' -f $Executable)

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startMenu)
    $shortcut.TargetPath = $Executable
    $shortcut.WorkingDirectory = Split-Path -Parent $Executable
    $shortcut.IconLocation = "$Executable,0"
    $shortcut.Description = $productName
    $shortcut.Save()

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    New-Item -Path $runKey -Force | Out-Null
    New-ItemProperty -Path $runKey -Name $productName -Value ('"{0}"' -f $Executable) -PropertyType String -Force | Out-Null

    $installedScript = Join-Path $installRoot 'install-windows-agent.ps1'
    New-Item -Path $uninstallKey -Force | Out-Null
    Set-ItemProperty -Path $uninstallKey -Name DisplayName -Value $productName
    Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value $ActiveVersion
    Set-ItemProperty -Path $uninstallKey -Name Publisher -Value 'CRM Ynov'
    Set-ItemProperty -Path $uninstallKey -Name DisplayIcon -Value $Executable
    Set-ItemProperty -Path $uninstallKey -Name InstallLocation -Value (Split-Path -Parent $Executable)
    Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -Type DWord
    Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -Uninstall' -f $installedScript)
    Set-Content -LiteralPath (Join-Path $installRoot 'active-version.txt') -Value $ActiveVersion -Encoding ascii
}

Assert-ManagedPath $installRoot

if ($PSCmdlet.ParameterSetName -eq 'Uninstall') {
    Remove-Item -LiteralPath $protocolKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
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
Set-Activation $installedExecutable $Version

Write-Warning "Le binaire pilote n'est pas signé. Un certificat de signature est requis avant diffusion générale."
Write-Output ("Agent installé pour l'utilisateur courant : " + $installedExecutable)
Write-Output ('Protocole enregistré : ' + $scheme + '://command/{id}')
Write-Output 'Démarrage automatique enregistré pour la session Windows courante.'
if (-not $NoLaunch) {
    Start-Process -FilePath $installedExecutable -WorkingDirectory (Split-Path -Parent $installedExecutable)
    Write-Output 'Agent lancé. Le premier démarrage ouvre l’assistant d’association et de configuration audio.'
}
