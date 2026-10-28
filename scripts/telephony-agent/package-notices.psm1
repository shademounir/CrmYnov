Set-StrictMode -Version Latest

function Get-CrmPackageNoticePlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SdkRoot,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RuntimeConfigPath,
        [Parameter(Mandatory = $true)][string]$AssetsPath
    )
    $ErrorActionPreference = 'Stop'
    $runtime = Get-Content -LiteralPath $RuntimeConfigPath -Raw | ConvertFrom-Json
    $assets = Get-Content -LiteralPath $AssetsPath -Raw | ConvertFrom-Json
    $frameworks = @($runtime.runtimeOptions.includedFrameworks)
    $expected = @('Microsoft.NETCore.App', 'Microsoft.WindowsDesktop.App')
    if ($frameworks.Count -ne 2 -or (@($frameworks.name | Sort-Object) -join '|') -cne ($expected -join '|')) {
        throw 'PACKAGE_NOTICE_FRAMEWORK_SET_INVALID'
    }
    $assetFrameworks = @($assets.project.frameworks.PSObject.Properties | Where-Object { $_.Value.targetAlias -ceq 'net8.0-windows' })
    if ($assetFrameworks.Count -ne 1) { throw 'PACKAGE_NOTICE_ASSET_FRAMEWORK_AMBIGUOUS' }
    $packageFolders = @($assets.packageFolders.PSObject.Properties.Name)
    if ($packageFolders.Count -lt 1 -or $packageFolders.Count -gt 4) { throw 'PACKAGE_NOTICE_PACKAGE_FOLDERS_INVALID' }
    $specifications = @(
        @{ component = 'CRM Ynov'; version = 'source'; root = $RepositoryRoot; source = 'apps/telephony-agent-windows/THIRD-PARTY-NOTICES.md'; destination = 'THIRD-PARTY-NOTICES.md'; role = 'pilot-reservations' },
        @{ component = 'libjpeg-turbo'; version = 'sdk-5.5.21'; root = $SdkRoot; source = 'share/doc/linphone-sdk/LICENSE.md'; destination = 'libjpeg-turbo/LICENSE.md'; role = 'license-text' },
        @{ component = 'libjpeg-turbo'; version = 'sdk-5.5.21'; root = $SdkRoot; source = 'share/doc/linphone-sdk/README.ijg'; destination = 'libjpeg-turbo/README.ijg'; role = 'license-text' },
        @{ component = 'oRTP'; version = 'sdk-5.5.21'; root = $SdkRoot; source = 'share/doc/ortp-5.5.0/LICENSE.txt'; destination = 'ortp/LICENSE.txt'; role = 'license-text' },
        @{ component = 'oRTP'; version = 'sdk-5.5.21'; root = $SdkRoot; source = 'share/doc/ortp-5.5.0/AUTHORS.md'; destination = 'ortp/AUTHORS.md'; role = 'attribution' },
        # This upstream HTML page has an empty COPYING fragment. Preserve it as
        # supporting documentation, never as evidence of a mediastreamer license.
        @{ component = 'mediastreamer2'; version = 'sdk-5.5.21'; root = $SdkRoot; source = 'share/doc/mediastreamer2-5.5.0/html/mediastreamer2_license.html'; destination = 'mediastreamer2/COPYING-page.html'; role = 'upstream-page-not-license-proof' }
    )
    foreach ($framework in $frameworks) {
        if ($framework.version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'PACKAGE_NOTICE_RUNTIME_VERSION_INVALID' }
        $packageId = $framework.name + '.Runtime.win-x64'
        $downloads = @($assetFrameworks[0].Value.downloadDependencies | Where-Object { $_.name -ceq $packageId })
        $range = "[$($framework.version), $($framework.version)]"
        if ($downloads.Count -ne 1 -or $downloads[0].version -cne $range) { throw 'PACKAGE_NOTICE_RUNTIME_ASSET_VERSION_MISMATCH' }
        $relativeRoot = $packageId.ToLowerInvariant() + '/' + $framework.version
        $roots = @($packageFolders | ForEach-Object { Join-Path $_ $relativeRoot } | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
        if ($roots.Count -ne 1) { throw 'PACKAGE_NOTICE_RUNTIME_PACK_AMBIGUOUS_OR_MISSING' }
        $names = if ($framework.name -ceq 'Microsoft.NETCore.App') { @('LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT') } else { @('LICENSE') }
        foreach ($name in $names) {
            $specifications += @{ component = $packageId; version = $framework.version; root = $roots[0]; source = $name; destination = ($packageId + '/' + $framework.version + '/' + $name); role = 'runtime-pack-notice' }
        }
    }
    $entries = @()
    foreach ($spec in $specifications) {
        $source = Join-Path $spec.root $spec.source
        $item = Get-Item -LiteralPath $source -ErrorAction Stop
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -lt 1 -or $item.Length -gt 1048576) {
            throw 'PACKAGE_NOTICE_SOURCE_INVALID'
        }
        $content = Get-Content -LiteralPath $source -Raw
        if ([String]::IsNullOrWhiteSpace($content)) { throw 'PACKAGE_NOTICE_TEXT_EMPTY' }
        if ($spec.destination -ceq 'libjpeg-turbo/LICENSE.md' -and -not $content.StartsWith('libjpeg-turbo Licenses', [StringComparison]::Ordinal)) {
            throw 'PACKAGE_NOTICE_LIBJPEG_IDENTITY_INVALID'
        }
        $entries += [pscustomobject]@{
            sourcePath = $item.FullName
            sourceRelativePath = $spec.source
            destination = $spec.destination
            component = $spec.component
            version = $spec.version
            role = $spec.role
            bytes = $item.Length
            sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [pscustomobject]@{
        schemaVersion = 1
        files = $entries
        distributionApproved = $false
        completeComponentLicenseInventory = $false
        correspondingSourcesComplete = $false
        licenseChoiceApproved = $false
    }
}

Export-ModuleMember -Function Get-CrmPackageNoticePlan
