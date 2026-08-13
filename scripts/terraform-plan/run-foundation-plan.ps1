[CmdletBinding(DefaultParameterSetName = "Synthetic")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Synthetic")]
  [switch] $SyntheticFixture,

  [Parameter(Mandatory = $true, ParameterSetName = "Synthetic")]
  [string] $FixturePath,

  [Parameter(ParameterSetName = "Synthetic")]
  [ValidateSet("None", "Command", "PlanAbsent", "PlanEmpty", "JsonAbsent", "JsonEmpty", "Analyzer")]
  [string] $SyntheticFailure = "None",

  [Parameter(Mandatory = $true, ParameterSetName = "Contract")]
  [switch] $ContractSimulation,

  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [switch] $RealExecution,

  [Parameter(Mandatory = $true, ParameterSetName = "Contract")]
  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [string] $RepositoryRoot,

  [Parameter(Mandatory = $true, ParameterSetName = "Contract")]
  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [string] $TerraformRoot,

  [Parameter(Mandatory = $true, ParameterSetName = "Contract")]
  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [string] $TfVarsPath,

  [Parameter(Mandatory = $true, ParameterSetName = "Contract")]
  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [ValidatePattern("^[a-f0-9]{40}$")]
  [string] $ExpectedMainSha,

  [Parameter(Mandatory = $true, ParameterSetName = "Contract")]
  [Parameter(ParameterSetName = "Real")]
  [string] $TerraformExecutable = "terraform",

  [Parameter(ParameterSetName = "Contract")]
  [Parameter(ParameterSetName = "Real")]
  [string] $TemporaryParent
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptRoot = $PSScriptRoot
$analyzer = Join-Path $scriptRoot "analyze-foundation-plan.mjs"
$temporaryRoot = $null
$executionId = $null
$repo = $null
$root = $null
$tfDataDirTouched = $false
$previousTfDataDirExisted = Test-Path Env:TF_DATA_DIR
$previousTfDataDir = if ($previousTfDataDirExisted) { $env:TF_DATA_DIR } else { $null }
$tfDataDirRestored = $false
$cleanupAttempted = $false
$cleanupSucceeded = $true
$artifactsRemaining = 0
$failureCode = "wrapper_fail_closed"
$failureStage = "preflight"
$failureExitCode = $null
$finalSummary = $null
$exitCodes = [ordered]@{}
$sensitiveValues = [System.Collections.Generic.List[string]]::new()

function Get-CanonicalPath([string] $Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathWithin([string] $Candidate, [string] $Parent) {
  $candidatePath = Get-CanonicalPath $Candidate
  $parentPath = Get-CanonicalPath $Parent
  return $candidatePath.Equals($parentPath, [System.StringComparison]::OrdinalIgnoreCase) -or
    $candidatePath.StartsWith($parentPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Set-StableFailure([string] $Code, [string] $Stage, [Nullable[int]] $ExitCode = $null) {
  $script:failureCode = $Code
  $script:failureStage = $Stage
  $script:failureExitCode = $ExitCode
  throw [System.InvalidOperationException]::new($Code)
}

function Protect-SensitiveText([AllowNull()][string] $Text) {
  if ($null -eq $Text) { return "" }
  $safe = $Text
  foreach ($value in $script:sensitiveValues) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $safe = $safe.Replace($value, "[REDACTED]")
    }
  }
  $safe = $safe -replace '(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*', '[REDACTED_AUTHORIZATION]'
  $safe = $safe -replace '(?i)(authorization|api[_-]?token|password|private[_-]?key)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
  $safe = $safe -replace '\b[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}\b', '[REDACTED_BILLING_ACCOUNT]'
  $safe = $safe -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[REDACTED_EMAIL]'
  foreach ($path in @($script:temporaryRoot, $script:repo, $script:root, [Environment]::GetFolderPath("UserProfile"))) {
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      $safe = $safe.Replace($path, "[REDACTED_PATH]")
    }
  }
  return $safe
}

function Assert-SafeTemporaryParent([string] $Candidate, [string] $Repository) {
  $path = Get-CanonicalPath $Candidate
  $volumeRoot = [System.IO.Path]::GetPathRoot($path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $profile = Get-CanonicalPath ([Environment]::GetFolderPath("UserProfile"))
  if ($path.Equals($volumeRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $path.Equals($profile, [System.StringComparison]::OrdinalIgnoreCase) -or
      (Test-PathWithin $path $Repository)) {
    Set-StableFailure "unsafe_temp_path" "preflight"
  }
}

function New-SafeTemporaryRoot([string] $Parent, [string] $Repository) {
  $base = if ([string]::IsNullOrWhiteSpace($Parent)) { [System.IO.Path]::GetTempPath() } else { $Parent }
  Assert-SafeTemporaryParent $base $Repository
  $base = Get-CanonicalPath $base
  if (-not (Test-Path -LiteralPath $base -PathType Container)) {
    [System.IO.Directory]::CreateDirectory($base) | Out-Null
  }
  $script:executionId = [System.Guid]::NewGuid().ToString("N")
  $candidate = Join-Path $base ("crmynov-evidence-" + $script:executionId)
  if ((Test-PathWithin $candidate $Repository) -or -not (Test-PathWithin $candidate $base)) {
    Set-StableFailure "unsafe_temp_path" "preflight"
  }
  [System.IO.Directory]::CreateDirectory($candidate) | Out-Null
  return Get-CanonicalPath $candidate
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)] [string] $Executable,
    [Parameter(Mandatory = $true)] [string[]] $Arguments,
    [Parameter(Mandatory = $true)] [string] $Stage,
    [Parameter(Mandatory = $true)] [string] $FailureCode
  )
  $stdoutPath = Join-Path $script:temporaryRoot ($Stage + ".stdout")
  $stderrPath = Join-Path $script:temporaryRoot ($Stage + ".stderr")
  try {
    $stdout = @(& $Executable @Arguments 2> $stderrPath)
    $nativeExitCode = $LASTEXITCODE
  }
  catch {
    $nativeExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { -1 }
    [System.IO.File]::WriteAllText($stderrPath, "native_invocation_failed", [System.Text.UTF8Encoding]::new($false))
    $stdout = @()
  }
  [System.IO.File]::WriteAllLines($stdoutPath, [string[]]$stdout, [System.Text.UTF8Encoding]::new($false))
  $script:exitCodes[$Stage] = [int]$nativeExitCode
  $null = Protect-SensitiveText ([System.IO.File]::ReadAllText($stdoutPath))
  $null = Protect-SensitiveText ([System.IO.File]::ReadAllText($stderrPath))
  if ($nativeExitCode -ne 0) {
    Set-StableFailure $FailureCode $Stage ([int]$nativeExitCode)
  }
  return [pscustomobject]@{ stdoutPath = $stdoutPath; stderrPath = $stderrPath; exitCode = [int]$nativeExitCode }
}

