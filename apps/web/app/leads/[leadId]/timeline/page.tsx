const syntheticEvents = [
  { id: "evt-2", type: "COMMENT", result: "Relance planifiée", author: "Conseiller synthétique", occurredAt: "22/08/2026 10:15" },
  { id: "evt-1", type: "CRM_CALL", result: "Contact établi", author: "Conseiller synthétique", occurredAt: "22/08/2026 09:45" },
];

export default function LeadTimelinePage(): React.JSX.Element {
  return <main><h1>Timeline du lead</h1><p>Historique immuable trié par horodatage serveur. Les données affichées ici sont exclusivement synthétiques.</p>
    <ol>{syntheticEvents.map((event) => <li key={event.id}><strong>{event.type}</strong> — {event.result}<br/><small>{event.author} · {event.occurredAt}</small></li>)}</ol>
  </main>;
}
