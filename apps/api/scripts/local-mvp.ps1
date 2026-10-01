param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Start", "Seed", "Verify", "Restart", "Stop", "Validate", "Cleanup")]
  [string]$Action,
  [switch]$ConfirmCleanup
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectName = "crmynov-local"
$ExpectedVolume = "crmynov-local_postgres-data"
$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..")).Path
$ComposeFile = Join-Path $RepositoryRoot "compose.yaml"
$EnvironmentFile = Join-Path $RepositoryRoot ".env.example"
$Compose = @("compose", "-p", $ProjectName, "--profile", "multi-instance", "--env-file", $EnvironmentFile, "-f", $ComposeFile)

function Assert-LocalContract {
  if ($env:CRM_LOCAL_MODE -ne "true") { throw "CRM_LOCAL_MODE must be true." }
  $password = [string]$env:CRM_LOCAL_SEED_PASSWORD
  if ($password.Length -lt 14 -or $password -notmatch "[a-z]" -or $password -notmatch "[A-Z]" -or $password -notmatch "\d" -or $password -notmatch "[^a-zA-Z0-9]" -or $password -match "\s") {
    throw "CRM_LOCAL_SEED_PASSWORD does not satisfy the local policy."
  }
  $configJson = (& docker @Compose config --format json 2>$null | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "compose_contract_invalid" }
  $config = $configJson | ConvertFrom-Json
  if ($config.name -ne $ProjectName) { throw "compose_project_refused" }
  $databaseUrl = [uri]$config.services.api.environment.DATABASE_URL
  if ($databaseUrl.Scheme -ne "postgresql" -or $databaseUrl.Host -ne "postgres" -or $databaseUrl.Query) { throw "persistent_database_refused" }
  $volumeName = [string]$config.volumes.'postgres-data'.name
  if ($volumeName -ne $ExpectedVolume) { throw "compose_volume_refused" }
}

function Invoke-Compose([string[]]$Arguments) {
  & docker @Compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker_compose_command_failed" }
}

function Start-Stack {
  Assert-LocalContract
  Invoke-Compose @("up", "-d", "--build", "--force-recreate", "--wait")
}

function Stop-Stack {
  Assert-LocalContract
  Invoke-Compose @("down", "--remove-orphans")
}

function Invoke-Check([string]$Mode) {
  Invoke-Compose @("run", "--rm", "--no-deps", "--env", "CRM_PRIMARY_READY_URL=http://api:3001/health/ready", "--env", "CRM_SECONDARY_READY_URL=http://api-secondary:3001/health/ready", "migrate", "apps/api/dist-local/scripts/local-mvp-check.js", $Mode)
}

function Invoke-Seed {
  Assert-LocalContract
  Invoke-Compose @("--profile", "seed", "run", "--rm", "--no-deps", "seed")
}

Push-Location $RepositoryRoot
try {
  switch ($Action) {
    "Start" { Start-Stack }
    "Seed" { Invoke-Seed }
    "Verify" { Assert-LocalContract; Invoke-Check "verify" }
    "Restart" { Stop-Stack; Start-Stack }
    "Stop" { Stop-Stack }
    "Validate" {
      Start-Stack
      Invoke-Seed
      Invoke-Check "prepare"
      Stop-Stack
      Start-Stack
      Invoke-Check "verify"
    }
    "Cleanup" {
      Assert-LocalContract
      if (-not $ConfirmCleanup) { throw "ConfirmCleanup is required." }
      $existing = (& docker volume ls --filter "name=^$ExpectedVolume$" --format "{{.Name}}" | Out-String).Trim()
      if ($existing -ne $ExpectedVolume) { throw "target_volume_not_found_or_ambiguous" }
      Stop-Stack
      & docker volume rm $ExpectedVolume
      if ($LASTEXITCODE -ne 0) { throw "target_volume_cleanup_failed" }
    }
  }
} finally {
  Pop-Location
}
