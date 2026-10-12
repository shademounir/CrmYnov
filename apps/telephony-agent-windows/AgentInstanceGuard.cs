using System;
using System.Threading;

namespace CrmYnov.TelephonyAgent;

internal static class AgentInstanceGuard
{
    public const string Name = "Local\\CRM-Ynov-Telephony-Agent";

    public static Mutex Acquire(string name = Name)
    {
        var mutex = new Mutex(true, name, out var createdNew);
        if (createdNew) return mutex;
        mutex.Dispose();
        throw new InvalidOperationException("AGENT_INSTANCE_ALREADY_RUNNING");
    }
}
