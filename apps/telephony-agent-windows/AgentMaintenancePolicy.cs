using System;

namespace CrmYnov.TelephonyAgent;

internal static class AgentMaintenancePolicy
{
    public static void RequireIdle(bool hasActiveCall, int pendingEventCount)
    {
        if (hasActiveCall) throw new InvalidOperationException("PROFILE_MAINTENANCE_CALL_ACTIVE");
        if (pendingEventCount > 0) throw new InvalidOperationException("PROFILE_MAINTENANCE_PENDING_EVENTS");
    }
}
