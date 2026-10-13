namespace CrmYnov.TelephonyAgent;

// Passive callback capture only. No SDK invocation, credential access or profile mutation.
// One instance belongs to one Core lifetime. The adapter serializes access under engineGate.
internal sealed class SdkShutdownSignals(nint coreIdentity)
{
    private nint accountIdentity;
    private bool accountBound;
    private bool shutdownRequested;
    private bool registrationCleared;
    private bool invalid;
    public bool CoreOffObserved { get; private set; }
    private ObservedSdkState state = ObservedSdkState.Unknown;

    public void BindAccount(nint identity)
    {
        if (shutdownRequested || accountBound || identity == 0) { invalid = true; return; }
        accountIdentity = identity;
        accountBound = true;
    }

    public void BeginShutdown()
    {
        if (coreIdentity == 0 || invalid || shutdownRequested || state != ObservedSdkState.On)
            throw new InvalidOperationException("SDK_SHUTDOWN_STATE_UNPROVEN");
        registrationCleared = false;
        shutdownRequested = true;
    }

    public void OnGlobalState(nint core, ObservedSdkState value)
    {
        if (core != coreIdentity || core == 0) return;
        if (value == ObservedSdkState.Off) CoreOffObserved = true;
        if (state == ObservedSdkState.Off && value != ObservedSdkState.Off) invalid = true;
        if (shutdownRequested && value is not (ObservedSdkState.On or ObservedSdkState.Shutdown or ObservedSdkState.Off)) invalid = true;
        state = value;
    }

    public void OnRegistrationState(nint core, nint account, bool cleared)
    {
        if (core != coreIdentity || account != accountIdentity || !accountBound || !shutdownRequested) return;
        // Off is terminal. A late callback must not manufacture missing proof.
        if (state == ObservedSdkState.Off) return;
        registrationCleared = cleared;
    }

    public SdkShutdownObservation Observe(bool hasCalls, bool audioActive) =>
        new(invalid || coreIdentity == 0 ? ObservedSdkState.Unknown : state,
            accountBound, registrationCleared, hasCalls, audioActive);
}
