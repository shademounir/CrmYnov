"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../../../_components/ui/page-header";
import { PipelineLeadCards } from "../commercial-funnel/pipeline-leads";
import { readLeadListPage, type LeadListPage } from "../../../leads/lead-list-query";
import type { ApiValue } from "../../../_components/connected-resource";

export const workViews = { NEW_RECEIVED: "Nouveaux reçus", TO_CONTACT: "À contacter", FIRST_TREATMENT_OVERDUE: "Premier traitement en retard", ACTIVE_FOLLOW_UP: "Relances en attente", OVERDUE_FOLLOW_UP: "Relances en retard", NEXT_ACTION_MISSING: "Prochaine action manquante", PENDING_CLOSURE: "Clôtures à valider" } as const;
const keys = Object.keys(workViews);
const queuePriority = (key: string): number => key === "FIRST_TREATMENT_OVERDUE" ? 0 : key === "OVERDUE_FOLLOW_UP" ? 1 : key === "NEXT_ACTION_MISSING" ? 2 : key === "NEW_RECEIVED" ? 3 : 4;
interface Queue { key: string; label: string; leadCount: number; itemCount: number; itemUnit: "LEADS" | "ACTIONS" | "REQUESTS"; href: string; leadShare: { numerator: number; denominator: number; value: number | null }; subsetRate?: { numerator: number; denominator: number; value: number | null; unit: "LEADS" | "ACTIONS"; denominatorQueue: string; label: string } }
type Actions = Record<"active" | "future" | "dueNow" | "overdue" | "invalidDeadline" | "completed" | "cancelled", number>;
interface WorkReport { filters?: Record<string, string>; queues: Queue[]; selectedQueue: string; page: LeadListPage; definitions: string[]; generatedAt: string; actions: Actions; cohort: { leadCount: number; from?: string; to?: string }; advisers: Array<{ adviserId: string; adviserLabel?: string; leadCount: number; queues: Queue[]; actions: Actions }> }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function actions(value: unknown): value is Actions {
  return object(value) && ["active", "future", "dueNow", "overdue", "invalidDeadline", "completed", "cancelled"].every((key) => count(value[key]))
    && value.active === Number(value.future) + Number(value.dueNow) + Number(value.overdue) + Number(value.invalidDeadline);
}
function queue(value: unknown): value is Queue {
  if (!object(value) || !keys.some((key) => key === value.key) || typeof value.label !== "string" || !count(value.leadCount) || !count(value.itemCount)
    || !["LEADS", "ACTIONS", "REQUESTS"].includes(String(value.itemUnit)) || value.itemCount < value.leadCount || value.itemUnit === "LEADS" && value.itemCount !== value.leadCount
    || typeof value.href !== "string" || !value.href.startsWith("/manager/reports/commercial-work?") || !object(value.leadShare)) return false;
  const rate = value.leadShare;
  return new URLSearchParams(value.href.split("?")[1]).get("queue") === value.key && count(rate.numerator) && rate.numerator === value.leadCount && count(rate.denominator) && rate.numerator <= rate.denominator
    && (rate.denominator === 0 ? rate.value === null : rate.value === rate.numerator / rate.denominator);
}
export function parseWorkReport(value: unknown): WorkReport {
  const expectedKeys = object(value) && value.definitionVersion === "commercial-work-v2" ? keys : keys.filter(key => key !== "NEW_RECEIVED");
  const candidateQueues = object(value) && Array.isArray(value.queues) ? value.queues : [];
  if (!object(value) || !["commercial-work-v1", "commercial-work-v2"].includes(String(value.definitionVersion)) || value.timezone !== "Africa/Casablanca" || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.queues) || value.queues.length !== expectedKeys.length || !value.queues.every(queue) || new Set(value.queues.map((item) => item.key)).size !== expectedKeys.length || !expectedKeys.every(key => candidateQueues.some((item: Queue) => item.key === key))
    || !object(value.cohort) || !count(value.cohort.leadCount) || !["CURRENT_PRIMARY_ADVISER", "INVOLVED_ADVISER"].includes(String(value.cohort.attribution)) || value.cohort.dateBasis !== "LEAD_CREATED_COHORT_CURRENT_STATE" || ![value.cohort.from, value.cohort.to].every((date) => date === undefined || typeof date === "string" && Number.isFinite(Date.parse(date)))
    || !actions(value.actions) || !Array.isArray(value.advisers) || !value.advisers.every((item) => object(item) && typeof item.adviserId === "string" && (item.adviserLabel === undefined || typeof item.adviserLabel === "string") && count(item.leadCount) && actions(item.actions) && Array.isArray(item.queues) && item.queues.length === expectedKeys.length && item.queues.every(queue) && new Set(item.queues.map((entry) => entry.key)).size === expectedKeys.length && item.queues.every((entry) => entry.leadShare.denominator === item.leadCount))
    || !Array.isArray(value.definitions) || !value.definitions.every((item) => typeof item === "string")) throw new Error("commercial_work_contract_invalid");
  const page = readLeadListPage(value.page as ApiValue);
  const denominator = value.cohort.leadCount;
  const selected = value.queues.find((item) => item.key === value.selectedQueue);
  if (!selected || selected.leadCount !== page.total || value.queues.some((item) => item.leadShare.denominator !== denominator)) throw new Error("commercial_work_selection_inconsistent");
  if (value.definitionVersion === "commercial-work-v2" && (!object(value.filters) || !Object.values(value.filters).every(item => typeof item === "string"))) throw new Error("commercial_work_filters_invalid");
  if (value.definitionVersion === "commercial-work-v2") for (const rows of [value.queues, ...value.advisers.map(item => (item as { queues: Queue[] }).queues)]) {
    for (const [key, denominatorKey, unit] of [["FIRST_TREATMENT_OVERDUE", "TO_CONTACT", "LEADS"], ["OVERDUE_FOLLOW_UP", "ACTIVE_FOLLOW_UP", "ACTIONS"]]) {
      const row = rows.find(item => item.key === key)!, base = rows.find(item => item.key === denominatorKey)!, rate = row.subsetRate;
      const numerator = unit === "ACTIONS" ? row.itemCount : row.leadCount, expected = unit === "ACTIONS" ? base.itemCount : base.leadCount;
      if (!rate || rate.numerator !== numerator || rate.denominator !== expected || rate.denominatorQueue !== denominatorKey || rate.unit !== unit || typeof rate.label !== "string" || numerator > expected || (expected === 0 ? rate.value !== null : rate.value !== numerator / expected)) throw new Error("commercial_work_rate_inconsistent");
    }
  }
  const report = { ...value, page } as unknown as WorkReport;
  if (new Set(report.advisers.map(adviser => adviser.adviserId)).size !== report.advisers.length) throw new Error("commercial_work_advisers_inconsistent");
  for (const total of report.queues) {
    const rows = report.advisers.map(adviser => adviser.queues.find(item => item.key === total.key));
    if (rows.some(item => !item || item.itemUnit !== total.itemUnit)
      || rows.reduce((sum, item) => sum + (item?.leadCount ?? 0), 0) > total.leadCount
      || rows.reduce((sum, item) => sum + (item?.itemCount ?? 0), 0) > total.itemCount) throw new Error("commercial_work_advisers_inconsistent");
  }
  return report;
}
function ActionStates({ data }: Readonly<{ data: Actions }>): React.JSX.Element {
  const labels = { active: "Actions actives", future: "Futures", dueNow: "Échues maintenant", overdue: "En retard", invalidDeadline: "Échéance à vérifier", completed: "Réalisées", cancelled: "Annulées — pas réalisées" };
  return <dl className="pipeline-lead-cards">{(Object.keys(labels) as Array<keyof Actions>).map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{data[key]}</dd></div>)}</dl>;
}
export function QueueAdviserBreakdown({ item, advisers }: Readonly<{ item: Queue; advisers: WorkReport["advisers"] }>): React.JSX.Element {
  const rows = advisers.map(adviser => ({ adviser, queue: adviser.queues.find(row => row.key === item.key)! }));
  const unassignedLeads = item.leadCount - rows.reduce((sum, row) => sum + row.queue.leadCount, 0);
  const unassignedItems = item.itemCount - rows.reduce((sum, row) => sum + row.queue.itemCount, 0);
  const amount = (leads: number, items: number): React.JSX.Element => <span className="work-queue-adviser-count"><strong>{leads}</strong> {leads === 1 ? "Lead" : "Leads"}{item.itemUnit === "LEADS" ? null : <small>{items} {item.itemUnit === "ACTIONS" ? items === 1 ? "action" : "actions" : items === 1 ? "demande" : "demandes"}</small>}</span>;
  return <section className="work-queue-advisers" aria-label={`Leads par conseiller · ${item.label}`}>
    <p>Par conseiller principal · nom d’utilisateur CRM</p>
    <ul>{rows.map(({ adviser, queue }) => <li key={adviser.adviserId}><bdi dir="auto" className="work-queue-adviser-label">{adviser.adviserLabel?.trim() ? adviser.adviserLabel : "Conseiller · nom indisponible"}</bdi>{amount(queue.leadCount, queue.itemCount)}</li>)}
      {unassignedLeads > 0 || unassignedItems > 0 ? <li><span>Sans conseiller principal</span>{amount(unassignedLeads, unassignedItems)}</li> : null}
    </ul>
    {rows.length === 0 && unassignedLeads === 0 && unassignedItems === 0 ? <p>Aucun conseiller principal dans cette cohorte.</p> : null}
  </section>;
}
function QueueLink({ item, onSelect, selected = false, advisers }: Readonly<{ item: Queue; onSelect?: ((href: string) => void) | undefined; selected?: boolean; advisers?: WorkReport["advisers"] }>): React.JSX.Element {
  const unit = item.itemUnit === "ACTIONS" ? "actions" : item.itemUnit === "REQUESTS" ? "demandes" : "leads";
  const rate = item.subsetRate;
  return <div className="pipeline-lead-card work-queue" data-selected={selected}><h3>{onSelect ? <button className="text-button" type="button" aria-pressed={selected} onClick={() => onSelect(item.href)}>{item.label}</button> : <Link href={item.href} aria-current={selected ? "page" : undefined}>{item.label}</Link>}</h3><p><strong>{item.itemCount} {unit}</strong> · {item.leadCount} leads distincts</p>
    <small>Part de la cohorte : {item.leadShare.numerator}/{item.leadShare.denominator} · {percent(item.leadShare.value)}</small>
    {rate ? <p className="work-subset-rate">{rate.label} : <strong>{percent(rate.value)}</strong><small>{rate.numerator}/{rate.denominator} {rate.unit === "ACTIONS" ? "actions" : "leads distincts"}</small></p> : null}
    {advisers ? <QueueAdviserBreakdown item={item} advisers={advisers} /> : null}</div>;
}
function percent(value: number | null): string { return value === null ? "non calculable" : `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`; }
export default function CommercialWork({ query, embedded = false }: Readonly<{ query: string; embedded?: boolean }>): React.JSX.Element {
  const [selection, setSelection] = useState({ base: query, query });
  const activeQuery = selection.base === query ? selection.query : query;
  const [attempt, setAttempt] = useState(0), [loaded, setState] = useState<{ kind: "loading" } | { kind: "ready"; query: string; report: WorkReport } | { kind: "error"; message: string }>({ kind: "loading" });
  // Never paint a previous cohort while the effect for a new filter starts.
  const state = loaded.kind === "ready" && loaded.query !== activeQuery ? { kind: "loading" as const } : loaded;
  useEffect(() => {
    let current = true; const controller = new AbortController(); const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
    setState({ kind: "loading" });
    void (async (): Promise<void> => {
      try {
        const response = await fetch(workApiEndpoint(activeQuery), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Session expirée. Reconnectez-vous pour consulter votre file." : response.status === 403 ? "Votre périmètre ne permet pas cette consultation." : "File indisponible. Vérifiez les filtres ; aucun total n’est confirmé.");
        const report = parseWorkReport(await response.json()); if (current) setState({ kind: "ready", query: activeQuery, report });
      } catch (error) { if (current) setState({ kind: "error", message: controller.signal.aborted ? "Délai de chargement dépassé. Réessayez." : error instanceof Error ? error.message : "Chargement impossible." }); }
      finally { globalThis.clearTimeout(timeout); }
    })();
    return (): void => { current = false; controller.abort(); globalThis.clearTimeout(timeout); };
  }, [activeQuery, attempt]);
  const select = embedded ? (href: string): void => { setSelection({ base: query, query: href.split("?")[1] ?? query }); } : undefined;
  const pageHref = (page: number): string => { const params = new URLSearchParams(activeQuery); params.set("page", String(page)); return `/manager/reports/commercial-work?${params}`; };
  const Wrapper = embedded ? "section" : "main";
  return <Wrapper className={embedded ? "pipeline-work-supervision" : "pipeline-pilot-page pipeline-work-supervision"}>{embedded ? <header><h2>Vues de travail et supervision par conseiller</h2><p>Compteurs et listes issus du même contrat API. Les files se recouvrent : ne pas additionner leurs dossiers.</p></header> : <PageHeader eyebrow="Travail commercial" title="Files et suivi par conseiller" description="Dossiers distincts et actions, sans confondre réalisation et annulation." />}
    {state.kind === "loading" ? <p role="status" aria-busy="true">Chargement des files autorisées…</p> : null}
    {state.kind === "error" ? <section role="alert"><p>{state.message}</p><button type="button" onClick={(): void => setAttempt((value) => value + 1)}>Réessayer</button></section> : null}
    {state.kind === "ready" ? <>
      <p>Période d’ajout au CRM : {state.report.cohort.from ?? "sans borne de début"} (incluse) → {state.report.cohort.to ?? "sans borne de fin"} (exclue). Stock actuel, pas activité réalisée aujourd’hui.</p>
      <p>Campus : {state.report.filters?.campus ?? "périmètre autorisé"} · Campagne : {state.report.filters?.campaign ?? "toutes les campagnes autorisées"} · Source : {state.report.filters?.source ?? "toutes les sources autorisées"}. Conseiller et dernier traitement : filtres de la sélection courante conservés.</p>
      <p>Priorité aux retards de cette cohorte. Le tri des nouveaux entrants ne remplace pas les files urgentes.</p>
      <div className="pipeline-lead-cards" aria-label="Vues de travail">{[...state.report.queues].sort((left, right) => queuePriority(left.key) - queuePriority(right.key)).map((item) => <QueueLink key={item.key} item={item} advisers={state.report.advisers} onSelect={select} selected={item.key === state.report.selectedQueue} />)}</div>
      <details><summary>États des actions de la cohorte</summary><ActionStates data={state.report.actions} /></details>
      <h2>{state.report.queues.find((item) => item.key === state.report.selectedQueue)?.label}</h2>
      <p role="status">{state.report.page.total} dossiers distincts · page {state.report.page.page} · {state.report.page.items.length} affichés</p>
      {state.report.page.items.length ? <PipelineLeadCards data={state.report.page} generatedAt={state.report.generatedAt} /> : <p>Aucun dossier dans cette file autorisée.</p>}
      <nav aria-label="Pagination de la file">{state.report.page.page > 1 ? select ? <button className="secondary-button" type="button" onClick={() => select(pageHref(state.report.page.page - 1))}>Précédente</button> : <Link className="secondary-button" href={pageHref(state.report.page.page - 1)}>Précédente</Link> : null}{state.report.page.page * state.report.page.pageSize < state.report.page.total ? select ? <button className="secondary-button" type="button" onClick={() => select(pageHref(state.report.page.page + 1))}>Suivante</button> : <Link className="secondary-button" href={pageHref(state.report.page.page + 1)}>Suivante</Link> : null}{embedded && activeQuery !== query ? <button type="button" className="text-button" onClick={() => setSelection({ base: query, query })}>Revenir aux filtres de départ</button> : null}</nav>
      <section><h2>Portefeuille principal par conseiller</h2>{state.report.advisers.length ? state.report.advisers.map((adviser) => <details key={adviser.adviserId}><summary>{adviser.adviserLabel ?? "Conseiller · nom indisponible"} · {adviser.leadCount} leads principaux</summary><div className="pipeline-lead-cards">{adviser.queues.map((item) => <QueueLink key={item.key} item={item} onSelect={select} />)}</div><ActionStates data={adviser.actions} /></details>) : <p>Aucun conseiller principal dans ce périmètre.</p>}</section>
      <details><summary>Définitions, période et limites</summary>{state.report.definitions.map((definition) => <p key={definition}>{definition}</p>)}<p>Lecture API générée le {new Date(state.report.generatedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}, heure de Casablanca. Les droits sont revérifiés à chaque ouverture de file.</p></details>
    </> : null}
  </Wrapper>;
}

/** Navigation state is not a server filter, just as in Pipeline drilldowns. */
export function workApiEndpoint(query: string): string {
  const params = new URLSearchParams(query); params.delete("returnTo");
  params.set("contractVersion", "2");
  return `/api/crm/reports/commercial-work?${params.toString()}`;
}

/** Shared Pipeline/dashboard adapter. No rolling default is recomputed when the
 * parent already supplies exact cohort boundaries; omitted bounds stay omitted. */
export function workCohortQuery(filters: Record<string, string>): string {
  const allowed = new Set(["from", "to", "campus", "campaign", "program", "source", "channel", "adviserId", "status", "view", "treatmentFrom", "treatmentTo", "treatmentState"]);
  const params = new URLSearchParams(Object.entries(filters).filter(([key]) => allowed.has(key)));
  params.set("period", params.has("from") && params.has("to") ? "custom" : "open");
  params.set("adviserScope", "INVOLVED"); params.set("queue", "NEW_RECEIVED");
  return params.toString();
}
