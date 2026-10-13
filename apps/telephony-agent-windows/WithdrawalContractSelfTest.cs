using System.Net;
using System.Text;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

// Synthetic in-memory HTTP only: no Core, audio, DPAPI, filesystem or real API.
internal static class WithdrawalContractSelfTest
{
    public static async Task RunAsync()
    {
        var settings = new AgentSettings("https://crm.example.invalid/agent/", "synthetic-token", Guid.NewGuid().ToString("D"),
            Guid.NewGuid().ToString("D"), "sip:synthetic@example.invalid", null, "example.invalid", null, "TLS", "", null, null);
        Refuses(() => AgentWithdrawalPolicy.CreateRequest(settings, Guid.NewGuid()));
        var legacyJson = JsonSerializer.Serialize(settings, AgentJsonContext.Default.AgentSettings);
        using (var legacy = JsonDocument.Parse(legacyJson)) {
            var withoutAssociation = "{" + string.Join(",", legacy.RootElement.EnumerateObject().Where(p => p.Name != "associationId").Select(p => JsonSerializer.Serialize(p.Name) + ":" + p.Value.GetRawText())) + "}";
            Require(JsonSerializer.Deserialize(withoutAssociation, AgentJsonContext.Default.AgentSettings)?.AssociationId is null);
        }
        settings = settings with { AssociationId = Guid.NewGuid().ToString("D") };
        Require(JsonSerializer.Deserialize(JsonSerializer.Serialize(settings, AgentJsonContext.Default.AgentSettings), AgentJsonContext.Default.AgentSettings) == settings);
        var request = AgentWithdrawalPolicy.CreateRequest(settings, Guid.NewGuid());
        Refuses(() => AgentWithdrawalPolicy.CreateRequest(settings, Guid.Empty));
        Refuses(() => AgentWithdrawalPolicy.CreateRequest(settings with { AssociationId = "not-a-generation" }, Guid.NewGuid()));
        var profile = new AgentProfile(settings.ProfileId, settings.WorkstationId, settings.SipAddress, null, new("example.invalid", null, "TLS"), false, false);
        Require(AgentWithdrawalPolicy.AssociationFromPair(new("synthetic-token", settings.WorkstationId, profile)) is null);
        var pair = new PairResponse("synthetic-token", settings.WorkstationId, profile with { AssociationId = settings.AssociationId }, settings.AssociationId);
        Require(AgentWithdrawalPolicy.AssociationFromPair(pair) == settings.AssociationId);
        Refuses(() => AgentWithdrawalPolicy.AssociationFromPair(pair with { AssociationId = Guid.NewGuid().ToString("D") }));
        Refuses(() => AgentWithdrawalPolicy.AssociationFromPair(pair with { WorkstationId = Guid.NewGuid().ToString("D") }));
        Require(JsonSerializer.Deserialize(JsonSerializer.Serialize(pair, AgentJsonContext.Default.PairResponse), AgentJsonContext.Default.PairResponse) == pair);

        var receipt = new ProfileWithdrawalReceipt(1, request.RequestId, request.AssociationId, request.WorkstationId, request.ProfileId,
            "WITHDRAWN", "2026-10-13T04:00:00.000Z", 2, 4);
        var json = JsonSerializer.Serialize(receipt, AgentJsonContext.Default.ProfileWithdrawalReceipt);
        Require(AgentWithdrawalPolicy.ParseReceipt(json, request) == receipt);
        foreach (var bad in new[] { receipt with { SchemaVersion = 2 }, receipt with { Outcome = "UNKNOWN" }, receipt with { RequestId = Guid.NewGuid().ToString("D") },
            receipt with { AssociationId = Guid.NewGuid().ToString("D") }, receipt with { WorkstationId = Guid.NewGuid().ToString("D") }, receipt with { ProfileId = Guid.NewGuid().ToString("D") },
            receipt with { WorkstationVersion = 1 }, receipt with { ProfileVersion = 0 }, receipt with { WithdrawnAt = "2026-10-13T04:00:00+00:00" }, receipt with { WithdrawnAt = "2026-02-30T04:00:00.000Z" } })
            Refuses(() => AgentWithdrawalPolicy.RequireReceipt(bad, request));
        foreach (var bad in new[] { "null", "[]", "{}", json[..^1] + ",\"token\":\"synthetic\"}", json[..^1] + ",\"outcome\":\"WITHDRAWN\"}", json.Replace("\"profileVersion\":4", "\"profileVersion\":null", StringComparison.Ordinal) })
            Refuses(() => AgentWithdrawalPolicy.ParseReceipt(bad, request));

        var handler = new FakeHandler(request, json);
        using var client = new CrmAgentClient(settings.ApiBaseUrl, settings.AgentToken, handler);
        Require(await client.WithdrawProfileAsync(request, CancellationToken.None) == receipt);
        Require(handler.LastPath == "/agent/integrations/telephony/agent/v1/profile-withdrawals");
        Require(await client.GetWithdrawalReceiptAsync(request, CancellationToken.None) == receipt);
        Require(handler.LastPath == "/agent/integrations/telephony/agent/v1/profile-withdrawals/receipt");
        foreach (var status in new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.Conflict, HttpStatusCode.InternalServerError, HttpStatusCode.Redirect }) {
            handler.Status = status; var before = handler.Count;
            await RefusesAsync(() => client.GetWithdrawalReceiptAsync(request, CancellationToken.None));
            Require(handler.Count == before + 1); // no redirect or retry
        }
        handler.Status = HttpStatusCode.OK; handler.Body = new string('x', 8193);
        await RefusesAsync(() => client.WithdrawProfileAsync(request, CancellationToken.None));
        handler.Body = json.Replace(request.AssociationId, Guid.NewGuid().ToString("D"), StringComparison.Ordinal);
        await RefusesAsync(() => client.WithdrawProfileAsync(request, CancellationToken.None));
        handler.Throw = true;
        var calls = handler.Count;
        await RefusesAsync(() => client.WithdrawProfileAsync(request, CancellationToken.None));
        Require(handler.Count == calls + 1);
        var blocked = new BlockingBody();
        var stalled = new FakeHandler(request, json) { ContentOverride = new StreamContent(blocked) };
        using (var bounded = new CrmAgentClient(settings.ApiBaseUrl, settings.AgentToken, stalled, TimeSpan.FromMilliseconds(100))) {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            await RefusesAsync(() => bounded.GetWithdrawalReceiptAsync(request, CancellationToken.None));
            Require(blocked.Cancelled && stalled.Count == 1 && watch.Elapsed < TimeSpan.FromSeconds(3));
        }
        var malformedUtf8 = new FakeHandler(request, json) { ContentOverride = new ByteArrayContent([0xff, 0xfe]) };
        using (var malformed = new CrmAgentClient(settings.ApiBaseUrl, settings.AgentToken, malformedUtf8))
            await RefusesAsync(() => malformed.GetWithdrawalReceiptAsync(request, CancellationToken.None));
    }

    private static void Require(bool value) { if (!value) throw new InvalidOperationException("WITHDRAWAL_CONTRACT_SELF_TEST_FAILED"); }
    private static void Refuses(Action action)
    {
        try { action(); } catch (Exception error) when (error is InvalidOperationException or JsonException) { return; }
        throw new InvalidOperationException("WITHDRAWAL_CONTRACT_REFUSAL_MISSING");
    }
    private static async Task RefusesAsync(Func<Task> action)
    {
        try { await action(); } catch (Exception error) when (error is HttpRequestException or JsonException or InvalidOperationException or TaskCanceledException) { return; }
        throw new InvalidOperationException("WITHDRAWAL_TRANSPORT_REFUSAL_MISSING");
    }
    private sealed class FakeHandler(ProfileWithdrawalRequest expected, string body) : HttpMessageHandler
    {
        public int Count { get; private set; }
        public string? LastPath { get; private set; }
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public string Body { get; set; } = body;
        public bool Throw { get; set; }
        public HttpContent? ContentOverride { get; init; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Count++; LastPath = request.RequestUri?.AbsolutePath;
            Require(request.Method == HttpMethod.Post && request.RequestUri?.Host == "crm.example.invalid");
            Require(request.Headers.GetValues("x-telephony-agent-token").Single() == "synthetic-token");
            Require(JsonSerializer.Deserialize(await request.Content!.ReadAsStringAsync(cancellationToken), AgentJsonContext.Default.ProfileWithdrawalRequest) == expected);
            if (Throw) throw new TaskCanceledException("SYNTHETIC_RESPONSE_LOST");
            return new HttpResponseMessage(Status) { Content = ContentOverride ?? new StringContent(Body, Encoding.UTF8, "application/json") };
        }
    }
    private sealed class BlockingBody : Stream
    {
        public bool Cancelled { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            try { await Task.Delay(Timeout.Infinite, cancellationToken); }
            catch (OperationCanceledException) { Cancelled = true; throw; }
            return 0;
        }
        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
