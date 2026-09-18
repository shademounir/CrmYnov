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

            var ready = new AgentRuntimeSnapshot(true, true, true, true, "SIP_ENREGISTRÉ", null, null, false, 0, [], "input", "output", "Autorisée", true, false, true, true);
            Require(AgentReadiness.IsReady(ready), "READINESS_COMPLETE_PROFILE_REFUSED");
            Require(!AgentReadiness.IsReady(ready with { AuthorizationState = "Révoquée" }), "READINESS_REVOKED_WORKSTATION_ACCEPTED");
            Require(!AgentReadiness.IsReady(ready with { OutputDeviceAvailable = false }), "READINESS_MISSING_OUTPUT_ACCEPTED");

            if (!string.IsNullOrWhiteSpace(reportPath)) {
                var report = new { generatedAt = DateTimeOffset.UtcNow, passed = true, checks = new[] { "dpapi-roundtrip", "journal-replay-and-ack", "sanitized-diagnostic", "readiness-contract" } };
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
    private static string SafeCode(Exception error) => System.Text.RegularExpressions.Regex.IsMatch(error.Message, "^[A-Z0-9_]{3,80}$") ? error.Message : "SELF_TEST_FAILED";
}
