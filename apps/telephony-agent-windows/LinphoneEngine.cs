using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Linphone;

namespace CrmYnov.TelephonyAgent;

internal sealed class LinphoneEngine : IDisposable
{
    private AgentSettings settings;
    private readonly string dataDirectory;
    private readonly HashSet<string> configuredRealms = new(StringComparer.Ordinal);
    private readonly WindowsAudioPeakMeter peakMeter = new();
    private readonly WindowsAudioSamplePlayer samplePlayer = new();
    private Config? volatileConfig;
    private Core? core;
    private Account? account;
    private Player? localPlayer;
    private Call? activeCall;
    private string? activeCommandId;
    private string? activeCallId;
    private string? lastState;
    private DateTimeOffset? answeredAt;
    private int? lastDurationSeconds;
    private bool muted;
    private bool stopping;
    private bool replayCapturedSample;
    public bool SdkLoaded { get; private set; }
    public bool SipRegistered { get; private set; }
    public string? CurrentCallState => lastState;
    public int? CallDurationSeconds => answeredAt is null ? lastDurationSeconds : Math.Max(0, (int)(DateTimeOffset.UtcNow - answeredAt.Value).TotalSeconds);
    public bool Muted => muted;
    public bool AudioTestActive => peakMeter.IsRunning || samplePlayer.IsPlaying;
    public bool LocalMonitoringActive => samplePlayer.IsPlaying;
    public int LastMicrophonePeak => peakMeter.LastPeakPercent;
    public long MicrophoneSampleCount => peakMeter.SampleCount;
    public string? AudioMeterErrorCode => peakMeter.ErrorCode;
    public int MicrophoneLevel {
        get {
            if (peakMeter.IsRunning) return peakMeter.ReadPercent();
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

    public void StartAudio()
    {
        if (core is not null) return;
        var factory = Factory.Instance;
        factory.DataDir = dataDirectory;
        factory.ConfigDir = dataDirectory;
        factory.TopResourcesDir = Path.Combine(AppContext.BaseDirectory, "share");
        factory.MspluginsDir = Path.Combine(AppContext.BaseDirectory, "plugins");
        // Do not give Liblinphone a writable configuration file. The account is
        // rebuilt for this process and the SIP secret remains DPAPI-only.
        volatileConfig = factory.CreateConfigFromString(string.Empty);
        core = factory.CreateCoreWithConfig(volatileConfig, IntPtr.Zero);
        ConfigureCallAudioProcessing();
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
        core.Listener.OnAudioDevicesListUpdated = _ => {
            ApplyDevices(settings.InputDeviceId, settings.OutputDeviceId);
            var missing = MissingSelectedDevice();
            if (missing is not null && activeCall is not null) {
                StatusChanged?.Invoke("AUDIO_DEVICE_REMOVED_DURING_CALL");
                activeCall.Terminate();
            } else StatusChanged?.Invoke(missing ?? "AUDIO_DEVICES_UPDATED");
        };
        core.Start(); SdkLoaded = true;
        ApplyDevices(settings.InputDeviceId, settings.OutputDeviceId);
        StatusChanged?.Invoke("AUDIO_READY");
    }

    public void ConnectSip()
    {
        StartAudio();
        if (account is not null) return;
        if (settings.SipPassword.Length == 0) throw new InvalidOperationException("SIP_SECRET_MISSING");
        var factory = Factory.Instance;
        var parameters = core.CreateAccountParams();
        parameters.PushNotificationAllowed = false;
        parameters.RemotePushNotificationAllowed = false;
        parameters.IdentityAddress = factory.CreateAddress(settings.SipAddress) ?? throw new InvalidOperationException("SIP_IDENTITY_INVALID");
        var proxy = settings.ProxyUri ?? $"sip:{settings.SipDomain}";
        var server = factory.CreateAddress(proxy) ?? throw new InvalidOperationException("SIP_PROXY_INVALID");
        server.Transport = settings.Transport.ToUpperInvariant() switch { "UDP" => TransportType.Udp, "TCP" => TransportType.Tcp, _ => TransportType.Tls };
        parameters.ServerAddress = server; parameters.RegisterEnabled = true;
        account = core.CreateAccount(parameters); core.AddAccount(account); core.DefaultAccount = account;
        ApplyDevices(settings.InputDeviceId, settings.OutputDeviceId);
    }

    public void Start() { StartAudio(); ConnectSip(); }

    public void Iterate() => core?.Iterate();
    public void StartCall(AgentCommand command)
    {
        if (core is null || !SipRegistered) throw new InvalidOperationException("SIP_NOT_REGISTERED");
        if (activeCall is not null) throw new InvalidOperationException("WORKSTATION_BUSY");
        if (peakMeter.IsPoisoned) throw new InvalidOperationException("AUDIO_CAPTURE_RESTART_REQUIRED");
        if (peakMeter.IsRunning || samplePlayer.IsPlaying) throw new InvalidOperationException("AUDIO_TEST_ACTIVE");
        var missing = MissingSelectedDevice();
        if (missing is not null) throw new InvalidOperationException(missing);
        if (!Regex.IsMatch(command.Destination, @"^\+[1-9]\d{7,14}$", RegexOptions.CultureInvariant)) throw new InvalidOperationException("DESTINATION_INVALID");
        var address = Factory.Instance.CreateAddress($"sip:{command.Destination}@{settings.SipDomain}") ?? throw new InvalidOperationException("DESTINATION_INVALID");
        var callParams = core.CreateCallParams(null!); callParams.VideoEnabled = false;
        var createdCall = core.InviteAddressWithParams(address, callParams) ?? throw new InvalidOperationException("SDK_CALL_NOT_CREATED");
        // Keep this explicit at call level as well: it prevents a profile or
        // backend default from silently re-enabling the experimental limiter.
        createdCall.EchoCancellationEnabled = true;
        createdCall.EchoLimiterEnabled = false;
        activeCommandId = command.CommandId; activeCallId = command.CallId; lastState = null; answeredAt = null; lastDurationSeconds = null; muted = false;
        activeCall = createdCall;
    }
    public void Hangup() { if (activeCall is not null) activeCall.Terminate(); }
    public void SetMuted(bool value) { if (activeCall is null) return; activeCall.MicrophoneMuted = value; muted = activeCall.MicrophoneMuted; }
    public void ApplyDevices(string? inputId, string? outputId)
    {
        if (core is null) return;
        if (peakMeter.IsRunning || samplePlayer.IsPlaying) StopMicrophoneTest();
        settings = settings with { InputDeviceId = inputId, OutputDeviceId = outputId };
        var devices = Devices;
        var input = devices.FirstOrDefault(device => device.Id == inputId && device.HasCapability(AudioDeviceCapabilities.CapabilityRecord));
        var output = devices.FirstOrDefault(device => device.Id == outputId && device.HasCapability(AudioDeviceCapabilities.CapabilityPlay));
        if (input is not null) core.InputAudioDevice = input;
        if (output is not null) core.OutputAudioDevice = output;
        if (!peakMeter.Select(input?.Id, input?.DeviceName) && input is not null)
            StatusChanged?.Invoke(peakMeter.ErrorCode ?? "AUDIO_CAPTURE_MAPPING_UNRESOLVED");
        _ = samplePlayer.Select(output?.Id, output?.DeviceName);
        if (activeCall is not null) {
            if (input is not null) activeCall.InputAudioDevice = input;
            if (output is not null) activeCall.OutputAudioDevice = output;
        }
    }

    public void ReloadAudioDevices()
    {
        core?.ReloadSoundDevices();
        ApplyDevices(settings.InputDeviceId, settings.OutputDeviceId);
    }

    public void StartMicrophoneTest(bool localMonitoring = false)
    {
        if (core is null) throw new InvalidOperationException("AUDIO_NOT_INITIALIZED");
        if (activeCall is not null) throw new InvalidOperationException("AUDIO_TEST_CALL_ACTIVE");
        var missingInput = MissingSelectedInputDevice();
        if (missingInput is not null) throw new InvalidOperationException(missingInput);
        if (localMonitoring && (MissingSelectedDevice() is not null || !samplePlayer.SelectionValid)) throw new InvalidOperationException("AUDIO_PLAYBACK_MAPPING_UNRESOLVED");
        if (peakMeter.IsRunning || samplePlayer.IsPlaying) return;
        replayCapturedSample = localMonitoring;
        if (!peakMeter.Start(retainForPlayback: localMonitoring)) throw new InvalidOperationException(peakMeter.ErrorCode ?? "AUDIO_MICROPHONE_OPEN_FAILED");
        StatusChanged?.Invoke("AUDIO_MIC_TEST_RUNNING");
    }

    public void StopMicrophoneTest()
    {
        if (samplePlayer.IsPlaying)
        {
            samplePlayer.Stop();
            StatusChanged?.Invoke("AUDIO_LOCAL_PLAYBACK_STOPPED");
            return;
        }
        if (!peakMeter.IsRunning && peakMeter.ErrorCode is null) return;
        peakMeter.Stop();
        var sample = peakMeter.TakeRetainedSample();
        var shouldReplay = replayCapturedSample;
        replayCapturedSample = false;
        StatusChanged?.Invoke("AUDIO_MIC_TEST_STOPPED");
        if (shouldReplay)
        {
            if (sample is null) throw new InvalidOperationException("AUDIO_PLAYBACK_SAMPLE_EMPTY");
            if (!samplePlayer.Play(sample)) throw new InvalidOperationException(samplePlayer.ErrorCode ?? "AUDIO_PLAYBACK_FAILED");
            StatusChanged?.Invoke("AUDIO_LOCAL_PLAYBACK_RUNNING");
        }
        else sample?.Dispose();
    }

    public void PlayOutputTest()
    {
        if (core is null) throw new InvalidOperationException("AUDIO_NOT_INITIALIZED");
        if (activeCall is not null) throw new InvalidOperationException("AUDIO_TEST_CALL_ACTIVE");
        if (peakMeter.IsRunning || samplePlayer.IsPlaying) throw new InvalidOperationException("AUDIO_TEST_ACTIVE");
        var output = Devices.FirstOrDefault(device => device.Id == settings.OutputDeviceId && device.HasCapability(AudioDeviceCapabilities.CapabilityPlay));
        if (output is null) throw new InvalidOperationException("AUDIO_OUTPUT_UNAVAILABLE");
        localPlayer?.Close();
        // CreateLocalPlayer expects the sound-card identifier understood by
        // mediastreamer, not the human-readable label displayed in the UI.
        localPlayer = core.CreateLocalPlayer(output.Id, null!, IntPtr.Zero) ?? throw new InvalidOperationException("AUDIO_PLAYER_UNAVAILABLE");
        var path = EnsureOutputTestTone();
        localPlayer.Open(path);
        localPlayer.Start();
        StatusChanged?.Invoke("AUDIO_OUTPUT_TEST_PLAYING");
    }

    private string? MissingSelectedDevice()
    {
        if (string.IsNullOrWhiteSpace(settings.InputDeviceId) || string.IsNullOrWhiteSpace(settings.OutputDeviceId)) return "AUDIO_DEVICE_NOT_CONFIGURED";
        var devices = Devices;
        if (!devices.Any(device => device.Id == settings.InputDeviceId && device.HasCapability(AudioDeviceCapabilities.CapabilityRecord))) return "AUDIO_INPUT_UNAVAILABLE";
        if (!devices.Any(device => device.Id == settings.OutputDeviceId && device.HasCapability(AudioDeviceCapabilities.CapabilityPlay))) return "AUDIO_OUTPUT_UNAVAILABLE";
        return null;
    }

    private void ConfigureCallAudioProcessing()
    {
        if (core is null) return;
        // The validated headset path had a small residual echo and light
        // broadband hiss. Use Liblinphone's documented software AEC and noise
        // suppression, keep gains neutral, and avoid the experimental echo
        // limiter (half-duplex) and AGC, which can pump background noise.
        core.EchoCancellationEnabled = true;
        core.NoiseSuppressionEnabled = true;
        core.EchoLimiterEnabled = false;
        core.AgcEnabled = false;
        core.GenericComfortNoiseEnabled = false;
        core.MicGainDb = 0f;
        core.PlaybackGainDb = 0f;
    }

    private string? MissingSelectedInputDevice()
    {
        if (string.IsNullOrWhiteSpace(settings.InputDeviceId)) return "AUDIO_DEVICE_NOT_CONFIGURED";
        return Devices.Any(device => device.Id == settings.InputDeviceId && device.HasCapability(AudioDeviceCapabilities.CapabilityRecord))
            ? null
            : "AUDIO_INPUT_UNAVAILABLE";
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
            // Freeze the observed duration. Keeping answeredAt populated would
            // make the UI timer continue after Liblinphone has ended the call.
            answeredAt = null;
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

    private string EnsureOutputTestTone()
    {
        var path = Path.Combine(dataDirectory, "output-test-48000-stereo.wav");
        if (File.Exists(path)) return path;
        Directory.CreateDirectory(dataDirectory);
        const int sampleRate = 48000;
        const short channels = 2;
        const short bitsPerSample = 16;
        const double durationSeconds = 0.8;
        var sampleFrames = (int)(sampleRate * durationSeconds);
        var dataBytes = sampleFrames * channels * (bitsPerSample / 8);
        using var stream = File.Create(path);
        using var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: false);
        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(36 + dataBytes);
        writer.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
        writer.Write(16);
        writer.Write((short)1);
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(sampleRate * channels * (bitsPerSample / 8));
        writer.Write((short)(channels * (bitsPerSample / 8)));
        writer.Write(bitsPerSample);
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(dataBytes);
        for (var frame = 0; frame < sampleFrames; frame++) {
            var envelope = Math.Min(1d, frame / (sampleRate * 0.02d)) * Math.Min(1d, (sampleFrames - frame) / (sampleRate * 0.04d));
            var sample = (short)(Math.Sin(2d * Math.PI * 440d * frame / sampleRate) * short.MaxValue * 0.18d * envelope);
            writer.Write(sample);
            writer.Write(sample);
        }
        return path;
    }

    public void Dispose()
    {
        if (stopping) return; stopping = true;
        try { StopMicrophoneTest(); } catch { /* continue with core shutdown */ }
        try { localPlayer?.Close(); } catch { /* continue with core shutdown */ }
        try { activeCall?.Terminate(); } catch { /* continue with core shutdown */ }
        try {
            core?.Stop();
            for (var i = 0; i < 25; i++) { core?.Iterate(); Thread.Sleep(20); }
        } catch { /* shutdown remains best effort */ }
        peakMeter.Dispose(); samplePlayer.Dispose(); configuredRealms.Clear(); activeCall = null; account = null; localPlayer = null; core = null; volatileConfig = null;
    }
}
