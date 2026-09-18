using System.Text.Json;
using System.Reflection;

namespace CrmYnov.TelephonyAgent;

internal static class DiagnosticsExporter
{
    public static void Export(string path, AgentRuntimeSnapshot snapshot, bool paired, bool secretConfigured)
    {
        var document = new {
            generatedAt = DateTimeOffset.UtcNow,
            agentVersion = typeof(DiagnosticsExporter).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                ?? typeof(DiagnosticsExporter).Assembly.GetName().Version?.ToString()
                ?? "unknown",
            sdkVersion = Linphone.LinphoneWrapper.VERSION,
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
                snapshot.AudioTestActive,
                snapshot.LocalMonitoringActive,
                snapshot.MicrophoneLevel,
                snapshot.LastMicrophonePeak,
                snapshot.MicrophoneSampleCount,
                snapshot.AudioMeterErrorCode,
                audioDeviceCount = snapshot.Devices.Count,
                inputSelected = !string.IsNullOrWhiteSpace(snapshot.InputDeviceId),
                outputSelected = !string.IsNullOrWhiteSpace(snapshot.OutputDeviceId),
                snapshot.InputDeviceAvailable,
                snapshot.OutputDeviceAvailable,
            },
            privacy = "Aucun secret, jeton, numéro, adresse SIP, identifiant de poste ou nom de périphérique n’est exporté.",
        };
        File.WriteAllText(path, JsonSerializer.Serialize(document, new JsonSerializerOptions { WriteIndented = true }));
    }
}
