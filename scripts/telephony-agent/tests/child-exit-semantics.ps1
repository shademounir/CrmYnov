# CI TEST TOOLING ONLY. Synthetic child; never installer/SDK/registry/COM.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64'){throw 'HOSTED_WINDOWS_REQUIRED'}
if($env:GITHUB_REPOSITORY -cne 'shademounir/CrmYnov' -or $env:GITHUB_ACTOR -cne 'shademounir'){throw 'REPOSITORY_ACTOR_REFUSED'}
$argv=[Environment]::GetCommandLineArgs()
if($argv.Count -lt 4 -or $argv[1] -ine '-NoProfile' -or $argv[2] -ine '-File' -or [IO.Path]::GetFullPath($argv[3]) -ine [IO.Path]::GetFullPath($PSCommandPath)){throw 'HOST_ARGS_REFUSED'}
foreach($arg in $argv){if($arg -imatch '^-(ExecutionPolicy|EncodedCommand|EncodedArguments|Command|ep|ec|c)$'){throw 'HOST_POLICY_OVERRIDE_REFUSED'}}
if(Test-Path Env:PSExecutionPolicyPreference){throw 'INHERITED_PROCESS_POLICY_REFUSED'}
$out=[IO.Path]::GetFullPath($OutputDirectory);$root=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
if([IO.Path]::GetDirectoryName($out) -ine $root -or [IO.Path]::GetFileName($out) -cnotmatch '^desktop-child-exit-probe-[a-f0-9]{32}$'){throw 'PROBE_OUTPUT_REFUSED'}
if(Test-Path -LiteralPath $out){throw 'PROBE_OUTPUT_EXISTS'}
$ancestor=$out
while($ancestor){
    try{$a=[IO.File]::GetAttributes($ancestor)}catch [IO.FileNotFoundException]{$a=$null}catch [IO.DirectoryNotFoundException]{$a=$null}
    if($null -ne $a -and ($a -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'PROBE_REPARSE_REFUSED'}
    $ancestor=[IO.Path]::GetDirectoryName($ancestor)
}
[IO.Directory]::CreateDirectory($out)|Out-Null
$child=Join-Path $out 'synthetic-child.ps1';$b=[Text.Encoding]::UTF8.GetBytes("`$null=1`r`nexit 0`r`n")
$s=[IO.File]::Open($child,[IO.FileMode]::CreateNew);try{$s.Write($b,0,$b.Length);$s.Flush($true)}finally{$s.Dispose()}
$bp=Set-PSBreakpoint -Script $child -Line 1 -Column 1 -Action {}
$continued=$false
try{
    $global:LASTEXITCODE=0
    & $child
    $continued=$true;$code=$LASTEXITCODE
    if(-not $continued -or $code -ne 0 -or $bp.HitCount -le 0){throw 'CHILD_EXIT_NOT_PROVEN'}
    $interpreter=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $record=[pscustomobject]@{schemaVersion=1;status='PASS';parentContinued=$continued;childExitCode=$code;childBreakpointHits=$bp.HitCount;powerShellVersion=$PSVersionTable.PSVersion.ToString();childSha256=(Get-FileHash -LiteralPath $child -Algorithm SHA256).Hash.ToLowerInvariant();probeSourceSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();interpreterSha256=(Get-FileHash -LiteralPath $interpreter -Algorithm SHA256).Hash.ToLowerInvariant();syntheticOnly=$true;installerExecuted=$false;registryOrSdkUsed=$false}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 6));$f=[IO.File]::Open((Join-Path $out 'RESULT.json'),[IO.FileMode]::CreateNew)
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
}finally{Remove-PSBreakpoint -Breakpoint $bp}
