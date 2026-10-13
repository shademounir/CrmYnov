using System.Security.Cryptography;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal sealed record WithdrawalState(int SchemaVersion, string State, ProfileWithdrawalRequest Request,
    string Origin, string SettingsSha256, ProfileWithdrawalReceipt? Receipt);

internal interface IWithdrawalProtection
{
    byte[] Protect(byte[] value);
    byte[] Unprotect(byte[] value);
}

internal sealed class WindowsWithdrawalProtection : IWithdrawalProtection
{
    public byte[] Protect(byte[] value) => DpapiStore.Protect(value);
    public byte[] Unprotect(byte[] value) => DpapiStore.Unprotect(value);
}

// Append-only phases preserve prior receipts. No token or SIP secret is copied.
// The runtime must hold its maintenance/instance lease before using this store.
internal sealed class AgentWithdrawalStateStore
{
    private readonly string directory;
    private readonly IWithdrawalProtection protection;
    private const int MaximumBytes = 32768;
    private static readonly string[] Fields = ["schemaVersion", "state", "request", "origin", "settingsSha256", "receipt"];
    private static readonly string[] RequestFields = ["requestId", "associationId", "workstationId", "profileId"];

    public AgentWithdrawalStateStore(string directory, IWithdrawalProtection? protection = null)
    {
        this.directory = Path.GetFullPath(directory);
        this.protection = protection ?? new WindowsWithdrawalProtection();
    }

    public WithdrawalState? Load()
    {
        using var guard = Acquire();
        return ReadLatest();
    }
    public WithdrawalState? Load(Guid requestId)
    {
        using var guard = Acquire();
        return ReadLatest(requestId.ToString("D"));
    }

    // Once a request exists, callers must use Load/receipt consultation, not POST again.
    public WithdrawalState Begin(ProfileWithdrawalRequest request, string origin, string settingsSha256)
    {
        var attempted = new WithdrawalState(1, "ATTEMPTED", request, AgentEndpointPolicy.Normalize(origin), settingsSha256, null);
        Validate(attempted);
        using var guard = Acquire();
        var historical = ReadLatest(request.RequestId);
        if (historical is not null) {
            if (!SameOperation(historical, attempted)) throw new InvalidOperationException("WITHDRAWAL_STATE_CHANGED");
            throw new InvalidOperationException("WITHDRAWAL_ALREADY_ATTEMPTED");
        }
        var previous = ReadLatest();
        if (previous is not null) {
            if (previous.State != "COMPLETED") throw new InvalidOperationException("WITHDRAWAL_ALREADY_PENDING");
        }
        // Never recycle any historical request ID, including after completion.
        if (Directory.EnumerateFiles(directory, $"withdrawal-{request.RequestId}-*.dpapi").Any()) throw new InvalidOperationException("WITHDRAWAL_REQUEST_ALREADY_EXISTS");
        Publish(attempted);
        return attempted;
    }

    public WithdrawalState StoreReceipt(WithdrawalState expected, ProfileWithdrawalReceipt receipt) => Advance(expected, "RECEIPT_STORED", receipt);
    public WithdrawalState Complete(WithdrawalState expected) => Advance(expected, "COMPLETED", expected.Receipt);

    private WithdrawalState Advance(WithdrawalState expected, string state, ProfileWithdrawalReceipt? receipt)
    {
        Validate(expected);
        using var guard = Acquire();
        var current = ReadLatest(expected.Request.RequestId) ?? throw new InvalidOperationException("WITHDRAWAL_STATE_MISSING");
        if (!SameOperation(current, expected)) throw new InvalidOperationException("WITHDRAWAL_STATE_CHANGED");
        var next = expected with { State = state, Receipt = receipt };
        Validate(next);
        if (current == next) return current;
        if (current != expected || Phase(state) != Phase(current.State) + 1) throw new InvalidOperationException("WITHDRAWAL_STATE_TRANSITION_REFUSED");
        Publish(next);
        return next;
    }

    private IDisposable Acquire()
    {
        // Directory is supplied explicitly, never inferred from the live profile.
        var pinned = TargetedProfileRemoval.PinDirectory(directory);
        try {
            return new StoreLease(TargetedProfileRemoval.OpenStateFile(directory, "withdrawal.lock", true), pinned);
        } catch { pinned.Dispose(); throw; }
    }

    private WithdrawalState? ReadLatest(string? requestId = null)
    {
        if (Directory.EnumerateFiles(directory, "withdrawal-*.pending").Any()) throw new IOException("WITHDRAWAL_PARTIAL_WRITE");
        var states = new List<WithdrawalState>();
        foreach (var file in Directory.EnumerateFiles(directory, "withdrawal-*.dpapi")) {
            using var stream = TargetedProfileRemoval.OpenStateFile(directory, Path.GetFileName(file), false);
            if (stream.Length is <= 0 or > MaximumBytes) throw new IOException("WITHDRAWAL_STATE_SIZE_INVALID");
            var encrypted = new byte[(int)stream.Length]; stream.ReadExactly(encrypted);
            var clear = protection.Unprotect(encrypted);
            try {
                if (clear.Length > MaximumBytes) throw new IOException("WITHDRAWAL_STATE_SIZE_INVALID");
                var state = Parse(clear);
                if (Path.GetFileName(file) != Name(state)) throw new IOException("WITHDRAWAL_STATE_NAME_MISMATCH");
                states.Add(state);
            } finally { CryptographicOperations.ZeroMemory(clear); }
        }
        var latest = new List<WithdrawalState>();
        foreach (var group in states.GroupBy(s => s.Request.RequestId)) {
            var phases = group.OrderBy(s => Phase(s.State)).ToArray();
            for (var i = 0; i < phases.Length; i++) {
                if (Phase(phases[i].State) != i + 1 || !SameOperation(phases[0], phases[i])
                    || (i == 2 && phases[i].Receipt != phases[i - 1].Receipt)) throw new IOException("WITHDRAWAL_HISTORY_INVALID");
            }
            latest.Add(phases[^1]);
        }
        var pending = latest.Where(s => s.State != "COMPLETED").ToArray();
        if (pending.Length > 1) throw new IOException("WITHDRAWAL_HISTORY_AMBIGUOUS");
        return requestId is null ? pending.SingleOrDefault() : latest.SingleOrDefault(s => s.Request.RequestId == requestId);
    }

