const syntheticEvents = [
  { id: "evt-3", type: "CORRECTION", result: "WRONG_RESULT → CONTACT_ESTABLISHED", author: "Manager synthétique", occurredAt: "22/08/2026 10:30", originalEventId: "evt-1" },
  { id: "evt-2", type: "COMMENT", result: "Relance planifiée", author: "Conseiller synthétique", occurredAt: "22/08/2026 10:15" },
  { id: "evt-1", type: "CRM_CALL", result: "Contact établi", author: "Conseiller synthétique", occurredAt: "22/08/2026 09:45" },
];

export default function LeadTimelinePage(): React.JSX.Element {
  return <main><h1>Timeline du lead</h1><p>Historique immuable trié par horodatage serveur. Les données affichées ici sont exclusivement synthétiques.</p>
    <section aria-labelledby="correction-heading"><h2 id="correction-heading">Corriger sans réécrire</h2><p>Une correction ajoute un événement compensatoire motivé. L’interaction originale reste intacte et visible.</p><button type="button">Ajouter une correction compensatoire</button></section>
    <ol>{syntheticEvents.map((event) => <li key={event.id}><strong>{event.type}</strong> — {event.result}{"originalEventId" in event ? <span> · corrige {event.originalEventId}</span> : null}<br/><small>{event.author} · {event.occurredAt}</small></li>)}</ol>
  </main>;
}
