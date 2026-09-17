using System.Net.Http.Json;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal sealed class CrmAgentClient : IDisposable
{
    private readonly HttpClient http;
    private string? token;
    public CrmAgentClient(string apiBaseUrl, string? token = null)
    {
        var endpoint = new Uri(apiBaseUrl.EndsWith('/') ? apiBaseUrl : apiBaseUrl + "/");
        if (endpoint.Scheme != Uri.UriSchemeHttps && !(endpoint.Scheme == Uri.UriSchemeHttp && (endpoint.IsLoopback || endpoint.Host == "host.docker.internal"))) throw new InvalidOperationException("API_TLS_REQUIRED");
        http = new HttpClient { BaseAddress = endpoint, Timeout = TimeSpan.FromSeconds(10) }; this.token = token;
    }
    public async Task<PairResponse> PairAsync(PairRequest request, CancellationToken cancellation)
    {
        using var response = await http.PostAsJsonAsync("integrations/telephony/agent/v1/pair", request, AgentJsonContext.Default.PairRequest, cancellation);
        return await ReadAsync(response, AgentJsonContext.Default.PairResponse, cancellation);
    }
    public void SetToken(string value) => token = value;
    public Task<PollResponse> PollAsync(CancellationToken cancellation) => PostAsync("integrations/telephony/agent/v1/poll", null, AgentJsonContext.Default.PollResponse, cancellation);
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
