namespace CrmYnov.TelephonyAgent;

// UI lifecycle serialization only. It never replaces the runtime's durable
// command, maintenance, withdrawal or SDK-attestation guards.
internal sealed class AgentUiOperationGate
{
    private int busy;
    public bool IsBusy => Volatile.Read(ref busy) != 0;
    public IDisposable? TryBegin() => Interlocked.CompareExchange(ref busy, 1, 0) == 0 ? new Lease(this) : null;
    private sealed class Lease(AgentUiOperationGate owner) : IDisposable
    {
        private AgentUiOperationGate? owner = owner;
        public void Dispose() { var current = Interlocked.Exchange(ref owner, null); if (current is not null) Volatile.Write(ref current.busy, 0); }
    }
}
