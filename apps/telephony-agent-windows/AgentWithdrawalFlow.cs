namespace CrmYnov.TelephonyAgent;

// Managed orchestration boundary: tests supply fakes, never an SDK or real profile.
internal sealed class AgentWithdrawalFlow(
    Func<WithdrawalState?> load,
    Func<ProfileWithdrawalRequest, string, string, WithdrawalState> begin,
    Func<WithdrawalState, ProfileWithdrawalReceipt, WithdrawalState> storeReceipt,
    Action<WithdrawalState> complete,
    Func<ProtectedProfileSnapshot> capture,
    Action<WithdrawalState> remove,
    Func<ProtectedProfileSnapshot?, WithdrawalState?, Task<bool>> stopAttested,
    Func<AgentSettings, ProfileWithdrawalRequest, CancellationToken, Task<ProfileWithdrawalReceipt>> post,
    Func<AgentSettings, ProfileWithdrawalRequest, CancellationToken, Task<ProfileWithdrawalReceipt>> lookup)
{
    // Caller holds the exclusive maintenance lease for this entire task.
    public async Task ExecuteAsync(bool resumeOnly, CancellationToken token)
    {
        var state = load();
        if (state is null && resumeOnly) throw new InvalidOperationException("WITHDRAWAL_STATE_MISSING");
        if (state is null) {
            var original = capture();
            var request = AgentWithdrawalPolicy.CreateRequest(original.Settings, Guid.NewGuid());
            if (!await stopAttested(original, null).ConfigureAwait(true)) throw new InvalidOperationException("WITHDRAWAL_SDK_STOP_UNPROVEN");
            RequireSameProfile(original, capture());
            token.ThrowIfCancellationRequested();
            // Persist BEFORE the first request. A timeout/crash can only resume via lookup.
            state = begin(request, AgentEndpointPolicy.Normalize(original.Settings.ApiBaseUrl), original.SettingsSha256);
            var current = capture(); RequireBoundProfile(state, current);
            var receipt = await post(current.Settings, state.Request, token).ConfigureAwait(true);
            AgentWithdrawalPolicy.RequireReceipt(receipt, state.Request);
            state = storeReceipt(state, receipt);
        } else {
            // ATTEMPTED proves this operation crossed the initial SDK stop fence.
            // On restart no new SDK is started to fabricate another attestation.
            var target = state.State == "ATTEMPTED" ? capture() : null;
            if (target is not null) RequireBoundProfile(state, target);
            if (!await stopAttested(target, state).ConfigureAwait(true)) throw new InvalidOperationException("WITHDRAWAL_SDK_STOP_UNPROVEN");
            if (state.State == "ATTEMPTED") {
                var current = capture(); RequireBoundProfile(state, current);
                var receipt = await lookup(current.Settings, state.Request, token).ConfigureAwait(true);
                AgentWithdrawalPolicy.RequireReceipt(receipt, state.Request);
                state = storeReceipt(state, receipt);
            }
        }
        if (state.State != "RECEIPT_STORED") throw new InvalidOperationException("WITHDRAWAL_RECEIPT_REQUIRED");
        // The durable receipt precedes CAS removal; removal rechecks the actual file.
        // AlreadyAbsent is valid only here (crash after removal, before Complete).
        token.ThrowIfCancellationRequested();
        remove(state);
        complete(state);
    }

    private static void RequireSameProfile(ProtectedProfileSnapshot expected, ProtectedProfileSnapshot current)
    {
        if (expected.SettingsSha256 != current.SettingsSha256 || expected.Settings != current.Settings)
            throw new InvalidOperationException("WITHDRAWAL_PROFILE_CHANGED");
    }
    internal static void RequireBoundProfile(WithdrawalState state, ProtectedProfileSnapshot current)
    {
        if (current.SettingsSha256 != state.SettingsSha256 || current.Settings.AssociationId != state.Request.AssociationId
            || current.Settings.WorkstationId != state.Request.WorkstationId || current.Settings.ProfileId != state.Request.ProfileId
            || !AgentEndpointPolicy.SameEndpoint(current.Settings.ApiBaseUrl, state.Origin))
            throw new InvalidOperationException("WITHDRAWAL_PROFILE_CHANGED");
    }
}

// A stop attestation belongs to one exact protected file, never to the process globally.
internal sealed class WithdrawalStopBinding
{
    private ProtectedProfileSnapshot? attested;
    public void Invalidate() => attested = null;
    public void Record(ProtectedProfileSnapshot target) => attested = target;
    public bool Matches(ProtectedProfileSnapshot target) => attested == target;
    public bool AllowsResume(WithdrawalState state, bool sdkEverCreated)
    {
        if (!sdkEverCreated) return true; // Durable intent on a fresh process, no SDK was opened.
        if (attested is null) return false;
        try { AgentWithdrawalFlow.RequireBoundProfile(state, attested); return true; }
        catch (InvalidOperationException) { return false; }
    }
    public static void RequireEngineProfile(ProtectedProfileSnapshot target, AgentSettings? runtime, AgentSettings? engineOwned)
    {
        if (target.Settings != runtime || target.Settings != engineOwned)
            throw new InvalidOperationException("WITHDRAWAL_PROFILE_CHANGED");
    }
}
