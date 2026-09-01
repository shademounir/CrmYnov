"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Funnel, Plus } from "@phosphor-icons/react";
import { ConnectedResource } from "../_components/connected-resource";
import { PageHeader } from "../_components/ui/page-header";
import DashboardReturnLink from "./dashboard-return-link";

function LeadResults(): React.JSX.Element {
  const searchParams = useSearchParams();
  const query = new URLSearchParams(searchParams.toString());
  if (!query.has("page")) query.set("page", "1");
  if (!query.has("pageSize")) query.set("pageSize", "25");
  return <ConnectedResource endpoint={`/api/crm/leads?${query.toString()}`} ariaLabel="Leads issus de PostgreSQL" emptyMessage="Aucun lead ne correspond aux filtres." fields={[{ key: "leadCode", label: "Identifiant" }, { key: "firstName", label: "Prénom" }, { key: "lastName", label: "Nom" }, { key: "status", label: "Statut" }, { key: "program", label: "Formation" }, { key: "assignedToId", label: "Conseiller" }]} itemPathPrefix="/leads" />;
}

export default function LeadsPage(): React.JSX.Element {
  return <main className="leads-page">
    <PageHeader eyebrow="Base prospects" title="Tous les leads" description="Centralisez, qualifiez et affectez chaque opportunité." actions={<Link className="primary-button" href="/leads/new"><Plus size={19} weight="bold" /> Nouveau lead</Link>} />
    <DashboardReturnLink />
    <nav className="saved-views" aria-label="Vues Leads"><Link href="/leads?view=ALL">Tous les leads</Link><Link href="/leads?view=MINE">Mes leads</Link><Link href="/leads?view=FOLLOW_UP">À relancer</Link><Link href="/leads?view=UNASSIGNED">Non affectés</Link><Link href="/leads?view=NO_ACTIVITY">Sans activité</Link><Link href="/leads?view=CLOSED">Clôturés</Link></nav>
    <section className="panel leads-work-panel">
      <form className="lead-filter-form" action="/leads" method="get" aria-label="Recherche et filtres des leads">
        <div className="lead-toolbar"><label><span className="sr-only">Identité ou identifiant</span><input name="search" placeholder="Rechercher par nom, email, téléphone ou LD-…" /></label><label><span className="sr-only">Statut</span><select name="status"><option value="">Tous les statuts</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label><button className="secondary-button" type="submit"><Funnel size={18} /> Appliquer</button></div>
        <details className="advanced-filters"><summary>Filtres avancés</summary><div className="filter-grid"><label>Conseiller<input name="assignedToId" /></label><label>Source<input name="source" /></label><label>Formation<input name="program" /></label><label>Campagne<input name="campaign" /></label><label>Campus<input name="campus" /></label><label>Mode d’affectation<input name="assignmentMode" /></label><label>Lot d’import<input name="importBatchId" /></label><label>Du<input name="createdFrom" type="date" /></label><label>Au<input name="createdTo" type="date" /></label><label>Trier par<select name="sortBy"><option value="createdAt">Date</option><option value="leadCode">Identifiant</option><option value="lastName">Nom</option><option value="status">Statut</option></select></label></div></details>
        <input name="page" type="hidden" value="1" /><input name="pageSize" type="hidden" value="25" />
      </form>
      <nav className="provenance-views" aria-label="Vues par provenance"><Link href="/leads?savedView=FORMINATOR_ZAPIER">Forminator/Zapier</Link><Link href="/leads?savedView=YNOV_MA_LEGACY">Ynov.ma historique</Link><Link href="/leads?savedView=PHONE_CALLS">Appels</Link><Link href="/leads?savedView=PHYSICAL_VISITS">Visites</Link><Link href="/leads?savedView=JOBINTECH">JobInTech</Link><Link href="/leads?savedView=UNCLASSIFIED_SOURCES">Sources non classifiées</Link><Link href="/leads?savedView=INCOMPLETE">À compléter</Link><Link href="/leads?savedView=IMPORT_ERRORS">Imports en erreur</Link></nav>
      <Suspense fallback={<section className="connected-state" aria-busy="true"><span className="ui-skeleton connected-state__skeleton" /><span className="sr-only">Préparation des filtres…</span></section>}><LeadResults /></Suspense>
    </section>
    <nav className="api-pagination-note" aria-label="Pagination">Pagination pilotée par l’API</nav>
  </main>;
}
