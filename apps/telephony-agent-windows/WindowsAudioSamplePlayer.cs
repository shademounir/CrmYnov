using System.Runtime.InteropServices;

namespace CrmYnov.TelephonyAgent;

/// <summary>
/// Replays one short in-memory microphone sample through the explicitly selected
/// Windows output. No file is created and the PCM buffer is zeroed after use.
/// </summary>
internal sealed class WindowsAudioSamplePlayer : IDisposable
{
    private const uint WaveHeaderDone = 0x00000001;
    private const uint WaveErrorStillPlaying = 33;
    private readonly object gate = new();
    private uint selectedDevice;
    private bool selectionValid;
    private CancellationTokenSource? cancellation;
    private Task? playback;
    private string? errorCode;

    public bool IsPlaying { get { lock (gate) return playback is { IsCompleted: false }; } }
    public bool SelectionValid { get { lock (gate) return selectionValid; } }
    public string? ErrorCode { get { lock (gate) return errorCode; } }

    public bool Select(string? deviceId, string? deviceName)
    {
        Stop();
        lock (gate)
        {
            errorCode = null;
            selectionValid = false;
            var count = waveOutGetNumDevs();
            if (count == 0) { errorCode = "AUDIO_PLAYBACK_NO_DEVICE"; return false; }

            var bestScore = 0;
            var bestScoreCount = 0;
            var bestDevice = 0u;
            for (uint index = 0; index < count; index++)
            {
                if (waveOutGetDevCapsW(new UIntPtr(index), out var capabilities, (uint)Marshal.SizeOf<WaveOutCaps>()) != 0) continue;
                var score = MatchScore(deviceId, deviceName, capabilities.Name ?? string.Empty);
                if (score > bestScore) { bestScore = score; bestScoreCount = 1; bestDevice = index; }
                else if (score > 0 && score == bestScore) bestScoreCount++;
            }

            if (bestScore < 200) { errorCode = "AUDIO_PLAYBACK_MAPPING_UNRESOLVED"; return false; }
            if (bestScoreCount != 1) { errorCode = "AUDIO_PLAYBACK_MAPPING_AMBIGUOUS"; return false; }
            selectedDevice = bestDevice;
            selectionValid = true;
            return true;
        }
    }

    public bool Play(CapturedAudio sample)
    {
        Stop();
        lock (gate)
        {
            if (!selectionValid) { errorCode ??= "AUDIO_PLAYBACK_MAPPING_UNRESOLVED"; sample.Dispose(); return false; }
            errorCode = null;
            cancellation = new CancellationTokenSource();
            var token = cancellation.Token;
            playback = Task.Run(() => PlayCore(sample, token), CancellationToken.None);
            return true;
        }
    }

