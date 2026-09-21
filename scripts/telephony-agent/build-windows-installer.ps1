[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DotnetPath,
    [Parameter(Mandatory = $true)][string]$PackageArchive,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'INSTALLER_VERSION_INVALID' }
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repositoryRoot 'apps\telephony-agent-installer-windows\CrmYnov.TelephonyAgent.Installer.csproj'
$dotnet = (Resolve-Path -LiteralPath $DotnetPath).Path
$archive = (Resolve-Path -LiteralPath $PackageArchive).Path
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $output -PathType Container)) { New-Item -ItemType Directory -Path $output | Out-Null }
$expectedName = "CRM-Ynov-Telephony-Agent-Setup-$Version.exe"
$target = Join-Path $output $expectedName
if (Test-Path -LiteralPath $target) { throw "INSTALLER_OUTPUT_ALREADY_EXISTS: $target" }

$metadata = Join-Path $output 'installer-metadata.json'
$packageFolder = [System.IO.Path]::GetFileNameWithoutExtension($archive)
[ordered]@{
    version = $Version
    packageFolder = $packageFolder
    packageSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath $metadata -Encoding utf8

$publish = Join-Path $output 'installer-publish'
try {
    & $dotnet publish $project -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false `
        -p:AgentPackageArchive="$archive" -p:InstallerMetadataPath="$metadata" -o $publish
    if ($LASTEXITCODE -ne 0) { throw "INSTALLER_PUBLISH_FAILED: $LASTEXITCODE" }
    $built = Join-Path $publish 'CrmYnov.TelephonyAgent.Installer.exe'
    if (-not (Test-Path -LiteralPath $built -PathType Leaf)) { throw 'INSTALLER_EXECUTABLE_MISSING' }
    Move-Item -LiteralPath $built -Destination $target
    [pscustomobject]@{
        installer = $target
        bytes = (Get-Item -LiteralPath $target).Length
        sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        packageSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        signed = $false
    } | ConvertTo-Json
}
finally {
    if (Test-Path -LiteralPath $publish) { Remove-Item -LiteralPath $publish -Recurse -Force }
}
