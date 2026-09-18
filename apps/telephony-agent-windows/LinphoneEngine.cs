using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Linphone;

namespace CrmYnov.TelephonyAgent;

internal sealed class LinphoneEngine : IDisposable
{
    private readonly AgentSettings settings;
    private readonly string dataDirectory;
    private readonly HashSet<string> configuredRealms = new(StringComparer.Ordinal);
    private Config? volatileConfig;
    private Core? core;
    private Call? activeCall;
    private string? activeCommandId;
    private string? activeCallId;
    private string? lastState;
    private DateTimeOffset? answeredAt;
    private int? lastDurationSeconds;
    private bool muted;
    private bool stopping;
    public bool SdkLoaded { get; private set; }
    public bool SipRegistered { get; private set; }
    public string? CurrentCallState => lastState;
    public int? CallDurationSeconds => answeredAt is null ? lastDurationSeconds : Math.Max(0, (int)(DateTimeOffset.UtcNow - answeredAt.Value).TotalSeconds);
    public bool Muted => muted;
    public int MicrophoneLevel {
        get {
            if (activeCall is null || lastState != "ANSWERED" || muted) return 0;
            var dbm0 = activeCall.RecordVolume;
            if (float.IsNaN(dbm0) || float.IsInfinity(dbm0) || dbm0 <= -120) return 0;
            return Math.Clamp((int)Math.Round((dbm0 + 60f) / 60f * 100f), 0, 100);
        }
    }
    public event Action<AgentEvent>? EventObserved;
    public event Action<string>? StatusChanged;

    public LinphoneEngine(AgentSettings settings, string dataDirectory) { this.settings = settings; this.dataDirectory = dataDirectory; }
    public IReadOnlyList<AudioDevice> Devices => core?.ExtendedAudioDevices.ToList() ?? [];

    public void Start()
    {
        var factory = Factory.Instance;
        factory.DataDir = dataDirectory;
        factory.ConfigDir = dataDirectory;
        factory.TopResourcesDir = Path.Combine(AppContext.BaseDirectory, "share");
        factory.MspluginsDir = Path.Combine(AppContext.BaseDirectory, "plugins");
        // Do not give Liblinphone a writable configuration file. The account is
        // rebuilt for this process and the SIP secret remains DPAPI-only.
        volatileConfig = factory.CreateConfigFromString(string.Empty);
        core = factory.CreateCoreWithConfig(volatileConfig, IntPtr.Zero);
        var authUser = string.IsNullOrWhiteSpace(settings.AuthUsername) ? ExtractUser(settings.SipAddress) : settings.AuthUsername;
        var digestPolicy = factory.CreateDigestAuthenticationPolicy();
        digestPolicy.AllowMd5 = true;
        digestPolicy.AllowNoQop = true;
        core.DigestAuthenticationPolicy = digestPolicy;
        core.Listener.OnAuthenticationRequested = (_, requested, method) => {
            if (method != AuthMethod.HttpDigest) return;
            StatusChanged?.Invoke("SIP_AUTH_CHALLENGE");
            var requestedAlgorithm = requested.Algorithm?.Trim();
            if (!string.IsNullOrEmpty(requestedAlgorithm) && !requestedAlgorithm.Equals("MD5", StringComparison.OrdinalIgnoreCase)) {
                StatusChanged?.Invoke("SIP_AUTH_ALGORITHM_REFUSED");
                return;
            }
            var realm = requested.Realm?.Trim();
            if (string.IsNullOrEmpty(realm)) {
                StatusChanged?.Invoke("SIP_AUTH_REALM_MISSING");
                return;
            }
            if (!configuredRealms.Add(realm)) return;
            var normalized = factory.CreateAuthInfo(authUser!, authUser!, null!, ComputeHa1(authUser!, realm, settings.SipPassword), realm, settings.SipDomain, "MD5");
            normalized.AvailableAlgorithms = ["MD5"];
            core.AddAuthInfo(normalized);
            StatusChanged?.Invoke("SIP_AUTH_HA1_CONFIGURED");
        };
        core.Listener.OnAccountRegistrationStateChanged = (_, account, state, _) => {
            SipRegistered = state == RegistrationState.Ok;
            if (state == RegistrationState.Failed) {
                var error = account.ErrorInfo;
                StatusChanged?.Invoke($"SIP_FAILED_{error.ProtocolCode}_{error.Reason.ToString().ToUpperInvariant()}");
                return;
            }
            StatusChanged?.Invoke($"SIP_{state.ToString().ToUpperInvariant()}");
        };
        core.Listener.OnCallStateChanged = (_, call, state, _) => OnCallState(call, state);
        core.Listener.OnAudioDevicesListUpdated = _ => StatusChanged?.Invoke("AUDIO_DEVICES_UPDATED");
        core.Start(); SdkLoaded = true;
        var parameters = core.CreateAccountParams();
        parameters.PushNotificationAllowed = false;
        parameters.RemotePushNotificationAllowed = false;
        parameters.IdentityAddress = factory.CreateAddress(settings.SipAddress) ?? throw new InvalidOperationException("SIP_IDENTITY_INVALID");
        var proxy = settings.ProxyUri ?? $"sip:{settings.SipDomain}";
        var server = factory.CreateAddress(proxy) ?? throw new InvalidOperationException("SIP_PROXY_INVALID");
        server.Transport = settings.Transport.ToUpperInvariant() switch { "UDP" => TransportType.Udp, "TCP" => TransportType.Tcp, _ => TransportType.Tls };
        parameters.ServerAddress = server; parameters.RegisterEnabled = true;
        var account = core.CreateAccount(parameters); core.AddAccount(account); core.DefaultAccount = account;
        ApplyDevices(settings.InputDeviceId, settings.OutputDeviceId);
    }

