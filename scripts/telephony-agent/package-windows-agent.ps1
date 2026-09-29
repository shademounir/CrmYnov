[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DotnetPath,
    [Parameter(Mandatory = $true)][string]$SdkRoot,
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repositoryRoot 'apps\telephony-agent-windows\CrmYnov.TelephonyAgent.csproj'
$installerScript = Join-Path $repositoryRoot 'scripts\telephony-agent\install-windows-agent.ps1'
$sdkRootResolved = (Resolve-Path -LiteralPath $SdkRoot).Path
$dotnetResolved = (Resolve-Path -LiteralPath $DotnetPath).Path
$packageName = "crm-ynov-telephony-agent-$Version-win-x64"
$packageDirectory = Join-Path $OutputRoot $packageName
$zipPath = Join-Path $OutputRoot "$packageName.zip"
$sourceZipPath = Join-Path $OutputRoot "$packageName-source.zip"

$syntaxTokens = $null
$syntaxErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($installerScript, [ref]$syntaxTokens, [ref]$syntaxErrors) | Out-Null
if ($syntaxErrors.Count -gt 0) {
    $first = $syntaxErrors[0]
    throw "INSTALLER_SCRIPT_SYNTAX_INVALID: line=$($first.Extent.StartLineNumber) message=$($first.Message)"
}

if (Test-Path -LiteralPath $packageDirectory) { throw "PACKAGE_DIRECTORY_ALREADY_EXISTS: $packageDirectory" }
if (Test-Path -LiteralPath $zipPath) { throw "PACKAGE_ARCHIVE_ALREADY_EXISTS: $zipPath" }
if (Test-Path -LiteralPath $sourceZipPath) { throw "SOURCE_ARCHIVE_ALREADY_EXISTS: $sourceZipPath" }

$requiredHashes = @{
    'bin\liblinphone.dll' = '762ACD8FEF393B603BA93C932C631F8DBAAC39F0BAB318606F0751183899FBA7'
    'bin\belle-sip.dll' = '71FFAD72BEFC44F99B7CFE1E82B832ED0524F447E29CCD3C689F42F21C95744B'
    'share\linphonecs\LinphoneWrapper.cs' = '6E5CA4F6E7BF17FC12D4BFF68E534BDDF6154E5D96E07A93BF85CA6711B6416A'
}
foreach ($entry in $requiredHashes.GetEnumerator()) {
    $path = Join-Path $sdkRootResolved $entry.Key
    if (-not (Test-Path -LiteralPath $path)) { throw "SDK_FILE_MISSING: $($entry.Key)" }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ne $entry.Value) { throw "SDK_HASH_MISMATCH: $($entry.Key)" }
}

New-Item -ItemType Directory -Path $packageDirectory | Out-Null
$env:LIBLINPHONE_SDK_ROOT = $sdkRootResolved
& $dotnetResolved restore $project -r win-x64
if ($LASTEXITCODE -ne 0) { throw "DOTNET_RESTORE_FAILED: $LASTEXITCODE" }
& $dotnetResolved publish $project -c Release -r win-x64 --self-contained true --no-restore -o $packageDirectory
if ($LASTEXITCODE -ne 0) { throw "DOTNET_PUBLISH_FAILED: $LASTEXITCODE" }
$publishedExecutable = Join-Path $packageDirectory 'CrmYnov.TelephonyAgent.exe'
$publishedVersion = (Get-Item -LiteralPath $publishedExecutable).VersionInfo.ProductVersion
if (-not $publishedVersion.StartsWith("$Version+", [System.StringComparison]::OrdinalIgnoreCase) -and $publishedVersion -ne $Version) {
    throw "PACKAGE_VERSION_MISMATCH: requested=$Version executable=$publishedVersion"
}

$documentation = Join-Path $packageDirectory 'documentation'
$notices = Join-Path $packageDirectory 'notices'
New-Item -ItemType Directory -Path $documentation,$notices | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'apps\telephony-agent-windows\README.md') -Destination $documentation
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'apps\telephony-agent-windows\THIRD-PARTY-NOTICES.md') -Destination $notices
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'docs\runbooks\linphone-windows-bridge.md') -Destination $documentation
Copy-Item -LiteralPath $installerScript -Destination $packageDirectory
$noticeSources = @(
    'share\doc\linphone-sdk\LICENSE.md',
    'share\doc\mediastreamer2-5.5.0\html\mediastreamer2_license.html',
    'share\doc\ortp-5.5.0\LICENSE.txt',
    'share\doc\ortp-5.5.0\AUTHORS.md'
)
foreach ($relative in $noticeSources) {
    $source = Join-Path $sdkRootResolved $relative
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $notices }
}

$manifest = Get-ChildItem -LiteralPath $packageDirectory -Recurse -File | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{
        path = $_.FullName.Substring($packageDirectory.Length + 1).Replace('\','/')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifestDocument = [ordered]@{
    schemaVersion = 1
    product = 'CRM Ynov Telephony Agent'
    version = $Version
    runtime = 'win-x64-self-contained'
    liblinphoneSdk = '5.5.21'
    executableProductVersion = $publishedVersion
    signed = $false
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    files = $manifest
}
$manifestDocument | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $packageDirectory 'manifest.json') -Encoding utf8

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixedTimestamp = [DateTimeOffset]::Parse('2026-09-18T00:00:00Z')
function New-DeterministicZip([string]$Root, [string]$Destination, [System.IO.FileInfo[]]$Files) {
    $stream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::CreateNew)
    try {
        $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($file in ($Files | Sort-Object FullName)) {
                $relative = $file.FullName.Substring($Root.Length + 1).Replace('\','/')
                $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $fixedTimestamp
                $input = $file.OpenRead(); $output = $entry.Open()
                try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
}

New-DeterministicZip $packageDirectory $zipPath @(Get-ChildItem -LiteralPath $packageDirectory -Recurse -File)
$sourceFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'apps\telephony-agent-windows') -Recurse -File |
        Where-Object { $_.FullName -notmatch '[\\/](bin|obj)[\\/]' }
    Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'apps\telephony-agent-installer-windows') -Recurse -File |
        Where-Object { $_.FullName -notmatch '[\\/](bin|obj)[\\/]' }
    Get-Item -LiteralPath (Join-Path $repositoryRoot 'docs\runbooks\linphone-windows-bridge.md')
    Get-Item -LiteralPath $PSCommandPath
    Get-Item -LiteralPath (Join-Path $repositoryRoot 'scripts\telephony-agent\install-windows-agent.ps1')
    Get-Item -LiteralPath (Join-Path $repositoryRoot 'scripts\telephony-agent\build-windows-installer.ps1')
)
New-DeterministicZip $repositoryRoot $sourceZipPath $sourceFiles

[pscustomobject]@{
    packageDirectory = $packageDirectory
    packageArchive = $zipPath
    packageSha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceArchive = $sourceZipPath
    sourceSha256 = (Get-FileHash -LiteralPath $sourceZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    signature = 'ABSENTE — certificat de signature requis avant production'
} | ConvertTo-Json -Depth 3
