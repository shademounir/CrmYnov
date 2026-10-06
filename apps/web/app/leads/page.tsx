"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import { PageHeader } from "../_components/ui/page-header";
import DashboardReturnLink from "./dashboard-return-link";
import { LeadDirectory } from "./lead-directory";
import { SavedViews } from "./saved-views";
import { LeadCreateAccess } from "./lead-create-access";
import { leadPageMode, type LeadPageMode } from "./lead-page-mode";
import { LeadFilterChips, LeadFilterForm } from "./lead-filter-form";
import { leadListHref, leadListResetHref, leadProvenanceViews, leadWorkViews } from "./lead-list-query";

function LeadResults({ queryString, mode }: Readonly<{ queryString: string; mode: LeadPageMode }>): React.JSX.Element {
  const query = new URLSearchParams(queryString);
  if (!query.has("page")) query.set("page", "1");
  if (!query.has("pageSize")) query.set("pageSize", "25");
  const followUp = mode === "follow-up";
  return <LeadDirectory
    key={query.toString()}
    endpoint={`/api/crm/leads?${query.toString()}`}
    ariaLabel={followUp ? "Relances arrivées à échéance dans votre périmètre" : "Leads visibles dans votre périmètre"}
    emptyMessage={followUp ? "Aucune relance arrivée à échéance ne correspond aux filtres." : "Aucun lead ne correspond aux filtres."}
    context={mode}
  />;
}

function LeadsPageContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const current = new URLSearchParams(searchParams.toString());
  const mode = leadPageMode(current.get("view"));
  const followUp = mode === "follow-up";
  const activeView = current.get("view")?.toUpperCase() ?? "ALL";
  const activeProvenance = current.get("savedView")?.toUpperCase();
  const sharedView = Boolean(current.get("sharedViewId"));
  const importErrors = activeProvenance === "IMPORT_ERRORS" && !sharedView;
  const results = <Suspense fallback={<section className="connected-state" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Préparation des filtres…</span></section>}><LeadResults queryString={current.toString()} mode={mode} /></Suspense>;

  return <main className={`leads-page${followUp ? " leads-page--follow-up" : ""}`}>
    <PageHeader
      eyebrow={followUp ? "Suivi commercial" : "Base prospects"}
      title={followUp ? "Relances" : "Tous les leads"}
      description={followUp ? "Traitez les échéances arrivées à terme, de la plus ancienne à la plus récente." : "Centralisez, qualifiez et affectez chaque opportunité."}
      actions={<>{followUp ? <Link className="secondary-button" href={leadListHref(current, { view: "ALL", sharedViewId: null })}><ArrowLeft size={18} aria-hidden="true" /> Tous les leads</Link> : null}<LeadCreateAccess /></>}
    />
    <DashboardReturnLink />
    <nav className="saved-views lead-work-views" aria-label="Files de travail Leads">{leadWorkViews.map(([view, label]) => sharedView
      ? <span key={view} aria-disabled="true">{label}</span>
      : <Link key={view} prefetch={false} href={leadListHref(current, { view })} className={activeView === view ? "active" : undefined} aria-current={activeView === view ? "page" : undefined}>{label}</Link>)}</nav>
    <section className="panel leads-work-panel">
      <LeadFilterChips current={current} />
      <LeadFilterForm key={current.toString()} current={current} mode={mode} />
      <nav className="provenance-views" aria-label="Vues par provenance">
        {leadProvenanceViews.map(([view, label]) => sharedView ? <span key={view} aria-disabled="true">{label}</span> : <Link key={view} prefetch={false} href={leadListHref(current, { savedView: activeProvenance === view ? null : view })} className={activeProvenance === view ? "active" : undefined} aria-current={activeProvenance === view ? "page" : undefined}>{label}</Link>)}
        <span className="lead-import-unavailable" aria-disabled="true" title="L’API ne restitue pas les erreurs d’import dans la liste Leads.">Imports en erreur · indisponible</span>
      </nav>
      {importErrors ? <section className="ui-state" role="status"><h2>File d’erreurs d’import indisponible</h2><p>L’API Leads ne restitue pas les erreurs d’import. Cette vue ne peut pas être interprétée comme « aucun import en erreur ».</p><Link className="secondary-button" href={leadListHref(current, { savedView: null })}>Revenir à la liste des leads</Link></section> : followUp ? <>
        <section className="follow-up-context" aria-label="Priorité de la file"><div><strong>Échéances à traiter</strong><span>La date affichée est restituée en heure de Casablanca.</span></div><span>Ordre : plus ancienne d’abord</span></section>
        {results}
      </> : results}
      <details className="lead-view-tools"><summary>Gérer mes vues et partages</summary><LeadSavedViews current={current} resetHref={leadListResetHref(current)} /></details>
    </section>
  </main>;
}

export default function LeadsPage(): React.JSX.Element {
  return <Suspense fallback={<main className="leads-page" aria-busy="true"><span className="sr-only">Chargement de la liste des Leads…</span></main>}><LeadsPageContent /></Suspense>;
}

function LeadSavedViews({ current, resetHref }: Readonly<{ current: URLSearchParams; resetHref: string }>): React.JSX.Element {
  return <SavedViews current={Object.fromEntries(current.entries())} resetHref={resetHref} />;
}
