namespace CrmYnov.TelephonyAgent;

internal static class WithdrawalFlowTests
{
    private static int passed;
    private static void Check(bool condition, string name) { if (!condition) throw new Exception(name); passed++; }
    private static async Task Refuses(Func<Task> action) { try { await action(); } catch { passed++; return; } throw new Exception("Expected refusal"); }
    private sealed class Harness
    {
        public WithdrawalState? State;
        public ProtectedProfileSnapshot Profile = new(new("https://api.example.invalid", "synthetic", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "sip:synthetic@example.invalid", null, "example.invalid", null, "TLS", "synthetic", null, null, AssociationId: "00000000-0000-4000-8000-000000000003"), new string('a', 64));
        public readonly List<string> Steps = [];
        public bool Attested = true, FailPost, FailLookup, FailReceipt, FailComplete, Removed, ChangeOnStop, ChangeOnReply, InvalidReceipt;
        public int Posts, Lookups, Deletes;
        public TaskCompletionSource? WaitPost;
        public Func<ProtectedProfileSnapshot?, WithdrawalState?, bool>? StopPolicy;
        private ProfileWithdrawalReceipt Receipt(ProfileWithdrawalRequest request) => new(1, request.RequestId, request.AssociationId, request.WorkstationId,
            InvalidReceipt ? "00000000-0000-4000-8000-000000000099" : request.ProfileId, "WITHDRAWN", "2026-10-13T00:00:00.000Z", 2, 2);
        public AgentWithdrawalFlow Flow() => new(
            () => State,
            (request, origin, hash) => { Check(State is null, "No duplicate Begin"); Steps.Add("begin"); return State = new(1, "ATTEMPTED", request, origin, hash, null); },
            (state, receipt) => { Steps.Add("receipt"); if (FailReceipt) throw new IOException("synthetic receipt write failure"); return State = state with { State = "RECEIPT_STORED", Receipt = receipt }; },
            state => { Steps.Add("complete"); if (FailComplete) throw new IOException("synthetic completion failure"); State = null; },
            () => { if (Removed) throw new IOException("synthetic absent profile"); return Profile; },
            state => { Steps.Add("remove"); Check(State?.State == "RECEIPT_STORED", "Receipt durable before delete"); if (!Removed) { AgentWithdrawalFlow.RequireBoundProfile(state, Profile); Deletes++; Removed = true; } },
            (target, state) => { Steps.Add("stop"); if (ChangeOnStop) Profile = Profile with { SettingsSha256 = new string('b', 64) }; return Task.FromResult(StopPolicy?.Invoke(target, state) ?? Attested); },
            async (_, request, token) => { Posts++; Steps.Add("post"); Check(State?.State == "ATTEMPTED", "Intent before HTTP"); if (WaitPost is not null) await WaitPost.Task.WaitAsync(token); if (FailPost) throw new IOException("synthetic lost response"); if (ChangeOnReply) Profile = Profile with { SettingsSha256 = new string('b', 64) }; return Receipt(request); },
            (_, request, _) => { Lookups++; Steps.Add("lookup"); if (FailLookup) throw new HttpRequestException("synthetic not found", null, System.Net.HttpStatusCode.NotFound); return Task.FromResult(Receipt(request)); });
    }
    public static async Task Main()
    {
        var success = new Harness(); await success.Flow().ExecuteAsync(false, CancellationToken.None);
        Check(string.Join(',', success.Steps) == "stop,begin,post,receipt,remove,complete", "Ordered durable withdrawal");
        Check(success.Removed && success.Posts == 1 && success.State is null, "Completed once");
        var noProof = new Harness { Attested = false }; await Refuses(() => noProof.Flow().ExecuteAsync(false, CancellationToken.None)); Check(noProof.State is null && noProof.Posts == 0 && !noProof.Removed, "No SDK attestation, no request");
        var changed = new Harness { ChangeOnStop = true }; await Refuses(() => changed.Flow().ExecuteAsync(false, CancellationToken.None)); Check(changed.Posts == 0 && changed.State is null, "Profile changed before HTTP");
        var lost = new Harness { FailPost = true }; await Refuses(() => lost.Flow().ExecuteAsync(false, CancellationToken.None)); var request = lost.State!.Request;
        lost.FailLookup = true; await Refuses(() => lost.Flow().ExecuteAsync(true, CancellationToken.None)); Check(lost.Posts == 1 && !lost.Removed && lost.State!.Request == request, "404 preserves uncertainty and exact request");
        lost.FailLookup = false; lost.Attested = false; await Refuses(() => lost.Flow().ExecuteAsync(true, CancellationToken.None)); Check(lost.Lookups == 1 && !lost.Removed, "Resume cannot ignore unsafe SDK state");
        lost.StopPolicy = (_, state) => state is not null && new WithdrawalStopBinding().AllowsResume(state, false);
        await lost.Flow().ExecuteAsync(false, CancellationToken.None); Check(lost.Posts == 1 && lost.Lookups == 2 && lost.Removed, "Fresh process only consults receipt without opening SDK");
        var saveLost = new Harness { FailReceipt = true }; await Refuses(() => saveLost.Flow().ExecuteAsync(false, CancellationToken.None)); Check(!saveLost.Removed && saveLost.State!.State == "ATTEMPTED", "Receipt write failure preserves profile");
        saveLost.FailReceipt = false; await saveLost.Flow().ExecuteAsync(true, CancellationToken.None); Check(saveLost.Posts == 1 && saveLost.Lookups == 1, "Receipt persistence failure never resubmits");
        var finishLost = new Harness { FailComplete = true }; await Refuses(() => finishLost.Flow().ExecuteAsync(false, CancellationToken.None)); finishLost.FailComplete = false;
        await finishLost.Flow().ExecuteAsync(true, CancellationToken.None); Check(finishLost.Deletes == 1 && finishLost.Posts == 1 && finishLost.Lookups == 0 && finishLost.State is null, "Recovery after deletion uses durable receipt");
        var badReceipt = new Harness { InvalidReceipt = true }; await Refuses(() => badReceipt.Flow().ExecuteAsync(false, CancellationToken.None)); Check(!badReceipt.Removed && badReceipt.State!.State == "ATTEMPTED", "Invalid receipt cannot erase");
        var afterReply = new Harness { ChangeOnReply = true }; await Refuses(() => afterReply.Flow().ExecuteAsync(false, CancellationToken.None)); Check(!afterReply.Removed && afterReply.State!.State == "RECEIPT_STORED", "Final CAS retains changed profile and receipt");
        var cancelled = new Harness(); using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); await Refuses(() => cancelled.Flow().ExecuteAsync(false, cancellation.Token)); Check(cancelled.State is null && cancelled.Posts == 0, "Cancelled before initial HTTP");
        var gate = new AgentActivityFence(); var concurrent = new Harness { WaitPost = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        using (gate.Maintenance()) {
            var task = concurrent.Flow().ExecuteAsync(false, CancellationToken.None);
            try { using var lease = gate.Command(); throw new Exception("Command unexpectedly allowed"); } catch (InvalidOperationException) { passed++; }
            concurrent.WaitPost.SetResult(); await task;
        }
        using (gate.Command()) { passed++; }
        var missing = new Harness(); await Refuses(() => missing.Flow().ExecuteAsync(true, CancellationToken.None)); Check(missing.Posts == 0, "Resume without intent cannot create one");
        var rebound = new Harness(); var binding = new WithdrawalStopBinding(); binding.Record(rebound.Profile);
        rebound.Profile = rebound.Profile with { Settings = rebound.Profile.Settings with { AssociationId = "00000000-0000-4000-8000-000000000088" }, SettingsSha256 = new string('c', 64) };
        rebound.StopPolicy = (target, _) => target is not null && binding.Matches(target);
        await Refuses(() => rebound.Flow().ExecuteAsync(false, CancellationToken.None)); Check(rebound.Posts == 0 && rebound.Deletes == 0 && rebound.State is null, "New association cannot reuse old stop attestation");
        var replaced = new Harness(); var engineOwned = replaced.Profile.Settings;
        replaced.Profile = replaced.Profile with { Settings = engineOwned with { AgentToken = "synthetic-replaced" }, SettingsSha256 = new string('d', 64) };
        replaced.StopPolicy = (target, _) => { WithdrawalStopBinding.RequireEngineProfile(target!, engineOwned, engineOwned); return true; };
        await Refuses(() => replaced.Flow().ExecuteAsync(false, CancellationToken.None)); Check(replaced.Posts == 0 && replaced.Deletes == 0 && replaced.State is null, "File replaced before stop cannot target another SDK profile");
        binding.Invalidate(); Check(!binding.Matches(rebound.Profile), "Profile mutation invalidates attestation");
        Check(!binding.AllowsResume(lost.State ?? new(1, "ATTEMPTED", request, "https://api.example.invalid", new string('a', 64), null), true), "Existing SDK process requires exact bound attestation");
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { passed, failed = 0, syntheticOnly = true, sdkStarted = false, networkUsed = false, profileFilesystemUsed = false }));
    }
}
