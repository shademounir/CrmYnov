using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal sealed class DpapiStore
{
    private readonly string directory;
    public DpapiStore(string? dataDirectory = null) { directory = dataDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CRM Ynov", "Telephony Agent"); }
    private string SettingsPath => Path.Combine(directory, "settings.dpapi");
    public string JournalPath => Path.Combine(directory, "events.jsonl");
    public string DataDirectory => directory;

    public AgentSettings? Load()
    {
        if (!File.Exists(SettingsPath)) return null;
        var clear = Unprotect(File.ReadAllBytes(SettingsPath));
        try { return JsonSerializer.Deserialize(clear, AgentJsonContext.Default.AgentSettings); }
        finally { Array.Clear(clear); }
    }

    public void Save(AgentSettings settings)
    {
        Directory.CreateDirectory(directory);
        var clear = JsonSerializer.SerializeToUtf8Bytes(settings, AgentJsonContext.Default.AgentSettings);
        try { File.WriteAllBytes(SettingsPath, Protect(clear)); }
        finally { Array.Clear(clear); }
    }

    public void EnsureDirectory() => Directory.CreateDirectory(directory);

    public void RemoveLegacyCoreConfig()
    {
        // Older pilot builds let Liblinphone persist its runtime configuration.
        // That file could contain copied SIP credentials and duplicate accounts.
        // The authoritative secret remains the DPAPI-protected settings file.
        var legacyPath = Path.Combine(directory, "linphonerc");
        if (File.Exists(legacyPath)) File.Delete(legacyPath);
    }

    private static byte[] Protect(byte[] clear) => Transform(clear, true);
    private static byte[] Unprotect(byte[] encrypted) => Transform(encrypted, false);

    private static byte[] Transform(byte[] input, bool protect)
    {
        var inputBlob = Blob.From(input); var outputBlob = new Blob();
        try
        {
            var ok = protect
                ? CryptProtectData(ref inputBlob, "CRM Ynov Telephony Agent", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0x1, ref outputBlob)
                : CryptUnprotectData(ref inputBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0x1, ref outputBlob);
            if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
            var result = new byte[outputBlob.Length]; Marshal.Copy(outputBlob.Data, result, 0, outputBlob.Length); return result;
        }
        finally { inputBlob.Free(); outputBlob.FreeLocal(); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct Blob
    {
        public int Length; public IntPtr Data;
        public static Blob From(byte[] bytes) { var blob = new Blob { Length = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) }; Marshal.Copy(bytes, 0, blob.Data, bytes.Length); return blob; }
        public void Free() { if (Data != IntPtr.Zero) Marshal.FreeHGlobal(Data); Data = IntPtr.Zero; }
        public void FreeLocal() { if (Data != IntPtr.Zero) LocalFree(Data); Data = IntPtr.Zero; }
    }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CryptProtectData(ref Blob dataIn, string description, IntPtr optionalEntropy, IntPtr reserved, IntPtr promptStruct, int flags, ref Blob dataOut);
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CryptUnprotectData(ref Blob dataIn, IntPtr description, IntPtr optionalEntropy, IntPtr reserved, IntPtr promptStruct, int flags, ref Blob dataOut);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
}
