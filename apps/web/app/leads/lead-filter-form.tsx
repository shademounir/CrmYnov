"use client";

import React from "react";
import Link from "next/link";
import { Funnel, X } from "@phosphor-icons/react";
import type { LeadPageMode } from "./lead-page-mode";
import { leadListFilterLabels, leadListFilterValue, leadListHref, leadListResetHref } from "./lead-list-query";

function DateBoundaryFilter({ name, label, initialValue }: Readonly<{ name: "createdFrom" | "createdTo"; label: string; initialValue: string }>): React.JSX.Element {
  const [boundary, setBoundary] = React.useState(initialValue);
  return <label>{label}<input name={name} type="hidden" value={boundary} /><input type="date" aria-label={label}
    defaultValue={initialValue.slice(0, 10)} onChange={(event) => setBoundary(event.target.value ? `${event.target.value}T${name === "createdTo" ? "23:59:59.999" : "00:00:00.000"}Z` : "")} /></label>;
}

export function LeadFilterChips({ current }: Readonly<{ current: URLSearchParams }>): React.JSX.Element {
  const filters = Object.entries(leadListFilterLabels).filter(([key]) => current.get(key) && (!current.get("sharedViewId") || key === "sharedViewId") && !(key === "view" && current.get(key)?.toUpperCase() === "ALL"));
  return <section className="lead-active-filters" aria-label="Filtres actifs">
    <div><strong>{filters.length ? "Filtres actifs" : "Aucun filtre actif"}</strong><Link href={leadListResetHref(current)}>Réinitialiser les filtres</Link></div>
    {filters.length ? <ul>{filters.map(([key, label]) => <li key={key}><span>{label} : {leadListFilterValue(key, current.get(key) ?? "", current)}</span><Link prefetch={false} href={leadListHref(current, { [key]: null })} aria-label={`Retirer le filtre ${label}`}><X size={16} aria-hidden="true" /></Link></li>)}</ul> : null}
  </section>;
}

