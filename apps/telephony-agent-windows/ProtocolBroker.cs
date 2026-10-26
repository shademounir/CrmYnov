using System.IO.Pipes;
using System.Text;

namespace CrmYnov.TelephonyAgent;

internal sealed record ProtocolRequest(Guid? CommandId)
{
    public const string Scheme = "crmynov-telephony";
    public static ProtocolRequest Open { get; } = new((Guid?)null);

    public static bool TryParse(string? value, out ProtocolRequest request)
    {
        request = Open;
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (string.Equals(value, "open", StringComparison.OrdinalIgnoreCase)) return true;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Scheme, StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)) return false;
        if (string.Equals(uri.Host, "open", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath is "" or "/") return true;
        if (!string.Equals(uri.Host, "command", StringComparison.OrdinalIgnoreCase)
            || !Guid.TryParse(uri.AbsolutePath.Trim('/'), out var commandId)) return false;
        request = new ProtocolRequest(commandId);
        return true;
    }

    public string Serialize() => CommandId?.ToString("D") ?? "open";
    public static bool TryDeserialize(string value, out ProtocolRequest request) =>
        TryParse(value.Equals("open", StringComparison.OrdinalIgnoreCase) ? "open" : $"{Scheme}://command/{value}", out request);
}

internal sealed class ProtocolBroker : IAsyncDisposable
{
    private const string PipeName = "CRM-Ynov-Telephony-Agent-Protocol-v1";
    private readonly CancellationTokenSource cancellation = new();
    private readonly Func<ProtocolRequest, Task> handler;
    private readonly Task listener;
    private readonly ProtocolBrokerShutdown shutdown;

    public ProtocolBroker(Func<ProtocolRequest, Task> handler)
    {
        this.handler = handler;
        listener = ListenAsync(cancellation.Token);
        shutdown = new ProtocolBrokerShutdown(cancellation, listener);
    }

    public static async Task<bool> SendAsync(ProtocolRequest request)
    {
        try
        {
            await using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.Asynchronous, System.Security.Principal.TokenImpersonationLevel.Identification);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await pipe.ConnectAsync(timeout.Token).ConfigureAwait(false);
            var bytes = Encoding.UTF8.GetBytes(request.Serialize());
            await pipe.WriteAsync(bytes, timeout.Token).ConfigureAwait(false);
            await pipe.FlushAsync(timeout.Token).ConfigureAwait(false);
            return true;
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or UnauthorizedAccessException) { return false; }
    }

    private async Task ListenAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(token).ConfigureAwait(false);
                using var buffer = new MemoryStream();
                await pipe.CopyToAsync(buffer, token).ConfigureAwait(false);
                if (buffer.Length > 128) continue;
                var value = Encoding.UTF8.GetString(buffer.ToArray());
                if (ProtocolRequest.TryDeserialize(value, out var request)) await handler(request).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (IOException) { await Task.Delay(100, token).ConfigureAwait(false); }
        }
    }

    public ValueTask DisposeAsync() => shutdown.DisposeAsync();
}

// Separate managed coordination permits tests without starting a named pipe.
// Completion is published before Cancel can invoke a reentrant callback.
internal sealed class ProtocolBrokerShutdown(CancellationTokenSource cancellation, Task listener) : IAsyncDisposable
{
    private readonly object gate = new();
    private Task? completion;

    public ValueTask DisposeAsync()
    {
        TaskCompletionSource? owner = null;
        Task shared;
        lock (gate)
        {
            if (completion is null)
            {
                owner = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                completion = owner.Task;
            }
            shared = completion;
        }
        if (owner is not null) _ = CompleteAsync(owner);
        return new ValueTask(shared);
    }

    private async Task CompleteAsync(TaskCompletionSource owner)
    {
        Exception? failure = null;
        try { cancellation.Cancel(); }
        catch (Exception error) { failure = error; }
        try { await listener.ConfigureAwait(false); }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception error) { failure = failure is null ? error : new AggregateException(failure, error); }
        finally { cancellation.Dispose(); }
        if (failure is null) owner.SetResult();
        else owner.SetException(failure);
    }
}
