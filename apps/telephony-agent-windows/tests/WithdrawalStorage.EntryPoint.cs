#if MANAGED_WITHDRAWAL_STORAGE_TEST
using System.ComponentModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CrmYnov.TelephonyAgent;

if (args.Length == 2 && args[0] == "--synthetic-reparse") {
    var candidate = Path.GetFullPath(args[1]);
    var allowedPrefix = Path.Combine(Path.GetFullPath(Path.GetTempPath()), "crm-withdrawal-storage-");
    if (!candidate.StartsWith(allowedPrefix, StringComparison.OrdinalIgnoreCase)
        || (File.GetAttributes(candidate) & FileAttributes.ReparsePoint) == 0) throw new Exception("FIXTURE_SCOPE_INVALID");
    var target = Path.Combine(Path.GetDirectoryName(candidate)!, "junction-target");
    if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0) throw new Exception("FIXTURE_SCOPE_INVALID");
    var synthetic = new AgentSettings("https://crm.example.invalid/agent/", "SYNTHETIC-TOKEN", Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"),
        "sip:synthetic@example.invalid", null, "example.invalid", null, "TLS", "SYNTHETIC-SIP", null, null, AssociationId: Guid.NewGuid().ToString("D"));
    new DpapiStore(target).Save(synthetic);
    File.WriteAllText(Path.Combine(target, "events.jsonl"), "synthetic-preserved");
    var captured = TargetedProfileRemoval.Capture(target);
    var req = AgentWithdrawalPolicy.CreateRequest(synthetic, Guid.NewGuid());
    var receipt = new ProfileWithdrawalReceipt(1, req.RequestId, req.AssociationId, req.WorkstationId, req.ProfileId, "WITHDRAWN", "2026-10-13T06:00:00.000Z", 2, 3);
    var state = new WithdrawalState(1, "RECEIPT_STORED", req, synthetic.ApiBaseUrl, captured.SettingsSha256, receipt);
    var refused = 0;
    try { TargetedProfileRemoval.Capture(candidate); }
    catch (IOException error) when (error.Message == "WITHDRAWAL_DIRECTORY_LINK_REFUSED") { refused++; }
    try { TargetedProfileRemoval.Remove(candidate, state); }
    catch (IOException error) when (error.Message == "WITHDRAWAL_DIRECTORY_LINK_REFUSED") { refused++; }
    if (refused != 2 || TargetedProfileRemoval.Capture(target).SettingsSha256 != captured.SettingsSha256
        || File.ReadAllText(Path.Combine(target, "events.jsonl")) != "synthetic-preserved") throw new Exception("REPARSE_REFUSAL_MISSING");
    Console.WriteLine("{\"passed\":true,\"syntheticDirectoryReparseRefused\":true,\"captureAndRemovalRefused\":true,\"targetUnchanged\":true,\"sdkLoaded\":false,\"networkUsed\":false}"); return;
}
var fixtureRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "crm-withdrawal-storage-" + Guid.NewGuid().ToString("N")));
if (!fixtureRoot.StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase)) throw new Exception("FIXTURE_SCOPE_INVALID");
Directory.CreateDirectory(fixtureRoot);
Console.WriteLine("Synthetic fixture retained: " + fixtureRoot);
var checks = 0;
void Check(bool condition) { if (!condition) throw new Exception("STORAGE_ASSERT_FAILED"); checks++; }
void Refused(Action action) { try { action(); } catch (Exception error) when (error is IOException or InvalidOperationException or JsonException or Win32Exception or CryptographicException) { checks++; return; } throw new Exception("STORAGE_REFUSAL_MISSING"); }
string Folder() { var p = Path.Combine(fixtureRoot, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(p); return p; }
AgentSettings Settings() => new("https://crm.example.invalid/agent/", "SYNTHETIC-TOKEN", Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"),
    "sip:synthetic@example.invalid", null, "example.invalid", null, "TLS", "SYNTHETIC-SIP", null, null, AssociationId: Guid.NewGuid().ToString("D"));
ProfileWithdrawalReceipt Receipt(WithdrawalState state) => new(1, state.Request.RequestId, state.Request.AssociationId, state.Request.WorkstationId, state.Request.ProfileId, "WITHDRAWN", "2026-10-13T06:00:00.000Z", 2, 3);
var dir = Folder(); var dpapi = new DpapiStore(dir); var settings = Settings(); dpapi.Save(settings);
File.WriteAllText(Path.Combine(dir, "events.jsonl"), "synthetic-journal-retained");
var snapshot = TargetedProfileRemoval.Capture(dir);
Check(snapshot.Settings == settings);
var store = new AgentWithdrawalStateStore(dir);
var request = AgentWithdrawalPolicy.CreateRequest(settings, Guid.NewGuid());
var attempted = store.Begin(request, settings.ApiBaseUrl, snapshot.SettingsSha256);
Check(store.Load() == attempted);
Refused(() => store.Begin(request, settings.ApiBaseUrl, snapshot.SettingsSha256));
Refused(() => store.Begin(request with { RequestId = Guid.NewGuid().ToString("D") }, settings.ApiBaseUrl, snapshot.SettingsSha256));
Refused(() => store.Complete(attempted));
Refused(() => TargetedProfileRemoval.Remove(dir, attempted));
var accepted = store.StoreReceipt(attempted, Receipt(attempted));
Check(store.StoreReceipt(attempted, Receipt(attempted)) == accepted);
var filesBefore = Directory.GetFiles(dir, "withdrawal-*.dpapi");
Check(filesBefore.Length == 2);
foreach (var path in filesBefore) {
    var bytes = File.ReadAllBytes(path);
    Check(!Encoding.UTF8.GetString(bytes).Contains(settings.AgentToken, StringComparison.Ordinal));
    var clear = DpapiStore.Unprotect(bytes);
    try { var text = Encoding.UTF8.GetString(clear); Check(!text.Contains(settings.AgentToken, StringComparison.Ordinal) && !text.Contains(settings.SipPassword, StringComparison.Ordinal)); }
    finally { CryptographicOperations.ZeroMemory(clear); }
}
using (var blocker = new FileStream(Path.Combine(dir, "settings.dpapi"), FileMode.Open, FileAccess.Read, FileShare.Read))
    Refused(() => TargetedProfileRemoval.Remove(dir, accepted));
Check(File.Exists(Path.Combine(dir, "settings.dpapi")));
File.SetAttributes(Path.Combine(dir, "settings.dpapi"), FileAttributes.ReadOnly);
Refused(() => TargetedProfileRemoval.Remove(dir, accepted));
File.SetAttributes(Path.Combine(dir, "settings.dpapi"), FileAttributes.Normal);
dpapi.Save(settings with { AssociationId = Guid.NewGuid().ToString("D") });
Refused(() => TargetedProfileRemoval.Remove(dir, accepted));
Check(File.Exists(Path.Combine(dir, "settings.dpapi")));
// A separate synthetic profile avoids restoring or overwriting the changed generation.
var cleanDir = Folder(); new DpapiStore(cleanDir).Save(settings);
var cleanSnapshot = TargetedProfileRemoval.Capture(cleanDir);
var cleanStore = new AgentWithdrawalStateStore(cleanDir);
var cleanAttempt = cleanStore.Begin(request, settings.ApiBaseUrl, cleanSnapshot.SettingsSha256);
var cleanAccepted = cleanStore.StoreReceipt(cleanAttempt, Receipt(cleanAttempt));
File.WriteAllText(Path.Combine(cleanDir, "events.jsonl"), "unchanged");
Check(TargetedProfileRemoval.Remove(cleanDir, cleanAccepted) == ProfileRemovalResult.Removed);
Check(!File.Exists(Path.Combine(cleanDir, "settings.dpapi")));
Check(TargetedProfileRemoval.Remove(cleanDir, cleanAccepted) == ProfileRemovalResult.AlreadyAbsent);
var complete = cleanStore.Complete(cleanAccepted);
Check(cleanStore.Load() is null && cleanStore.Load(Guid.Parse(request.RequestId)) == complete);
Check(cleanStore.Complete(cleanAccepted) == complete);
Check(Directory.GetFiles(cleanDir, "withdrawal-*.dpapi").Length == 3 && File.ReadAllText(Path.Combine(cleanDir, "events.jsonl")) == "unchanged");
Refused(() => TargetedProfileRemoval.Remove(cleanDir, complete));
var corrupted = Folder();
File.WriteAllBytes(Path.Combine(corrupted, $"withdrawal-{request.RequestId}-1.dpapi"), [1, 2, 3]);
Refused(() => new AgentWithdrawalStateStore(corrupted).Load());
var partial = Folder(); File.WriteAllText(Path.Combine(partial, "withdrawal-interrupted.pending"), "partial");
Refused(() => new AgentWithdrawalStateStore(partial).Load());
var json = Encoding.UTF8.GetString(AgentWithdrawalStateStore.Serialize(attempted));
foreach (var bad in new[] { "{}", json[..^1] + ",\"token\":\"synthetic\"}", json[..^1] + ",\"state\":\"ATTEMPTED\"}", json.Replace("ATTEMPTED", "COMPLETED", StringComparison.Ordinal) })
    Refused(() => AgentWithdrawalStateStore.Parse(Encoding.UTF8.GetBytes(bad)));
var fakeDir = Folder(); var fake = new AgentWithdrawalStateStore(fakeDir, new IdentityProtection());
Check(fake.Begin(request, settings.ApiBaseUrl, snapshot.SettingsSha256).State == "ATTEMPTED");
Check(fake.Load()?.Receipt is null);
using (var locked = TargetedProfileRemoval.OpenStateFile(fakeDir, "withdrawal.lock", true)) Refused(() => fake.Load());
var gapDir = Folder();
File.WriteAllBytes(Path.Combine(gapDir, $"withdrawal-{request.RequestId}-2.dpapi"), AgentWithdrawalStateStore.Serialize(accepted));
Refused(() => new AgentWithdrawalStateStore(gapDir, new IdentityProtection()).Load());
var raceDir = Folder(); var successes = 0; var refusals = 0;
Parallel.For(0, 2, _ => {
    try { new AgentWithdrawalStateStore(raceDir, new IdentityProtection()).Begin(request, settings.ApiBaseUrl, snapshot.SettingsSha256); Interlocked.Increment(ref successes); }
    catch (Exception error) when (error is IOException or InvalidOperationException or Win32Exception) { Interlocked.Increment(ref refusals); }
});
Check(successes == 1 && refusals == 1);
Check(Directory.GetFiles(raceDir, "withdrawal-*.dpapi").Length == 1);
var completedHistory = cleanStore.Begin(request with { RequestId = Guid.NewGuid().ToString("D") }, settings.ApiBaseUrl, cleanSnapshot.SettingsSha256);
Check(cleanStore.Load() == completedHistory && cleanStore.Load(Guid.Parse(request.RequestId)) == complete);
var symlinkDir = Folder(); var symlinkAvailable = true;
try { File.CreateSymbolicLink(Path.Combine(symlinkDir, "settings.dpapi"), Path.Combine(dir, "settings.dpapi")); }
catch (Exception error) when (error is UnauthorizedAccessException or IOException) { symlinkAvailable = false; }
if (symlinkAvailable) { Refused(() => TargetedProfileRemoval.Capture(symlinkDir)); Check(File.Exists(Path.Combine(dir, "settings.dpapi"))); }
Console.WriteLine(JsonSerializer.Serialize(new { passed = true, checks, symlinkTestExecuted = symlinkAvailable, syntheticOnly = true, sdkLoaded = false, networkUsed = false, fixtureRoot }));
internal sealed class IdentityProtection : IWithdrawalProtection
{
    public byte[] Protect(byte[] value) => value.ToArray();
    public byte[] Unprotect(byte[] value) => value.ToArray();
}
#endif
