$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'windows-fixture-guards.psm1') -Force
$checks=0
function Check([bool]$Actual){$script:checks++;if(-not $Actual){throw 'MEMORY_GUARD_ASSERTION_FAILED'}}
function Refuses([scriptblock]$Action,[string]$Code){try{& $Action;throw 'MISSING_REFUSAL'}catch{Check($_.Exception.Message -ceq $Code)}}
$owned='CRM Ynov Telephony Agent'
Check(Test-FixtureStartupNameAbsent @() $owned)
Check(Test-FixtureStartupNameAbsent @('Unrelated','') $owned)
Check(-not (Test-FixtureStartupNameAbsent @($owned) $owned))
Check(-not (Test-FixtureStartupNameAbsent @($owned.ToUpperInvariant()) $owned))
Check(-not (Test-FixtureStartupNameAbsent @('Unrelated',$owned) $owned))
foreach($fixture in @(
    [pscustomobject]@{Kind='REG_BINARY';Data=[byte[]]@()},
    [pscustomobject]@{Kind='REG_NONE';Data=$null},
    [pscustomobject]@{Kind='REG_SZ';Data=''},
    [pscustomobject]@{Kind='REG_MULTI_SZ';Data=@()},
    [pscustomobject]@{Kind='REG_SZ';Data='synthetic-value'}
)){
    $memory=[pscustomobject]@{Names=@($owned);Kind=$fixture.Kind;Data=$fixture.Data;Reads=0}
    $memory|Add-Member -MemberType ScriptMethod -Name GetValueNames -Value {return ,$this.Names}
    $memory|Add-Member -MemberType ScriptMethod -Name GetValue -Value {$this.Reads++;throw 'VALUE_READ_FORBIDDEN'}
    Check(-not (Test-FixtureStartupNameAbsent ($memory.GetValueNames()) $owned))
    Check($memory.Reads -eq 0)
}
Refuses {Test-FixtureStartupNameAbsent $null $owned} 'STARTUP_NAMES_INVENTORY_REQUIRED'
Refuses {Test-FixtureStartupNameAbsent $owned $owned} 'STARTUP_NAMES_INVENTORY_REQUIRED'
Refuses {Test-FixtureStartupNameAbsent @('Unrelated',123) $owned} 'STARTUP_NAMES_INVENTORY_INVALID'
Refuses {Test-FixtureStartupNameAbsent @() ''} 'STARTUP_NAMES_INVENTORY_REQUIRED'
[pscustomobject]@{passed=$true;checks=$checks;scope='Pure TESTtooling name guard on memory objects';registryReadOrWritten=$false;valueDataRead=$false;comOrSdkUsed=$false;harnessExecuted=$false}|ConvertTo-Json -Compress
