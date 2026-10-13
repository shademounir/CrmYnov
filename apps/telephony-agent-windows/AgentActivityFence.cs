using System;
using System.Threading;

namespace CrmYnov.TelephonyAgent;

// A maintenance lease covers the entire asynchronous profile mutation, not
// merely shutdown. In-flight calls are refused rather than cancelled midway.
internal sealed class AgentActivityFence
{
    private readonly object sync = new();
    private int commands;
    private bool maintenance;

    public IDisposable Command()
    {
        lock (sync) {
            AssertMayStart();
            commands++;
            return new Lease(() => { lock (sync) commands--; });
        }
    }

    public IDisposable Maintenance()
    {
        lock (sync) {
            AssertMayStart();
            if (commands != 0) throw new InvalidOperationException("PROFILE_MAINTENANCE_COMMAND_PENDING");
            maintenance = true;
            return new Lease(() => { lock (sync) maintenance = false; });
        }
    }

    public void AssertMayStart()
    {
        lock (sync) {
            if (maintenance) throw new InvalidOperationException("PROFILE_MAINTENANCE_IN_PROGRESS");
        }
    }

    private sealed class Lease(Action release) : IDisposable
    {
        private Action? release = release;
        public void Dispose() => Interlocked.Exchange(ref release, null)?.Invoke();
    }
}