    public void Iterate() => core?.Iterate();
    public void StartCall(AgentCommand command)
    {
        if (core is null || !SipRegistered) throw new InvalidOperationException("SIP_NOT_REGISTERED");
        if (activeCall is not null) throw new InvalidOperationException("WORKSTATION_BUSY");
        activeCommandId = command.CommandId; activeCallId = command.CallId; lastState = null; answeredAt = null; lastDurationSeconds = null; muted = false;
        if (!Regex.IsMatch(command.Destination, @"^\+[1-9]\d{7,14}$", RegexOptions.CultureInvariant)) throw new InvalidOperationException("DESTINATION_INVALID");
        var address = Factory.Instance.CreateAddress($"sip:{command.Destination}@{settings.SipDomain}") ?? throw new InvalidOperationException("DESTINATION_INVALID");
        var callParams = core.CreateCallParams(null!); callParams.VideoEnabled = false;
        activeCall = core.InviteAddressWithParams(address, callParams) ?? throw new InvalidOperationException("SDK_CALL_NOT_CREATED");
    }
    public void Hangup() { if (activeCall is not null) activeCall.Terminate(); }
    public void SetMuted(bool value) { if (activeCall is null) return; activeCall.MicrophoneMuted = value; muted = activeCall.MicrophoneMuted; }
    public void ApplyDevices(string? inputId, string? outputId)
    {
        if (core is null) return;
        var devices = Devices;
        var input = devices.FirstOrDefault(device => device.Id == inputId && device.HasCapability(AudioDeviceCapabilities.CapabilityRecord));
        var output = devices.FirstOrDefault(device => device.Id == outputId && device.HasCapability(AudioDeviceCapabilities.CapabilityPlay));
        if (input is not null) core.InputAudioDevice = input;
        if (output is not null) core.OutputAudioDevice = output;
        if (activeCall is not null) {
            if (input is not null) activeCall.InputAudioDevice = input;
            if (output is not null) activeCall.OutputAudioDevice = output;
        }
    }
    private void OnCallState(Call call, CallState state)
    {
        if (state is CallState.IncomingReceived or CallState.PushIncomingReceived) { call.Decline(Reason.Declined); return; }
        if (activeCommandId is null || activeCallId is null || call != activeCall) return;
        var mapped = state switch {
            CallState.OutgoingInit or CallState.OutgoingProgress => ("DIALING", (string?)null),
            CallState.OutgoingRinging or CallState.OutgoingEarlyMedia => ("RINGING", (string?)null),
            CallState.Connected or CallState.StreamsRunning => ("ANSWERED", (string?)null),
            CallState.Error => ("FAILED", ReasonCode(call.ErrorInfo?.Reason)),
            CallState.End when lastState == "ANSWERED" => ("ENDED", (string?)null),
            CallState.End when call.ErrorInfo?.Reason is Reason.NoResponse or Reason.NotAnswered => ("MISSED", ReasonCode(call.ErrorInfo?.Reason)),
            CallState.End => ("CANCELLED", ReasonCode(call.ErrorInfo?.Reason)),
            _ => ((string?)null, (string?)null),
        };
        if (mapped.Item1 is null || mapped.Item1 == lastState) return;
        lastState = mapped.Item1;
        if (mapped.Item1 == "ANSWERED" && answeredAt is null) answeredAt = DateTimeOffset.UtcNow;
        if (mapped.Item1 is "ENDED" or "FAILED" or "MISSED" or "CANCELLED") {
            lastDurationSeconds = answeredAt is null ? null : Math.Max(0, (int)(DateTimeOffset.UtcNow - answeredAt.Value).TotalSeconds);
        }
        EventObserved?.Invoke(new("1", activeCommandId, activeCallId, $"sdk-{Guid.NewGuid():N}", mapped.Item1, DateTimeOffset.UtcNow, mapped.Item2));
        if (mapped.Item1 is "ENDED" or "FAILED" or "MISSED" or "CANCELLED") { activeCall = null; activeCommandId = null; activeCallId = null; muted = false; }
    }
    private static string? ReasonCode(Reason? reason) => reason switch { Reason.NoResponse => "SDK_NO_RESPONSE", Reason.NotAnswered => "SDK_NOT_ANSWERED", Reason.Busy => "SDK_BUSY", Reason.Declined => "SDK_DECLINED", Reason.Forbidden or Reason.Unauthorized => "SDK_AUTHENTICATION_FAILED", Reason.IOError => "SDK_NETWORK_ERROR", null or Reason.None => null, _ => "SDK_CALL_ERROR" };
    private static string ComputeHa1(string username, string realm, string password)
    {
        using var digest = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
        AppendUtf8(digest, username); AppendUtf8(digest, ":"); AppendUtf8(digest, realm); AppendUtf8(digest, ":"); AppendUtf8(digest, password);
        return Convert.ToHexString(digest.GetHashAndReset()).ToLowerInvariant();
    }
    private static void AppendUtf8(IncrementalHash digest, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        try { digest.AppendData(bytes); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    private static string ExtractUser(string address) { var body = address.StartsWith("sip:", StringComparison.OrdinalIgnoreCase) ? address[4..] : address; return body.Split('@', 2)[0]; }
    public void Dispose()
    {
        if (stopping) return; stopping = true;
        try { activeCall?.Terminate(); core?.Stop(); for (var i = 0; i < 25; i++) { core?.Iterate(); Thread.Sleep(20); } } catch { /* shutdown remains best effort */ }
        configuredRealms.Clear(); activeCall = null; core = null; volatileConfig = null;
    }
}
