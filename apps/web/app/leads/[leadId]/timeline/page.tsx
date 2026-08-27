"use client";

import { useParams } from "next/navigation";
import { ConnectedResource } from "../../../_components/connected-resource";

function Timeline(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <ConnectedResource endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}/timeline`} ariaLabel="Timeline immuable" emptyMessage="Aucun événement dans la timeline." fields={[{ key: "type", label: "Type" }, { key: "result", label: "Résultat" }, { key: "authorId", label: "Auteur" }, { key: "occurredAt", label: "Horodatage serveur" }]} />;
}

export default function LeadTimelinePage(): React.JSX.Element {
  return <main><h1>Timeline du lead</h1><p>Historique immuable chargé depuis l’API et trié par horodatage serveur.</p><section aria-labelledby="correction-heading"><h2 id="correction-heading">Corriger sans réécrire</h2><p>Une correction compensatoire ajoute un événement motivé ; l’original reste intact.</p></section><Timeline /></main>;
}
