"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ConnectedResource } from "../_components/connected-resource";
import DashboardReturnLink from "./dashboard-return-link";

function LeadResults(): React.JSX.Element {
  const searchParams = useSearchParams();
  const query = new URLSearchParams(searchParams.toString());
  if (!query.has("page")) query.set("page", "1");
  if (!query.has("pageSize")) query.set("pageSize", "25");
  return <ConnectedResource endpoint={`/api/crm/leads?${query.toString()}`} ariaLabel="Leads issus de PostgreSQL" emptyMessage="Aucun lead ne correspond aux filtres." fields={[{ key: "leadCode", label: "Identifiant" }, { key: "firstName", label: "Prénom" }, { key: "lastName", label: "Nom" }, { key: "status", label: "Statut" }, { key: "program", label: "Formation" }, { key: "assignedToId", label: "Conseiller" }]} itemPathPrefix="/leads" />;
}

export default function LeadsPage(): React.JSX.Element {
  return <main><h1>Files de travail Leads</h1><p>Recherche et filtres combinables, transmis à l’API persistante et conservés dans une URL partageable.</p>
    <DashboardReturnLink />
    <nav aria-label="Vues Leads"><a href="/leads?view=ALL">Tous les leads</a> <a href="/leads?view=MINE">Mes leads</a> <a href="/leads?view=FOLLOW_UP">À relancer</a> <a href="/leads?view=UNASSIGNED">Non affectés</a> <a href="/leads?view=NO_ACTIVITY">Sans activité</a> <a href="/leads?view=CLOSED">Clôturés</a></nav>
    <nav aria-label="Vues par provenance"><a href="/leads?savedView=FORMINATOR_ZAPIER">Forminator/Zapier</a> <a href="/leads?savedView=YNOV_MA_LEGACY">Ynov.ma historique</a> <a href="/leads?savedView=PHONE_CALLS">Appels</a> <a href="/leads?savedView=PHYSICAL_VISITS">Visites</a> <a href="/leads?savedView=JOBINTECH">JobInTech</a> <a href="/leads?savedView=UNCLASSIFIED_SOURCES">Sources non classifiées</a> <a href="/leads?savedView=INCOMPLETE">À compléter</a> <a href="/leads?savedView=IMPORT_ERRORS">Imports en erreur</a></nav>
    <form action="/leads" method="get" aria-label="Recherche et filtres des leads"><label>Identité ou identifiant <input name="search" placeholder="Nom, email, téléphone ou LD-…" /></label><label>Conseiller <input name="assignedToId" /></label><label>Statut <select name="status"><option value="">Tous</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label><label>Source <input name="source" /></label><label>Formation <input name="program" /></label><label>Campagne <input name="campaign" /></label><label>Campus <input name="campus" /></label><label>Mode d’affectation <input name="assignmentMode" /></label><label>Lot d’import <input name="importBatchId" /></label><label>Du <input name="createdFrom" type="date" /></label><label>Au <input name="createdTo" type="date" /></label><label>Trier par <select name="sortBy"><option value="createdAt">Date</option><option value="leadCode">Identifiant</option><option value="lastName">Nom</option><option value="status">Statut</option></select></label><input name="page" type="hidden" value="1" /><input name="pageSize" type="hidden" value="25" /><button type="submit">Appliquer</button></form>
    <Suspense fallback={<p role="status">Préparation des filtres…</p>}><LeadResults /></Suspense>
    <nav aria-label="Pagination">Pagination pilotée par l’API</nav>
  </main>;
}
