using System.Net.Http.Json;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal sealed class CrmAgentClient : IDisposable
{
    private readonly HttpClient http;
    private readonly TimeSpan withdrawalTimeout;
    private string? token;
    public CrmAgentClient(string apiBaseUrl, string? token = null)
        : this(apiBaseUrl, token, new HttpClientHandler { AllowAutoRedirect = false }) { }
    // Injection for deterministic managed transport tests; no SDK or network required.
    internal CrmAgentClient(string apiBaseUrl, string? token, HttpMessageHandler handler, TimeSpan? withdrawalTimeout = null)
    {
        this.withdrawalTimeout = withdrawalTimeout ?? TimeSpan.FromSeconds(10);
        if (this.withdrawalTimeout < TimeSpan.FromMilliseconds(1) || this.withdrawalTimeout > TimeSpan.FromSeconds(10))
            throw new ArgumentOutOfRangeException(nameof(withdrawalTimeout));
        var endpoint = new Uri(AgentEndpointPolicy.Normalize(apiBaseUrl));
        // Never forward the agent token across a redirect to a different origin.
        http = new HttpClient(handler) { BaseAddress = endpoint, Timeout = TimeSpan.FromSeconds(10) }; this.token = token;
    }
    public async Task<PairResponse> PairAsync(PairRequest request, CancellationToken cancellation)
    {
        using var response = await http.PostAsJsonAsync("integrations/telephony/agent/v1/pair", request, AgentJsonContext.Default.PairRequest, cancellation);
        return await ReadAsync(response, AgentJsonContext.Default.PairResponse, cancellation);
    }
    public void SetToken(string value) => token = value;
    public Task<PollResponse> PollAsync(CancellationToken cancellation) => PostAsync("integrations/telephony/agent/v1/poll", null, AgentJsonContext.Default.PollResponse, cancellation);
    public Task<PollResponse> ClaimAsync(Guid commandId, CancellationToken cancellation) =>
        PostAsync($"integrations/telephony/agent/v1/commands/{commandId:D}/claim", null, AgentJsonContext.Default.PollResponse, cancellation);
    public Task<FreeCallResponse> CreateFreeCallAsync(FreeCallRequest body, CancellationToken cancellation) =>
        PostAsync("integrations/telephony/agent/v1/free-calls", JsonContent.Create(body, AgentJsonContext.Default.FreeCallRequest), AgentJsonContext.Default.FreeCallResponse, cancellation);
    public Task<FreeCallReconciliationResponse> ReconcileFreeCallAsync(string key, CancellationToken cancellation) =>
        PostAsync("integrations/telephony/agent/v1/free-calls/reconciliation", JsonContent.Create(new FreeCallReconciliationRequest(key), AgentJsonContext.Default.FreeCallReconciliationRequest), AgentJsonContext.Default.FreeCallReconciliationResponse, cancellation);
    public Task<ProfileWithdrawalReceipt> WithdrawProfileAsync(ProfileWithdrawalRequest request, CancellationToken cancellation) =>
        WithdrawalAsync("integrations/telephony/agent/v1/profile-withdrawals", request, cancellation);
    public Task<ProfileWithdrawalReceipt> GetWithdrawalReceiptAsync(ProfileWithdrawalRequest request, CancellationToken cancellation) =>
        WithdrawalAsync("integrations/telephony/agent/v1/profile-withdrawals/receipt", request, cancellation);
    private async Task<ProfileWithdrawalReceipt> WithdrawalAsync(string path, ProfileWithdrawalRequest body, CancellationToken cancellation)
    {
        AgentWithdrawalPolicy.RequireRequest(body);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(withdrawalTimeout);
        var boundedCancellation = deadline.Token;
        using var request = Authenticated(HttpMethod.Post, path, JsonContent.Create(body, AgentJsonContext.Default.ProfileWithdrawalRequest));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, boundedCancellation);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"CRM_HTTP_{(int)response.StatusCode}", null, response.StatusCode);
        // Bound the terminal proof; never log a response body or automatically
        // replay a failed mutation. 404/401/timeout are not withdrawal receipts.
        using var content = await response.Content.ReadAsStreamAsync(boundedCancellation);
        using var buffer = new MemoryStream();
        var chunk = new byte[1024];
        int count;
        while ((count = await content.ReadAsync(chunk, boundedCancellation)) != 0) {
            if (buffer.Length + count > 8192) throw new JsonException("PROFILE_WITHDRAWAL_RECEIPT_TOO_LARGE");
            buffer.Write(chunk, 0, count);
        }
        string json;
        try { json = new System.Text.UTF8Encoding(false, true).GetString(buffer.ToArray()); }
        catch (System.Text.DecoderFallbackException) { throw new JsonException("PROFILE_WITHDRAWAL_RECEIPT_ENCODING_INVALID"); }
        return AgentWithdrawalPolicy.ParseReceipt(json, body);
    }
    public async Task SendStatusAsync(AgentStatus status, CancellationToken cancellation)
    {
        using var request = Authenticated(HttpMethod.Post, "integrations/telephony/agent/v1/status", JsonContent.Create(status, AgentJsonContext.Default.AgentStatus));
        using var response = await http.SendAsync(request, cancellation); response.EnsureSuccessStatusCode();
    }
    public async Task SendEventAsync(AgentEvent item, CancellationToken cancellation)
    {
        using var request = Authenticated(HttpMethod.Post, "integrations/telephony/agent/v1/events", JsonContent.Create(item, AgentJsonContext.Default.AgentEvent));
        request.Headers.TryAddWithoutValidation("x-correlation-id", $"agent-{item.EventId}");
        using var response = await http.SendAsync(request, cancellation); response.EnsureSuccessStatusCode();
    }
    private async Task<T> PostAsync<T>(string path, HttpContent? content, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> info, CancellationToken cancellation)
    {
        using var request = Authenticated(HttpMethod.Post, path, content); using var response = await http.SendAsync(request, cancellation); return await ReadAsync(response, info, cancellation);
    }
    private HttpRequestMessage Authenticated(HttpMethod method, string path, HttpContent? content)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("AGENT_NOT_PAIRED");
        var request = new HttpRequestMessage(method, path) { Content = content }; request.Headers.TryAddWithoutValidation("x-telephony-agent-token", token); return request;
    }
    private static async Task<T> ReadAsync<T>(HttpResponseMessage response, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> info, CancellationToken cancellation)
    {
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"CRM_HTTP_{(int)response.StatusCode}", null, response.StatusCode);
        return await response.Content.ReadFromJsonAsync(info, cancellation) ?? throw new JsonException("CRM_RESPONSE_EMPTY");
    }
    public void Dispose() => http.Dispose();
}
