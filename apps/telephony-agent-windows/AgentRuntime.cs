using System.Net;

namespace CrmYnov.TelephonyAgent;

internal sealed class AgentRuntime : IAsyncDisposable
{
    private readonly DpapiStore store;
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private readonly object engineGate = new();
    private CancellationTokenSource? cancellation;
    private Task? loop;
    private LinphoneEngine? engine;
    private CrmAgentClient? client;
    private EventJournal? journal;
    private AgentSettings? settings;
    private Queue<AgentEvent> pending = new();
    private readonly SemaphoreSlim commandGate = new(1, 1);
    private bool crmConnected;
    private string authorizationState = "À vérifier";
    private string statusCode = "ARRÊTÉ";

    public AgentRuntime(DpapiStore store) { this.store = store; }
    public event Action<AgentRuntimeSnapshot>? SnapshotChanged;
    public bool Running => cancellation is not null && !cancellation.IsCancellationRequested;
    public AgentRuntimeSnapshot Snapshot => BuildSnapshot();

    public async Task EnsureAudioAsync()
    {
        await lifecycle.WaitAsync().ConfigureAwait(true);
        try
        {
            if (engine is not null) { lock (engineGate) engine.Iterate(); Publish(); return; }
            settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
            store.RemoveLegacyCoreConfig();
            lock (engineGate) {
                engine = CreateEngine(settings);
                engine.StartAudio();
            }
            statusCode = "AUDIO_PRÊT";
            Publish();
        }
        catch
        {
            DisposeEngine();
            throw;
        }
        finally { lifecycle.Release(); }
    }

    public async Task ResetAudioAsync()
    {
        await StopAsync().ConfigureAwait(true);
        await EnsureAudioAsync().ConfigureAwait(true);
    }

    public async Task StartAsync()
    {
        await lifecycle.WaitAsync().ConfigureAwait(true);
        try
        {
            if (Running) return;
            settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
            if (settings.SipPassword.Length == 0) throw new InvalidOperationException("SIP_SECRET_MISSING");
            store.RemoveLegacyCoreConfig();
            lock (engineGate) {
                engine ??= CreateEngine(settings);
                engine.StartAudio();
                engine.ConnectSip();
            }
            journal = new EventJournal(store.JournalPath);
            pending = new Queue<AgentEvent>(journal.Pending);
            client = new CrmAgentClient(settings.ApiBaseUrl, settings.AgentToken);
            cancellation = new CancellationTokenSource();
            crmConnected = false;
            authorizationState = "À vérifier";
            statusCode = "CONNEXION_CRM";
            Publish();
            loop = RunLoopAsync(cancellation.Token);
        }
        catch
        {
            await DisposeRuntimeAsync().ConfigureAwait(true);
            throw;
        }
        finally { lifecycle.Release(); }
    }

    public async Task StopAsync()
    {
        await lifecycle.WaitAsync().ConfigureAwait(true);
        try
        {
            cancellation?.Cancel();
            if (loop is not null)
            {
                try { await loop.ConfigureAwait(true); }
                catch (OperationCanceledException) { }
            }
            await DisposeRuntimeAsync().ConfigureAwait(true);
            statusCode = "ARRÊTÉ";
            crmConnected = false;
            authorizationState = "À vérifier";
            Publish();
        }
        finally { lifecycle.Release(); }
    }

    public void TickAudio()
    {
        if (Running || engine is null) return;
        lock (engineGate) engine.Iterate();
        Publish();
    }

    public void Hangup() { lock (engineGate) engine?.Hangup(); }
    public void SetMuted(bool muted) { lock (engineGate) engine?.SetMuted(muted); Publish(); }

    public void ApplyDevices(string? inputId, string? outputId)
    {
        settings ??= store.Load();
        if (settings is null) throw new InvalidOperationException("AGENT_NOT_PAIRED");
        settings = settings with { InputDeviceId = inputId, OutputDeviceId = outputId };
        store.Save(settings);
        lock (engineGate) engine?.ApplyDevices(inputId, outputId);
        Publish();
    }

