[CmdletBinding(DefaultParameterSetName = "Real")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Synthetic")]
  [switch] $SyntheticFixture,

  [Parameter(Mandatory = $true, ParameterSetName = "Synthetic")]
  [string] $FixturePath,

  [Parameter(ParameterSetName = "Synthetic")]
  [ValidateSet("None", "Command", "PlanAbsent", "PlanEmpty", "JsonAbsent", "JsonEmpty", "Analyzer")]
  [string] $SyntheticFailure = "None",

  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [string] $RepositoryRoot,

  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [string] $TerraformRoot,

  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [string] $TfVarsPath,

  [Parameter(Mandatory = $true, ParameterSetName = "Real")]
  [ValidatePattern("^[a-f0-9]{40}$")]
  [string] $ExpectedMainSha
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$analyzer = Join-Path $scriptRoot "analyze-foundation-plan.mjs"
$temporaryRoot = $null

function Assert-NativeSuccess([string] $CommandName) {
  if ($LASTEXITCODE -ne 0) { throw ("native_command_failed:" + $CommandName) }
}

function Assert-OutsideRepository([string] $Candidate, [string] $Repository) {
  $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
  $repositoryPath = [System.IO.Path]::GetFullPath($Repository).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  if ($candidatePath.StartsWith($repositoryPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "sensitive_path_inside_repository"
  }
}

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node_missing" }
  $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("crmynov-evidence-" + [System.Guid]::NewGuid().ToString("N"))
  [System.IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
  $jsonPath = Join-Path $temporaryRoot "foundation.json"

  if ($SyntheticFixture) {
    $fixturesRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot "fixtures"))
    $sourcePath = [System.IO.Path]::GetFullPath($FixturePath)
    if (-not $sourcePath.StartsWith($fixturesRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "synthetic_fixture_outside_allowlist"
    }
    if (-not $sourcePath.EndsWith(".synthetic.json", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "synthetic_fixture_extension_invalid"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "synthetic_fixture_missing" }
    if ($SyntheticFailure -eq "Command") { throw "synthetic_command_failure" }
    if ($SyntheticFailure -eq "PlanAbsent") { throw "synthetic_plan_absent" }
    if ($SyntheticFailure -eq "PlanEmpty") { throw "synthetic_plan_empty" }
    if ($SyntheticFailure -eq "JsonAbsent") { throw "synthetic_json_absent" }
    [System.IO.File]::Copy($sourcePath, $jsonPath, $false)
    if ($SyntheticFailure -eq "JsonEmpty") { [System.IO.File]::WriteAllBytes($jsonPath, [byte[]]@()) }
    if ($SyntheticFailure -eq "Analyzer") { [System.IO.File]::WriteAllText($jsonPath, "{invalid", [System.Text.UTF8Encoding]::new($false)) }
  }
  else {
    $repo = [System.IO.Path]::GetFullPath($RepositoryRoot)
    $root = [System.IO.Path]::GetFullPath($TerraformRoot)
    $tfvars = [System.IO.Path]::GetFullPath($TfVarsPath)
    Assert-OutsideRepository $tfvars $repo
    Assert-OutsideRepository $temporaryRoot $repo
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "terraform_root_missing" }
    if (-not (Test-Path -LiteralPath $tfvars -PathType Leaf)) { throw "tfvars_missing" }
    if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) { throw "terraform_missing" }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git_missing" }

    $actualSha = (& git -C $repo rev-parse main).Trim()
    Assert-NativeSuccess "git-rev-parse"
    if ($actualSha -ne $ExpectedMainSha) { throw "main_sha_mismatch" }

    $planPath = Join-Path $temporaryRoot "foundation.tfplan"
    & terraform "-chdir=$root" plan -input=false -lock=false "-var-file=$tfvars" "-out=$planPath" 2> (Join-Path $temporaryRoot "plan.stderr")
    Assert-NativeSuccess "terraform-plan"
    if (-not (Test-Path -LiteralPath $planPath -PathType Leaf) -or (Get-Item -LiteralPath $planPath).Length -eq 0) {
      throw "plan_binary_missing_or_empty"
    }
    $null = Get-FileHash -LiteralPath $planPath -Algorithm SHA256

    $jsonLines = & terraform "-chdir=$root" show -json $planPath 2> (Join-Path $temporaryRoot "show.stderr")
    Assert-NativeSuccess "terraform-show"
    [System.IO.File]::WriteAllText($jsonPath, ($jsonLines -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
    if (-not (Test-Path -LiteralPath $jsonPath -PathType Leaf) -or (Get-Item -LiteralPath $jsonPath).Length -eq 0) {
      throw "plan_json_missing_or_empty"
    }
  }

  & node $analyzer $jsonPath
  Assert-NativeSuccess "node-analyzer"
}
catch {
  [Console]::Out.WriteLine('{"valid":false,"errorCode":"wrapper_fail_closed","category":"wrapper"}')
  exit 1
}
finally {
  if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
