"use client";

import { useParams } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConnectedResource } from "../../../_components/connected-resource";
import { PageHeader } from "../../../_components/ui/page-header";

function Timeline(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  const searchParams = useSearchParams();
  const filter = searchParams.get("type")?.trim() ?? "";
  const query = filter ? `?type=${encodeURIComponent(filter)}` : "";
  return <ConnectedResource endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}/timeline${query}`} ariaLabel="Timeline immuable" emptyMessage="Aucun événement dans la timeline." fields={[{ key: "type", label: "Type" }, { key: "result", label: "Résultat" }, { key: "authorId", label: "Auteur" }, { key: "occurredAt", label: "Horodatage serveur" }]} />;
}

function LeadReturnLink(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <Link className="secondary-button" href={`/leads/${encodeURIComponent(leadId)}`}>Retour à la fiche</Link>;
}

export default function LeadTimelinePage(): React.JSX.Element {
  return <main className="timeline-page"><PageHeader eyebrow="Historique métier" title="Timeline du lead" description="Historique immuable chargé depuis l’API et trié par horodatage serveur." actions={<LeadReturnLink />} />
    <section className="panel timeline-controls"><form method="get"><label>Filtrer la timeline<select name="type" defaultValue=""><option value="">Tous les événements</option><option value="LEAD_CREATED">Création</option><option value="LEAD_ASSIGNED">Affectation</option><option value="LEAD_STATUS_CHANGED">Statut</option><option value="INTERACTION_RECORDED">Interaction</option></select></label><button type="submit">Appliquer</button></form></section>
    <section className="panel correction-note" aria-labelledby="correction-heading"><h2 id="correction-heading">Corriger sans réécrire</h2><p>Une correction compensatoire ajoute un événement motivé ; l’original reste intact.</p></section><section className="panel"><Timeline /></section></main>;
}
