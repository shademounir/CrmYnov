using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal static class AgentSelfTest
{
    public static int Run(string? reportPath)
    {
        var root = Path.Combine(Path.GetTempPath(), $"crm-ynov-agent-self-test-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(root);
            var store = new DpapiStore(root);
            var expected = new AgentSettings(
                "http://127.0.0.1:43216", "synthetic-agent-token", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(),
                "sip:synthetic@sip.example.invalid", "synthetic", "sip.example.invalid", null, "TLS",
                "synthetic-private-secret", "input-private-id", "output-private-id");
            store.Save(expected);
            var restored = store.Load();
            Require(restored == expected, "DPAPI_ROUNDTRIP_FAILED");
            var protectedBytes = File.ReadAllBytes(Path.Combine(root, "settings.dpapi"));
            Require(!System.Text.Encoding.UTF8.GetString(protectedBytes).Contains(expected.SipPassword, StringComparison.Ordinal), "DPAPI_CLEAR_SECRET_FOUND");

            var journal = new EventJournal(store.JournalPath);
            var item = new AgentEvent("1", "command-self-test", "call-self-test", "event-self-test", "FAILED", DateTimeOffset.UtcNow, "NETWORK_UNCERTAIN");
            journal.MarkCommand(item.CommandId);
            journal.Add(item);
            var reloaded = new EventJournal(store.JournalPath);
            Require(reloaded.HasSeen(item.CommandId), "JOURNAL_COMMAND_REPLAY_NOT_BLOCKED");
            Require(reloaded.Pending.Single().ReasonCode == item.ReasonCode, "JOURNAL_REASON_NOT_PERSISTED");
            reloaded.Acknowledge(reloaded.Pending.Single());
            Require(new EventJournal(store.JournalPath).Pending.Count == 0, "JOURNAL_ACK_NOT_PERSISTED");

            var diagnostic = Path.Combine(root, "diagnostic.json");
            DiagnosticsExporter.Export(diagnostic, new(true, false, true, false, "CRM_INJOIGNABLE", "DIALING", 2, false, 17,
                [new("private-device-id", "Private microphone name", true, false)], "private-device-id", null), true, true);
            var diagnosticText = File.ReadAllText(diagnostic);
            foreach (var forbidden in new[] { expected.AgentToken, expected.SipPassword, expected.SipAddress, "private-device-id", "Private microphone name" })
                Require(!diagnosticText.Contains(forbidden, StringComparison.Ordinal), "DIAGNOSTIC_PRIVATE_VALUE_FOUND");
            using (var diagnosticJson = JsonDocument.Parse(diagnosticText)) {
                var rootElement = diagnosticJson.RootElement;
                var expectedVersion = typeof(AgentSelfTest).Assembly
                    .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
                    .Cast<System.Reflection.AssemblyInformationalVersionAttribute>()
                    .Single().InformationalVersion;
                Require(rootElement.GetProperty("agentVersion").GetString() == expectedVersion, "DIAGNOSTIC_VERSION_MISMATCH");
                var runtime = rootElement.GetProperty("runtime");
                Require(runtime.TryGetProperty("MicrophoneLevel", out _), "DIAGNOSTIC_MIC_LEVEL_MISSING");
                Require(runtime.TryGetProperty("LastMicrophonePeak", out _), "DIAGNOSTIC_MIC_PEAK_MISSING");
                Require(runtime.TryGetProperty("MicrophoneSampleCount", out _), "DIAGNOSTIC_MIC_SAMPLES_MISSING");
            }

            var ready = new AgentRuntimeSnapshot(true, true, true, true, "SIP_ENREGISTRÉ", null, null, false, 0, [], "input", "output", "Autorisée", true, false, true, true);
            Require(AgentReadiness.IsReady(ready), "READINESS_COMPLETE_PROFILE_REFUSED");
            Require(!AgentReadiness.IsReady(ready with { AuthorizationState = "Révoquée" }), "READINESS_REVOKED_WORKSTATION_ACCEPTED");
            Require(!AgentReadiness.IsReady(ready with { OutputDeviceAvailable = false }), "READINESS_MISSING_OUTPUT_ACCEPTED");

            Require(AgentCallState.IsActive("ANSWERED"), "ACTIVE_CALL_STATE_REFUSED");
            Require(!AgentCallState.IsActive("ENDED"), "TERMINAL_CALL_STATE_STILL_ACTIVE");
            Require(DialPadEditor.Apply("0612345678", 0, 10, "7") == new DialPadEdit("7", 1), "DIALPAD_SELECTION_NOT_REPLACED");
            Require(DialPadEditor.Apply("0612", 2, 2, "⌫") == new DialPadEdit("06", 2), "DIALPAD_SELECTION_NOT_DELETED");
            Require(DialPadEditor.Apply("0612", 2, 0, "⌫") == new DialPadEdit("012", 1), "DIALPAD_BACKSPACE_FAILED");

            Require(AgentSetup.NormalizeApiBaseUrl("https://crm-dev.example.test/agent") == "https://crm-dev.example.test/agent/", "CRM_ADDRESS_NOT_NORMALIZED");
            Require(AgentSetup.EnvironmentLabel("https://crm-prod-web.example.a.run.app/agent/") == "HTTPS · crm-prod-web.example.a.run.app/agent", "CRM_ENVIRONMENT_NOT_DISPLAYED");
            RequireThrows(() => AgentSetup.NormalizeApiBaseUrl("http://crm-dev.example.test/agent/"), "CRM_HTTP_REMOTE_ACCEPTED");
            RequireThrows(() => AgentSetup.NormalizeApiBaseUrl("https://user@crm-dev.example.test/agent/"), "CRM_ADDRESS_CREDENTIAL_ACCEPTED");

            var paired = new PairResponse("new-token", expected.WorkstationId, new AgentProfile(expected.ProfileId, expected.WorkstationId, expected.SipAddress, expected.AuthUsername, new(expected.SipDomain, expected.ProxyUri, expected.Transport), false, false));
            Require(AgentSetup.CanPreserveLocalProfile(expected, AgentSetup.NormalizeApiBaseUrl(expected.ApiBaseUrl), paired), "SAME_ORIGIN_PROFILE_NOT_PRESERVED");
            Require(!AgentSetup.CanPreserveLocalProfile(expected, "https://crm-dev.example.test/agent/", paired), "CROSS_ORIGIN_PROFILE_PRESERVED");
            Require(!AgentEndpointPolicy.SameEndpoint("https://crm.example.test/agent", "https://crm.example.test/Agent"), "CROSS_GATEWAY_PROFILE_PRESERVED");
            Require(AgentEndpointPolicy.SameEndpoint("https://CRM.example.test:443/agent", "https://crm.example.test/agent/"), "CANONICAL_ENDPOINT_REFUSED");
            AgentMaintenancePolicy.RequireIdle(false, 0);
            RequireThrows(() => AgentMaintenancePolicy.RequireIdle(true, 0), "ACTIVE_CALL_MAINTENANCE_ACCEPTED");
            RequireThrows(() => AgentMaintenancePolicy.RequireIdle(false, 1), "PENDING_EVENT_MAINTENANCE_ACCEPTED");
            // Exercise the real runtime boundary without constructing a SDK Core.
            // A persisted unacknowledged event must fence profile maintenance even
            // when no network queue or engine has been started in this process.
            var pendingMaintenance = item with { EventId = "event-maintenance-pending" };
            reloaded.Add(pendingMaintenance);
            var maintenanceRuntime = new AgentRuntime(store);
            RequireCode(() => maintenanceRuntime.StopForMaintenanceAsync().GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_PENDING_EVENTS");
            Require(store.Load() == expected, "MAINTENANCE_CHANGED_PROTECTED_PROFILE");
            reloaded.Acknowledge(pendingMaintenance);
            maintenanceRuntime.StopForMaintenanceAsync().GetAwaiter().GetResult();
            // An empty synthetic secret makes a regressed guard fail locally,
            // before SDK initialization or any SIP registration is possible.
            store.Save(expected with { SipPassword = "" });
            RequireCode(() => maintenanceRuntime.HandleProtocolCommandAsync(Guid.NewGuid()).GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_IN_PROGRESS");
            RequireCode(() => maintenanceRuntime.StartFreeCallAsync("+212600000000", "OTHER_AUTHORIZED", null).GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_IN_PROGRESS");
            MaintenanceLeaseTestAsync(maintenanceRuntime).GetAwaiter().GetResult();
            reloaded.BeginFreeCall("synthetic-uncertain-request");
            Require(new EventJournal(store.JournalPath).UnresolvedFreeCallCount == 1, "UNCERTAIN_FREE_CALL_NOT_DURABLE");
            RequireCode(() => maintenanceRuntime.StopForMaintenanceAsync().GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_PENDING_EVENTS");
            reloaded.ResolveFreeCall("synthetic-uncertain-request");
            Require(new EventJournal(store.JournalPath).UnresolvedFreeCallCount == 0, "FREE_CALL_RECEIPT_NOT_RESOLVED");
            maintenanceRuntime.DisposeAsync().AsTask().GetAwaiter().GetResult();
            store.Save(expected);
            ActivityFenceTestAsync().GetAwaiter().GetResult();
            var mutexName = $"Local\\CRM-Ynov-Test-{Guid.NewGuid():N}";
            using (var instance = AgentInstanceGuard.Acquire(mutexName)) {
                RequireCode(() => AgentInstanceGuard.Acquire(mutexName).Dispose(), "AGENT_INSTANCE_ALREADY_RUNNING");
            }
            foreach (var status in new[] { 408, 429, 500, 502, 503 }) {
                var message = MainForm.HumanError(new HttpRequestException("synthetic-private-value", null, (System.Net.HttpStatusCode)status));
                Require(message.Contains("incertain", StringComparison.Ordinal) && message.Contains("Ne répétez pas", StringComparison.Ordinal), "UNCERTAIN_HTTP_MESSAGE_UNSAFE");
                Require(!message.Contains("synthetic-private-value", StringComparison.Ordinal), "ERROR_PRIVATE_VALUE_DISCLOSED");
            }
            Require(MainForm.HumanError(new TaskCanceledException()).Contains("Ne répétez pas", StringComparison.Ordinal), "TIMEOUT_MESSAGE_UNSAFE");
            Require(MainForm.HumanError(new JsonException()).Contains("Ne répétez pas", StringComparison.Ordinal), "JSON_MESSAGE_UNSAFE");
            Require(!MainForm.HumanError(new Exception()).Contains("Aucun appel n’a été lancé", StringComparison.Ordinal), "ERROR_CLAIMS_NO_CALL");

            Require(ProtocolRequest.TryParse("crmynov-telephony://command/123e4567-e89b-42d3-a456-426614174000", out var protocol)
                && protocol.CommandId == Guid.Parse("123e4567-e89b-42d3-a456-426614174000"), "PROTOCOL_COMMAND_REFUSED");
            Require(ProtocolRequest.TryParse("crmynov-telephony://open", out var openProtocol) && openProtocol.CommandId is null, "PROTOCOL_OPEN_REFUSED");
            Require(!ProtocolRequest.TryParse("crmynov-telephony://command/+212600000165", out _), "PROTOCOL_PHONE_ACCEPTED");
            Require(!ProtocolRequest.TryParse("crmynov-telephony://command/123e4567-e89b-42d3-a456-426614174000?token=secret", out _), "PROTOCOL_QUERY_ACCEPTED");

            if (!string.IsNullOrWhiteSpace(reportPath)) {
                var report = new { generatedAt = DateTimeOffset.UtcNow, passed = true, checks = new[] { "dpapi-roundtrip", "journal-replay-and-ack", "sanitized-diagnostic", "readiness-contract", "call-terminal-state", "dialpad-selection-editing", "crm-address-validation", "cross-origin-profile-isolation", "case-sensitive-gateway-isolation", "maintenance-call-and-event-guards", "persisted-event-maintenance-fence", "protocol-and-free-call-maintenance-fence", "async-profile-mutation-lease", "inflight-command-maintenance-fence", "uncertain-free-call-durable-intent", "exclusive-cli-gui-instance", "honest-uncertain-operation-messages", "opaque-protocol-contract" } };
                File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            }
            return 0;
        }
        catch (Exception error)
        {
            if (!string.IsNullOrWhiteSpace(reportPath)) File.WriteAllText(reportPath, JsonSerializer.Serialize(new { generatedAt = DateTimeOffset.UtcNow, passed = false, errorCode = SafeCode(error) }, new JsonSerializerOptions { WriteIndented = true }));
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { /* the test result remains authoritative even if Windows delays cleanup */ }
        }
    }

    private static void Require(bool condition, string code) { if (!condition) throw new InvalidOperationException(code); }
    private static void RequireCode(Action action, string expected) {
        try { action(); } catch (InvalidOperationException error) {
            Require(error.Message == expected, "UNEXPECTED_GUARD_ERROR"); return;
        }
        throw new InvalidOperationException("GUARD_DID_NOT_REFUSE");
    }
    private static async Task MaintenanceLeaseTestAsync(AgentRuntime runtime)
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var mutation = runtime.WithProfileMaintenanceAsync(async () => { entered.SetResult(); await release.Task; });
        await entered.Task;
        try {
            RequireCode(() => runtime.StartAsync().GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_IN_PROGRESS");
            RequireCode(() => runtime.HandleProtocolCommandAsync(Guid.NewGuid()).GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_IN_PROGRESS");
            RequireCode(() => runtime.StartFreeCallAsync("+212600000000", "OTHER_AUTHORIZED", null).GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_IN_PROGRESS");
            RequireCode(() => runtime.WithProfileMaintenanceAsync(() => Task.CompletedTask).GetAwaiter().GetResult(), "PROFILE_MAINTENANCE_IN_PROGRESS");
        } finally { release.SetResult(); await mutation; }
    }
    private static async Task ActivityFenceTestAsync()
    {
        var fence = new AgentActivityFence();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var command = Task.Run(async () => { using var lease = fence.Command(); entered.SetResult(); await release.Task; });
        await entered.Task;
        try { RequireCode(() => fence.Maintenance().Dispose(), "PROFILE_MAINTENANCE_COMMAND_PENDING"); }
        finally { release.SetResult(); await command; }
        using (var maintenance = fence.Maintenance()) {
            RequireCode(() => fence.Command().Dispose(), "PROFILE_MAINTENANCE_IN_PROGRESS");
            RequireCode(fence.AssertMayStart, "PROFILE_MAINTENANCE_IN_PROGRESS");
        }
        using var next = fence.Command();
    }
    private static void RequireThrows(Action action, string code) { try { action(); } catch (InvalidOperationException) { return; } throw new InvalidOperationException(code); }
    private static string SafeCode(Exception error) => System.Text.RegularExpressions.Regex.IsMatch(error.Message, "^[A-Z0-9_]{3,80}$") ? error.Message : "SELF_TEST_FAILED";
}
