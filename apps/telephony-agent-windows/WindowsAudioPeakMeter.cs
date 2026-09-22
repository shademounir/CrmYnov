using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace CrmYnov.TelephonyAgent;

/// <summary>
/// Measures a selected Windows capture device with short in-memory WinMM
/// buffers. A dedicated pump drains the capture buffers independently from
/// CRM requests and the UI. Samples are reduced to a normalized dBFS level,
/// are never played back, persisted or exposed, then immediately discarded.
/// </summary>
internal sealed class WindowsAudioPeakMeter : IDisposable
{
    private const int RetainedSeconds = 5;
    private const uint WaveHeaderDone = 0x00000001;
    private const uint WaveHeaderPrepared = 0x00000002;
    private const uint WaveErrorStillPlaying = 33;
    private readonly object gate = new();
    private readonly List<CaptureSession> quarantinedSessions = [];
    private uint selectedDevice;
    private bool selectionValid;
    private CaptureSession? session;
    private CancellationTokenSource? pumpCancellation;
    private Task? pumpTask;
    private bool started;
    private bool poisoned;
    private float displayedLevel;
    private string? errorCode;
    private long sampleCount;
    private int currentLevelPercent;
    private int lastPeakPercent;
    private MemoryStream? retainedPcm;
    private WaveFormatEx? retainedFormat;

    public bool IsRunning { get { lock (gate) return started; } }
    public bool IsPoisoned { get { lock (gate) return poisoned; } }
    public string? ErrorCode { get { lock (gate) return errorCode; } }
    public long SampleCount { get { lock (gate) return sampleCount; } }
    public int LastPeakPercent { get { lock (gate) return lastPeakPercent; } }

    public bool Select(string? deviceId, string? deviceName)
    {
        Stop();
        lock (gate)
        {
            if (poisoned)
            {
                errorCode ??= "AUDIO_CAPTURE_RESTART_REQUIRED";
                return false;
            }
            errorCode = null;
            selectionValid = false;
            sampleCount = 0;
            currentLevelPercent = 0;
            lastPeakPercent = 0;
            displayedLevel = 0;

            var count = waveInGetNumDevs();
            if (count == 0) { errorCode = "AUDIO_CAPTURE_NO_DEVICE"; return false; }

            var bestScore = 0;
            var bestScoreCount = 0;
            var bestDevice = 0u;
            for (uint index = 0; index < count; index++)
            {
                var result = waveInGetDevCapsW(new UIntPtr(index), out var capabilities, (uint)Marshal.SizeOf<WaveInCaps>());
                if (result != 0) continue;
                var score = MatchScore(deviceId, deviceName, capabilities.Name ?? string.Empty);
                if (score > bestScore) { bestScore = score; bestScoreCount = 1; bestDevice = index; }
                else if (score > 0 && score == bestScore) bestScoreCount++;
            }

            // WinMM names are truncated to 31 characters. A unique containment
            // match is reliable enough for those names; otherwise require at
            // least two distinctive shared tokens and fail closed on ties.
            if (bestScore < 200) { errorCode = "AUDIO_CAPTURE_MAPPING_UNRESOLVED"; return false; }
            if (bestScoreCount != 1) { errorCode = "AUDIO_CAPTURE_MAPPING_AMBIGUOUS"; return false; }
            selectedDevice = bestDevice;
            selectionValid = true;
            return true;
        }
    }

    public bool Start(bool retainForPlayback = false)
    {
        if (IsRunning) return true;
        Stop();

        lock (gate)
        {
            if (poisoned)
            {
                errorCode ??= "AUDIO_CAPTURE_RESTART_REQUIRED";
                return false;
            }
            if (!selectionValid)
            {
                errorCode ??= "AUDIO_CAPTURE_MAPPING_UNRESOLVED";
                return false;
            }

            errorCode = null;
            sampleCount = 0;
            currentLevelPercent = 0;
            lastPeakPercent = 0;
            displayedLevel = 0;
            ClearRetainedSample();

            foreach (var candidateFormat in new[] {
                NewFormat(48000, 1), NewFormat(48000, 2), NewFormat(44100, 1), NewFormat(16000, 1)
            })
            {
                var format = candidateFormat;
                var result = waveInOpen(out var handle, selectedDevice, ref format, IntPtr.Zero, IntPtr.Zero, 0);
                if (result != 0) { errorCode = $"AUDIO_CAPTURE_OPEN_{result}"; continue; }

                var candidate = new CaptureSession(handle, format);
                try
                {
                    AllocateBuffers(candidate);
                    result = waveInStart(handle);
                    if (result != 0) throw new AudioNativeException("START", result);

                    var cancellation = new CancellationTokenSource();
                    session = candidate;
                    if (retainForPlayback)
                    {
                        retainedPcm = new MemoryStream((int)Math.Min(int.MaxValue, candidate.Format.AverageBytesPerSecond * RetainedSeconds));
                        retainedFormat = candidate.Format;
                    }
                    started = true;
                    errorCode = null;
                    pumpCancellation = cancellation;
                    try { pumpTask = Task.Run(() => Pump(candidate, cancellation.Token), CancellationToken.None); }
                    catch
                    {
                        started = false;
                        session = null;
                        pumpCancellation = null;
                        cancellation.Dispose();
                        throw;
                    }
                    return true;
                }
                catch (AudioNativeException error)
                {
                    errorCode = $"AUDIO_CAPTURE_{error.Stage}_{error.Result}";
                }
                catch
                {
                    errorCode = "AUDIO_CAPTURE_INITIALIZATION_FAILED";
                }

                if (!TryReleaseSession(candidate, out var cleanupError))
                {
                    quarantinedSessions.Add(candidate);
                    errorCode = cleanupError;
                    poisoned = true;
                    return false;
                }
            }

            return false;
        }
    }

