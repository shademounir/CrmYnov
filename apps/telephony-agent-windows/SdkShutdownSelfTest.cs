namespace CrmYnov.TelephonyAgent;

// Entirely managed fixtures: no SDK Core, audio, network or protected profile.
internal static class SdkShutdownSelfTest
{
    public static void Run()
    {
        SdkOperationPolicy.RequireAvailable(false, false);
        Refuses(() => SdkOperationPolicy.RequireAvailable(true, false), "SDK_SHUTDOWN_IN_PROGRESS");
        Refuses(() => SdkOperationPolicy.RequireAvailable(false, true), "SDK_SHUTDOWN_IN_PROGRESS");
        Refuses(() => SdkOperationPolicy.RequireAvailable(true, true), "SDK_SHUTDOWN_IN_PROGRESS");
        var on = new SdkShutdownObservation(ObservedSdkState.On, true, false, false, false);
        var off = on with { State = ObservedSdkState.Off, RegistrationCleared = true };
        void Test(SdkShutdownObservation[] values, string? refusal = null, bool brokenClock = false)
        {
            var fake = new Control(values); var time = TimeSpan.Zero;
            try {
                var receipt = SdkShutdownCoordinator.Stop(fake, () => time,
                    () => { if (!brokenClock) time += TimeSpan.FromMilliseconds(20); }, TimeSpan.FromMilliseconds(60));
                Require(refusal is null && receipt.CoreOffObserved);
            } catch (InvalidOperationException error) when (error.Message == refusal) { }
            Require(!fake.IteratedAfterOff && fake.StopCount <= 1);
        }
        Test([on, on, off]);
        Test([on, off with { RegistrationCleared = false }], "SDK_UNREGISTER_UNPROVEN");
        Test([on with { HasCalls = true }], "PROFILE_MAINTENANCE_CALL_ACTIVE");
        Test([on with { AudioActive = true }], "PROFILE_MAINTENANCE_AUDIO_ACTIVE");
        Test([on, on with { HasCalls = true }], "PROFILE_MAINTENANCE_CALL_ACTIVE");
        Test([on, on with { AudioActive = true }], "PROFILE_MAINTENANCE_AUDIO_ACTIVE");
        Test([on, on with { HasAccount = false }], "SDK_SHUTDOWN_ACCOUNT_CHANGED");
        Test([on], "SDK_SHUTDOWN_TIMEOUT");
        Test([on], "SDK_SHUTDOWN_TIMEOUT", true);
        Test([on with { State = ObservedSdkState.Unknown }], "SDK_SHUTDOWN_STATE_UNPROVEN");
        Test([on with { State = ObservedSdkState.Ready }], "SDK_SHUTDOWN_STATE_UNPROVEN");
        Test([off]);
        Test([on with { State = ObservedSdkState.Shutdown }, off]);
        Test([on with { HasAccount = false }, off with { HasAccount = false, RegistrationCleared = false }]);
        var late = new Control([on, off]); var clockRead = 0;
        Refuses(() => SdkShutdownCoordinator.Stop(late, () => clockRead++ == 0 ? TimeSpan.Zero : TimeSpan.FromSeconds(1), () => {}, TimeSpan.FromSeconds(1)), "SDK_SHUTDOWN_TIMEOUT");
        var backwards = new Control([on, off]); clockRead = 0;
        Refuses(() => SdkShutdownCoordinator.Stop(backwards, () => clockRead++ == 0 ? TimeSpan.FromSeconds(1) : TimeSpan.Zero, () => {}, TimeSpan.FromSeconds(1)), "SDK_SHUTDOWN_TIMEOUT");
        foreach (var deadline in new[] { TimeSpan.Zero, TimeSpan.FromSeconds(-1), TimeSpan.FromSeconds(31) })
            Refuses(() => SdkShutdownCoordinator.Stop(new Control([on]), () => TimeSpan.Zero, () => {}, deadline), "SDK_SHUTDOWN_DEADLINE_INVALID");
        var failing = new Control([on]) { FailOnStop = true };
        try {
            SdkShutdownCoordinator.Stop(failing, () => TimeSpan.Zero, () => {}, TimeSpan.FromSeconds(1));
            throw new InvalidOperationException("SDK_SHUTDOWN_EXCEPTION_SWALLOWED");
        } catch (IOException) { Require(failing.StopCount == 1); }

        SdkShutdownSignals Ready() { var s = new SdkShutdownSignals(1); s.BindAccount(2); s.OnGlobalState(1, ObservedSdkState.On); return s; }
        var signals = Ready(); signals.OnRegistrationState(1, 2, true);
        Require(!signals.Observe(false, false).RegistrationCleared);
        signals.BeginShutdown();
        signals.OnRegistrationState(1, 3, true); signals.OnRegistrationState(9, 2, true);
        Require(!signals.Observe(false, false).RegistrationCleared);
        signals.OnGlobalState(9, ObservedSdkState.Off); Require(!signals.CoreOffObserved);
        signals.OnRegistrationState(1, 2, true); Require(signals.Observe(false, false).RegistrationCleared);
        signals.OnRegistrationState(1, 2, false); Require(!signals.Observe(false, false).RegistrationCleared);
        signals.OnRegistrationState(1, 2, true); signals.OnGlobalState(1, ObservedSdkState.Off);
        Require(signals.CoreOffObserved && signals.Observe(false, false).RegistrationCleared);
        signals.OnGlobalState(1, ObservedSdkState.On);
        Require(signals.CoreOffObserved && signals.Observe(false, false).State == ObservedSdkState.Unknown);
        signals = Ready(); signals.BeginShutdown(); signals.OnGlobalState(1, ObservedSdkState.Off); signals.OnRegistrationState(1, 2, true);
        Require(!signals.Observe(false, false).RegistrationCleared);
        signals = Ready(); signals.BeginShutdown(); signals.BindAccount(3);
        Require(signals.Observe(false, false).State == ObservedSdkState.Unknown);
        signals = Ready(); signals.BeginShutdown(); Refuses(signals.BeginShutdown, "SDK_SHUTDOWN_STATE_UNPROVEN");
        Require(new SdkShutdownSignals(0).Observe(false, false).State == ObservedSdkState.Unknown);
    }

    private static void Require(bool condition) { if (!condition) throw new InvalidOperationException("SDK_SHUTDOWN_SELF_TEST_FAILED"); }
    private static void Refuses(Action action, string code)
    {
        try { action(); } catch (InvalidOperationException error) when (error.Message == code) { return; }
        throw new InvalidOperationException("SDK_SHUTDOWN_REFUSAL_NOT_OBSERVED");
    }
    private sealed class Control(SdkShutdownObservation[] values) : ISdkShutdownControl
    {
        private int index; private bool off;
        public int StopCount { get; private set; }
        public bool IteratedAfterOff { get; private set; }
        public bool FailOnStop { get; init; }
        public SdkShutdownObservation Observe() { var value = values[Math.Min(index++, values.Length - 1)]; off = value.State == ObservedSdkState.Off; return value; }
        public void BeginStopAsync() { StopCount++; if (FailOnStop) throw new IOException("SYNTHETIC_STOP_FAILURE"); }
        public void Iterate() { if (off) IteratedAfterOff = true; }
    }
}
