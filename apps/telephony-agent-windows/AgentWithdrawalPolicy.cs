using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CrmYnov.TelephonyAgent;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record ProfileWithdrawalRequest(string RequestId, string AssociationId, string WorkstationId, string ProfileId);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record ProfileWithdrawalReceipt(int SchemaVersion, string RequestId, string AssociationId,
    string WorkstationId, string ProfileId, string Outcome, string WithdrawnAt, int WorkstationVersion, int ProfileVersion);

// Pure protocol validation, not permission to erase local settings. The future
// orchestration must separately attest SDK stop and compare the current DPAPI
// generation/content under its maintenance lease before any targeted removal.
internal static class AgentWithdrawalPolicy
{
    private static readonly string[] ReceiptFields = ["schemaVersion", "requestId", "associationId", "workstationId", "profileId", "outcome", "withdrawnAt", "workstationVersion", "profileVersion"];

    public static string? AssociationFromPair(PairResponse paired)
    {
        var association = paired.AssociationId ?? paired.Profile.AssociationId;
        // An older API can still pair; it cannot authorize profile withdrawal.
        if (association is null) return null;
        RequireUuid(association);
        RequireUuid(paired.WorkstationId); RequireUuid(paired.Profile.Id);
        if (paired.WorkstationId != paired.Profile.WorkstationId
            || (paired.AssociationId is not null && paired.Profile.AssociationId is not null && paired.AssociationId != paired.Profile.AssociationId))
            throw new InvalidOperationException("PROFILE_WITHDRAWAL_ASSOCIATION_MISMATCH");
        return association;
    }

    public static ProfileWithdrawalRequest CreateRequest(AgentSettings settings, Guid requestId)
    {
        if (settings.AssociationId is null) throw new InvalidOperationException("PROFILE_WITHDRAWAL_LEGACY_ASSOCIATION");
        var request = new ProfileWithdrawalRequest(requestId.ToString("D"), settings.AssociationId, settings.WorkstationId, settings.ProfileId);
        RequireRequest(request);
        return request;
    }

    public static void RequireRequest(ProfileWithdrawalRequest request)
    {
        RequireUuid(request.RequestId); RequireUuid(request.AssociationId);
        RequireUuid(request.WorkstationId); RequireUuid(request.ProfileId);
    }

    public static ProfileWithdrawalReceipt ParseReceipt(string json, ProfileWithdrawalRequest request)
    {
        RequireRequest(request);
        // System.Text.Json normally accepts duplicate properties. Reject them,
        // omissions and additions before source-generated deserialization.
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("PROFILE_WITHDRAWAL_RECEIPT_INVALID");
        var fields = document.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
        if (fields.Length != ReceiptFields.Length || fields.Distinct(StringComparer.Ordinal).Count() != fields.Length
            || !ReceiptFields.All(f => fields.Contains(f, StringComparer.Ordinal))) throw new JsonException("PROFILE_WITHDRAWAL_RECEIPT_INVALID");
        var receipt = JsonSerializer.Deserialize(json, AgentJsonContext.Default.ProfileWithdrawalReceipt)
            ?? throw new JsonException("PROFILE_WITHDRAWAL_RECEIPT_INVALID");
        RequireReceipt(receipt, request);
        return receipt;
    }

    public static void RequireReceipt(ProfileWithdrawalReceipt receipt, ProfileWithdrawalRequest request)
    {
        RequireRequest(request);
        if (receipt.SchemaVersion != 1 || receipt.Outcome != "WITHDRAWN"
            || receipt.RequestId != request.RequestId || receipt.AssociationId != request.AssociationId
            || receipt.WorkstationId != request.WorkstationId || receipt.ProfileId != request.ProfileId
            || receipt.WorkstationVersion < 2 || receipt.ProfileVersion < 2
            || !DateTimeOffset.TryParseExact(receipt.WithdrawnAt, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var instant)
            || instant.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) != receipt.WithdrawnAt)
            throw new InvalidOperationException("PROFILE_WITHDRAWAL_RECEIPT_MISMATCH");
    }

    private static void RequireUuid(string? value)
    {
        if (value is null || !Guid.TryParseExact(value, "D", out var id) || id == Guid.Empty
            || value != id.ToString("D") || value[14] is < '1' or > '8' || !"89ab".Contains(value[19]))
            throw new InvalidOperationException("PROFILE_WITHDRAWAL_IDENTITY_INVALID");
    }
}
