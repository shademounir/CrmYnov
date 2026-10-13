using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace CrmYnov.TelephonyAgent;

internal sealed record ProtectedProfileSnapshot(AgentSettings Settings, string SettingsSha256);
internal enum ProfileRemovalResult { Removed, AlreadyAbsent }

// Only settings.dpapi is ever targeted. No directory/journal/SDK/startup removal.
// Microsoft CreateFileW + FileDispositionInfo: DELETE access is requested at open,
// but deletion is armed only AFTER comparisons, never via DELETE_ON_CLOSE.
internal static class TargetedProfileRemoval
{
    private const uint Read = 0x80000000, Delete = 0x00010000, ReadAttributes = 0x80;
    private const uint OpenExisting = 3, OpenReparsePoint = 0x00200000, BackupSemantics = 0x02000000;
    private const uint ReparsePoint = 0x400, DirectoryAttribute = 0x10;
    private const int MaximumProfileBytes = 65536;

    public static ProtectedProfileSnapshot Capture(string directory)
    {
        using var pinned = PinDirectory(directory);
        using var file = OpenProfile(directory, false);
        return Decode(file);
    }

    public static ProfileRemovalResult Remove(string directory, WithdrawalState state)
    {
        AgentWithdrawalStateStore.Validate(state);
        if (state.State != "RECEIPT_STORED") throw new InvalidOperationException("WITHDRAWAL_RECEIPT_REQUIRED");
        using var pinned = PinDirectory(directory);
        FileStream file;
        try { file = OpenProfile(directory, true); }
        catch (Win32Exception error) when (error.NativeErrorCode == 2) { return ProfileRemovalResult.AlreadyAbsent; }
        using (file) {
            var snapshot = Decode(file);
            if (snapshot.SettingsSha256 != state.SettingsSha256
                || snapshot.Settings.AssociationId != state.Request.AssociationId
                || snapshot.Settings.WorkstationId != state.Request.WorkstationId
                || snapshot.Settings.ProfileId != state.Request.ProfileId
                || !AgentEndpointPolicy.SameEndpoint(snapshot.Settings.ApiBaseUrl, state.Origin))
                throw new InvalidOperationException("WITHDRAWAL_PROFILE_CHANGED");
            var disposition = new Disposition { DeleteFile = 1 };
            if (!SetFileInformationByHandle(file.SafeFileHandle, 4, ref disposition, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        return ProfileRemovalResult.Removed;
    }

    private static ProtectedProfileSnapshot Decode(FileStream file)
    {
        if (file.Length is <= 0 or > MaximumProfileBytes) throw new IOException("WITHDRAWAL_PROFILE_SIZE_INVALID");
        var encrypted = new byte[(int)file.Length]; file.ReadExactly(encrypted);
        var hash = Convert.ToHexString(SHA256.HashData(encrypted)).ToLowerInvariant();
        var clear = DpapiStore.Unprotect(encrypted);
        try {
            var settings = JsonSerializer.Deserialize(clear, AgentJsonContext.Default.AgentSettings) ?? throw new JsonException("WITHDRAWAL_PROFILE_INVALID");
            // No withdrawal on a legacy/null generation, even for an exact hash.
            AgentWithdrawalPolicy.CreateRequest(settings, Guid.NewGuid());
            return new(settings, hash);
        } finally { CryptographicOperations.ZeroMemory(clear); }
    }

    private static FileStream OpenProfile(string directory, bool delete)
    {
        return OpenExactFile(directory, "settings.dpapi", Read | (delete ? Delete : 0), OpenExisting);
    }

    internal static FileStream OpenStateFile(string directory, string name, bool createLock)
    {
        if (createLock && name != "withdrawal.lock") throw new IOException("WITHDRAWAL_STATE_PATH_INVALID");
        return OpenExactFile(directory, name, Read, createLock ? 4u : OpenExisting);
    }

    private static FileStream OpenExactFile(string directory, string name, uint access, uint creation)
    {
        if (Path.GetFileName(name) != name || name.Contains(':') || name is "." or "..") throw new IOException("WITHDRAWAL_FILE_PATH_INVALID");
        var path = Path.Combine(Path.GetFullPath(directory), name);
        var handle = CreateFileW(path, access, 0, IntPtr.Zero, creation, OpenReparsePoint, IntPtr.Zero);
        try {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info = Information(handle);
            if ((info.Attributes & (ReparsePoint | DirectoryAttribute)) != 0 || info.NumberOfLinks != 1) throw new IOException("WITHDRAWAL_PROFILE_LINK_REFUSED");
            var final = new StringBuilder(32768);
            var length = GetFinalPathNameByHandleW(handle, final, (uint)final.Capacity, 0);
            if (length == 0 || length >= final.Capacity || !string.Equals(final.ToString(), "\\\\?\\" + path, StringComparison.OrdinalIgnoreCase)) throw new IOException("WITHDRAWAL_PROFILE_PATH_CHANGED");
            return new FileStream(handle, FileAccess.Read);
        } catch { handle.Dispose(); throw; }
    }

    // Pin each ancestor before opening its child; omit FILE_SHARE_DELETE to
    // exclude rename/reparse replacement during state I/O and targeted removal.
    internal static IDisposable PinDirectory(string directory)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("WITHDRAWAL_WINDOWS_REQUIRED");
        var full = Path.GetFullPath(directory);
        var root = Path.GetPathRoot(full);
        if (root is null || root.Length != 3 || root[1] != ':' || full.Length <= root.Length || full.Length > 1024 || full.IndexOf(':', 2) >= 0) throw new IOException("WITHDRAWAL_DIRECTORY_INVALID");
        var handles = new List<SafeFileHandle>();
        try {
            var paths = new List<string> { root }; var current = root;
            foreach (var part in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)) { current = Path.Combine(current, part); paths.Add(current); }
            foreach (var path in paths) {
                var handle = CreateFileW(path, ReadAttributes, 3, IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
                if (handle.IsInvalid) { var code = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(code); }
                handles.Add(handle);
                var info = Information(handle);
                if ((info.Attributes & ReparsePoint) != 0 || (info.Attributes & DirectoryAttribute) == 0) throw new IOException("WITHDRAWAL_DIRECTORY_LINK_REFUSED");
            }
            return new PinnedDirectories(handles);
        } catch { foreach (var handle in handles) handle.Dispose(); throw; }
    }

    private static FileInformation Information(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var information)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return information;
    }
    private sealed class PinnedDirectories(List<SafeFileHandle> handles) : IDisposable
    {
        public void Dispose() { for (var i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Disposition { public byte DeleteFile; }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation
    {
        public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh,
            VolumeSerial, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass, ref Disposition disposition, uint size);
}
