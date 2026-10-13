using System;

namespace CrmYnov.TelephonyAgent;

// Shared by setup and the HTTP client: no token is sent before this validation.
internal static class AgentEndpointPolicy
{
    public static string Normalize(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var endpoint)
            || !string.IsNullOrEmpty(endpoint.UserInfo)
            || !string.IsNullOrEmpty(endpoint.Query)
            || !string.IsNullOrEmpty(endpoint.Fragment))
            throw new InvalidOperationException("CRM_ADDRESS_INVALID");
        if (endpoint.Scheme != Uri.UriSchemeHttps
            && !(endpoint.Scheme == Uri.UriSchemeHttp && (endpoint.IsLoopback || endpoint.Host == "host.docker.internal")))
            throw new InvalidOperationException("API_TLS_REQUIRED");
        return endpoint.GetLeftPart(UriPartial.Path).TrimEnd('/') + "/";
    }

    public static string Label(string value)
    {
        var endpoint = new Uri(Normalize(value));
        if (endpoint.IsLoopback || endpoint.Host == "host.docker.internal") return $"Local · {endpoint.Authority}";
        // A hosting suffix is not evidence of DEV, STAGING or PROD.
        return $"HTTPS · {endpoint.Authority}{endpoint.AbsolutePath.TrimEnd('/')}";
    }

    public static bool SameEndpoint(string previous, string next)
    {
        var left = new Uri(Normalize(previous));
        var right = new Uri(Normalize(next));
        return string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase)
            && left.Port == right.Port
            && string.Equals(left.AbsolutePath, right.AbsolutePath, StringComparison.Ordinal);
    }
}