function Get-EvidenceHash([string] $Path, [string] $Stage) {
  try {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  catch {
    Set-StableFailure "evidence_hash_failed" $Stage
  }
}

function Get-ProviderVersion([string] $TerraformDirectory) {
  $lockPath = Join-Path $TerraformDirectory ".terraform.lock.hcl"
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return $null }
  $lockText = [System.IO.File]::ReadAllText($lockPath)
  $match = [regex]::Match($lockText, 'provider\s+"registry\.terraform\.io/hashicorp/google"\s*\{[\s\S]*?version\s*=\s*"([^"]+)"')
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

function Get-NotExecutedExitCodes([string] $Reason) {
  $result = [ordered]@{}
  foreach ($stage in @("terraformVersion", "fmt", "init", "validate", "plan", "show")) {
    $result[$stage] = [ordered]@{ executed = $false; reason = $Reason }
  }
  return $result
}

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Set-StableFailure "analyzer_failed" "analyzer" }

  if ($SyntheticFixture) {
    $fixturesRoot = Get-CanonicalPath (Join-Path $scriptRoot "fixtures")
    $sourcePath = Get-CanonicalPath $FixturePath
    if (-not (Test-PathWithin $sourcePath $fixturesRoot)) { Set-StableFailure "unsafe_temp_path" "synthetic" }
    if (-not $sourcePath.EndsWith(".synthetic.json", [System.StringComparison]::OrdinalIgnoreCase)) { Set-StableFailure "terraform_json_missing" "synthetic" }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { Set-StableFailure "terraform_json_missing" "synthetic" }
    $repoForSafety = Get-CanonicalPath (Join-Path $scriptRoot "..\..")
    $temporaryRoot = New-SafeTemporaryRoot ([System.IO.Path]::GetTempPath()) $repoForSafety
    $jsonPath = Join-Path $temporaryRoot "foundation.json"

    if ($SyntheticFailure -eq "Command") { Set-StableFailure "terraform_version_failed" "synthetic" 1 }
    if ($SyntheticFailure -eq "PlanAbsent") { Set-StableFailure "terraform_plan_missing" "synthetic" }
    if ($SyntheticFailure -eq "PlanEmpty") { Set-StableFailure "terraform_plan_empty" "synthetic" }
    if ($SyntheticFailure -eq "JsonAbsent") { Set-StableFailure "terraform_json_missing" "synthetic" }
    [System.IO.File]::Copy($sourcePath, $jsonPath, $false)
    if ($SyntheticFailure -eq "JsonEmpty") { [System.IO.File]::WriteAllBytes($jsonPath, [byte[]]@()) }
    if ($SyntheticFailure -eq "Analyzer") { [System.IO.File]::WriteAllText($jsonPath, "{invalid", [System.Text.UTF8Encoding]::new($false)) }

    $fixtureHash = Get-EvidenceHash $jsonPath "evidence"
    $analysisResult = Invoke-NativeChecked "node" @($analyzer, $jsonPath) "analyzer" "analyzer_failed"
    try { $analysis = [System.IO.File]::ReadAllText($analysisResult.stdoutPath) | ConvertFrom-Json }
    catch { Set-StableFailure "analyzer_failed" "analyzer" 0 }
    if (-not $analysis.valid) { Set-StableFailure "analyzer_failed" "analyzer" 0 }

    $syntheticExitCodes = Get-NotExecutedExitCodes "synthetic_fixture"
    $syntheticExitCodes["analyzer"] = 0
    $finalSummary = [ordered]@{
      schemaVersion = 2
      valid = $true
      mode = "synthetic_fixture"
      gitSha = $null
      utcTimestamp = [DateTime]::UtcNow.ToString("o")
      terraformVersion = $analysis.terraformVersion
      providerVersion = $null
      plan = [ordered]@{ status = "synthetic_not_produced"; sha256 = $null; sizeBytes = $null }
      json = [ordered]@{ status = "synthetic_fixture"; sha256 = $fixtureHash; sizeBytes = (Get-Item -LiteralPath $jsonPath).Length }
      exitCodes = $syntheticExitCodes
      actions = $analysis.actions
      resourceTypes = $analysis.resourceTypes
      budgets = $analysis.budgets
      sensitiveDataDetected = [bool]$analysis.sensitiveDataDetected
    }
  }
  else {
    $repo = Get-CanonicalPath $RepositoryRoot
    $root = Get-CanonicalPath $TerraformRoot
    $tfvarsSource = Get-CanonicalPath $TfVarsPath
    if (-not (Test-Path -LiteralPath $repo -PathType Container)) { Set-StableFailure "git_sha_mismatch" "gitSha" }
    if (-not (Test-Path -LiteralPath $root -PathType Container) -or -not (Test-PathWithin $root $repo)) { Set-StableFailure "unsafe_temp_path" "preflight" }
    if (-not (Test-Path -LiteralPath $tfvarsSource -PathType Leaf) -or (Get-Item -LiteralPath $tfvarsSource).Length -eq 0) { Set-StableFailure "tfvars_invalid" "preflight" }
    if (Test-PathWithin $tfvarsSource $repo) { Set-StableFailure "unsafe_temp_path" "preflight" }
    if (-not (Get-Command $TerraformExecutable -ErrorAction SilentlyContinue)) { Set-StableFailure "terraform_version_failed" "terraformVersion" }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Set-StableFailure "git_sha_mismatch" "gitSha" }

    $temporaryRoot = New-SafeTemporaryRoot $TemporaryParent $repo
    $tfDataDirectory = Join-Path $temporaryRoot "tfdata"
    [System.IO.Directory]::CreateDirectory($tfDataDirectory) | Out-Null
    $env:TF_DATA_DIR = $tfDataDirectory
    $tfDataDirTouched = $true
    $tfvars = Join-Path $temporaryRoot "foundation.auto.tfvars"
    [System.IO.File]::Copy($tfvarsSource, $tfvars, $false)
    $tfvarsText = [System.IO.File]::ReadAllText($tfvars)
    foreach ($match in [regex]::Matches($tfvarsText, '(?m)^\s*[^#\r\n=]+\s*=\s*"?([^"\r\n]+)"?\s*$')) {
      $sensitiveValues.Add($match.Groups[1].Value.Trim())
    }

    $gitResult = Invoke-NativeChecked "git" @("-C", $repo, "rev-parse", "HEAD") "gitSha" "git_sha_mismatch"
    $actualSha = [System.IO.File]::ReadAllText($gitResult.stdoutPath).Trim()
    if ($actualSha -ne $ExpectedMainSha) { Set-StableFailure "git_sha_mismatch" "gitSha" 0 }

    $versionResult = Invoke-NativeChecked $TerraformExecutable @("-chdir=$root", "version") "terraformVersion" "terraform_version_failed"
    $versionText = [System.IO.File]::ReadAllText($versionResult.stdoutPath)
    $versionMatch = [regex]::Match($versionText, 'Terraform\s+v?([^\s]+)')
    $terraformVersion = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { $null }
    Invoke-NativeChecked $TerraformExecutable @("-chdir=$root", "fmt", "-check", "-diff") "fmt" "terraform_fmt_failed" | Out-Null
    Invoke-NativeChecked $TerraformExecutable @("-chdir=$root", "init", "-backend=false", "-input=false", "-lockfile=readonly") "init" "terraform_init_failed" | Out-Null
    Invoke-NativeChecked $TerraformExecutable @("-chdir=$root", "validate", "-no-color") "validate" "terraform_validate_failed" | Out-Null

    $planPath = Join-Path $temporaryRoot "foundation.tfplan"
    Invoke-NativeChecked $TerraformExecutable @("-chdir=$root", "plan", "-input=false", "-no-color", "-out=$planPath", "-var-file=$tfvars") "plan" "terraform_plan_failed" | Out-Null
    if (-not (Test-Path -LiteralPath $planPath -PathType Leaf)) { Set-StableFailure "terraform_plan_missing" "plan" 0 }
    if ((Get-Item -LiteralPath $planPath).Length -eq 0) { Set-StableFailure "terraform_plan_empty" "plan" 0 }
    $planHash = Get-EvidenceHash $planPath "plan"
    $planSize = (Get-Item -LiteralPath $planPath).Length

    $showResult = Invoke-NativeChecked $TerraformExecutable @("-chdir=$root", "show", "-json", $planPath) "show" "terraform_show_failed"
    $jsonPath = Join-Path $temporaryRoot "foundation.json"
    [System.IO.File]::Copy($showResult.stdoutPath, $jsonPath, $false)
    if (-not (Test-Path -LiteralPath $jsonPath -PathType Leaf)) { Set-StableFailure "terraform_json_missing" "show" 0 }
    if ((Get-Item -LiteralPath $jsonPath).Length -eq 0) { Set-StableFailure "terraform_json_empty" "show" 0 }
    $jsonHash = Get-EvidenceHash $jsonPath "show"
    $jsonSize = (Get-Item -LiteralPath $jsonPath).Length

    $analysisResult = Invoke-NativeChecked "node" @($analyzer, $jsonPath) "analyzer" "analyzer_failed"
    try { $analysis = [System.IO.File]::ReadAllText($analysisResult.stdoutPath) | ConvertFrom-Json }
    catch { Set-StableFailure "analyzer_failed" "analyzer" 0 }
    if (-not $analysis.valid -or $analysis.planSha256 -ne $jsonHash) { Set-StableFailure "analyzer_failed" "analyzer" 0 }

    $finalSummary = [ordered]@{
      schemaVersion = 2
      valid = $true
      mode = if ($ContractSimulation) { "contract_simulation" } else { "real" }
      gitSha = $actualSha
      utcTimestamp = [DateTime]::UtcNow.ToString("o")
      terraformVersion = $terraformVersion
      providerVersion = Get-ProviderVersion $root
      plan = [ordered]@{ status = "produced"; sha256 = $planHash; sizeBytes = $planSize }
      json = [ordered]@{ status = "produced"; sha256 = $jsonHash; sizeBytes = $jsonSize }
      evidenceChain = ("git:" + $actualSha + " -> plan:" + $planHash + " -> json:" + $jsonHash + " -> analyzer:valid")
      exitCodes = $exitCodes
      actions = $analysis.actions
      resourceTypes = $analysis.resourceTypes
      budgets = $analysis.budgets
      sensitiveDataDetected = [bool]$analysis.sensitiveDataDetected
    }
  }
}
catch {
  $finalSummary = [ordered]@{
    schemaVersion = 2
    valid = $false
    errorCode = $failureCode
    stage = $failureStage
    exitCode = $failureExitCode
    artifact = [ordered]@{
      planPresent = [bool]($temporaryRoot -and (Test-Path -LiteralPath (Join-Path $temporaryRoot "foundation.tfplan") -PathType Leaf))
      jsonPresent = [bool]($temporaryRoot -and (Test-Path -LiteralPath (Join-Path $temporaryRoot "foundation.json") -PathType Leaf))
    }
  }
}
finally {
  if ($tfDataDirTouched) {
    if ($previousTfDataDirExisted) { $env:TF_DATA_DIR = $previousTfDataDir }
    else { Remove-Item Env:TF_DATA_DIR -ErrorAction SilentlyContinue }
    $tfDataDirRestored = if ($previousTfDataDirExisted) { $env:TF_DATA_DIR -eq $previousTfDataDir } else { -not (Test-Path Env:TF_DATA_DIR) }
  }
  else { $tfDataDirRestored = $true }

  if ($temporaryRoot) {
    $cleanupAttempted = $true
    try {
      $canonicalTemp = Get-CanonicalPath $temporaryRoot
      $leaf = Split-Path -Leaf $canonicalTemp
      $expectedLeaf = "crmynov-evidence-" + $executionId
      $safetyRepo = if ($repo) { $repo } else { Get-CanonicalPath (Join-Path $scriptRoot "..\..") }
      if ($leaf -ne $expectedLeaf -or (Test-PathWithin $canonicalTemp $safetyRepo)) { throw "unsafe_cleanup_target" }
      Remove-Item -LiteralPath $canonicalTemp -Recurse -Force
      $cleanupSucceeded = -not (Test-Path -LiteralPath $canonicalTemp)
    }
    catch { $cleanupSucceeded = $false }
  }
  $artifactsRemaining = if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) { @(Get-ChildItem -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue).Count } else { 0 }
}

