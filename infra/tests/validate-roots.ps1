$ErrorActionPreference = "Stop"

$roots = @(
  (Resolve-Path "$PSScriptRoot\..\bootstrap\foundation"),
  (Resolve-Path "$PSScriptRoot\..\bootstrap\state"),
  (Resolve-Path "$PSScriptRoot\..\bootstrap\wif")
)

foreach ($root in $roots) {
  Write-Host "Validating $root"
  terraform -chdir="$root" init -backend=false -input=false
  if ($LASTEXITCODE -ne 0) { throw "terraform init failed for $root" }
  terraform -chdir="$root" validate
  if ($LASTEXITCODE -ne 0) { throw "terraform validate failed for $root" }
}
