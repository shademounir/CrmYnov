param()
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$files = @('AgentEndpointPolicy.cs', 'AgentMaintenancePolicy.cs') | ForEach-Object {
    Join-Path $root "apps/telephony-agent-windows/$_"
}
# Compile the actual pure managed policies, not a reimplementation. No network,
# SDK load, profile access, microphone, registry or telephone command is involved.
$sources = $files | ForEach-Object { [IO.File]::ReadAllText($_) }
$harness = @'
using System;
namespace CrmYnov.TelephonyAgent;
public static class MaintenancePolicyTestHarness
{
    private static int checks;
    private static void Check(bool result) { if (!result) throw new Exception("POLICY_ASSERTION_FAILED"); checks++; }
    private static void Refused(Action action, string code) {
        try { action(); } catch (InvalidOperationException error) { Check(error.Message == code); return; }
        throw new Exception("POLICY_REFUSAL_MISSING");
    }
    public static int Run() {
        Check(AgentEndpointPolicy.Normalize("https://crm.example.test/agent") == "https://crm.example.test/agent/");
        Check(AgentEndpointPolicy.Normalize(" http://127.0.0.1:43216 ") == "http://127.0.0.1:43216/");
        Check(AgentEndpointPolicy.Label("https://crm-prod-web.example.a.run.app/agent/") == "HTTPS · crm-prod-web.example.a.run.app/agent");
        Check(AgentEndpointPolicy.Label("https://crm-dev-web.example.a.run.app/agent/").StartsWith("HTTPS ·", StringComparison.Ordinal));
        Check(AgentEndpointPolicy.Label("http://127.0.0.1:43216").StartsWith("Local ·", StringComparison.Ordinal));
        Check(AgentEndpointPolicy.SameEndpoint("https://CRM.example.test:443/agent", "https://crm.example.test/agent/"));
        Check(!AgentEndpointPolicy.SameEndpoint("https://crm.example.test/agent", "https://crm.example.test/Agent"));
        Check(!AgentEndpointPolicy.SameEndpoint("https://crm.example.test/agent", "https://other.example.test/agent"));
        Check(!AgentEndpointPolicy.SameEndpoint("https://crm.example.test/agent", "https://crm.example.test:444/agent"));
        Refused(() => AgentEndpointPolicy.Normalize("http://crm.example.test/agent"), "API_TLS_REQUIRED");
        Refused(() => AgentEndpointPolicy.Normalize("https://user:secret@crm.example.test/agent"), "CRM_ADDRESS_INVALID");
        Refused(() => AgentEndpointPolicy.Normalize("https://crm.example.test/agent?token=value"), "CRM_ADDRESS_INVALID");
        Refused(() => AgentEndpointPolicy.Normalize("https://crm.example.test/agent#fragment"), "CRM_ADDRESS_INVALID");
        Refused(() => AgentEndpointPolicy.Normalize("file:///agent"), "API_TLS_REQUIRED");
        AgentMaintenancePolicy.RequireIdle(false, 0); checks++;
        Refused(() => AgentMaintenancePolicy.RequireIdle(true, 0), "PROFILE_MAINTENANCE_CALL_ACTIVE");
        Refused(() => AgentMaintenancePolicy.RequireIdle(false, 1), "PROFILE_MAINTENANCE_PENDING_EVENTS");
        Refused(() => AgentMaintenancePolicy.RequireIdle(true, 1), "PROFILE_MAINTENANCE_CALL_ACTIVE");
        return checks;
    }
}
'@
$body = (($sources + $harness) | ForEach-Object { $_.Replace('using System;', '').Replace('namespace CrmYnov.TelephonyAgent;', '') }) -join "`n"
Add-Type -TypeDefinition ("using System;`nnamespace CrmYnov.TelephonyAgent {`n" + $body + "`n}") -Language CSharp
$count = [CrmYnov.TelephonyAgent.MaintenancePolicyTestHarness]::Run()
[pscustomobject]@{ passed = $true; checks = $count; nativeSdkLoaded = $false; networkUsed = $false; scope = 'Pure managed endpoint and maintenance policies only; not a native runtime or installer qualification' } | ConvertTo-Json
