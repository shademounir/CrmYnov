using System.Runtime.InteropServices;

namespace CrmYnov.TelephonyAgent;

/// <summary>
/// Reads the Windows endpoint peak meter without opening a capture stream. It
/// never records audio and never changes the system default device.
/// </summary>
internal sealed class WindowsAudioPeakMeter : IDisposable
{
    private IAudioMeterInformation? meter;

    public bool Select(string? deviceName)
    {
        DisposeMeter();
        IMMDeviceEnumerator? enumerator = null;
        IMMDeviceCollection? collection = null;
        try
        {
            var enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), true)!;
            enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType)!;
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(EDataFlow.Capture, DeviceState.Active, out collection));
            Marshal.ThrowExceptionForHR(collection.GetCount(out var count));
            IMMDevice? selected = null;
            for (uint index = 0; index < count; index++)
            {
                Marshal.ThrowExceptionForHR(collection.Item(index, out var device));
                var friendlyName = GetFriendlyName(device);
                if (Matches(deviceName, friendlyName)) { selected = device; break; }
                Marshal.ReleaseComObject(device);
            }
            if (selected is null)
            {
                Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.Capture, ERole.Communications, out selected));
            }
            var iid = typeof(IAudioMeterInformation).GUID;
            Marshal.ThrowExceptionForHR(selected.Activate(ref iid, ClsCtx.All, IntPtr.Zero, out var activated));
            meter = (IAudioMeterInformation)activated;
            Marshal.ReleaseComObject(selected);
            return true;
        }
        catch
        {
            DisposeMeter();
            return false;
        }
        finally
        {
            if (collection is not null) Marshal.ReleaseComObject(collection);
            if (enumerator is not null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public int ReadPercent()
    {
        if (meter is null) return 0;
        try
        {
            Marshal.ThrowExceptionForHR(meter.GetPeakValue(out var peak));
            return Math.Clamp((int)Math.Round(peak * 100f), 0, 100);
        }
        catch { return 0; }
    }

    private static bool Matches(string? expected, string actual) =>
        !string.IsNullOrWhiteSpace(expected)
        && (actual.Contains(expected, StringComparison.OrdinalIgnoreCase)
            || expected.Contains(actual, StringComparison.OrdinalIgnoreCase));

    private static string GetFriendlyName(IMMDevice device)
    {
        IPropertyStore? properties = null;
        try
        {
            Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out properties));
            var key = PropertyKey.DeviceFriendlyName;
            Marshal.ThrowExceptionForHR(properties.GetValue(ref key, out var value));
            try { return value.GetString() ?? string.Empty; }
            finally { PropVariantClear(ref value); }
        }
        catch { return string.Empty; }
        finally { if (properties is not null) Marshal.ReleaseComObject(properties); }
    }

    private void DisposeMeter()
    {
        if (meter is not null) Marshal.ReleaseComObject(meter);
        meter = null;
    }

    public void Dispose() => DisposeMeter();

    [Flags] private enum ClsCtx : uint { InprocServer = 1, InprocHandler = 2, LocalServer = 4, RemoteServer = 16, All = 23 }
    private enum EDataFlow { Render, Capture, All }
    private enum ERole { Console, Multimedia, Communications }
    [Flags] private enum DeviceState : uint { Active = 1 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, DeviceState stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-C0A8DBCE13AA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, ClsCtx context, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object activated);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore properties);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
        public static PropertyKey DeviceFriendlyName => new() { FormatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), PropertyId = 14 };
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant
    {
        [FieldOffset(0)] private ushort type;
        [FieldOffset(8)] private IntPtr pointer;
        public string? GetString() => type == 31 && pointer != IntPtr.Zero ? Marshal.PtrToStringUni(pointer) : null;
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);
}
