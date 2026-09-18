using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal static class Program
{
    private const string Version = "0.3.3-pilot";
    private const string SdkVersion = "5.5.21";
    [STAThread]
    public static async Task<int> Main(string[] args)
    {
        var command = args.FirstOrDefault()?.ToLowerInvariant() ?? "gui";
        try
        {
            if (command is "gui" or "start") return RunGui();
            if (command == "self-test") return AgentSelfTest.Run(args.Skip(1).FirstOrDefault());
            // Loading the official SDK must remain a read-only diagnostic: it must
            // not create a local profile or touch a user's protected SIP state.
            if (command == "native-check") return NativeCheck();
            var store = new DpapiStore(); store.EnsureDirectory();
            return command switch {
                "audio-check" => AudioCheck(store, args.Skip(1).FirstOrDefault()),
                "audio-probe" => AudioProbe(store, args.Skip(1).FirstOrDefault()),
                "pair" => await PairAsync(store),
                "configure-secret" => ConfigureSecret(store),
                "run" => await RunAsync(store),
                _ => Status(store),
            };
        }
        catch (Exception error) { Console.Error.WriteLine($"Agent indisponible : {SafeCode(error)}"); return 1; }
    }

    private static int RunGui()
    {
        using var singleInstance = new Mutex(true, "Local\\CRM-Ynov-Telephony-Agent", out var createdNew);
        if (!createdNew) {
            MessageBox.Show("L’agent téléphonique CRM Ynov est déjà ouvert dans cette session.", "CRM Ynov", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        ApplicationConfiguration.Initialize();
        var store = new DpapiStore(); store.EnsureDirectory();
        Application.Run(new MainForm(store));
        return 0;
    }

    private static async Task<int> PairAsync(DpapiStore store)
    {
        Console.Write("URL API CRM (HTTPS, ou loopback HTTP en recette) : "); var api = Console.ReadLine()?.Trim() ?? "";
        Console.Write("Code d’association temporaire : "); var code = ReadSecret();
        Console.Write("Nom de ce poste : "); var name = Console.ReadLine()?.Trim() ?? Environment.MachineName;
        var publicId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{Environment.UserDomainName}|{Environment.UserName}|{Environment.MachineName}"))).ToLowerInvariant()[..32];
        using var client = new CrmAgentClient(api); var paired = await client.PairAsync(new(code, publicId, name, Version, SdkVersion), CancellationToken.None);
        store.Save(new(api, paired.Token, paired.WorkstationId, paired.Profile.Id, paired.Profile.SipAddress, paired.Profile.AuthUsername, paired.Profile.Server.SipDomain, paired.Profile.Server.ProxyUri, paired.Profile.Server.Transport, "", null, null));
        Console.WriteLine("Poste associé. Le mot de passe SIP reste à configurer localement."); return 0;
    }
    private static int ConfigureSecret(DpapiStore store)
    {
        var settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
        Console.Write("Mot de passe SIP (stocké par DPAPI pour cet utilisateur Windows) : "); var password = ReadSecret();
        if (password.Length < 1) throw new InvalidOperationException("SIP_SECRET_EMPTY");
        store.Save(settings with { SipPassword = password }); Console.WriteLine("Secret SIP protégé localement. Aucun test d’appel n’a été lancé."); return 0;
    }
    private static int NativeCheck()
    {
        var version = Linphone.LinphoneWrapper.VERSION;
        _ = Linphone.Factory.Instance;
        Console.WriteLine($"Liblinphone chargé : {version}. Aucun compte SIP et aucun appel utilisés."); return 0;
    }
    private static int AudioCheck(DpapiStore store, string? reportPath)
    {
        if (string.IsNullOrWhiteSpace(reportPath)) throw new InvalidOperationException("AUDIO_REPORT_PATH_REQUIRED");
        var settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
        store.RemoveLegacyCoreConfig();
        using var engine = new LinphoneEngine(settings, store.DataDirectory);
        engine.StartAudio();
        for (var index = 0; index < 20; index++) { engine.Iterate(); Thread.Sleep(25); }
        var devices = engine.Devices;
        var report = new {
            generatedAt = DateTimeOffset.UtcNow,
            passed = devices.Any(item => item.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityRecord))
                && devices.Any(item => item.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityPlay)),
            sdkLoaded = engine.SdkLoaded,
            sipRegistered = engine.SipRegistered,
            inputCount = devices.Count(item => item.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityRecord)),
            outputCount = devices.Count(item => item.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityPlay)),
            selectedInputAvailable = devices.Any(item => item.Id == settings.InputDeviceId && item.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityRecord)),
            selectedOutputAvailable = devices.Any(item => item.Id == settings.OutputDeviceId && item.HasCapability(Linphone.AudioDeviceCapabilities.CapabilityPlay)),
            privacy = "No device names, identifiers, SIP registration or audio recording included",
        };
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        return report.passed ? 0 : 1;
    }

    private static int AudioProbe(DpapiStore store, string? reportPath)
    {
        if (string.IsNullOrWhiteSpace(reportPath)) throw new InvalidOperationException("AUDIO_REPORT_PATH_REQUIRED");
        var settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
        store.RemoveLegacyCoreConfig();
        using var engine = new LinphoneEngine(settings, store.DataDirectory);
        engine.StartAudio();
        Iterate(engine, 20);
        var microphoneOpened = false;
        var microphonePeakPercent = 0;
        var outputDispatchSucceeded = false;
        try {
            engine.StartMicrophoneTest();
            microphoneOpened = true;
            for (var index = 0; index < 60; index++) {
                engine.Iterate();
                microphonePeakPercent = Math.Max(microphonePeakPercent, engine.MicrophoneLevel);
                Thread.Sleep(25);
            }
        }
        finally { engine.StopMicrophoneTest(); }
        Iterate(engine, 10);
        engine.PlayOutputTest();
        outputDispatchSucceeded = true;
        Iterate(engine, 80);
        var report = new {
            generatedAt = DateTimeOffset.UtcNow,
            passed = microphoneOpened && outputDispatchSucceeded,
            microphoneOpened,
            microphonePeakPercent,
            outputDispatchSucceeded,
            outputAudibilityRequiresHumanConfirmation = true,
            privacy = "No call, recording, device name, identifier or SIP secret included",
        };
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        return report.passed ? 0 : 1;
    }

    private static void Iterate(LinphoneEngine engine, int count)
    {
        for (var index = 0; index < count; index++) { engine.Iterate(); Thread.Sleep(25); }
    }
    private static int Status(DpapiStore store)
    {
        var settings = store.Load();
        Console.WriteLine(settings is null ? "Agent non associé." : $"Agent associé au poste {settings.WorkstationId}; SDK attendu {SdkVersion}; secret SIP {(settings.SipPassword.Length > 0 ? "présent" : "absent")}.");
        return 0;
    }
    private static async Task<int> RunAsync(DpapiStore store)
    {
        var settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
        if (settings.SipPassword.Length == 0) throw new InvalidOperationException("SIP_SECRET_MISSING");
        var journal = new EventJournal(store.JournalPath);
        using var client = new CrmAgentClient(settings.ApiBaseUrl, settings.AgentToken);
        store.RemoveLegacyCoreConfig();
        using var engine = new LinphoneEngine(settings, store.DataDirectory);
        var pending = new Queue<AgentEvent>(journal.Pending);
        engine.EventObserved += item => { journal.Add(item); lock (pending) pending.Enqueue(item); };
        engine.StatusChanged += state => Console.WriteLine($"État : {state}");
        engine.Start();
        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; cancellation.Cancel(); };
        Console.WriteLine("Agent actif. Commandes locales : devices, input N, output N, hangup, quit.");
        var nextPoll = DateTimeOffset.MinValue; var nextStatus = DateTimeOffset.MinValue;
        while (!cancellation.IsCancellationRequested)
        {
            engine.Iterate();
            if (Console.KeyAvailable)
            {
                var line = Console.ReadLine()?.Trim() ?? "";
                if (line.Equals("quit", StringComparison.OrdinalIgnoreCase)) break;
                if (line.Equals("hangup", StringComparison.OrdinalIgnoreCase)) engine.Hangup();
                if (line.Equals("devices", StringComparison.OrdinalIgnoreCase)) PrintDevices(engine);
                if (TryDevice(line, "input", engine, true, store, ref settings) || TryDevice(line, "output", engine, false, store, ref settings)) { }
            }
            if (DateTimeOffset.UtcNow >= nextStatus)
            {
                await client.SendStatusAsync(new(engine.SipRegistered ? "CONNECTED" : "UNAVAILABLE", engine.SdkLoaded, engine.SipRegistered, settings.InputDeviceId, settings.OutputDeviceId, engine.SipRegistered ? null : "SIP_NOT_REGISTERED"), cancellation.Token);
                nextStatus = DateTimeOffset.UtcNow.AddSeconds(10);
            }
            AgentEvent? item = null; lock (pending) { if (pending.Count > 0) item = pending.Dequeue(); }
            if (item is not null)
            {
                try { await client.SendEventAsync(item, cancellation.Token); journal.Acknowledge(item); }
                catch (HttpRequestException) { lock (pending) pending.Enqueue(item); }
            }
            if (DateTimeOffset.UtcNow >= nextPoll)
            {
                var response = await client.PollAsync(cancellation.Token); var command = response.Command;
                if (command is not null)
                {
                    if (command.HangupRequested) engine.Hangup();
                    else if (command.ExpiresAt <= DateTimeOffset.UtcNow) await RejectAsync(client, journal, command, "COMMAND_EXPIRED", cancellation.Token);
                    else if (journal.HasSeen(command.CommandId)) await RejectAsync(client, journal, command, "LOCAL_REPLAY_BLOCKED", cancellation.Token);
                    else
                    {
                        journal.MarkCommand(command.CommandId);
                        try { engine.StartCall(command); }
                        catch (InvalidOperationException error) { await RejectAsync(client, journal, command, SafeCode(error), cancellation.Token); }
                    }
                }
                nextPoll = DateTimeOffset.UtcNow.AddSeconds(2);
            }
            try { await Task.Delay(20, cancellation.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
        }
        return 0;
    }
    private static async Task RejectAsync(CrmAgentClient client, EventJournal journal, AgentCommand command, string reason, CancellationToken cancellation)
    {
        var item = new AgentEvent("1", command.CommandId, command.CallId, $"agent-{Guid.NewGuid():N}", "FAILED", DateTimeOffset.UtcNow, reason); journal.Add(item); await client.SendEventAsync(item, cancellation); journal.Acknowledge(item);
    }
    private static void PrintDevices(LinphoneEngine engine)
    {
        var devices = engine.Devices; for (var index = 0; index < devices.Count; index++) Console.WriteLine($"{index}: {devices[index].DeviceName} [{devices[index].Capabilities}]");
    }
    private static bool TryDevice(string line, string prefix, LinphoneEngine engine, bool input, DpapiStore store, ref AgentSettings settings)
    {
        if (!line.StartsWith(prefix + " ", StringComparison.OrdinalIgnoreCase) || !int.TryParse(line[(prefix.Length + 1)..], out var index)) return false;
        var devices = engine.Devices; if (index < 0 || index >= devices.Count) { Console.WriteLine("Index de périphérique invalide."); return true; }
        settings = input ? settings with { InputDeviceId = devices[index].Id } : settings with { OutputDeviceId = devices[index].Id };
        store.Save(settings); engine.ApplyDevices(settings.InputDeviceId, settings.OutputDeviceId); Console.WriteLine("Périphérique appliqué."); return true;
    }
    private static string ReadSecret()
    {
        var value = new StringBuilder(); ConsoleKeyInfo key;
        while ((key = Console.ReadKey(true)).Key != ConsoleKey.Enter) { if (key.Key == ConsoleKey.Backspace && value.Length > 0) value.Length--; else if (!char.IsControl(key.KeyChar)) value.Append(key.KeyChar); }
        Console.WriteLine(); return value.ToString();
    }
    private static string SafeCode(Exception error)
    {
        var value = error is HttpRequestException http && http.StatusCode is not null ? $"CRM_HTTP_{(int)http.StatusCode}" : error.Message;
        return System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Z0-9_]{3,80}$") ? value : "AGENT_OPERATION_FAILED";
    }
}
