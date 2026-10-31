[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\package-notices.psm1') -Force
$suiteRoot = Join-Path ([IO.Path]::GetTempPath()) ('crm-notice-plan-synthetic-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $suiteRoot | Out-Null
$results = @()
function Write-FixtureText([string]$Path, [string]$Text) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function New-Fixture([string]$Name) {
    $base = Join-Path $suiteRoot $Name
    $sdk = Join-Path $base 'sdk'; $repo = Join-Path $base 'repo'; $packs = Join-Path $base 'packs'
    foreach ($entry in @(
        @('share/doc/linphone-sdk/LICENSE.md', "libjpeg-turbo Licenses`nSYNTHETIC fixture only"),
        @('share/doc/linphone-sdk/README.ijg', 'SYNTHETIC IJG notice fixture'),
        @('share/doc/ortp-5.5.0/LICENSE.txt', 'SYNTHETIC oRTP notice fixture'),
        @('share/doc/ortp-5.5.0/AUTHORS.md', 'SYNTHETIC authors fixture'),
        @('share/doc/mediastreamer2-5.5.0/html/mediastreamer2_license.html', '<pre class="fragment"></pre>')
    )) { Write-FixtureText (Join-Path $sdk $entry[0]) $entry[1] }
    Write-FixtureText (Join-Path $repo 'apps/telephony-agent-windows/THIRD-PARTY-NOTICES.md') 'SYNTHETIC reservations fixture'
    foreach ($p in @('microsoft.netcore.app.runtime.win-x64/8.0.31/LICENSE.TXT','microsoft.netcore.app.runtime.win-x64/8.0.31/THIRD-PARTY-NOTICES.TXT','microsoft.windowsdesktop.app.runtime.win-x64/8.0.31/LICENSE')) { Write-FixtureText (Join-Path $packs $p) 'SYNTHETIC runtime notice fixture' }
    $runtime = @{ runtimeOptions = @{ includedFrameworks = @(@{name='Microsoft.NETCore.App';version='8.0.31'},@{name='Microsoft.WindowsDesktop.App';version='8.0.31'}) } }
    $folders = @{}; $folders[$packs] = @{}
    $assets = @{ packageFolders = $folders; project = @{ frameworks = @{ 'net8.0-windows7.0' = @{ targetAlias='net8.0-windows'; downloadDependencies=@(@{name='Microsoft.NETCore.App.Runtime.win-x64';version='[8.0.31, 8.0.31]'},@{name='Microsoft.WindowsDesktop.App.Runtime.win-x64';version='[8.0.31, 8.0.31]'}) } } } }
    $fixture = @{SdkRoot=$sdk;RepositoryRoot=$repo;RuntimeConfigPath=(Join-Path $base 'runtime.json');AssetsPath=(Join-Path $base 'assets.json')}
    Write-FixtureText $fixture.RuntimeConfigPath ($runtime | ConvertTo-Json -Depth 10)
    Write-FixtureText $fixture.AssetsPath ($assets | ConvertTo-Json -Depth 10)
    return $fixture
}
function Assert-True([bool]$Condition) { if (-not $Condition) { throw 'NOTICE_TEST_ASSERTION_FAILED' } }
function Test-Case([string]$Name, [scriptblock]$Action) {
    $fixture = New-Fixture $Name
    try { & $Action $fixture } catch { throw ('NOTICE_TEST_CASE_FAILED: ' + $Name + ': ' + $_.Exception.Message) }
    $script:results += @{name=$Name;status='PASS'}
}
function Assert-Refusal([hashtable]$Fixture, [string]$Code='') {
    $caught = $null
    try { Get-CrmPackageNoticePlan @Fixture | Out-Null } catch { $caught = $_ }
    Assert-True ($null -ne $caught)
    if ($Code) { Assert-True ($caught.Exception.Message -like ('*' + $Code + '*')) }
}
function Edit-Json([string]$Path, [scriptblock]$Edit) {
    $value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    & $Edit $value
    Write-FixtureText $Path ($value | ConvertTo-Json -Depth 15)
}
Test-Case 'complete-provenance-plan' {
    param($f)
    $before = @(Get-ChildItem (Split-Path $f.SdkRoot -Parent) -Recurse -File | ForEach-Object { $_.FullName + ':' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash })
    $p = Get-CrmPackageNoticePlan @f
    Assert-True ($p.files.Count -eq 9)
    Assert-True ((@($p.files.destination | Sort-Object -Unique)).Count -eq 9)
    Assert-True (-not $p.distributionApproved -and -not $p.completeComponentLicenseInventory -and -not $p.correspondingSourcesComplete -and -not $p.licenseChoiceApproved)
    foreach ($e in $p.files) { Assert-True ($e.sha256 -ceq (Get-FileHash $e.sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()) }
    $after = @(Get-ChildItem (Split-Path $f.SdkRoot -Parent) -Recurse -File | ForEach-Object { $_.FullName + ':' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash })
    Assert-True (($before -join '|') -ceq ($after -join '|'))
}
Test-Case 'empty-upstream-copying-not-license-proof' { param($f) $p=Get-CrmPackageNoticePlan @f; $e=@($p.files | Where-Object {$_.component -ceq 'mediastreamer2'}); Assert-True ($e.Count -eq 1 -and $e[0].role -ceq 'upstream-page-not-license-proof') }
Test-Case 'libjpeg-name-not-global-sdk-license' { param($f) $p=Get-CrmPackageNoticePlan @f; Assert-True (@($p.files | Where-Object {$_.destination -ceq 'libjpeg-turbo/LICENSE.md'}).Count -eq 1); Assert-True (@($p.files | Where-Object {$_.destination -ceq 'LICENSE.md'}).Count -eq 0) }
Test-Case 'runtime-notices-version-bound' { param($f) $p=Get-CrmPackageNoticePlan @f; $n=@($p.files | Where-Object {$_.role -ceq 'runtime-pack-notice'}); Assert-True ($n.Count -eq 3); foreach ($e in $n) { Assert-True ($e.version -ceq '8.0.31' -and $e.destination.Contains('/8.0.31/')) } }
Test-Case 'missing-included-framework' { param($f) Edit-Json $f.RuntimeConfigPath {param($x) $x.runtimeOptions.includedFrameworks=@($x.runtimeOptions.includedFrameworks[0])}; Assert-Refusal $f 'FRAMEWORK_SET_INVALID' }
Test-Case 'duplicate-included-framework' { param($f) Edit-Json $f.RuntimeConfigPath {param($x) $x.runtimeOptions.includedFrameworks=@($x.runtimeOptions.includedFrameworks[0],$x.runtimeOptions.includedFrameworks[0])}; Assert-Refusal $f 'FRAMEWORK_SET_INVALID' }
Test-Case 'additional-framework' { param($f) Edit-Json $f.RuntimeConfigPath {param($x) $x.runtimeOptions.includedFrameworks+=@{name='Other.App';version='8.0.31'}}; Assert-Refusal $f 'FRAMEWORK_SET_INVALID' }
Test-Case 'malformed-version-path' { param($f) Edit-Json $f.RuntimeConfigPath {param($x) $x.runtimeOptions.includedFrameworks[0].version='../other'}; Assert-Refusal $f 'RUNTIME_VERSION_INVALID' }
Test-Case 'runtime-assets-version-mismatch' { param($f) Edit-Json $f.AssetsPath {param($x) $x.project.frameworks.'net8.0-windows7.0'.downloadDependencies[0].version='[8.0.30, 8.0.30]'}; Assert-Refusal $f 'RUNTIME_ASSET_VERSION_MISMATCH' }
Test-Case 'duplicate-download-dependency' { param($f) Edit-Json $f.AssetsPath {param($x) $x.project.frameworks.'net8.0-windows7.0'.downloadDependencies+=$x.project.frameworks.'net8.0-windows7.0'.downloadDependencies[0]}; Assert-Refusal $f 'RUNTIME_ASSET_VERSION_MISMATCH' }
Test-Case 'wrong-asset-framework' { param($f) Edit-Json $f.AssetsPath {param($x) $x.project.frameworks.'net8.0-windows7.0'.targetAlias='other'}; Assert-Refusal $f 'ASSET_FRAMEWORK_AMBIGUOUS' }
Test-Case 'missing-runtime-pack' { param($f) $absent=Join-Path (Split-Path $f.SdkRoot -Parent) 'missing-packs'; $x=Get-Content $f.AssetsPath -Raw|ConvertFrom-Json; $folders=@{}; $folders[$absent]=@{}; $x.packageFolders=$folders; Write-FixtureText $f.AssetsPath ($x|ConvertTo-Json -Depth 15); Assert-Refusal $f 'RUNTIME_PACK_AMBIGUOUS_OR_MISSING' }
Test-Case 'missing-ijg-required' { param($f) [IO.File]::Move((Join-Path $f.SdkRoot 'share/doc/linphone-sdk/README.ijg'),(Join-Path $f.SdkRoot 'share/doc/linphone-sdk/README.ijg.absent')); Assert-Refusal $f }
Test-Case 'wrong-libjpeg-identity' { param($f) Write-FixtureText (Join-Path $f.SdkRoot 'share/doc/linphone-sdk/LICENSE.md') 'not the selected notice'; Assert-Refusal $f 'LIBJPEG_IDENTITY_INVALID' }
Test-Case 'missing-core-transitive-notices' { param($f) $a=Get-Content $f.AssetsPath -Raw|ConvertFrom-Json; $r=$a.packageFolders.PSObject.Properties.Name; $p=Join-Path $r 'microsoft.netcore.app.runtime.win-x64/8.0.31/THIRD-PARTY-NOTICES.TXT'; [IO.File]::Move($p,($p+'.absent')); Assert-Refusal $f }
Test-Case 'empty-runtime-license' { param($f) $a=Get-Content $f.AssetsPath -Raw|ConvertFrom-Json; Write-FixtureText (Join-Path $a.packageFolders.PSObject.Properties.Name 'microsoft.windowsdesktop.app.runtime.win-x64/8.0.31/LICENSE') ' '; Assert-Refusal $f 'TEXT_EMPTY' }
Test-Case 'oversized-notice' { param($f) Write-FixtureText (Join-Path $f.SdkRoot 'share/doc/ortp-5.5.0/LICENSE.txt') ('x' * 1048577); Assert-Refusal $f 'SOURCE_INVALID' }
[ordered]@{ synthetic=$true; tests=$results.Count; pass=$results.Count; failures=0; fixtures=$suiteRoot; plannerOnly=$true; productSdkInstallerNetworkNotExecuted=$true; results=$results } | ConvertTo-Json -Depth 6
