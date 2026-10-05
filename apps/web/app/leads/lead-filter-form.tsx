"use client";

import React from "react";
import { Funnel } from "@phosphor-icons/react";
import type { LeadPageMode } from "./lead-page-mode";

function CreatedFromFilter({ initialValue }: Readonly<{ initialValue: string }>): React.JSX.Element {
  const [boundary, setBoundary] = React.useState(initialValue);
  return <label>Du<input name="createdFrom" type="hidden" value={boundary} /><input type="date" defaultValue={initialValue.slice(0, 10)} onChange={(event) => setBoundary(event.target.value)} /></label>;
}

export function LeadFilterForm({ current, mode }: Readonly<{ current: URLSearchParams; mode: LeadPageMode }>): React.JSX.Element {
  return <form className="lead-filter-form" action="/leads" method="get" aria-label={mode === "follow-up" ? "Recherche dans les relances" : "Recherche et filtres des leads"}>
    {["adviserId", "createdBefore", "channel", "returnTo"].map((key) => current.has(key) ? <input key={key} name={key} type="hidden" value={current.get(key) ?? ""} /> : null)}
    <div className="lead-toolbar"><label><span className="sr-only">Identité ou identifiant</span><input name="search" defaultValue={current.get("search") ?? ""} placeholder="Rechercher par nom, email, téléphone ou LD-…" /></label><label><span className="sr-only">Statut</span><select name="status" defaultValue={current.get("status") ?? ""}><option value="">Tous les statuts</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label><label><span className="sr-only">Température</span><select name="temperature" defaultValue={current.get("temperature") ?? ""}><option value="">Toutes les températures</option><option value="UNEVALUATED">Non évalué</option><option value="COLD">Froid</option><option value="WARM">Tiède</option><option value="HOT">Chaud</option></select></label><button className="secondary-button" type="submit"><Funnel size={18} /> Appliquer</button></div>
    <details className="advanced-filters"><summary>Filtres avancés</summary><div className="filter-grid"><label>Conseiller<input name="assignedToId" defaultValue={current.get("assignedToId") ?? ""} /></label><label>Source<input name="source" defaultValue={current.get("source") ?? ""} /></label><label>Formation<input name="program" defaultValue={current.get("program") ?? ""} /></label><label>Campagne<input name="campaign" defaultValue={current.get("campaign") ?? ""} /></label><label>Campus<input name="campus" defaultValue={current.get("campus") ?? ""} /></label><label>Mode d’affectation<input name="assignmentMode" defaultValue={current.get("assignmentMode") ?? ""} /></label><label>Lot d’import<input name="importBatchId" defaultValue={current.get("importBatchId") ?? ""} /></label><CreatedFromFilter key={current.get("createdFrom") ?? ""} initialValue={current.get("createdFrom") ?? ""} /><label>Au<input name="createdTo" type="date" defaultValue={current.get("createdTo") ?? ""} /></label><label>Trier par<select name="sortBy" defaultValue={current.get("sortBy") ?? "createdAt"}><option value="createdAt">Date</option><option value="leadCode">Identifiant</option><option value="lastName">Nom</option><option value="status">Statut</option></select></label></div></details>
    {mode === "follow-up" ? <input name="view" type="hidden" value="FOLLOW_UP" /> : null}
    <input name="page" type="hidden" value="1" /><input name="pageSize" type="hidden" value="25" />
  </form>;
}