    /// <summary>Returns the latest normalized signal level without touching native buffers.</summary>
    public int ReadPercent()
    {
        lock (gate) return currentLevelPercent;
    }

    public CapturedAudio? TakeRetainedSample()
    {
        lock (gate)
        {
            if (retainedPcm is null || retainedFormat is null || retainedPcm.Length == 0)
            {
                ClearRetainedSample();
                return null;
            }

            var bytes = retainedPcm.ToArray();
            var format = retainedFormat.Value;
            ClearRetainedSample();
            return new CapturedAudio(bytes, format.SamplesPerSecond, format.Channels, format.BitsPerSample);
        }
    }

    public void Stop()
    {
        CancellationTokenSource? cancellation;
        Task? pump;
        lock (gate)
        {
            started = false;
            cancellation = pumpCancellation;
            pump = pumpTask;
            cancellation?.Cancel();
        }

        if (pump is not null && (!Task.CurrentId.HasValue || Task.CurrentId.Value != pump.Id))
        {
            try { pump.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
            catch
            {
                lock (gate)
                {
                    errorCode = "AUDIO_CAPTURE_PUMP_FAILED";
                    poisoned = true;
                }
            }
        }

        lock (gate)
        {
            if (session is not null)
            {
                if (!TryReleaseSession(session, out var cleanupError))
                {
                    quarantinedSessions.Add(session);
                    errorCode = cleanupError;
                    poisoned = true;
                }
                session = null;
            }

            pumpCancellation?.Dispose();
            pumpCancellation = null;
            pumpTask = null;
            currentLevelPercent = 0;
            displayedLevel = 0;
        }
    }

    private void Pump(CaptureSession ownedSession, CancellationToken token)
    {
        var startedAt = System.Diagnostics.Stopwatch.GetTimestamp();
        string? faultCode = null;
        try
        {
            while (!token.IsCancellationRequested)
            {
                lock (gate)
                {
                    if (!started || !ReferenceEquals(session, ownedSession)) return;
                    try { DrainCompletedBuffers(ownedSession); }
                    catch (AudioNativeException error)
                    {
                        faultCode = $"AUDIO_CAPTURE_{error.Stage}_{error.Result}";
                        errorCode = faultCode;
                        started = false;
                    }
                    if (faultCode is null
                        && sampleCount == 0
                        && System.Diagnostics.Stopwatch.GetElapsedTime(startedAt) >= TimeSpan.FromSeconds(1.5))
                    {
                        faultCode = "AUDIO_CAPTURE_NO_SAMPLES";
                        errorCode = faultCode;
                        started = false;
                    }
                }

                if (faultCode is not null || token.WaitHandle.WaitOne(20)) break;
            }
        }
        finally
        {
            if (faultCode is not null)
            {
                lock (gate)
                {
                    if (ReferenceEquals(session, ownedSession))
                    {
                        if (!TryReleaseSession(ownedSession, out var cleanupError))
                        {
                            quarantinedSessions.Add(ownedSession);
                            errorCode = cleanupError;
                            poisoned = true;
                        }
                        session = null;
                        currentLevelPercent = 0;
                    }
                }
            }
        }
    }

    private void DrainCompletedBuffers(CaptureSession ownedSession)
    {
        double sumSquares = 0;
        long samplesRead = 0;

        foreach (var slot in ownedSession.Buffers)
        {
            var header = Marshal.PtrToStructure<WaveHeader>(slot.Header);
            if ((header.Flags & WaveHeaderDone) == 0) continue;

            var bytes = Math.Min(header.BytesRecorded, header.BufferLength);
            RetainForPlayback(header.Data, bytes, ownedSession.Format);
            for (var offset = 0; offset + 1 < bytes; offset += 2)
            {
                var normalized = Marshal.ReadInt16(header.Data, offset) / 32768d;
                sumSquares += normalized * normalized;
                samplesRead++;
            }

            header.BytesRecorded = 0;
            header.Flags &= WaveHeaderPrepared;
            Marshal.StructureToPtr(header, slot.Header, false);
            var result = waveInAddBuffer(ownedSession.Handle, slot.Header, (uint)Marshal.SizeOf<WaveHeader>());
            if (result != 0) throw new AudioNativeException("REQUEUE", result);
        }

        if (samplesRead == 0) return;
        sampleCount += samplesRead;
        var rms = Math.Sqrt(sumSquares / samplesRead);
        var dbfs = 20d * Math.Log10(Math.Max(rms, 0.000001d));
        var normalizedLevel = (float)Math.Clamp((dbfs + 60d) / 60d, 0d, 1d);
        displayedLevel = normalizedLevel >= displayedLevel
            ? normalizedLevel
            : Math.Max(normalizedLevel, displayedLevel * 0.78f);
        currentLevelPercent = Math.Clamp((int)Math.Round(displayedLevel * 100f), 0, 100);
        lastPeakPercent = Math.Max(lastPeakPercent, currentLevelPercent);
    }

    private void RetainForPlayback(IntPtr source, uint bytes, WaveFormatEx format)
    {
        if (retainedPcm is null || bytes == 0) return;
        var maximum = checked((long)format.AverageBytesPerSecond * RetainedSeconds);
        var remaining = maximum - retainedPcm.Length;
        if (remaining <= 0) return;
        var count = (int)Math.Min(bytes, remaining);
        var copy = new byte[count];
        Marshal.Copy(source, copy, 0, count);
        retainedPcm.Write(copy, 0, copy.Length);
        CryptographicOperations.ZeroMemory(copy);
    }

    private void ClearRetainedSample()
    {
        if (retainedPcm is not null)
        {
            if (retainedPcm.TryGetBuffer(out var buffer) && buffer.Array is not null)
                CryptographicOperations.ZeroMemory(buffer.Array.AsSpan(buffer.Offset, buffer.Count));
            retainedPcm.Dispose();
        }
        retainedPcm = null;
        retainedFormat = null;
    }

    private static void AllocateBuffers(CaptureSession target)
    {
        var bytesPerBuffer = (int)(target.Format.SamplesPerSecond / 10 * target.Format.BlockAlign);
        for (var index = 0; index < 4; index++)
        {
            var data = IntPtr.Zero;
            var header = IntPtr.Zero;
            try
            {
                data = Marshal.AllocHGlobal(bytesPerBuffer);
                header = Marshal.AllocHGlobal(Marshal.SizeOf<WaveHeader>());
                Marshal.StructureToPtr(new WaveHeader { Data = data, BufferLength = (uint)bytesPerBuffer }, header, false);
                var result = waveInPrepareHeader(target.Handle, header, (uint)Marshal.SizeOf<WaveHeader>());
                if (result != 0) throw new AudioNativeException("PREPARE", result);

                var slot = new BufferSlot(data, header) { Prepared = true };
                target.Buffers.Add(slot);
                result = waveInAddBuffer(target.Handle, header, (uint)Marshal.SizeOf<WaveHeader>());
                if (result != 0) throw new AudioNativeException("QUEUE", result);
                slot.Queued = true;
            }
            catch
            {
                if (!target.Buffers.Any(slot => slot.Header == header))
                {
                    if (header != IntPtr.Zero) Marshal.FreeHGlobal(header);
                    if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
                }
                throw;
            }
        }
    }

    /// <summary>
    /// Returns true only after Windows confirms every queued buffer is returned,
    /// unprepared and the capture handle is closed. On failure, remaining native
    /// memory stays quarantined for process-lifetime safety instead of being freed
    /// while the driver might still own it.
    /// </summary>
    private static bool TryReleaseSession(CaptureSession target, out string? cleanupError)
    {
        cleanupError = null;
        if (target.Handle == IntPtr.Zero) return true;

        _ = waveInStop(target.Handle);
        var resetResult = waveInReset(target.Handle);
        if (resetResult != 0)
        {
            cleanupError = $"AUDIO_CAPTURE_CLEANUP_RESET_{resetResult}";
            return false;
        }

        foreach (var slot in target.Buffers)
        {
            if (!slot.Prepared) continue;
            uint result = WaveErrorStillPlaying;
            for (var attempt = 0; attempt < 10 && result == WaveErrorStillPlaying; attempt++)
            {
                result = waveInUnprepareHeader(target.Handle, slot.Header, (uint)Marshal.SizeOf<WaveHeader>());
                if (result == WaveErrorStillPlaying) Thread.Sleep(10);
            }
            if (result != 0)
            {
                cleanupError = $"AUDIO_CAPTURE_CLEANUP_UNPREPARE_{result}";
                return false;
            }
            slot.Prepared = false;
            slot.Queued = false;
            slot.Free();
        }

        var closeResult = waveInClose(target.Handle);
        if (closeResult != 0)
        {
            cleanupError = $"AUDIO_CAPTURE_CLEANUP_CLOSE_{closeResult}";
            return false;
        }
        target.Handle = IntPtr.Zero;
        target.Buffers.Clear();
        return true;
    }

    private static WaveFormatEx NewFormat(uint rate, ushort channels) => new() {
        FormatTag = 1,
        Channels = channels,
        SamplesPerSecond = rate,
        BitsPerSample = 16,
        BlockAlign = (ushort)(channels * 2),
        AverageBytesPerSecond = rate * channels * 2,
        ExtraSize = 0,
    };

    private static int MatchScore(string? deviceId, string? deviceName, string actual)
    {
        if (ContainsEitherWay(deviceId, actual) || ContainsEitherWay(deviceName, actual)) return 1000;
        var expectedTokens = Tokens($"{deviceId} {deviceName}");
        var actualTokens = Tokens(actual);
        return expectedTokens.Intersect(actualTokens, StringComparer.OrdinalIgnoreCase).Count() * 100;
    }

    private static bool ContainsEitherWay(string? expected, string actual) =>
        !string.IsNullOrWhiteSpace(expected)
        && actual.Length >= 4
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

    public void Dispose()
    {
        Stop();
        lock (gate)
        {
            ClearRetainedSample();
            foreach (var abandoned in quarantinedSessions.ToArray())
                if (TryReleaseSession(abandoned, out _)) quarantinedSessions.Remove(abandoned);
            // Any session still present is intentionally retained until process
            // exit. Freeing memory still owned by an audio driver is unsafe.
        }
    }

    private sealed class CaptureSession(IntPtr handle, WaveFormatEx format)
    {
        public IntPtr Handle { get; set; } = handle;
        public WaveFormatEx Format { get; } = format;
        public List<BufferSlot> Buffers { get; } = [];
    }

    private sealed class BufferSlot(IntPtr data, IntPtr header)
    {
        public IntPtr Data { get; private set; } = data;
        public IntPtr Header { get; private set; } = header;
        public bool Prepared { get; set; }
        public bool Queued { get; set; }
        public void Free()
        {
            if (Header != IntPtr.Zero) { Marshal.FreeHGlobal(Header); Header = IntPtr.Zero; }
            if (Data != IntPtr.Zero) { Marshal.FreeHGlobal(Data); Data = IntPtr.Zero; }
        }
    }

    private sealed class AudioNativeException(string stage, uint result) : Exception
    {
        public string Stage { get; } = stage;
        public uint Result { get; } = result;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WaveInCaps
    {
        public ushort ManufacturerId;
        public ushort ProductId;
        public uint DriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint Formats;
        public ushort Channels;
        public ushort Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormatEx
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSecond;
        public uint AverageBytesPerSecond;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort ExtraSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHeader
    {
        public IntPtr Data;
        public uint BufferLength;
        public uint BytesRecorded;
        public UIntPtr User;
        public uint Flags;
        public uint Loops;
        public IntPtr Next;
        public UIntPtr Reserved;
    }

    [DllImport("winmm.dll")] private static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] private static extern uint waveInGetDevCapsW(UIntPtr deviceId, out WaveInCaps capabilities, uint capabilitiesSize);
    [DllImport("winmm.dll")] private static extern uint waveInOpen(out IntPtr waveIn, uint deviceId, ref WaveFormatEx format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] private static extern uint waveInPrepareHeader(IntPtr waveIn, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] private static extern uint waveInUnprepareHeader(IntPtr waveIn, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] private static extern uint waveInAddBuffer(IntPtr waveIn, IntPtr header, uint headerSize);
    [DllImport("winmm.dll")] private static extern uint waveInStart(IntPtr waveIn);
    [DllImport("winmm.dll")] private static extern uint waveInStop(IntPtr waveIn);
    [DllImport("winmm.dll")] private static extern uint waveInReset(IntPtr waveIn);
    [DllImport("winmm.dll")] private static extern uint waveInClose(IntPtr waveIn);
}

internal sealed class CapturedAudio(byte[] pcm, uint samplesPerSecond, ushort channels, ushort bitsPerSample) : IDisposable
{
    public byte[] Pcm { get; } = pcm;
    public uint SamplesPerSecond { get; } = samplesPerSecond;
    public ushort Channels { get; } = channels;
    public ushort BitsPerSample { get; } = bitsPerSample;
    public void Dispose() => CryptographicOperations.ZeroMemory(Pcm);
}