    public void RefreshAudioDevices()
    {
        if (engine is null) throw new InvalidOperationException("AUDIO_NOT_INITIALIZED");
        lock (engineGate) {
            engine.ReloadAudioDevices();
            engine.Iterate();
        }
        Publish();
    }

    public void StartMicrophoneTest(bool localMonitoring = false)
    {
        if (engine is null) throw new InvalidOperationException("AUDIO_NOT_INITIALIZED");
        lock (engineGate) engine.StartMicrophoneTest(localMonitoring);
        Publish();
    }

    public void StopMicrophoneTest()
    {
        lock (engineGate) engine?.StopMicrophoneTest();
        Publish();
    }

    public void PlayOutputTest()
    {
        if (engine is null) throw new InvalidOperationException("AUDIO_NOT_INITIALIZED");
        lock (engineGate) engine.PlayOutputTest();
        Publish();
    }

    public async Task HandleProtocolCommandAsync(Guid commandId)
    {
        if (!Running) await StartAsync().ConfigureAwait(true);
        var readyDeadline = DateTimeOffset.UtcNow.AddSeconds(12);
        while (!AgentReadiness.IsReady(BuildSnapshot()) && DateTimeOffset.UtcNow < readyDeadline)
            await Task.Delay(100).ConfigureAwait(true);
        if (!AgentReadiness.IsReady(BuildSnapshot())) throw new InvalidOperationException("AGENT_NOT_READY");
        await commandGate.WaitAsync().ConfigureAwait(true);
        try
        {
            if (client is null || journal is null || engine is null) throw new InvalidOperationException("AGENT_NOT_CONNECTED");
            var response = await client.ClaimAsync(commandId, CancellationToken.None).ConfigureAwait(true);
            MarkCrmSuccess();
            RefreshProfileIdentity(response.Profile);
            if (response.Command is null) throw new InvalidOperationException("AGENT_COMMAND_MISSING");
            await ExecuteCommandAsync(response.Command, CancellationToken.None).ConfigureAwait(true);
        }
        catch (HttpRequestException error) { HandleTransportError(error); throw; }
        finally { commandGate.Release(); }
    }

    public async Task StartFreeCallAsync(string phone, string purposeCode, string? comment)
    {
        if (!Running || !AgentReadiness.IsReady(BuildSnapshot())) throw new InvalidOperationException("AGENT_NOT_READY");
        if (client is null) throw new InvalidOperationException("AGENT_NOT_CONNECTED");
        var idempotencyKey = $"free-{Guid.NewGuid():N}";
        var created = await client.CreateFreeCallAsync(new FreeCallRequest(phone, purposeCode, string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(), idempotencyKey), CancellationToken.None).ConfigureAwait(true);
        if (!Guid.TryParse(created.ExternalId, out var commandId)) throw new InvalidOperationException("AGENT_COMMAND_INVALID");
        await HandleProtocolCommandAsync(commandId).ConfigureAwait(true);
    }

    private LinphoneEngine CreateEngine(AgentSettings current)
    {
        var next = new LinphoneEngine(current, store.DataDirectory);
        next.EventObserved += OnEventObserved;
        next.StatusChanged += OnEngineStatus;
        return next;
    }