export function LeadFilterForm({ current, mode }: Readonly<{ current: URLSearchParams; mode: LeadPageMode }>): React.JSX.Element {
  const [people, setPeople] = React.useState<Array<{ id: string; label: string }>>([]);
  const [peopleState, setPeopleState] = React.useState<"loading" | "ready" | "error">("loading");
  React.useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/crm/leads/filter-options", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("filter_options_unavailable");
      const data = await response.json() as { advisers?: Array<{ id: string; label: string }> };
      if (!Array.isArray(data.advisers)) throw new Error("filter_options_invalid");
      setPeople(data.advisers); setPeopleState("ready");
    }).catch(() => { if (!controller.signal.aborted) setPeopleState("error"); });
    return (): void => controller.abort();
  }, []);
  const sharedView = Boolean(current.get("sharedViewId"));
  const visibleKeys = new Set(["search", "status", "temperature", "assignedToId", "assignedToLabel", "collaboratorId", "collaboratorLabel", "source", "program", "campaign", "campus", "assignmentMode", "importBatchId", "createdFrom", "createdTo", "sortBy", "sortDirection", "pageSize", "page"]);
  // Context fields are not owned by this form (shared view, provenance, drill-down, return URL).
  const preserved = [...current.entries()].filter(([key]) => !visibleKeys.has(key));
  return <form className="lead-filter-form" action="/leads" method="get" aria-label={mode === "follow-up" ? "Recherche dans les relances" : "Recherche et filtres des leads"}>
    {preserved.map(([key, value], index) => <input key={`${key}-${index}`} name={key} type="hidden" value={value} />)}
    {mode === "follow-up" && !current.has("view") ? <input name="view" type="hidden" value="FOLLOW_UP" /> : null}
    {sharedView ? <p className="lead-shared-context">La définition de cette vue partagée est relue par le serveur. Ses filtres sont en lecture seule. <Link href={leadListHref(current, { sharedViewId: null })}>Quitter la vue partagée pour ajuster les filtres</Link></p> : null}
    <fieldset className="lead-filter-fields" disabled={sharedView} hidden={sharedView}>
      <legend className="sr-only">Recherche, filtres et tri</legend>
      <div className="lead-toolbar">
        <label><span className="sr-only">Identité ou identifiant</span><input name="search" defaultValue={current.get("search") ?? ""} placeholder="Nom, email, téléphone ou LD-…" type="search" /></label>
        <label><span className="sr-only">Statut</span><select name="status" defaultValue={current.get("status") ?? ""}><option value="">Tous les statuts</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
        <label><span className="sr-only">Température</span><select name="temperature" defaultValue={current.get("temperature") ?? ""}><option value="">Toutes les températures</option><option value="UNEVALUATED">Non évalué</option><option value="COLD">Froid</option><option value="WARM">Tiède</option><option value="HOT">Chaud</option></select></label>
        <button className="secondary-button" type="submit"><Funnel size={18} aria-hidden="true" /> Appliquer</button>
      </div>
      <div className="filter-grid">
        <PersonFilter name="assignedToId" label="Conseiller principal" current={current} people={people} state={peopleState} />
        <PersonFilter name="collaboratorId" label="Collaborateur" current={current} people={people} state={peopleState} />
      </div>
      <details className="advanced-filters"><summary>Filtres avancés et tri</summary><div className="filter-grid">
        <label>Source<input name="source" defaultValue={current.get("source") ?? ""} /></label>
        <label>Formation<input name="program" defaultValue={current.get("program") ?? ""} /></label>
        <label>Campagne<input name="campaign" defaultValue={current.get("campaign") ?? ""} /></label>
        <label>Campus<input name="campus" defaultValue={current.get("campus") ?? ""} /></label>
        <label>Mode d’affectation<input name="assignmentMode" defaultValue={current.get("assignmentMode") ?? ""} /></label>
        <label>Lot d’import<input name="importBatchId" defaultValue={current.get("importBatchId") ?? ""} /></label>
        <DateBoundaryFilter name="createdFrom" label="Créés à partir du" initialValue={current.get("createdFrom") ?? ""} />
        <DateBoundaryFilter name="createdTo" label="Créés jusqu’au (inclus)" initialValue={current.get("createdTo") ?? ""} />
        <label>Trier par<select name="sortBy" defaultValue={current.get("sortBy") ?? "createdAt"}><option value="createdAt">Date de création</option><option value="leadCode">Identifiant</option><option value="lastName">Nom</option><option value="status">Statut</option></select></label>
        <label>Sens du tri<select name="sortDirection" defaultValue={current.get("sortDirection") ?? "desc"}><option value="desc">Décroissant</option><option value="asc">Croissant</option></select></label>
        <label>Résultats par page<input name="pageSize" type="number" min={1} max={100} required defaultValue={current.get("pageSize") ?? "25"} /></label>
      </div><p className="lead-filter-help">Les journées saisies couvrent une journée UTC complète. Les bornes horaires déjà présentes dans l’URL restent inchangées tant que la date n’est pas modifiée.{mode === "follow-up" ? " La file de relances est toujours ordonnée par échéance, la plus ancienne d’abord." : ""}</p></details>
    </fieldset>
    <input name="page" type="hidden" value="1" />
  </form>;
}

function PersonFilter({ name, label, current, people, state }: Readonly<{ name: "assignedToId" | "collaboratorId"; label: string; current: URLSearchParams; people: Array<{ id: string; label: string }>; state: "loading" | "ready" | "error" }>): React.JSX.Element {
  const [id, setId] = React.useState(current.get(name) ?? "");
  const selected = people.find((person) => person.id === id);
  const labelKey = name === "assignedToId" ? "assignedToLabel" : "collaboratorLabel";
  return <label>{label}<select name={name} value={id} onChange={(event) => setId(event.target.value)} aria-busy={state === "loading"}>
    <option value="">Tous les {name === "assignedToId" ? "conseillers" : "collaborateurs"}</option>
    {id && !selected ? <option value={id}>{current.get(labelKey) || "Personne du filtre actuel"}</option> : null}
    {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
  </select>{id && (selected?.label || current.get(labelKey)) ? <input name={labelKey} type="hidden" value={selected?.label || current.get(labelKey) || ""} /> : null}{state === "error" ? <small role="status">Liste momentanément indisponible.</small> : null}</label>;
}
