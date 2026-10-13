namespace CrmYnov.TelephonyAgent;

internal static class SdkOperationPolicy
{
    public static void RequireAvailable(bool shutdownStarted, bool offObserved)
    {
        if (shutdownStarted || offObserved)
            throw new InvalidOperationException("SDK_SHUTDOWN_IN_PROGRESS");
    }
}
