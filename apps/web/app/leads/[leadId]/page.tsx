"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { CalendarBlank, Clock, PencilSimple, UserSwitch } from "@phosphor-icons/react";
import { ConnectedResource } from "../../_components/connected-resource";
import { PageHeader } from "../../_components/ui/page-header";

type LeadSection = "timeline" | "appointments" | "status" | "collaborators" | "follow-ups" | "documents";

export function leadSectionHref(leadId: string, section: LeadSection): string {
  return `/leads/${encodeURIComponent(leadId)}/${section}`;
}

function LeadDetail(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <ConnectedResource endpoint={`/api/crm/leads/${encodeURIComponent(leadId)}`} ariaLabel="Fiche lead persistante" emptyMessage="Lead introuvable." fields={[{ key: "leadCode", label: "Identifiant" }, { key: "status", label: "Statut" }, { key: "campaign", label: "Campagne" }, { key: "program", label: "Formation" }, { key: "assignedToId", label: "Conseiller" }, { key: "nextActionAt", label: "Prochaine action" }]} />;
}

function LeadPrimaryActions(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <nav className="lead-sticky-actions" aria-label="Actions principales du lead"><span>Actions rapides</span><Link className="secondary-button" href={leadSectionHref(leadId, "timeline")}><Clock size={18} /> Timeline</Link><Link className="secondary-button" href={leadSectionHref(leadId, "appointments")}><CalendarBlank size={18} /> Rendez-vous</Link><Link className="secondary-button" href={leadSectionHref(leadId, "status")}><PencilSimple size={18} /> Statut</Link><Link className="primary-button" href={leadSectionHref(leadId, "collaborators")}><UserSwitch size={18} /> Affecter</Link></nav>;
}

function LeadSectionLinks(): React.JSX.Element {
  const { leadId } = useParams<{ leadId: string }>();
  return <nav className="lead-section-links" aria-label="Sections de la fiche"><Link href={leadSectionHref(leadId, "timeline")}>Timeline immuable</Link><Link href={leadSectionHref(leadId, "follow-ups")}>Relances</Link><Link href={leadSectionHref(leadId, "appointments")}>Rendez-vous</Link><Link href={leadSectionHref(leadId, "documents")}>Documents</Link><Link href={leadSectionHref(leadId, "status")}>Changement de statut</Link></nav>;
}

export default function LeadDetailPage(): React.JSX.Element {
  return <main className="lead-detail-page">
    <PageHeader eyebrow="Fiche prospect" title="Fiche lead persistante" description="Les données visibles et les actions disponibles restent contrôlées par l’API et les droits de la session." />
    <LeadPrimaryActions />
    <section className="panel lead-record-panel" aria-labelledby="lead-record-title"><h2 id="lead-record-title" className="sr-only">Données du lead</h2><LeadDetail /></section>
    <p className="privacy-note">Les contacts sont masqués lorsque le rôle ne permet pas leur consultation. Les accès directs sont contrôlés par l’API.</p>
    <LeadSectionLinks />
  </main>;
}
