"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Funnel } from "@phosphor-icons/react";
import { PageHeader } from "../_components/ui/page-header";
import DashboardReturnLink from "./dashboard-return-link";
import { LeadDirectory } from "./lead-directory";
import { SavedViews } from "./saved-views";
import { LeadCreationDrawer } from "./lead-creation";

type LeadPageMode = "directory" | "follow-up";

export function leadPageMode(view: string | null | undefined): LeadPageMode {
  return view?.trim().toUpperCase() === "FOLLOW_UP" ? "follow-up" : "directory";
}

function LeadResults({ queryString, mode }: Readonly<{ queryString: string; mode: LeadPageMode }>): React.JSX.Element {
  const query = new URLSearchParams(queryString);
  if (!query.has("page")) query.set("page", "1");
  if (!query.has("pageSize")) query.set("pageSize", "25");
  const followUp = mode === "follow-up";
  return <LeadDirectory
    endpoint={`/api/crm/leads?${query.toString()}`}
    ariaLabel={followUp ? "Relances arrivées à échéance issues de PostgreSQL" : "Leads issus de PostgreSQL"}
    emptyMessage={followUp ? "Aucune relance arrivée à échéance ne correspond aux filtres." : "Aucun lead ne correspond aux filtres."}
    context={mode}
  />;
}

function LeadFilterForm({ current, mode }: Readonly<{ current: URLSearchParams; mode: LeadPageMode }>): React.JSX.Element {
  return <form className="lead-filter-form" action="/leads" method="get" aria-label={mode === "follow-up" ? "Recherche dans les relances" : "Recherche et filtres des leads"}>
    <div className="lead-toolbar"><label><span className="sr-only">Identité ou identifiant</span><input name="search" defaultValue={current.get("search") ?? ""} placeholder="Rechercher par nom, email, téléphone ou LD-…" /></label><label><span className="sr-only">Statut</span><select name="status" defaultValue={current.get("status") ?? ""}><option value="">Tous les statuts</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label><label><span className="sr-only">Température</span><select name="temperature" defaultValue={current.get("temperature") ?? ""}><option value="">Toutes les températures</option><option value="UNEVALUATED">Non évalué</option><option value="COLD">Froid</option><option value="WARM">Tiède</option><option value="HOT">Chaud</option></select></label><button className="secondary-button" type="submit"><Funnel size={18} /> Appliquer</button></div>
    <details className="advanced-filters"><summary>Filtres avancés</summary><div className="filter-grid"><label>Conseiller<input name="assignedToId" defaultValue={current.get("assignedToId") ?? ""} /></label><label>Source<input name="source" defaultValue={current.get("source") ?? ""} /></label><label>Formation<input name="program" defaultValue={current.get("program") ?? ""} /></label><label>Campagne<input name="campaign" defaultValue={current.get("campaign") ?? ""} /></label><label>Campus<input name="campus" defaultValue={current.get("campus") ?? ""} /></label><label>Mode d’affectation<input name="assignmentMode" defaultValue={current.get("assignmentMode") ?? ""} /></label><label>Lot d’import<input name="importBatchId" defaultValue={current.get("importBatchId") ?? ""} /></label><label>Du<input name="createdFrom" type="date" defaultValue={current.get("createdFrom") ?? ""} /></label><label>Au<input name="createdTo" type="date" defaultValue={current.get("createdTo") ?? ""} /></label><label>Trier par<select name="sortBy" defaultValue={current.get("sortBy") ?? "createdAt"}><option value="createdAt">Date</option><option value="leadCode">Identifiant</option><option value="lastName">Nom</option><option value="status">Statut</option></select></label></div></details>
    {mode === "follow-up" ? <input name="view" type="hidden" value="FOLLOW_UP" /> : null}
    <input name="page" type="hidden" value="1" /><input name="pageSize" type="hidden" value="25" />
  </form>;
}

const workViews = [
  ["ALL", "Tous les leads"],
  ["MINE", "Mes leads"],
  ["FOLLOW_UP", "À relancer"],
  ["UNASSIGNED", "Non affectés"],
  ["NO_ACTIVITY", "Sans activité"],
  ["CLOSED", "Clôturés"],
] as const;

function LeadsPageContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const current = new URLSearchParams(searchParams.toString());
  const mode = leadPageMode(current.get("view"));
  const followUp = mode === "follow-up";
  const activeView = current.get("view")?.toUpperCase() ?? "ALL";
  const results = <Suspense fallback={<section className="connected-state" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Préparation des filtres…</span></section>}><LeadResults queryString={current.toString()} mode={mode} /></Suspense>;

  return <main className={`leads-page${followUp ? " leads-page--follow-up" : ""}`}>
    <PageHeader
      eyebrow={followUp ? "Suivi commercial" : "Base prospects"}
      title={followUp ? "Relances" : "Tous les leads"}
      description={followUp ? "Traitez les échéances arrivées à terme, de la plus ancienne à la plus récente." : "Centralisez, qualifiez et affectez chaque opportunité."}
      actions={followUp ? <Link className="secondary-button" href="/leads"><ArrowLeft size={18} aria-hidden="true" /> Tous les leads</Link> : <LeadCreationDrawer />}
    />
    <DashboardReturnLink />
    <nav className="saved-views" aria-label="Vues Leads">{workViews.map(([view, label]) => <Link key={view} href={`/leads?view=${view}`} className={activeView === view ? "active" : undefined} aria-current={activeView === view ? "page" : undefined}>{label}</Link>)}</nav>
    <section className="panel leads-work-panel">
      {followUp ? <>
        <section className="follow-up-context" aria-label="Priorité de la file"><div><strong>Échéances à traiter</strong><span>La date affichée est restituée en heure de Casablanca.</span></div><span>Ordre : plus ancienne d’abord</span></section>
        {results}
        <LeadFilterForm current={current} mode={mode} />
        <details className="lead-view-tools"><summary>Gérer mes vues et partages</summary><LeadSavedViews current={current} resetHref="/leads?view=FOLLOW_UP" /></details>
      </> : <>
        <LeadSavedViews current={current} resetHref="/leads" />
        <LeadFilterForm current={current} mode={mode} />
        <nav className="provenance-views" aria-label="Vues par provenance"><Link href="/leads?savedView=FORMINATOR_ZAPIER">Forminator/Zapier</Link><Link href="/leads?savedView=YNOV_MA_LEGACY">Ynov.ma historique</Link><Link href="/leads?savedView=PHONE_CALLS">Appels</Link><Link href="/leads?savedView=PHYSICAL_VISITS">Visites</Link><Link href="/leads?savedView=JOBINTECH">JobInTech</Link><Link href="/leads?savedView=UNCLASSIFIED_SOURCES">Sources non classifiées</Link><Link href="/leads?savedView=INCOMPLETE">À compléter</Link><Link href="/leads?savedView=IMPORT_ERRORS">Imports en erreur</Link></nav>
        {results}
      </>}
    </section>
    <nav className="api-pagination-note" aria-label="Pagination">Pagination pilotée par l’API</nav>
  </main>;
}

export default function LeadsPage(): React.JSX.Element {
  return <Suspense fallback={<main className="leads-page" aria-busy="true"><span className="sr-only">Chargement de la liste des Leads…</span></main>}><LeadsPageContent /></Suspense>;
}

function LeadSavedViews({ current, resetHref }: Readonly<{ current: URLSearchParams; resetHref: string }>): React.JSX.Element {
  return <SavedViews current={Object.fromEntries(current.entries())} resetHref={resetHref} />;
}
