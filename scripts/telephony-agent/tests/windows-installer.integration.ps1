# DRAFT: preparation only. No local execution is authorized.
# Environment guards are defense in depth, not authentication of a hosted job.
# Future execution additionally requires reviewed workflow/actor/artifact proof.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ExpectedHead,
    [Parameter(Mandatory=$true)][string]$ExpectedTree,
    [Parameter(Mandatory=$true)][string]$SourceManifest,
    [Parameter(Mandatory=$true)][string]$ExitProbeEvidence,
    [Parameter(Mandatory=$true)][string]$ExitProbeSource,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Require([bool]$Value,[string]$Code){if(-not $Value){throw $Code}}
function Sha([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Write-NewJson([string]$Path,$Value){
    $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 32))
    $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Assert-HostedContext {
    $hostArgs=[Environment]::GetCommandLineArgs()
    Require ($hostArgs.Count -ge 4 -and $hostArgs[1] -ieq '-NoProfile' -and $hostArgs[2] -ieq '-File') 'HOST_WRAPPER_ARGS_REFUSED'
    Require ([IO.Path]::GetFullPath($hostArgs[3]) -ieq [IO.Path]::GetFullPath($PSCommandPath)) 'HOST_SCRIPT_PATH_MISMATCH'
    foreach($arg in $hostArgs){Require ($arg -inotmatch '^-(ExecutionPolicy|EncodedCommand|EncodedArguments|Command|ep|ec|c)$') 'HOST_POLICY_OR_COMMAND_OVERRIDE_REFUSED'}
    Require (-not (Test-Path Env:PSExecutionPolicyPreference)) 'INHERITED_PROCESS_POLICY_OVERRIDE_REFUSED'
    Require ($env:GITHUB_ACTIONS -ceq 'true') 'HOSTED_ACTIONS_REQUIRED'
    Require ($env:RUNNER_ENVIRONMENT -ceq 'github-hosted') 'SELF_HOSTED_OR_LOCAL_REFUSED'
    Require ($env:RUNNER_OS -ceq 'Windows' -and $env:RUNNER_ARCH -ceq 'X64') 'WINDOWS_X64_REQUIRED'
    Require ($env:GITHUB_REPOSITORY -ceq 'shademounir/CrmYnov' -and $env:GITHUB_REPOSITORY_OWNER -ceq 'shademounir') 'REPOSITORY_OWNER_MISMATCH'
    Require ($env:GITHUB_ACTOR -ceq 'shademounir' -and $env:GITHUB_EVENT_NAME -cin @('pull_request','push')) 'ACTOR_OR_EVENT_REFUSED'
    Require ($env:GITHUB_RUN_ID -cmatch '^[1-9][0-9]{0,19}$' -and $env:GITHUB_RUN_ATTEMPT -cmatch '^[1-9][0-9]{0,5}$') 'RUN_IDENTITY_INVALID'
    Require ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'WINDOWS_POWERSHELL51_REQUIRED'
    Require ($ExpectedHead -cmatch '^[a-f0-9]{40}$' -and $ExpectedTree -cmatch '^[a-f0-9]{40}$') 'EXPECTED_SOURCE_INVALID'
    $event=Get-Content -LiteralPath $env:GITHUB_EVENT_PATH -Raw|ConvertFrom-Json
    if($env:GITHUB_EVENT_NAME -ceq 'pull_request'){
        Require (-not $event.pull_request.head.repo.fork) 'FORK_REFUSED'
        Require ($event.pull_request.head.repo.full_name -ceq $env:GITHUB_REPOSITORY -and $event.pull_request.base.repo.full_name -ceq $env:GITHUB_REPOSITORY) 'PR_REPOSITORY_MISMATCH'
        Require ($event.pull_request.head.sha -ceq $ExpectedHead -and $event.pull_request.base.ref -cin @('develop','main')) 'PR_SOURCE_MISMATCH'
    }else{
        Require ($env:GITHUB_REF -ceq 'refs/heads/main' -and $event.ref -ceq 'refs/heads/main') 'PUSH_REF_REFUSED'
        Require ($event.after -ceq $ExpectedHead -and $env:GITHUB_SHA -ceq $ExpectedHead -and $ExpectedHead -cne ('0'*40) -and -not $event.deleted) 'PUSH_SOURCE_MISMATCH'
        Require ($event.repository.full_name -ceq $env:GITHUB_REPOSITORY -and $event.repository.owner.login -ceq 'shademounir') 'PUSH_REPOSITORY_MISMATCH'
    }
}
function Assert-NoReparse([string]$Path){
    $current=[IO.Path]::GetFullPath($Path)
    while($current){
        try{$attr=[IO.File]::GetAttributes($current)}catch [IO.FileNotFoundException]{$attr=$null}catch [IO.DirectoryNotFoundException]{$attr=$null}
        Require ($null -eq $attr -or ($attr -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'REPARSE_REFUSED'
        $current=[IO.Path]::GetDirectoryName($current)
    }
}
Assert-HostedContext
$guardModule=Join-Path $PSScriptRoot 'windows-fixture-guards.psm1'
Import-Module $guardModule -Force
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
Require ($repo -ieq [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)) 'WORKSPACE_MISMATCH'
$git='C:/Program Files/Git/cmd/git.exe'
function Read-Git([string[]]$Arguments){
    $value=& $git -C $repo @Arguments 2>&1
    Require ($LASTEXITCODE -eq 0) 'GIT_READ_FAILED'
    return ($value|Out-String).Trim()
}
Require ((Read-Git -Arguments @('rev-parse','HEAD')) -ceq $ExpectedHead) 'CHECKOUT_HEAD_MISMATCH'
Require ((Read-Git -Arguments @('rev-parse','HEAD^{tree}')) -ceq $ExpectedTree) 'CHECKOUT_TREE_MISMATCH'
Require ([string]::IsNullOrEmpty((Read-Git -Arguments @('status','--porcelain','--untracked-files=all')))) 'DIRTY_CHECKOUT_REFUSED'
$sourcePaths=@('scripts/telephony-agent/install-windows-agent.ps1','scripts/telephony-agent/installer-transactions.psm1','scripts/telephony-agent/package-windows-agent.ps1','scripts/telephony-agent/test-installer-transactions.ps1')
$sourceManifestBefore=Sha $SourceManifest
$manifest=Get-Content -LiteralPath $SourceManifest -Raw|ConvertFrom-Json
Require ($manifest.schemaVersion -eq 1 -and $manifest.head -ceq $ExpectedHead -and $manifest.tree -ceq $ExpectedTree) 'SOURCE_MANIFEST_MISMATCH'
Require ($manifest.sources.Count -eq $sourcePaths.Count) 'SOURCE_INVENTORY_MISMATCH'
foreach($relative in $sourcePaths){
    $record=@($manifest.sources|Where-Object{$_.path -ceq $relative})
    Require ($record.Count -eq 1 -and $record[0].sha256 -ceq (Sha (Join-Path $repo $relative))) 'SOURCE_HASH_MISMATCH'
}
$interpreter=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
Require ([IO.Path]::GetFullPath($interpreter) -ieq (Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell/v1.0/powershell.exe')) 'INTERPRETER_PATH_MISMATCH'
$inputReferences=@(
    [pscustomobject]@{role='SOURCE_MANIFEST';path=[IO.Path]::GetFullPath($SourceManifest);sha256Before=$sourceManifestBefore;sha256After=$null},
    [pscustomobject]@{role='EXIT_PROBE_EVIDENCE';path=[IO.Path]::GetFullPath($ExitProbeEvidence);sha256Before=(Sha $ExitProbeEvidence);sha256After=$null},
    [pscustomobject]@{role='EXIT_PROBE_SOURCE';path=[IO.Path]::GetFullPath($ExitProbeSource);sha256Before=(Sha $ExitProbeSource);sha256After=$null},
    [pscustomobject]@{role='POWERSHELL_INTERPRETER';path=[IO.Path]::GetFullPath($interpreter);sha256Before=(Sha $interpreter);sha256After=$null},
    [pscustomobject]@{role='TEST_TOOLING_GUARD';path=[IO.Path]::GetFullPath($guardModule);sha256Before=(Sha $guardModule);sha256After=$null}
)
$probeWrapper=Get-Content -LiteralPath $ExitProbeEvidence -Raw|ConvertFrom-Json
Require ($probeWrapper.sourceAndInterpreterBeforeAfterVerified -eq $true) 'BOUND_PROBE_EVIDENCE_REQUIRED'
foreach($role in @('EXIT_PROBE_SOURCE','POWERSHELL_INTERPRETER')){
    $expected=@($inputReferences|Where-Object{$_.role -ceq $role})[0]
    $matches=@($probeWrapper.references|Where-Object{[IO.Path]::GetFullPath($_.path) -ieq $expected.path})
    Require ($matches.Count -gt 0) 'PROBE_REFERENCE_MISSING'
    foreach($match in $matches){Require ($match.sha256 -ceq $expected.sha256Before) 'PROBE_REFERENCE_HASH_MISMATCH'}
}
$probe=$probeWrapper.record
Require ($probe.schemaVersion -eq 1 -and $probe.status -ceq 'PASS' -and $probe.parentContinued -and $probe.childBreakpointHits -gt 0 -and $probe.childExitCode -eq 0 -and $probe.powerShellVersion -ceq $PSVersionTable.PSVersion.ToString()) 'EXIT_PROBE_REQUIRED'
foreach($reference in $inputReferences){Require ((Sha $reference.path) -ceq $reference.sha256Before) 'EXECUTION_INPUT_CHANGED_BEFORE_EFFECTS'}
# No registry/COM/filesystem fixture mutation has occurred above this line.
$product='CRM Ynov Telephony Agent'
$local=[Environment]::GetFolderPath('LocalApplicationData')
$productRoot=Join-Path $local ('Programs/'+$product)
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Programs')) ($product+'.lnk')
$profileRoot=Join-Path $local 'CRM Ynov/Telephony Agent'
$protocol='Software\Classes\crmynov-telephony'
$registration='Software\Microsoft\Windows\CurrentVersion\Uninstall\CRM Ynov Telephony Agent'
$run='Software\Microsoft\Windows\CurrentVersion\Run'
function Key-Exists([string]$Relative){$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($Relative);if($null -eq $k){return $false};$k.Dispose();return $true}
function Run-Value { $k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($run);if($null -eq $k){return $null};try{return $k.GetValue($product,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}finally{$k.Dispose()} }
function Startup-NameAbsent {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($run)
    if($null -eq $key){return (Test-FixtureStartupNameAbsent @() $product)}
    try{return (Test-FixtureStartupNameAbsent @($key.GetValueNames()) $product)}finally{$key.Dispose()}
}
Require (-not (Test-Path -LiteralPath $productRoot)) 'PREEXISTING_PRODUCT_REFUSED'
Require (-not (Test-Path -LiteralPath $shortcutPath)) 'PREEXISTING_SHORTCUT_REFUSED'
Require (-not (Key-Exists $protocol)) 'PREEXISTING_PROTOCOL_REFUSED'
Require (-not (Key-Exists $registration)) 'PREEXISTING_REGISTRATION_REFUSED'
Require (Startup-NameAbsent) 'PREEXISTING_STARTUP_REFUSED'
Require (-not (Test-Path -LiteralPath $profileRoot)) 'PREEXISTING_CRM_PROFILE_REFUSED'
Require (@(Get-Process|Where-Object{$_.ProcessName -like 'CrmYnov.TelephonyAgent*'}).Count -eq 0) 'PREEXISTING_AGENT_REFUSED'
Assert-NoReparse $productRoot;Assert-NoReparse $shortcutPath
$out=[IO.Path]::GetFullPath($OutputDirectory);$runnerTemp=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
Require ([IO.Path]::GetDirectoryName($out) -ieq $runnerTemp) 'OUTPUT_OUTSIDE_RUNNER_TEMP'
Require ([IO.Path]::GetFileName($out) -cmatch '^crmy-desktop-windows-fixture-[a-f0-9]{32}$') 'OUTPUT_NAME_REFUSED'
Require (-not (Test-Path -LiteralPath $out)) 'OUTPUT_ALREADY_EXISTS'
Assert-NoReparse $out
[IO.Directory]::CreateDirectory($out)|Out-Null
Write-NewJson (Join-Path $out 'FIXTURE-INTENT.json') ([pscustomobject]@{head=$ExpectedHead;tree=$ExpectedTree;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;status='INTENT_ONLY_NOT_RESULT';inputReferences=$inputReferences;interpreterVersionObserved=$PSVersionTable.PSVersion.ToString();probeAuthorityAuthenticatedByThisReport=$false;syntheticPackageOnly=$true;packagedExeTested=$false;noSdkSipOrAppMain=$true})
$cases=[Collections.Generic.List[object]]::new();$observed=[Collections.Generic.List[object]]::new();$sources=[Collections.Generic.List[object]]::new()
$pesterPath='C:/Program Files/WindowsPowerShell/Modules/Pester/3.4.0/Pester.psd1'
Import-Module $pesterPath -Force
$pester=Get-Module Pester
Require ($pester.Version.ToString() -ceq '3.4.0') 'PESTER_VERSION_MISMATCH'
Require ([IO.Path]::GetFullPath($pester.ModuleBase) -ieq [IO.Path]::GetDirectoryName($pesterPath)) 'PESTER_MODULE_ROOT_MISMATCH'
Assert-NoReparse $pester.ModuleBase
$frameworkFiles=@(Get-ChildItem -LiteralPath $pester.ModuleBase -Recurse -File)
Require ($frameworkFiles.Count -gt 0 -and $frameworkFiles.Count -le 1000) 'PESTER_PAYLOAD_BOUND'
$framework=@($frameworkFiles|ForEach-Object{Assert-NoReparse $_.FullName;[pscustomobject]@{path=$_.FullName.Substring($pester.ModuleBase.Length+1).Replace('\','/');sha256=(Sha $_.FullName)}})
Write-NewJson (Join-Path $out 'framework-provenance.json') ([pscustomobject]@{version=$pester.Version.ToString();moduleRootObserved=$pester.ModuleBase;files=$framework;imageVersionObserved=$env:ImageVersion;payloadAuthenticatedByThisReport=$false})
Require (@(Get-PSBreakpoint).Count -eq 0) 'PREEXISTING_BREAKPOINTS_REFUSED'
function Command-Inventory([string]$Path){
    # Native Pester AST inventory only; never extract/rewrite executable code.
    return @(& $pester {param($p) Get-CommandsInFile -Path $p|Where-Object{-not (IsIgnoredCommand -Command $_)}} $Path|ForEach-Object{[pscustomobject]@{line=$_.Extent.StartLineNumber;column=$_.Extent.StartColumnNumber}})
}
function Instrument-Path([string]$Relative,[string]$Executed){
    $source=Join-Path $repo $Relative;$before=Sha $Executed
    Require ($before -ceq (Sha $source)) 'ALIAS_BYTES_MISMATCH'
    $commands=Command-Inventory $Executed
    $expected=Command-Inventory $source
    Require (($commands|ConvertTo-Json -Compress) -ceq ($expected|ConvertTo-Json -Compress)) 'ALIAS_COORDINATES_MISMATCH'
    $breakpoints=@($commands|ForEach-Object{Set-PSBreakpoint -Script $Executed -Line $_.line -Column $_.column -Action {}})
    $observed.Add([pscustomobject]@{sourcePath=$Relative;executedPath=$Executed;sha256Before=$before;commands=$commands;breakpoints=$breakpoints})
}
foreach($relative in $sourcePaths){
    $path=Join-Path $repo $relative;$text=[IO.File]::ReadAllText($path)
    $sources.Add([pscustomobject]@{path=$relative;sha256=(Sha $path);lineCount=($text -split '\r?\n').Count;classification=$(if($relative -like '*test-installer*'){'TEST'}else{'PRODUCTION'});commands=@(Command-Inventory $path)})
    Instrument-Path $relative $path
}
function Fixture-Package([string]$Version){
    $dir=Join-Path $out ('synthetic-'+$Version);[IO.Directory]::CreateDirectory($dir)|Out-Null
    # INERT ASCII bytes named .exe solely to satisfy the script's file contract.
    # Not a PE, SDK, installed agent, deliverable or simulated build result.
    [IO.File]::WriteAllText((Join-Path $dir 'CrmYnov.TelephonyAgent.exe'),'SYNTHETIC-INERT-NEVER-EXECUTE')
    foreach($name in @('install-windows-agent.ps1','installer-transactions.psm1')){[IO.File]::Copy((Join-Path $repo ('scripts/telephony-agent/'+$name)),(Join-Path $dir $name),$false)}
    $entries=@([IO.Directory]::EnumerateFiles($dir)|ForEach-Object{[pscustomobject]@{path=[IO.Path]::GetFileName($_);bytes=(Get-Item -LiteralPath $_).Length;sha256=(Sha $_)}})
    Write-NewJson (Join-Path $dir 'manifest.json') ([pscustomobject]@{schemaVersion=1;product=$product;version=$Version;runtime='SYNTHETIC-NOT-DELIVERABLE';sourceCommit=$ExpectedHead;files=$entries})
    return $dir
}
function Assert-NoAgent {
    Require (@(Get-Process|Where-Object{$_.ProcessName -like 'CrmYnov.TelephonyAgent*'}).Count -eq 0) 'AGENT_PROCESS_DETECTED'
    Require (-not (Test-Path -LiteralPath $profileRoot)) 'CRM_PROFILE_CREATED'
}
function Assert-Activation([string]$Version,[bool]$Startup){
    $exe=Join-Path $productRoot ('versions/'+$Version+'/CrmYnov.TelephonyAgent.exe')
    Require ([IO.File]::ReadAllText((Join-Path $productRoot 'active-version.txt')).Trim() -ceq $Version) 'ACTIVE_POINTER_MISMATCH'
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($protocol+'\shell\open\command')
    try{Require ($null -ne $key -and $key.GetValue('') -ceq ('"{0}" "%1"' -f $exe)) 'PROTOCOL_MISMATCH'}finally{if($null -ne $key){$key.Dispose()}}
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registration)
    try{Require ($null -ne $key -and $key.GetValue('DisplayVersion') -ceq $Version) 'REGISTRATION_MISMATCH'}finally{if($null -ne $key){$key.Dispose()}}
    $link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    Require ($link.TargetPath -ieq $exe) 'SHORTCUT_MISMATCH'
    if($Startup){Require (-not (Startup-NameAbsent) -and (Run-Value) -ceq ('"{0}"' -f $exe)) 'STARTUP_MISMATCH'}else{Require (Startup-NameAbsent) 'STARTUP_NOT_OFF'}
    Assert-NoAgent
}
function Invoke-FixtureInstall([string]$Package,[string]$Version){
    # No launcher, no PowerShell policy flag and NEVER an UninstallString.
    Invoke-FixtureScript (Join-Path $repo 'scripts/telephony-agent/install-windows-agent.ps1') @{PackageDirectory=$Package;Version=$Version;NoLaunch=$true}
    Assert-NoAgent
}
function Invoke-FixtureScript([string]$Path,[hashtable]$Parameters){
    $source=Join-Path $repo 'scripts/telephony-agent/install-windows-agent.ps1'
    $maintenance=Join-Path $productRoot 'install-windows-agent.ps1'
    Require ($Path -ieq $source -or $Path -ieq $maintenance) 'SCRIPT_PATH_REFUSED'
    Require ((Sha $Path) -ceq (Sha $source)) 'SCRIPT_BYTES_MISMATCH'
    # Installation has no explicit exit0, so stale native command codes must
    # never be accepted or mistaken for this invocation's result.
    $global:LASTEXITCODE=0
    & $Path @Parameters|Out-Null
    $exitCode=$LASTEXITCODE
    Require ($exitCode -eq 0) 'INSTALLER_EXIT_NONZERO'
}
function Assert-Uninstalled {
    Require (-not (Key-Exists $protocol) -and -not (Key-Exists $registration)) 'REGISTRATION_REMAINS'
    Require (-not (Test-Path -LiteralPath $shortcutPath) -and (Startup-NameAbsent)) 'ACTIVATION_REMAINS'
    Require (-not (Test-Path -LiteralPath (Join-Path $productRoot 'versions'))) 'VERSIONS_REMAIN'
    Require (-not (Test-Path -LiteralPath (Join-Path $productRoot 'active-version.txt'))) 'POINTER_REMAINS'
    foreach($name in @('install-windows-agent.ps1','installer-transactions.psm1')){Require ((Sha (Join-Path $productRoot $name)) -ceq (Sha (Join-Path $repo ('scripts/telephony-agent/'+$name)))) 'MAINTENANCE_NOT_RETAINED'}
    Assert-NoAgent
}
function Assert-InstallerLeaseReleased {
    $path=Join-Path $productRoot '.installer.lock'
    $handle=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $handle.Dispose()
}
function Case([string]$Id,[scriptblock]$Action){
    Require ($Id -cmatch '^[a-z0-9-]{1,80}$') 'CASE_ID_INVALID'
    $start=[DateTime]::UtcNow
    Write-NewJson (Join-Path $out ($Id+'.INTENT.json')) ([pscustomobject]@{id=$Id;status='INTENT_ONLY_OUTCOME_UNKNOWN_UNTIL_RESULT';head=$ExpectedHead;startUtc=$start.ToString('o')})
    try{
        & $Action
        Assert-InstallerLeaseReleased
    }catch{
        $failureRecord=$_
        $released=$false;try{Assert-InstallerLeaseReleased;$released=$true}catch{$released=$false}
        $failed=[pscustomobject]@{id=$Id;status='FAILED';installerLeaseReleased=$released;failureType=$failureRecord.Exception.GetType().FullName;startUtc=$start.ToString('o');endUtc=[DateTime]::UtcNow.ToString('o')}
        Write-NewJson (Join-Path $out ($Id+'.RESULT.json')) $failed
        $cases.Add($failed)
        throw $failureRecord
    }
    $passed=[pscustomobject]@{id=$Id;status='PASS';installerLeaseReleased=$true;startUtc=$start.ToString('o');endUtc=[DateTime]::UtcNow.ToString('o')}
    Write-NewJson (Join-Path $out ($Id+'.RESULT.json')) $passed
    $cases.Add($passed)
}
$status='FAILED';$errorCode=$null
$runnerAdminObserved=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$failureType=$null;$failureHResult=$null
try{
    # Both fixtures use CURRENT source and inert bytes. Version labels do NOT
    # qualify upgrading an actual historical0.4.13 installation or binary.
    $old=Fixture-Package '0.4.13-pilot';$new=Fixture-Package '0.4.14-pilot'
    Case 'fresh-off' {Invoke-FixtureInstall $old '0.4.13-pilot';Assert-Activation '0.4.13-pilot' $false}
    foreach($name in @('install-windows-agent.ps1','installer-transactions.psm1')){Instrument-Path ('scripts/telephony-agent/'+$name) (Join-Path $productRoot $name)}
    Case 'upgrade-off' {Invoke-FixtureInstall $new '0.4.14-pilot';Assert-Activation '0.4.14-pilot' $false}
    Case 'rollback-off' {Invoke-FixtureScript (Join-Path $repo 'scripts/telephony-agent/install-windows-agent.ps1') @{RollbackVersion='0.4.13-pilot'};Assert-Activation '0.4.13-pilot' $false}
    Case 'uninstall' {Invoke-FixtureScript (Join-Path $productRoot 'install-windows-agent.ps1') @{Uninstall=$true};Assert-Uninstalled}
    Case 'explicit-uninstall-repeat-not-interruption-proof' {Invoke-FixtureScript (Join-Path $productRoot 'install-windows-agent.ps1') @{Uninstall=$true};Assert-Uninstalled}
    Case 'new-cycle-fresh-off' {Invoke-FixtureInstall $old '0.4.13-pilot';Assert-Activation '0.4.13-pilot' $false}
    # Guest-only synthetic opt-in: owns this product's Run value, no other value.
    $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($run)
    try{$key.SetValue($product,('"{0}"' -f (Join-Path $productRoot 'versions/0.4.13-pilot/CrmYnov.TelephonyAgent.exe')),[Microsoft.Win32.RegistryValueKind]::String)}finally{$key.Dispose()}
    Case 'upgrade-on' {Invoke-FixtureInstall $new '0.4.14-pilot';Assert-Activation '0.4.14-pilot' $true}
    Case 'final-uninstall' {Invoke-FixtureScript (Join-Path $productRoot 'install-windows-agent.ps1') @{Uninstall=$true};Assert-Uninstalled}
    $status='PASS'
}catch{
    # No raw stderr, registry dump, environment or customer data in evidence.
    $errorCode='HOSTED_FIXTURE_FAILED_RECONCILE_NO_RETRY'
    if($_.Exception.Message -cmatch '^[A-Z0-9_]{1,96}$'){$errorCode=$_.Exception.Message}
    $failureType=$_.Exception.GetType().FullName;$failureHResult=$_.Exception.HResult
}finally{
    $sourceAfterVerified=$true
    $observations=@($observed|ForEach-Object{
        $after=$null
        try{$after=Sha $_.executedPath}catch{$sourceAfterVerified=$false}
        if($after -cne $_.sha256Before){$sourceAfterVerified=$false}
        [pscustomobject]@{sourcePath=$_.sourcePath;executedPath=$_.executedPath;sha256Before=$_.sha256Before;sha256After=$after;commands=@($_.breakpoints|ForEach-Object{[pscustomobject]@{line=$_.Line;column=$_.Column;hitCount=$_.HitCount}})}
    })
    foreach($source in $sources){try{if((Sha (Join-Path $repo $source.path)) -cne $source.sha256){$sourceAfterVerified=$false}}catch{$sourceAfterVerified=$false}}
    foreach($reference in $inputReferences){
        try{$reference.sha256After=Sha $reference.path}catch{$sourceAfterVerified=$false}
        if($reference.sha256After -cne $reference.sha256Before){$sourceAfterVerified=$false}
    }
    try{
        if((Read-Git -Arguments @('rev-parse','HEAD')) -cne $ExpectedHead -or (Read-Git -Arguments @('rev-parse','HEAD^{tree}')) -cne $ExpectedTree){$sourceAfterVerified=$false}
        if(-not [string]::IsNullOrEmpty((Read-Git -Arguments @('status','--porcelain','--untracked-files=all')))){$sourceAfterVerified=$false}
    }catch{$sourceAfterVerified=$false}
    if(-not $sourceAfterVerified){$status='FAILED';$errorCode='SOURCE_AFTER_NOT_PROVEN'}
    $payload=[pscustomobject]@{schemaVersion=1;head=$ExpectedHead;tree=$ExpectedTree;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;status=$status;evidenceKind='NATIVE_POWERSHELL_COMMAND_BREAKPOINTS';sourceBeforeAfterVerified=$sourceAfterVerified;sources=@($sources);observations=$observations;testCases=@($cases);inputReferences=$inputReferences;interpreterVersionObserved=$PSVersionTable.PSVersion.ToString();probeAuthorityAuthenticatedByThisReport=$false;errorCode=$errorCode;failureType=$failureType;failureHResult=$failureHResult;runnerAdminObserved=$runnerAdminObserved;standardUserOrUacAcceptance=$false;githubIdentityAuthenticatedByThisReport=$false;syntheticPackageOnly=$true;actualHistorical0413UpgradeTested=$false;packagedExeTested=$false;sdkSipUserOrProductionAcceptance=$false;interruptedUninstallTested=$false;unknownOutcomeCleanupAttempted=$false;frameworkProvenanceSha256=(Sha (Join-Path $out 'framework-provenance.json'))}
    Write-NewJson (Join-Path $out 'coverage-evidence.json') $payload
    foreach($observation in $observed){$observation.breakpoints|Remove-PSBreakpoint}
    # NO forced cleanup: product maintenance/recovery and evidence remain for
    # inspection; hosted VM teardown is external and not successful uninstall.
}
Require ($status -ceq 'PASS') 'HOSTED_FIXTURE_NOT_PASS'
