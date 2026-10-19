"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../../../_components/ui/page-header";
import { LeadDirectoryTable } from "../../../leads/lead-directory";
import { readLeadListPage, type LeadListPage } from "../../../leads/lead-list-query";
import type { ApiValue } from "../../../_components/connected-resource";

const keys = ["TO_CONTACT", "FIRST_TREATMENT_OVERDUE", "ACTIVE_FOLLOW_UP", "OVERDUE_FOLLOW_UP", "NEXT_ACTION_MISSING", "PENDING_CLOSURE"] as const;
interface Queue { key: string; label: string; leadCount: number; itemCount: number; itemUnit: "LEADS" | "ACTIONS" | "REQUESTS"; href: string; leadShare: { numerator: number; denominator: number; value: number | null } }
type Actions = Record<"active" | "future" | "dueNow" | "overdue" | "invalidDeadline" | "completed" | "cancelled", number>;
interface WorkReport { queues: Queue[]; selectedQueue: string; page: LeadListPage; definitions: string[]; generatedAt: string; actions: Actions; cohort: { leadCount: number; from?: string; to?: string }; advisers: Array<{ adviserId: string; adviserLabel?: string; leadCount: number; queues: Queue[]; actions: Actions }> }
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
  if (!object(value) || value.definitionVersion !== "commercial-work-v1" || value.timezone !== "Africa/Casablanca" || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.queues) || value.queues.length !== keys.length || !value.queues.every(queue) || new Set(value.queues.map((item) => item.key)).size !== keys.length
    || !object(value.cohort) || !count(value.cohort.leadCount) || value.cohort.attribution !== "CURRENT_PRIMARY_ADVISER" || value.cohort.dateBasis !== "LEAD_CREATED_COHORT_CURRENT_STATE" || ![value.cohort.from, value.cohort.to].every((date) => date === undefined || typeof date === "string" && Number.isFinite(Date.parse(date)))
    || !actions(value.actions) || !Array.isArray(value.advisers) || !value.advisers.every((item) => object(item) && typeof item.adviserId === "string" && (item.adviserLabel === undefined || typeof item.adviserLabel === "string") && count(item.leadCount) && actions(item.actions) && Array.isArray(item.queues) && item.queues.length === keys.length && item.queues.every(queue) && new Set(item.queues.map((entry) => entry.key)).size === keys.length && item.queues.every((entry) => entry.leadShare.denominator === item.leadCount))
    || !Array.isArray(value.definitions) || !value.definitions.every((item) => typeof item === "string")) throw new Error("commercial_work_contract_invalid");
  const page = readLeadListPage(value.page as ApiValue);
  const denominator = value.cohort.leadCount;
  const selected = value.queues.find((item) => item.key === value.selectedQueue);
  if (!selected || selected.leadCount !== page.total || value.queues.some((item) => item.leadShare.denominator !== denominator)) throw new Error("commercial_work_selection_inconsistent");
  return { ...value, page } as unknown as WorkReport;
}
function ActionStates({ data }: Readonly<{ data: Actions }>): React.JSX.Element {
  const labels = { active: "Actions actives", future: "Futures", dueNow: "Échues maintenant", overdue: "En retard", invalidDeadline: "Échéance à vérifier", completed: "Réalisées", cancelled: "Annulées — pas réalisées" };
  return <dl className="pipeline-lead-cards">{(Object.keys(labels) as Array<keyof Actions>).map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{data[key]}</dd></div>)}</dl>;
}
function QueueLink({ item }: Readonly<{ item: Queue }>): React.JSX.Element {
  const unit = item.itemUnit === "ACTIONS" ? "actions" : item.itemUnit === "REQUESTS" ? "demandes" : "leads";
  return <div className="pipeline-lead-card"><h3><Link href={item.href}>{item.label}</Link></h3><p><strong>{item.itemCount} {unit}</strong> · {item.leadCount} leads distincts</p>
    <small>Part des leads : {item.leadShare.numerator}/{item.leadShare.denominator} · {item.leadShare.value === null ? "non calculable" : `${(item.leadShare.value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}</small></div>;
}
export default function CommercialWork({ query }: Readonly<{ query: string }>): React.JSX.Element {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; report: WorkReport } | { kind: "error"; message: string }>({ kind: "loading" });
  useEffect(() => {
    let current = true; const controller = new AbortController(); const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
    setState({ kind: "loading" });
    void (async (): Promise<void> => {
      try {
        const response = await fetch(`/api/crm/reports/commercial-work?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Session expirée. Reconnectez-vous pour consulter votre file." : response.status === 403 ? "Votre périmètre ne permet pas cette consultation." : "File indisponible. Vérifiez les filtres ; aucun total n’est confirmé.");
        const report = parseWorkReport(await response.json()); if (current) setState({ kind: "ready", report });
      } catch (error) { if (current) setState({ kind: "error", message: controller.signal.aborted ? "Délai de chargement dépassé. Réessayez." : error instanceof Error ? error.message : "Chargement impossible." }); }
      finally { globalThis.clearTimeout(timeout); }
    })();
    return (): void => { current = false; controller.abort(); globalThis.clearTimeout(timeout); };
  }, [query, attempt]);
  const pageHref = (page: number): string => { const params = new URLSearchParams(query); params.set("page", String(page)); return `/manager/reports/commercial-work?${params}`; };
  return <main className="pipeline-pilot-page"><PageHeader eyebrow="Travail commercial" title="Files et suivi par conseiller" description="Dossiers distincts et actions, sans confondre réalisation et annulation." />
    {state.kind === "loading" ? <p role="status" aria-busy="true">Chargement des files autorisées…</p> : null}
    {state.kind === "error" ? <section role="alert"><p>{state.message}</p><button type="button" onClick={(): void => setAttempt((value) => value + 1)}>Réessayer</button></section> : null}
    {state.kind === "ready" ? <>
      <p>Période de création : {state.report.cohort.from ?? "sans borne de début"} (incluse) → {state.report.cohort.to ?? "sans borne de fin"} (exclue). Stock actuel, pas activité réalisée aujourd’hui.</p>
      <div className="pipeline-lead-cards" aria-label="Six files de travail">{state.report.queues.map((item) => <QueueLink key={item.key} item={item} />)}</div>
      <ActionStates data={state.report.actions} />
      <h2>{state.report.queues.find((item) => item.key === state.report.selectedQueue)?.label}</h2>
      <LeadDirectoryTable items={state.report.page.items} total={state.report.page.total} ariaLabel="Dossiers de la file sélectionnée" />
      <nav aria-label="Pagination de la file">{state.report.page.page > 1 ? <Link className="secondary-button" href={pageHref(state.report.page.page - 1)}>Précédente</Link> : null}{state.report.page.page * state.report.page.pageSize < state.report.page.total ? <Link className="secondary-button" href={pageHref(state.report.page.page + 1)}>Suivante</Link> : null}</nav>
      <section><h2>Portefeuille principal par conseiller</h2>{state.report.advisers.length ? state.report.advisers.map((adviser) => <details key={adviser.adviserId}><summary>{adviser.adviserLabel ?? "Conseiller · nom indisponible"} · {adviser.leadCount} leads principaux</summary><div className="pipeline-lead-cards">{adviser.queues.map((item) => <QueueLink key={item.key} item={item} />)}</div><ActionStates data={adviser.actions} /></details>) : <p>Aucun conseiller principal dans ce périmètre.</p>}</section>
      <details><summary>Définitions, période et limites</summary>{state.report.definitions.map((definition) => <p key={definition}>{definition}</p>)}<p>Lecture API générée le {new Date(state.report.generatedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}, heure de Casablanca. Les droits sont revérifiés à chaque ouverture de file.</p></details>
    </> : null}
  </main>;
}