    private void Publish(WithdrawalState state)
    {
        var clear = Serialize(state);
        byte[] encrypted;
        try { encrypted = protection.Protect(clear); }
        finally { CryptographicOperations.ZeroMemory(clear); }
        if (encrypted.Length is <= 0 or > MaximumBytes) throw new IOException("WITHDRAWAL_STATE_SIZE_INVALID");
        var temp = Path.Combine(directory, $"withdrawal-{state.Request.RequestId}-{Guid.NewGuid():N}.pending");
        using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) {
            file.Write(encrypted); file.Flush(true);
        }
        // Same directory/volume, never overwrite another state. Failed temps are
        // retained and block recovery instead of disappearing as a false success.
        File.Move(temp, Path.Combine(directory, Name(state)), false);
    }

    internal static WithdrawalState Parse(byte[] clear)
    {
        using var document = JsonDocument.Parse(clear);
        var root = document.RootElement; ExactFields(root, Fields);
        var requestJson = root.GetProperty("request"); ExactFields(requestJson, RequestFields);
        var request = JsonSerializer.Deserialize(requestJson.GetRawText(), AgentJsonContext.Default.ProfileWithdrawalRequest) ?? throw new JsonException("WITHDRAWAL_STATE_INVALID");
        var receiptJson = root.GetProperty("receipt");
        var receipt = receiptJson.ValueKind == JsonValueKind.Null ? null : AgentWithdrawalPolicy.ParseReceipt(receiptJson.GetRawText(), request);
        var state = new WithdrawalState(root.GetProperty("schemaVersion").GetInt32(), root.GetProperty("state").GetString()!, request,
            root.GetProperty("origin").GetString()!, root.GetProperty("settingsSha256").GetString()!, receipt);
        Validate(state); return state;
    }

    internal static byte[] Serialize(WithdrawalState state)
    {
        Validate(state);
        using var bytes = new MemoryStream();
        using (var writer = new Utf8JsonWriter(bytes)) {
            writer.WriteStartObject(); writer.WriteNumber("schemaVersion", state.SchemaVersion); writer.WriteString("state", state.State);
            writer.WritePropertyName("request"); JsonSerializer.Serialize(writer, state.Request, AgentJsonContext.Default.ProfileWithdrawalRequest);
            writer.WriteString("origin", state.Origin); writer.WriteString("settingsSha256", state.SettingsSha256);
            writer.WritePropertyName("receipt");
            if (state.Receipt is null) writer.WriteNullValue();
            else JsonSerializer.Serialize(writer, state.Receipt, AgentJsonContext.Default.ProfileWithdrawalReceipt);
            writer.WriteEndObject();
        }
        return bytes.ToArray();
    }

    internal static void Validate(WithdrawalState state)
    {
        AgentWithdrawalPolicy.RequireRequest(state.Request);
        if (state.SchemaVersion != 1 || Phase(state.State) == 0 || state.Origin is null
            || AgentEndpointPolicy.Normalize(state.Origin) != state.Origin || state.SettingsSha256 is null
            || state.SettingsSha256.Length != 64 || state.SettingsSha256.Any(c => !"0123456789abcdef".Contains(c))) throw new InvalidOperationException("WITHDRAWAL_STATE_INVALID");
        if (state.State == "ATTEMPTED") { if (state.Receipt is not null) throw new InvalidOperationException("WITHDRAWAL_STATE_INVALID"); }
        else { if (state.Receipt is null) throw new InvalidOperationException("WITHDRAWAL_RECEIPT_REQUIRED"); AgentWithdrawalPolicy.RequireReceipt(state.Receipt, state.Request); }
    }

    private static bool SameOperation(WithdrawalState a, WithdrawalState b) => a.Request == b.Request && a.Origin == b.Origin && a.SettingsSha256 == b.SettingsSha256;
    private static int Phase(string state) => state switch { "ATTEMPTED" => 1, "RECEIPT_STORED" => 2, "COMPLETED" => 3, _ => 0 };
    private static string Name(WithdrawalState state) => $"withdrawal-{state.Request.RequestId}-{Phase(state.State)}.dpapi";
    private static void ExactFields(JsonElement element, string[] expected)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new JsonException("WITHDRAWAL_STATE_INVALID");
        var fields = element.EnumerateObject().Select(p => p.Name).ToArray();
        if (fields.Length != expected.Length || fields.Distinct(StringComparer.Ordinal).Count() != fields.Length || !expected.All(f => fields.Contains(f, StringComparer.Ordinal))) throw new JsonException("WITHDRAWAL_STATE_INVALID");
    }
    private sealed class StoreLease(FileStream file, IDisposable pinned) : IDisposable
    {
        public void Dispose() { file.Dispose(); pinned.Dispose(); }
    }
}