    private async Task RunLoopAsync(CancellationToken token)
    {
        try
        {
            var nextPoll = DateTimeOffset.MinValue;
            var nextStatus = DateTimeOffset.MinValue;
            var nextUi = DateTimeOffset.MinValue;
            while (!token.IsCancellationRequested)
            {
                lock (engineGate) engine?.Iterate();
                var now = DateTimeOffset.UtcNow;
                if (now >= nextStatus) {
                    await SendStatusAsync(token).ConfigureAwait(true);
                    nextStatus = now.AddSeconds(10);
                }
                await SendPendingEventAsync(token).ConfigureAwait(true);
                if (now >= nextPoll) {
                    await PollAsync(token).ConfigureAwait(true);
                    nextPoll = now.AddSeconds(2);
                }
                if (now >= nextUi) { Publish(); nextUi = now.AddMilliseconds(150); }
                await Task.Delay(20, token).ConfigureAwait(true);
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch
        {
            try { lock (engineGate) { engine?.Hangup(); engine?.Dispose(); engine = null; } } catch { engine = null; }
            client?.Dispose(); client = null;
            crmConnected = false;
            statusCode = "AGENT_ÉCHEC";
            cancellation?.Cancel();
            Publish();
        }
    }

    private async Task SendStatusAsync(CancellationToken token)
    {
        if (client is null || engine is null || settings is null) return;
        try
        {
            var snapshot = BuildSnapshot();
            await client.SendStatusAsync(new(
                snapshot.SipRegistered && snapshot.InputDeviceAvailable && snapshot.OutputDeviceAvailable ? "CONNECTED" : "UNAVAILABLE",
                engine.SdkLoaded, engine.SipRegistered,
                settings.InputDeviceId, settings.OutputDeviceId,
                engine.SipRegistered ? null : "SIP_NOT_REGISTERED"), token).ConfigureAwait(true);
            MarkCrmSuccess();
        }
        catch (HttpRequestException error) { HandleTransportError(error); }
    }

    private async Task SendPendingEventAsync(CancellationToken token)
    {
        if (client is null || journal is null || pending.Count == 0) return;
        var item = pending.Dequeue();
        try
        {
            await client.SendEventAsync(item, token).ConfigureAwait(true);
            journal.Acknowledge(item);
            MarkCrmSuccess();
        }
        catch (HttpRequestException error)
        {
            pending.Enqueue(item);
            HandleTransportError(error);
            await Task.Delay(500, token).ConfigureAwait(true);
        }
    }

    private async Task PollAsync(CancellationToken token)
    {
        if (client is null || journal is null || engine is null) return;
        try
        {
            var response = await client.PollAsync(token).ConfigureAwait(true);
            MarkCrmSuccess();
            RefreshProfileIdentity(response.Profile);
            if (response.Command is not null) await ExecuteCommandAsync(response.Command, token).ConfigureAwait(true);
        }
        catch (HttpRequestException error) { HandleTransportError(error); }
    }

    private async Task ExecuteCommandAsync(AgentCommand command, CancellationToken token)
    {
        if (journal is null || engine is null) return;
        if (command.HangupRequested) { lock (engineGate) engine.Hangup(); return; }
        if (command.ExpiresAt <= DateTimeOffset.UtcNow) { await RejectAsync(command, "COMMAND_EXPIRED", token).ConfigureAwait(true); return; }
        // Polling and protocol activation may legitimately deliver the same
        // command. The local journal is the final no-redial guard.
        if (journal.HasSeen(command.CommandId)) return;
        journal.MarkCommand(command.CommandId);
        try { lock (engineGate) engine.StartCall(command); }
        catch (InvalidOperationException error) { await RejectAsync(command, SafeCode(error), token).ConfigureAwait(true); }
    }

    private async Task RejectAsync(AgentCommand command, string reason, CancellationToken token)
    {
        if (client is null || journal is null) return;
        var item = new AgentEvent("1", command.CommandId, command.CallId, $"agent-{Guid.NewGuid():N}", "FAILED", DateTimeOffset.UtcNow, reason);
        journal.Add(item);
        pending.Enqueue(item);
        await SendPendingEventAsync(token).ConfigureAwait(true);
    }

    private void MarkCrmSuccess()
    {
        crmConnected = true;
        authorizationState = "Autorisée";
    }

    private void RefreshProfileIdentity(AgentProfile profile)
    {
        if (settings is null) return;
        if (settings.CrmDisplayName == profile.CrmDisplayName && settings.CrmEmail == profile.CrmEmail) return;
        settings = settings with { CrmDisplayName = profile.CrmDisplayName, CrmEmail = profile.CrmEmail };
        store.Save(settings);
    }

    private void HandleTransportError(HttpRequestException error)
    {
        crmConnected = false;
        if (error.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) {
            authorizationState = "Révoquée";
            statusCode = "POSTE_RÉVOQUÉ";
        } else statusCode = "CRM_INJOIGNABLE";
        Publish();
    }

    private void OnEventObserved(AgentEvent item)
    {
        journal?.Add(item);
        pending.Enqueue(item);
        Publish();
    }

    private void OnEngineStatus(string state)
    {
        statusCode = TranslateState(state);
        Publish();
    }

    private AgentRuntimeSnapshot BuildSnapshot()
    {
        lock (engineGate)
        {
            var devices = engine?.Devices.Select(device => new AudioDeviceView(
                device.Id, device.DeviceName,
                device.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityRecord),
                device.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityPlay))).ToArray() ?? [];
            var inputAvailable = !string.IsNullOrWhiteSpace(settings?.InputDeviceId)
                && devices.Any(device => device.Id == settings.InputDeviceId && device.CanRecord);
            var outputAvailable = !string.IsNullOrWhiteSpace(settings?.OutputDeviceId)
                && devices.Any(device => device.Id == settings.OutputDeviceId && device.CanPlay);
            return new AgentRuntimeSnapshot(
                Running, crmConnected, engine?.SdkLoaded == true, engine?.SipRegistered == true,
                statusCode, engine?.CurrentCallState, engine?.CallDurationSeconds, engine?.Muted == true,
                engine?.MicrophoneLevel ?? 0, devices, settings?.InputDeviceId, settings?.OutputDeviceId,
                authorizationState, engine?.SdkLoaded == true, engine?.AudioTestActive == true,
                inputAvailable, outputAvailable, settings?.CrmDisplayName, settings?.CrmEmail,
                engine?.LastMicrophonePeak ?? 0, engine?.MicrophoneSampleCount ?? 0, engine?.AudioMeterErrorCode,
                engine?.LocalMonitoringActive == true);
        }
    }

