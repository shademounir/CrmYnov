namespace CrmYnov.TelephonyAgent;

// A missing receipt or a delivered command is never evidence of no call.
internal static class AgentReconciliationPolicy
{
    public static bool CanResolve(FreeCallReconciliationResponse receipt, string key, AgentSettings settings, bool callActive, int pendingEvents)
    {
        if (receipt.IdempotencyKey != key || receipt.WorkstationId != settings.WorkstationId || receipt.ProfileId != settings.ProfileId)
            throw new InvalidOperationException("FREE_CALL_RECEIPT_IDENTITY_MISMATCH");
        if (callActive || pendingEvents != 0) return false;
        if (receipt.Outcome is not ("TERMINAL" or "EXPIRED_UNDELIVERED")) return false;
        if (!Guid.TryParse(receipt.CommandId, out var commandId) || commandId == Guid.Empty
            || !Guid.TryParse(receipt.CallId, out var callId) || callId == Guid.Empty)
            throw new InvalidOperationException("FREE_CALL_RECEIPT_INVALID");
        return true;
    }
}
