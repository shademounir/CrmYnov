using System.Runtime.InteropServices;

namespace CrmYnov.TelephonyAgent;

/// <summary>
/// Reads the Windows endpoint peak meter without opening a capture stream. It
/// never records audio and never changes the system default device.
/// </summary>
internal sealed class WindowsAudioPeakMeter : IDisposable
{
    private readonly List<IAudioMeterInformation> meters = [];
    private float smoothedPeak;

    public bool Select(string? deviceId, string? deviceName)
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
            for (uint index = 0; index < count; index++)
            {
                Marshal.ThrowExceptionForHR(collection.Item(index, out var device));
                try
                {
                    var friendlyName = GetFriendlyName(device);
                    var iid = typeof(IAudioMeterInformation).GUID;
                    Marshal.ThrowExceptionForHR(device.Activate(ref iid, ClsCtx.All, IntPtr.Zero, out var activated));
                    var endpointMeter = (IAudioMeterInformation)activated;
                    if (Matches(deviceId, deviceName, friendlyName)) meters.Insert(0, endpointMeter);
                    else meters.Add(endpointMeter);
                }
                finally { Marshal.ReleaseComObject(device); }
            }
            return meters.Count > 0;
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
        if (meters.Count == 0) return 0;
        try
        {
            var peak = 0f;
            foreach (var endpointMeter in meters)
            {
                Marshal.ThrowExceptionForHR(endpointMeter.GetPeakValue(out var endpointPeak));
                peak = Math.Max(peak, endpointPeak);
            }
            // Endpoint peaks are linear and normal speech often stays below 5%.
            // A square-root scale makes speech visible without inventing signal;
            // the falling edge is held briefly to keep the gauge readable.
            var visiblePeak = (float)Math.Sqrt(Math.Clamp(peak, 0f, 1f));
            smoothedPeak = Math.Max(visiblePeak, smoothedPeak * 0.72f);
            return Math.Clamp((int)Math.Round(smoothedPeak * 100f), 0, 100);
        }
        catch { smoothedPeak = 0; return 0; }
    }

    private static bool Matches(string? deviceId, string? deviceName, string actual)
    {
        if (ContainsEitherWay(deviceId, actual) || ContainsEitherWay(deviceName, actual)) return true;
        var expectedTokens = Tokens($"{deviceId} {deviceName}");
        var actualTokens = Tokens(actual);
        return expectedTokens.Intersect(actualTokens, StringComparer.OrdinalIgnoreCase).Count() >= 2;
    }

    private static bool ContainsEitherWay(string? expected, string actual) =>
        !string.IsNullOrWhiteSpace(expected)
        && (actual.Contains(expected, StringComparison.OrdinalIgnoreCase)
            || expected.Contains(actual, StringComparison.OrdinalIgnoreCase));

    private static string[] Tokens(string? value)
    {
        var ignored = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "audio", "capture", "device", "headset", "microphone", "mic", "input", "usb", "wasapi", "mswasapi"
        };
        return System.Text.RegularExpressions.Regex.Split(value ?? string.Empty, "[^A-Za-z0-9]+")
            .Where(token => token.Length >= 2 && !ignored.Contains(token))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

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
        foreach (var endpointMeter in meters) Marshal.ReleaseComObject(endpointMeter);
        meters.Clear();
        smoothedPeak = 0;
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
