"use client";

import { useParams } from "next/navigation";
import { ConnectedResource } from "../../_components/connected-resource";

function LeadDetail(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <ConnectedResource endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}`} ariaLabel="Fiche lead persistante" emptyMessage="Lead introuvable." fields={[{ key: "leadCode", label: "Identifiant" }, { key: "status", label: "Statut" }, { key: "campaign", label: "Campagne" }, { key: "program", label: "Formation" }, { key: "assignedToId", label: "Conseiller" }, { key: "nextActionAt", label: "Prochaine action" }]} />;
}

export default function LeadDetailPage(): React.JSX.Element {
  return <main><h1>Fiche lead persistante</h1><LeadDetail /><p>Les contacts sont masqués lorsque le rôle ne permet pas leur consultation. Les accès directs sont contrôlés par l’API.</p><nav aria-label="Actions lead"><a href="timeline">Timeline</a> <a href="follow-ups">Relances</a> <a href="appointments">Rendez-vous</a> <a href="documents">Documents</a> <a href="status">Statut</a></nav></main>;
}
