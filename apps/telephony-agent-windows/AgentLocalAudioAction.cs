namespace CrmYnov.TelephonyAgent;

// An explicit local action may recreate audio after disconnect. It never starts
// CRM polling or SIP registration. Failure stops the action without replay.
internal static class AgentLocalAudioAction
{
    public static async Task RunAsync(Func<Task> ensureAudio, Action localAction)
    {
        await ensureAudio().ConfigureAwait(true);
        localAction();
    }
}
