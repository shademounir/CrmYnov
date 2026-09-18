using System.Net;

namespace CrmYnov.TelephonyAgent;

internal sealed class AgentRuntime : IAsyncDisposable
{
    private readonly DpapiStore store;
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private CancellationTokenSource? cancellation;
    private Task? loop;
    private LinphoneEngine? engine;
    private CrmAgentClient? client;
    private EventJournal? journal;
    private AgentSettings? settings;
    private Queue<AgentEvent> pending = new();
    private bool crmConnected;
    private string statusCode = "ARRÊTÉ";

    public AgentRuntime(DpapiStore store) { this.store = store; }
    public event Action<AgentRuntimeSnapshot>? SnapshotChanged;
    public bool Running => cancellation is not null && !cancellation.IsCancellationRequested;

    public AgentRuntimeSnapshot Snapshot => BuildSnapshot();

    public async Task StartAsync()
    {
        await lifecycle.WaitAsync().ConfigureAwait(true);
        try
        {
            if (Running) return;
            settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
            if (settings.SipPassword.Length == 0) throw new InvalidOperationException("SIP_SECRET_MISSING");
            store.RemoveLegacyCoreConfig();
            journal = new EventJournal(store.JournalPath);
            pending = new Queue<AgentEvent>(journal.Pending);
            client = new CrmAgentClient(settings.ApiBaseUrl, settings.AgentToken);
            engine = new LinphoneEngine(settings, store.DataDirectory);
            engine.EventObserved += OnEventObserved;
            engine.StatusChanged += OnEngineStatus;
            engine.Start();
            cancellation = new CancellationTokenSource();
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
            Publish();
        }
        finally { lifecycle.Release(); }
    }

    public void Hangup() => engine?.Hangup();
    public void SetMuted(bool muted) { engine?.SetMuted(muted); Publish(); }

    public void ApplyDevices(string? inputId, string? outputId)
    {
        if (settings is null || engine is null) return;
        settings = settings with { InputDeviceId = inputId, OutputDeviceId = outputId };
        store.Save(settings);
        engine.ApplyDevices(inputId, outputId);
        Publish();
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
                engine?.Iterate();
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
                if (now >= nextUi) { Publish(); nextUi = now.AddMilliseconds(250); }
                await Task.Delay(20, token).ConfigureAwait(true);
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch {
            // Fail closed: after an unexpected SDK/runtime error no additional
            // command may be claimed or dialled until the user restarts the agent.
            try { engine?.Hangup(); engine?.Dispose(); } catch { }
            engine = null;
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
            await client.SendStatusAsync(new(
                engine.SipRegistered ? "CONNECTED" : "UNAVAILABLE",
                engine.SdkLoaded, engine.SipRegistered,
                settings.InputDeviceId, settings.OutputDeviceId,
                engine.SipRegistered ? null : "SIP_NOT_REGISTERED"), token).ConfigureAwait(true);
            crmConnected = true;
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
            crmConnected = true;
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
            crmConnected = true;
            var command = response.Command;
            if (command is null) return;
            if (command.HangupRequested) { engine.Hangup(); return; }
            if (command.ExpiresAt <= DateTimeOffset.UtcNow) { await RejectAsync(command, "COMMAND_EXPIRED", token).ConfigureAwait(true); return; }
            if (journal.HasSeen(command.CommandId)) { await RejectAsync(command, "LOCAL_REPLAY_BLOCKED", token).ConfigureAwait(true); return; }
            journal.MarkCommand(command.CommandId);
            try { engine.StartCall(command); }
            catch (InvalidOperationException error) { await RejectAsync(command, SafeCode(error), token).ConfigureAwait(true); }
        }
        catch (HttpRequestException error) { HandleTransportError(error); }
    }

    private async Task RejectAsync(AgentCommand command, string reason, CancellationToken token)
    {
        if (client is null || journal is null) return;
        var item = new AgentEvent("1", command.CommandId, command.CallId, $"agent-{Guid.NewGuid():N}", "FAILED", DateTimeOffset.UtcNow, reason);
        journal.Add(item);
        pending.Enqueue(item);
        await SendPendingEventAsync(token).ConfigureAwait(true);
    }

    private void HandleTransportError(HttpRequestException error)
    {
        crmConnected = false;
        statusCode = error.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden ? "POSTE_RÉVOQUÉ" : "CRM_INJOIGNABLE";
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
        var devices = engine?.Devices.Select(device => new AudioDeviceView(
            device.Id, device.DeviceName,
            device.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityRecord),
            device.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityPlay))).ToArray() ?? [];
        return new AgentRuntimeSnapshot(
            Running, crmConnected, engine?.SdkLoaded == true, engine?.SipRegistered == true,
            statusCode, engine?.CurrentCallState, engine?.CallDurationSeconds, engine?.Muted == true,
            engine?.MicrophoneLevel ?? 0, devices, settings?.InputDeviceId, settings?.OutputDeviceId);
    }

    private void Publish() => SnapshotChanged?.Invoke(BuildSnapshot());

    private async Task DisposeRuntimeAsync()
    {
        if (engine is not null) {
            engine.EventObserved -= OnEventObserved;
            engine.StatusChanged -= OnEngineStatus;
            engine.Dispose();
        }
        client?.Dispose();
        cancellation?.Dispose();
        engine = null; client = null; cancellation = null; loop = null;
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
        "AUDIO_DEVICES_UPDATED" => "PÉRIPHÉRIQUES_ACTUALISÉS",
        _ when state.StartsWith("SIP_FAILED", StringComparison.Ordinal) => "SIP_ÉCHEC",
        _ => state,
    };

    public async ValueTask DisposeAsync() { await StopAsync().ConfigureAwait(true); lifecycle.Dispose(); }
}
