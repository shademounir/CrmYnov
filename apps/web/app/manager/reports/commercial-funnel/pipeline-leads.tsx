"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiString, type ApiValue } from "../../../_components/connected-resource";
import { followUpDate, leadDirectoryLabel, leadDirectoryNameParts, leadDirectoryStatus } from "../../../leads/lead-directory";
import { FirstTreatmentIndicator } from "../../../leads/first-treatment-indicator";
import { readLeadListPage, type LeadListPage } from "../../../leads/lead-list-query";
import { buildLeadListHref, temperatures } from "./funnel-contract";

/** Navigation context is not an API filter. The directory API owns visibility. */
export function pipelineLeadEndpoint(filters: Record<string, string>, page: number): string {
  const query = new URLSearchParams(buildLeadListHref(filters).split("?")[1]);
  query.delete("returnTo"); query.set("page", String(page)); query.set("pageSize", "12");
  query.set("sortBy", "lastTreatmentAt"); query.set("sortDirection", "asc");
  return `/api/crm/leads?${query}`;
}

export function PipelineLeadCards({ data, generatedAt }: Readonly<{ data: LeadListPage; generatedAt: string }>): React.JSX.Element {
  return <ul className="pipeline-lead-cards">{data.items.map((lead, index) => {
    const id = apiString(lead, "id");
    const code = leadDirectoryLabel(apiString(lead, "leadCode"), "Dossier");
    const name = leadDirectoryNameParts(lead).join(" ") || "Prospect à vérifier";
    const adviser = apiString(lead, "assignedToId") ? leadDirectoryLabel(apiString(lead, "assignedToLabel"), "Affecté · nom indisponible") : "Non affecté";
    const temperature = temperatures.find((item) => item.key === lead.temperature)?.label ?? "Température indisponible";
    const last = apiString(lead, "lastTreatmentAt"), due = apiString(lead, "nextActionAt");
    const active = lead.hasActiveNextAction;
    const overdue = active === true && Date.parse(due) < Date.parse(generatedAt);
    return <li key={id || index} className="pipeline-lead-card">
      <header><strong><bdi dir="auto">{name}</bdi></strong><small>{code}</small></header>
      <p>{leadDirectoryStatus(apiString(lead, "status"))} · {temperature}</p>
      <dl><div><dt>Conseiller principal</dt><dd>{adviser}</dd></div>
        <div><dt>Dernier traitement commercial</dt><dd>{last ? <time dateTime={last}>{followUpDate(last)}</time> : lead.treatmentState === "NONE" ? "Aucun traitement connu" : "Date inconnue"}{lead.hasUndatedHistory === true ? <small>Historique également non daté</small> : null}</dd></div>
        <div><dt>Prochaine action</dt><dd>{active === true ? <><span>Action persistée · </span>{due ? <time dateTime={due}>{followUpDate(due)}</time> : "Échéance indisponible"}{overdue ? <strong className="pipeline-lead-overdue">En retard à la génération du rapport</strong> : null}</>
          : active === false ? <><span>{["ENROLLED", "CLOSED_LOST"].includes(apiString(lead, "status")) ? "Dossier clôturé" : "Aucune action active persistée"}</span>{due ? <small>Date historique : {followUpDate(due)} · ne prouve pas une planification</small> : null}</>
            : <span>Planification non confirmée par cette réponse</span>}</dd></div></dl>
      <FirstTreatmentIndicator lead={lead} />
      {id ? <Link href={`/leads/${encodeURIComponent(id)}`}>Ouvrir le dossier et son action</Link> : <span>Fiche indisponible</span>}
    </li>;
  })}</ul>;
}

type State = { kind: "loading" } | { kind: "ready"; data: LeadListPage } | { kind: "error"; message: string };
export function PipelineLeads({ filters, generatedAt }: Readonly<{ filters: Record<string, string>; generatedAt: string }>): React.JSX.Element {
  const [page, setPage] = useState(1), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  const endpoint = pipelineLeadEndpoint(filters, page);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setState({ kind: "loading" });
    const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
    void (async (): Promise<void> => {
      try {
        const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Session expirée : reconnectez-vous pour consulter les dossiers." : response.status === 403 ? "Votre périmètre ne permet pas de consulter ces dossiers." : "Dossiers indisponibles. Aucun total n’est déduit du rapport.");
        const data = readLeadListPage(await response.json() as ApiValue);
        if (data.page !== page || data.pageSize !== 12) throw new Error("Pagination non confirmée par le serveur.");
        if (current) setState({ kind: "ready", data });
      } catch (error) { if (current) setState({ kind: "error", message: controller.signal.aborted ? "Délai dépassé. Réessayez sans modifier vos filtres." : error instanceof Error ? error.message : "Chargement impossible." }); }
      finally { globalThis.clearTimeout(timeout); }
    })();
    return (): void => { current = false; controller.abort(); globalThis.clearTimeout(timeout); };
  }, [endpoint, page, attempt]);
  return <section className="pipeline-pilot-panel pipeline-leads" aria-labelledby="pipeline-leads-title">
    <h2 id="pipeline-leads-title">Dossiers de la sélection</h2>
    <p>Mêmes filtres de cohorte et droits que la liste. Lecture séparée du rapport : des écritures entre ces lectures peuvent faire évoluer le total.</p>
    {state.kind === "loading" ? <p role="status" aria-busy="true">Chargement des dossiers…</p> : null}
    {state.kind === "error" ? <div role="alert"><p>{state.message}</p><button type="button" onClick={(): void => setAttempt((value) => value + 1)}>Réessayer les dossiers</button></div> : null}
    {state.kind === "ready" ? <><p role="status">{state.data.items.length} dossiers affichés sur {state.data.total} · page {state.data.page}</p>
      {state.data.items.length ? <PipelineLeadCards data={state.data} generatedAt={generatedAt} /> : <p>Aucun dossier renvoyé pour cette page.</p>}
      <nav aria-label="Pagination des dossiers Pipeline"><button type="button" disabled={page === 1} onClick={(): void => setPage((value) => value - 1)}>Dossiers précédents</button><button type="button" disabled={state.data.page * state.data.pageSize >= state.data.total} onClick={(): void => setPage((value) => value + 1)}>Dossiers suivants</button></nav></> : null}
  </section>;
}
