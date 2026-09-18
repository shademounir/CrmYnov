using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal static class DiagnosticsExporter
{
    public static void Export(string path, AgentRuntimeSnapshot snapshot, bool paired, bool secretConfigured)
    {
        var document = new {
            generatedAt = DateTimeOffset.UtcNow,
            agentVersion = "0.2.0-pilot",
            sdkVersion = "5.5.21",
            operatingSystem = Environment.OSVersion.VersionString,
            architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
            paired,
            secretConfigured,
            runtime = new {
                snapshot.Running,
                snapshot.CrmConnected,
                snapshot.SdkLoaded,
                snapshot.SipRegistered,
                snapshot.StatusCode,
                snapshot.CallState,
                snapshot.CallDurationSeconds,
                snapshot.Muted,
                audioDeviceCount = snapshot.Devices.Count,
                inputSelected = !string.IsNullOrWhiteSpace(snapshot.InputDeviceId),
                outputSelected = !string.IsNullOrWhiteSpace(snapshot.OutputDeviceId),
            },
            privacy = "Aucun secret, jeton, numéro, adresse SIP, identifiant de poste ou nom de périphérique n’est exporté.",
        };
        File.WriteAllText(path, JsonSerializer.Serialize(document, new JsonSerializerOptions { WriteIndented = true }));
    }
}
