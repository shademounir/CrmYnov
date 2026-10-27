Set-StrictMode -Version Latest
# TEST TOOLING ONLY. Pure name-inventory guard used by the hosted fixture.
# No registry/value lookup, filesystem, environment, process or native API.
function Test-FixtureStartupNameAbsent($ValueNames,[string]$OwnedName){
    if($ValueNames -isnot [array] -or [string]::IsNullOrEmpty($OwnedName)){throw 'STARTUP_NAMES_INVENTORY_REQUIRED'}
    foreach($name in $ValueNames){
        if($name -isnot [string]){throw 'STARTUP_NAMES_INVENTORY_INVALID'}
        if($name.Equals($OwnedName,[StringComparison]::OrdinalIgnoreCase)){return $false}
    }
    return $true
}
Export-ModuleMember -Function Test-FixtureStartupNameAbsent
