using System.Security.Cryptography;
using System.Text;

namespace CrmYnov.TelephonyAgent;

internal sealed class AgentSetup
{
    private const string Version = "0.2.0-pilot";
    private const string SdkVersion = "5.5.21";
    private readonly DpapiStore store;

    public AgentSetup(DpapiStore store) { this.store = store; }

    public AgentSettings? Settings => store.Load();

    public async Task<AgentSettings> PairAsync(string apiBaseUrl, string pairingCode, string displayName, CancellationToken cancellation)
    {
        var existing = store.Load();
        var publicId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{Environment.UserDomainName}|{Environment.UserName}|{Environment.MachineName}"))).ToLowerInvariant()[..32];
        using var client = new CrmAgentClient(apiBaseUrl);
        var paired = await client.PairAsync(new(pairingCode.Trim(), publicId, displayName.Trim(), Version, SdkVersion), cancellation);
        var preserveSecret = existing is not null
            && string.Equals(existing.ProfileId, paired.Profile.Id, StringComparison.Ordinal)
            && string.Equals(existing.SipAddress, paired.Profile.SipAddress, StringComparison.OrdinalIgnoreCase);
        var settings = new AgentSettings(
            apiBaseUrl.Trim(), paired.Token, paired.WorkstationId, paired.Profile.Id,
            paired.Profile.SipAddress, paired.Profile.AuthUsername, paired.Profile.Server.SipDomain,
            paired.Profile.Server.ProxyUri, paired.Profile.Server.Transport,
            preserveSecret ? existing!.SipPassword : "",
            preserveSecret ? existing!.InputDeviceId : null,
            preserveSecret ? existing!.OutputDeviceId : null);
        store.Save(settings);
        return settings;
    }

    public AgentSettings ConfigureSecret(string password)
    {
        var settings = store.Load() ?? throw new InvalidOperationException("AGENT_NOT_PAIRED");
        if (string.IsNullOrEmpty(password)) throw new InvalidOperationException("SIP_SECRET_EMPTY");
        var updated = settings with { SipPassword = password };
        store.Save(updated);
        return updated;
    }
}
