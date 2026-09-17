import { PhoneCall } from "@phosphor-icons/react/dist/ssr";
import React from "react";
import { LeadCalls } from "./lead-calls";

export default async function LeadCallsPage({ params }: Readonly<{ params: Promise<{ leadId: string }> }>): Promise<React.JSX.Element> {
  const { leadId } = await params;
  return <main className="calls-page lead-calls-page"><a className="back-link" href={`/leads/${encodeURIComponent(leadId)}`}>← Retour au dossier du Lead</a><header className="ui-page-header calls-page__header"><div><p className="eyebrow">Dossier · Téléphonie</p><h1>Historique des appels</h1><p>Les états techniques sont conservés sans exposer le numéro complet ni simuler un fournisseur réel.</p></div><span className="calls-page__icon" aria-hidden="true"><PhoneCall size={24} /></span></header><LeadCalls leadId={leadId} /></main>;
}
