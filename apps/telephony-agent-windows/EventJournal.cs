using System.Text.Json;

namespace CrmYnov.TelephonyAgent;

internal sealed class EventJournal
{
    private readonly string path;
    private readonly HashSet<string> seenCommands = new(StringComparer.Ordinal);
    private readonly Dictionary<string, AgentEvent> pending = new(StringComparer.Ordinal);
    public EventJournal(string path) { this.path = path; Load(); }
    public bool HasSeen(string commandId) => seenCommands.Contains(commandId);
    public IReadOnlyCollection<AgentEvent> Pending => pending.Values;
    public void MarkCommand(string commandId) { if (seenCommands.Add(commandId)) Append(new("COMMAND", commandId, null, null, null, DateTimeOffset.UtcNow, null)); }
    public void Add(AgentEvent item) { pending[item.EventId] = item; Append(new("EVENT", item.CommandId, item.EventId, item.CallId, item.State, item.OccurredAt, false)); }
    public void Acknowledge(AgentEvent item) { if (pending.Remove(item.EventId)) Append(new("ACK", item.CommandId, item.EventId, item.CallId, item.State, DateTimeOffset.UtcNow, true)); }
    private void Load()
    {
        if (!File.Exists(path)) return;
        foreach (var line in File.ReadLines(path))
        {
            try
            {
                var record = JsonSerializer.Deserialize(line, AgentJsonContext.Default.JournalRecord); if (record is null) continue;
                if (record.Kind == "COMMAND") seenCommands.Add(record.CommandId);
                if (record.Kind == "EVENT" && record.EventId is not null && record.CallId is not null && record.State is not null) pending[record.EventId] = new("1", record.CommandId, record.CallId, record.EventId, record.State, record.At, null);
                if (record.Kind == "ACK" && record.EventId is not null) pending.Remove(record.EventId);
            }
            catch (JsonException) { /* malformed tail is ignored; preceding records remain authoritative */ }
        }
    }
    private void Append(JournalRecord record)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.AppendAllText(path, JsonSerializer.Serialize(record, AgentJsonContext.Default.JournalRecord) + Environment.NewLine);
    }
}