    public void Stop()
    {
        CancellationTokenSource? source;
        Task? active;
        lock (gate) { source = cancellation; active = playback; source?.Cancel(); }
        if (active is not null && (!Task.CurrentId.HasValue || Task.CurrentId.Value != active.Id))
        {
            try { active.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
            catch { lock (gate) errorCode ??= "AUDIO_PLAYBACK_FAILED"; }
        }
        lock (gate)
        {
            source?.Dispose();
            if (ReferenceEquals(cancellation, source)) cancellation = null;
            if (ReferenceEquals(playback, active)) playback = null;
        }
    }

    private void PlayCore(CapturedAudio sample, CancellationToken token)
    {
        IntPtr handle = IntPtr.Zero;
        IntPtr data = IntPtr.Zero;
        IntPtr header = IntPtr.Zero;
        var prepared = false;
        try
        {
            var format = new WaveFormatEx {
                FormatTag = 1, Channels = sample.Channels, SamplesPerSecond = sample.SamplesPerSecond,
                BitsPerSample = sample.BitsPerSample, BlockAlign = (ushort)(sample.Channels * (sample.BitsPerSample / 8)),
                AverageBytesPerSecond = sample.SamplesPerSecond * sample.Channels * (uint)(sample.BitsPerSample / 8), ExtraSize = 0,
            };
            var result = waveOutOpen(out handle, selectedDevice, ref format, IntPtr.Zero, IntPtr.Zero, 0);
            if (result != 0) throw new AudioPlaybackException("OPEN", result);
            data = Marshal.AllocHGlobal(sample.Pcm.Length);
            Marshal.Copy(sample.Pcm, 0, data, sample.Pcm.Length);
            header = Marshal.AllocHGlobal(Marshal.SizeOf<WaveHeader>());
            Marshal.StructureToPtr(new WaveHeader { Data = data, BufferLength = (uint)sample.Pcm.Length }, header, false);
            result = waveOutPrepareHeader(handle, header, (uint)Marshal.SizeOf<WaveHeader>());
            if (result != 0) throw new AudioPlaybackException("PREPARE", result);
            prepared = true;
            result = waveOutWrite(handle, header, (uint)Marshal.SizeOf<WaveHeader>());
            if (result != 0) throw new AudioPlaybackException("WRITE", result);

            var timeout = TimeSpan.FromSeconds(sample.Pcm.Length / (double)Math.Max(1u, format.AverageBytesPerSecond) + 2d);
            var startedAt = System.Diagnostics.Stopwatch.GetTimestamp();
            while (!token.IsCancellationRequested)
            {
                var current = Marshal.PtrToStructure<WaveHeader>(header);
                if ((current.Flags & WaveHeaderDone) != 0) break;
                if (System.Diagnostics.Stopwatch.GetElapsedTime(startedAt) > timeout) throw new TimeoutException();
                token.WaitHandle.WaitOne(20);
            }
        }
        catch (AudioPlaybackException error) { lock (gate) errorCode = $"AUDIO_PLAYBACK_{error.Stage}_{error.Result}"; }
        catch (TimeoutException) { lock (gate) errorCode = "AUDIO_PLAYBACK_TIMEOUT"; }
        catch { lock (gate) errorCode = "AUDIO_PLAYBACK_FAILED"; }
        finally
        {
            if (handle != IntPtr.Zero && token.IsCancellationRequested) _ = waveOutReset(handle);
            if (prepared && handle != IntPtr.Zero && header != IntPtr.Zero)
            {
                uint result = WaveErrorStillPlaying;
                for (var attempt = 0; attempt < 20 && result == WaveErrorStillPlaying; attempt++)
                {
                    result = waveOutUnprepareHeader(handle, header, (uint)Marshal.SizeOf<WaveHeader>());
                    if (result == WaveErrorStillPlaying) Thread.Sleep(10);
                }
                if (result != 0) lock (gate) errorCode ??= $"AUDIO_PLAYBACK_CLEANUP_{result}";
            }
            if (handle != IntPtr.Zero && waveOutClose(handle) != 0) lock (gate) errorCode ??= "AUDIO_PLAYBACK_CLOSE_FAILED";
            if (header != IntPtr.Zero) Marshal.FreeHGlobal(header);
            if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
            sample.Dispose();
        }
    }

    private static int MatchScore(string? deviceId, string? deviceName, string actual)
    {
        if (ContainsEitherWay(deviceId, actual) || ContainsEitherWay(deviceName, actual)) return 1000;
        var expectedTokens = Tokens($"{deviceId} {deviceName}");
        var actualTokens = Tokens(actual);
        return expectedTokens.Intersect(actualTokens, StringComparer.OrdinalIgnoreCase).Count() * 100;
    }

    private static bool ContainsEitherWay(string? expected, string actual) =>
        !string.IsNullOrWhiteSpace(expected) && actual.Length >= 4
        && (actual.Contains(expected, StringComparison.OrdinalIgnoreCase) || expected.Contains(actual, StringComparison.OrdinalIgnoreCase));

    private static string[] Tokens(string? value)
    {
        var ignored = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "audio", "device", "headset", "speaker", "speakers", "output", "usb", "wasapi", "mswasapi" };
        return System.Text.RegularExpressions.Regex.Split(value ?? string.Empty, "[^A-Za-z0-9]+")
            .Where(token => token.Length >= 2 && !ignored.Contains(token)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public void Dispose() => Stop();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WaveOutCaps
    {
        public ushort ManufacturerId; public ushort ProductId; public uint DriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint Formats; public ushort Channels; public ushort Reserved; public uint Support;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormatEx
    {
        public ushort FormatTag; public ushort Channels; public uint SamplesPerSecond; public uint AverageBytesPerSecond;
        public ushort BlockAlign; public ushort BitsPerSample; public ushort ExtraSize;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHeader
    {
        public IntPtr Data; public uint BufferLength; public uint BytesRecorded; public UIntPtr User;
        public uint Flags; public uint Loops; public IntPtr Next; public UIntPtr Reserved;
    }
    private sealed class AudioPlaybackException(string stage, uint result) : Exception { public string Stage { get; } = stage; public uint Result { get; } = result; }

    [DllImport("winmm.dll")] private static extern uint waveOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] private static extern uint waveOutGetDevCapsW(UIntPtr deviceId, out WaveOutCaps capabilities, uint capabilitiesSize);
    [DllImport("winmm.dll")] private static extern uint waveOutOpen(out IntPtr waveOut, uint deviceId, ref WaveFormatEx format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] private static extern uint waveOutPrepareHeader(IntPtr waveOut, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] private static extern uint waveOutUnprepareHeader(IntPtr waveOut, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] private static extern uint waveOutWrite(IntPtr waveOut, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] private static extern uint waveOutReset(IntPtr waveOut);
    [DllImport("winmm.dll")] private static extern uint waveOutClose(IntPtr waveOut);
}
