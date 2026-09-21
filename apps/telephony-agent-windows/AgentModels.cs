using System.Text.Json.Serialization;

namespace CrmYnov.TelephonyAgent;

internal sealed record AgentSettings(
    string ApiBaseUrl,
    string AgentToken,
    string WorkstationId,
    string ProfileId,
    string SipAddress,
    string? AuthUsername,
    string SipDomain,
    string? ProxyUri,
    string Transport,
    string SipPassword,
    string? InputDeviceId,
    string? OutputDeviceId,
    string? CrmDisplayName = null,
    string? CrmEmail = null,
    string? WorkstationDisplayName = null);

internal sealed record PairRequest(string Code, string PublicId, string DisplayName, string AgentVersion, string SdkVersion);
internal sealed record PairResponse(string Token, string WorkstationId, AgentProfile Profile);
internal sealed record AgentProfile(string Id, string WorkstationId, string SipAddress, string? AuthUsername, AgentServer Server, bool InboundEnabled, bool RecordingEnabled, string? CrmDisplayName = null, string? CrmEmail = null);
internal sealed record AgentServer(string SipDomain, string? ProxyUri, string Transport);
internal sealed record PollResponse(AgentProfile Profile, AgentCommand? Command);
internal sealed record AgentCommand(string CommandId, string CallId, string Destination, DateTimeOffset ExpiresAt, int MaxDurationSeconds, bool HangupRequested);
internal sealed record FreeCallRequest(string Phone, string PurposeCode, string? Comment, string IdempotencyKey);
internal sealed record FreeCallResponse(string Id, string ExternalId, string State, string DispatchState, string MaskedPhone);
internal sealed record AgentStatus(string ConnectionState, bool SdkLoaded, bool SipRegistered, string? InputDeviceId, string? OutputDeviceId, string? ErrorCode);
internal sealed record AgentEvent(string SchemaVersion, string CommandId, string CallId, string EventId, string State, DateTimeOffset OccurredAt, string? ReasonCode);
internal sealed record JournalRecord(string Kind, string CommandId, string? EventId, string? CallId, string? State, DateTimeOffset At, bool? Acknowledged, string? ReasonCode = null);

internal sealed record AudioDeviceView(string Id, string Name, bool CanRecord, bool CanPlay);
internal sealed record AgentRuntimeSnapshot(
    bool Running,
    bool CrmConnected,
    bool SdkLoaded,
    bool SipRegistered,
    string StatusCode,
    string? CallState,
    int? CallDurationSeconds,
    bool Muted,
    int MicrophoneLevel,
    IReadOnlyList<AudioDeviceView> Devices,
    string? InputDeviceId,
    string? OutputDeviceId,
    string AuthorizationState = "À vérifier",
    bool AudioInitialized = false,
    bool AudioTestActive = false,
    bool InputDeviceAvailable = false,
    bool OutputDeviceAvailable = false,
    string? CrmDisplayName = null,
    string? CrmEmail = null,
    int LastMicrophonePeak = 0,
    long MicrophoneSampleCount = 0,
    string? AudioMeterErrorCode = null,
    bool LocalMonitoringActive = false);

internal static class AgentReadiness
{
    public static bool IsReady(AgentRuntimeSnapshot snapshot) =>
        snapshot.Running
        && snapshot.CrmConnected
        && snapshot.AuthorizationState == "Autorisée"
        && snapshot.SipRegistered
        && snapshot.InputDeviceAvailable
        && snapshot.OutputDeviceAvailable;
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(AgentSettings))]
[JsonSerializable(typeof(PairRequest))]
[JsonSerializable(typeof(PairResponse))]
[JsonSerializable(typeof(PollResponse))]
[JsonSerializable(typeof(AgentStatus))]
[JsonSerializable(typeof(AgentEvent))]
[JsonSerializable(typeof(FreeCallRequest))]
[JsonSerializable(typeof(FreeCallResponse))]
[JsonSerializable(typeof(JournalRecord))]
internal partial class AgentJsonContext : JsonSerializerContext;