    private void Publish() => SnapshotChanged?.Invoke(BuildSnapshot());

    private void DisposeEngine()
    {
        lock (engineGate)
        {
            if (engine is null) return;
            engine.EventObserved -= OnEventObserved;
            engine.StatusChanged -= OnEngineStatus;
            engine.Dispose();
            engine = null;
        }
    }

    private async Task DisposeRuntimeAsync()
    {
        DisposeEngine();
        client?.Dispose();
        cancellation?.Dispose();
        client = null; cancellation = null; loop = null; journal = null;
        crmConnected = false;
        await Task.CompletedTask;
    }

    private static string SafeCode(Exception error) => System.Text.RegularExpressions.Regex.IsMatch(error.Message, "^[A-Z0-9_]{3,80}$") ? error.Message : "AGENT_OPERATION_FAILED";
    private static string TranslateState(string state) => state switch {
        "SIP_OK" => "SIP_ENREGISTRÉ",
        "SIP_PROGRESS" => "SIP_CONNEXION",
        "SIP_AUTH_CHALLENGE" => "SIP_AUTHENTIFICATION",
        "SIP_AUTH_HA1_CONFIGURED" => "SIP_IDENTIFIANTS_APPLIQUÉS",
        "SIP_CLEARED" => "SIP_DÉCONNECTÉ",
        "AUDIO_READY" => "AUDIO_PRÊT",
        "AUDIO_DEVICES_UPDATED" => "PÉRIPHÉRIQUES_ACTUALISÉS",
        "AUDIO_MIC_TEST_RUNNING" => "TEST_MICRO_ACTIF",
        "AUDIO_MIC_TEST_STOPPED" => "TEST_MICRO_TERMINÉ",
        "AUDIO_OUTPUT_TEST_PLAYING" => "TEST_SORTIE_ACTIF",
        "AUDIO_INPUT_UNAVAILABLE" => "MICROPHONE_DÉCONNECTÉ",
        "AUDIO_OUTPUT_UNAVAILABLE" => "SORTIE_DÉCONNECTÉE",
        "AUDIO_DEVICE_NOT_CONFIGURED" => "AUDIO_À_CONFIGURER",
        "AUDIO_DEVICE_REMOVED_DURING_CALL" => "PÉRIPHÉRIQUE_RETIRÉ_PENDANT_APPEL",
        _ when state.StartsWith("SIP_FAILED", StringComparison.Ordinal) => "SIP_ÉCHEC",
        _ => state,
    };

    public async ValueTask DisposeAsync() { await StopAsync().ConfigureAwait(true); lifecycle.Dispose(); commandGate.Dispose(); }
}