if (-not $cleanupSucceeded -or -not $tfDataDirRestored -or $artifactsRemaining -ne 0) {
  $finalSummary = [ordered]@{
    schemaVersion = 2
    valid = $false
    errorCode = "cleanup_failed"
    stage = "cleanup"
    exitCode = $null
    artifact = [ordered]@{ planPresent = $false; jsonPresent = $false }
  }
}
$finalSummary["cleanupAttempted"] = $cleanupAttempted
$finalSummary["cleanupSucceeded"] = $cleanupSucceeded
$finalSummary["artifactsRemaining"] = $artifactsRemaining
$finalSummary["tfDataDirRestored"] = $tfDataDirRestored

$serialized = $finalSummary | ConvertTo-Json -Depth 12 -Compress
$redacted = Protect-SensitiveText $serialized
if ($redacted -match '(?i)SYNTHETIC-(?:BILLING|TOKEN|PASSWORD|PRIVATE)') {
  [Console]::Out.WriteLine('{"schemaVersion":2,"valid":false,"errorCode":"sensitive_output_detected","stage":"redaction","cleanupAttempted":true,"cleanupSucceeded":true,"artifactsRemaining":0,"tfDataDirRestored":true}')
  exit 1
}
[Console]::Out.WriteLine($redacted)
if ($finalSummary.valid) { exit 0 }
exit 1
