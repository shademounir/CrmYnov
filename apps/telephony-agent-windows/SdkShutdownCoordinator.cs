namespace CrmYnov.TelephonyAgent;

// An observed local shutdown is NOT a CRM revocation or permission to delete a profile.
// The adapter must expose captured SDK callbacks, never invoke SDK methods after Off.
internal enum ObservedSdkState { Unknown, Ready, On, Shutdown, Off }
internal readonly record struct SdkShutdownObservation(
    ObservedSdkState State, bool HasAccount, bool RegistrationCleared, bool HasCalls, bool AudioActive);
internal interface ISdkShutdownControl
{
    SdkShutdownObservation Observe();
    void BeginStopAsync();
    void Iterate();
}
internal readonly record struct SdkShutdownReceipt(bool CoreOffObserved, bool RegistrationClearedObserved);

internal static class SdkShutdownCoordinator
{
    public static SdkShutdownReceipt Stop(
        ISdkShutdownControl control, Func<TimeSpan> elapsed, Action pause, TimeSpan deadline)
    {
        if (deadline <= TimeSpan.Zero || deadline > TimeSpan.FromSeconds(30))
            throw new InvalidOperationException("SDK_SHUTDOWN_DEADLINE_INVALID");
        var started = elapsed();
        var previous = started;
        var first = control.Observe();
        RequireIdle(first);
        if (first.State is not (ObservedSdkState.On or ObservedSdkState.Shutdown or ObservedSdkState.Off))
            throw new InvalidOperationException("SDK_SHUTDOWN_STATE_UNPROVEN");
        var hasAccount = first.HasAccount;
        if (first.State == ObservedSdkState.On) control.BeginStopAsync();
        // Bound both time and iteration count; a broken/injected clock cannot loop forever.
        for (var iterations = 0; iterations < 1500; iterations++)
        {
            var current = control.Observe();
            RequireIdle(current);
            if (current.HasAccount != hasAccount)
                throw new InvalidOperationException("SDK_SHUTDOWN_ACCOUNT_CHANGED");
            var now = elapsed();
            var duration = now - started;
            // A late Off callback or a regressing clock cannot attest timely shutdown.
            if (now < previous || duration < TimeSpan.Zero || duration >= deadline)
                throw new InvalidOperationException("SDK_SHUTDOWN_TIMEOUT");
            previous = now;
            if (current.State == ObservedSdkState.Off)
            {
                if (hasAccount && !current.RegistrationCleared)
                    throw new InvalidOperationException("SDK_UNREGISTER_UNPROVEN");
                return new(true, hasAccount && current.RegistrationCleared);
            }
            if (current.State is not (ObservedSdkState.On or ObservedSdkState.Shutdown))
                throw new InvalidOperationException("SDK_SHUTDOWN_STATE_UNPROVEN");
            control.Iterate();
            pause();
        }
        throw new InvalidOperationException("SDK_SHUTDOWN_TIMEOUT");
    }

    private static void RequireIdle(SdkShutdownObservation observation)
    {
        if (observation.HasCalls) throw new InvalidOperationException("PROFILE_MAINTENANCE_CALL_ACTIVE");
        if (observation.AudioActive) throw new InvalidOperationException("PROFILE_MAINTENANCE_AUDIO_ACTIVE");
    }
}
