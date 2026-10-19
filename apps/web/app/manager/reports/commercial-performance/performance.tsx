"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

type Counts = Record<string, number>;
interface Adviser {
  adviserId: string; adviserLabel?: string; primaryLeadCount: number; secondaryLeadCount: number;
  activeLoad: number; inactiveLeadCount: number;
  acquisition: { newAcquisitionCount: number; baselinePortfolioCount: number };
  statusVolumes: Counts; rates: Record<string, number | null>; followUps: Counts;
  drillDown: { assigned: string; overdue: string; inactive: string };
}
export interface PerformanceData {
  generatedAt: string; cohort: { from?: string; to?: string; inactivityHours: number; uniqueLeadCount: number };
  acquisition: { newAcquisitionCount: number; baselinePortfolioCount: number }; advisers: Adviser[];
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("contract");
  return value as Record<string, unknown>;
};
const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("contract");
  return value;
};
const text = (value: unknown): string => { if (typeof value !== "string" || !value.trim()) throw new Error("contract"); return value; };
const instant = (value: unknown): string => { const result = text(value); if (!Number.isFinite(Date.parse(result))) throw new Error("contract"); return result; };
function counts(value: unknown, keys: string[]): Counts {
  const raw = record(value); return Object.fromEntries(keys.map((key) => [key, count(raw[key])]));
}
function acquisition(value: unknown, total: number): PerformanceData["acquisition"] {
  const raw = record(value);
  if (raw.definitionVersion !== "acquisition-cohort-v1" || raw.periodDateBasis !== "STORED_CREATED_AT_NOT_HISTORICAL_RECEPTION") throw new Error("contract");
  const result = { newAcquisitionCount: count(raw.newAcquisitionCount), baselinePortfolioCount: count(raw.baselinePortfolioCount) };
  if (result.newAcquisitionCount + result.baselinePortfolioCount !== total) throw new Error("contract");
  return result;
}
function link(value: unknown, owner: string, kind: "assigned" | "overdue" | "inactive", cutoff: string): string {
  const raw = text(value), url = new URL(raw, "https://crm.invalid");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || url.origin !== "https://crm.invalid" || url.hash) throw new Error("contract");
  if (kind === "overdue") {
    if (url.pathname !== "/manager/reports/commercial-work" || url.searchParams.get("queue") !== "OVERDUE_FOLLOW_UP" || url.searchParams.get("taskOwnerId") !== owner) throw new Error("contract");
  } else if (url.pathname !== "/leads" || url.searchParams.get("assignedToId") !== owner
    || kind === "inactive" && (url.searchParams.get("portfolioState") !== "OPEN" || url.searchParams.get("inactiveTreatmentBefore") !== cutoff)) throw new Error("contract");
  return raw;
}
export function readPerformance(value: unknown): PerformanceData {
  const raw = record(value), cohort = record(raw.cohort), generatedAt = instant(raw.generatedAt);
  if (raw.definitionVersion !== "commercial-performance-v1" || raw.timezone !== "Africa/Casablanca" || !Array.isArray(raw.advisers)) throw new Error("contract");
  const inactivityHours = count(cohort.inactivityHours), uniqueLeadCount = count(cohort.uniqueLeadCount);
  if (inactivityHours < 1 || inactivityHours > 2160) throw new Error("contract");
  const cutoff = new Date(Date.parse(generatedAt) - inactivityHours * 3_600_000).toISOString(), ids = new Set<string>();
  const advisers = raw.advisers.map((entry): Adviser => {
    const row = record(entry), adviserId = text(row.adviserId);
    if (ids.has(adviserId)) throw new Error("contract"); ids.add(adviserId);
    const primaryLeadCount = count(row.primaryLeadCount), secondaryLeadCount = count(row.secondaryLeadCount);
    const activeLoad = count(row.activeLoad), inactiveLeadCount = count(row.inactiveLeadCount);
    if (primaryLeadCount > uniqueLeadCount || secondaryLeadCount > uniqueLeadCount || activeLoad > primaryLeadCount || inactiveLeadCount > activeLoad) throw new Error("contract");
    const statusVolumes = counts(row.statusVolumes, ["contacted", "qualified", "enrolled", "closedLost"]), rawRates = record(row.rates);
    const rates: Record<string, number | null> = {};
    for (const [name, status] of [["contact", "contacted"], ["qualification", "qualified"], ["enrollment", "enrolled"], ["loss", "closedLost"]] as const) {
      if (statusVolumes[status]! > primaryLeadCount) throw new Error("contract");
      const expected = primaryLeadCount ? Number((statusVolumes[status]! / primaryLeadCount).toFixed(4)) : null;
      if (rawRates[name] !== expected) throw new Error("contract"); rates[name] = expected;
    }
    const followUps = counts(row.followUps, ["planned", "completed", "overdue", "cancelled", "active", "dueNow", "invalidDeadline"]);
    if (followUps.active !== followUps.planned! + followUps.overdue! + followUps.dueNow! + followUps.invalidDeadline!) throw new Error("contract");
    const drill = record(row.drillDown);
    return { adviserId, ...(typeof row.adviserLabel === "string" && row.adviserLabel.trim() ? { adviserLabel: row.adviserLabel } : {}), primaryLeadCount, secondaryLeadCount, activeLoad, inactiveLeadCount,
      acquisition: acquisition(row.acquisition, primaryLeadCount), statusVolumes, rates, followUps,
      drillDown: { assigned: link(drill.assigned, adviserId, "assigned", cutoff), overdue: link(drill.overdue, adviserId, "overdue", cutoff), inactive: link(drill.inactive, adviserId, "inactive", cutoff) } };
  });
  const from = cohort.from === undefined ? undefined : instant(cohort.from), to = cohort.to === undefined ? undefined : instant(cohort.to);
  if (advisers.reduce((sum, row) => sum + row.primaryLeadCount, 0) > uniqueLeadCount) throw new Error("contract");
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new Error("contract");
  return { generatedAt, cohort: { inactivityHours, uniqueLeadCount, ...(from ? { from } : {}), ...(to ? { to } : {}) }, acquisition: acquisition(raw.acquisition, uniqueLeadCount), advisers };
}
export function performanceEndpoint(query: string): string {
  const params = new URLSearchParams(query); params.delete("returnTo");
  return `/api/crm/reports/commercial-performance?${params}`;
}
const date = (value: string): string => new Intl.DateTimeFormat("fr-MA", { timeZone: "Africa/Casablanca", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function PerformanceResults({ data }: Readonly<{ data: PerformanceData }>): React.JSX.Element {
  return <section aria-label="Performance par commercial" className="commercial-performance-results">
    <h2>Portefeuille et actions par commercial</h2>
    <p>Photographie du {date(data.generatedAt)} · Africa/Casablanca. {data.cohort.uniqueLeadCount} dossiers uniques autorisés.</p>
    <p>Création CRM : {data.cohort.from ? date(data.cohort.from) : "sans borne de début"} (incluse) → {data.cohort.to ? date(data.cohort.to) : "sans borne de fin"} (exclue).
      Ce stock ne mesure pas le travail effectué aujourd’hui. Les listes sont relues au clic et peuvent évoluer.</p>
    <p>{data.acquisition.newAcquisitionCount} acquisitions nouvelles · {data.acquisition.baselinePortfolioCount} dossiers historiques importés. L’import n’est pas leur réception historique.</p>
    {data.advisers.length === 0 && <p>Aucun conseiller ni propriétaire de tâche dans cette cohorte autorisée. Aucun taux n’est calculable.</p>}
    <div className="pipeline-lead-cards">{data.advisers.map((row) => <article key={row.adviserId} className="pipeline-lead-card">
      <h3>{row.adviserLabel || "Conseiller · nom indisponible"}</h3>
      <p>Portefeuille principal actuel. Contributions secondaires distinctes, sans double comptage des indicateurs principaux.</p>
      <dl><div><dt>Leads principaux</dt><dd><Link href={row.drillDown.assigned}>{row.primaryLeadCount} dossiers</Link></dd></div>
        <div><dt>Contributions secondaires</dt><dd>{row.secondaryLeadCount} dossiers</dd></div><div><dt>Charge active</dt><dd>{row.activeLoad} dossiers ouverts</dd></div>
        <div><dt>Traitements datés anciens</dt><dd><Link href={row.drillDown.inactive}>{row.inactiveLeadCount} dossiers</Link> · seuil strict de {data.cohort.inactivityHours} h</dd></div>
      </dl>
      <h4>Actions du propriétaire de tâche</h4><p>Le propriétaire persistant peut être différent du conseiller principal actuel. Ces volumes comptent des actions, pas des dossiers distincts.</p>
      <dl>{[["active", "Actives"], ["planned", "À venir"], ["dueNow", "Échues à cet instant"], ["invalidDeadline", "Échéance invalide"], ["completed", "Réalisées"], ["cancelled", "Annulées"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{row.followUps[key!]} actions</dd></div>)}
        <div><dt>Relances en retard</dt><dd><Link href={row.drillDown.overdue}>{row.followUps.overdue} actions strictement en retard</Link></dd></div></dl>
      <h4>Parts du portefeuille principal</h4><p>Dénominateur : {row.primaryLeadCount} dossiers principaux de la cohorte de création ci-dessus. Ce ne sont pas des taux de travail réalisé sur la période.</p>
      <dl>{[["contact", "contacted", "Contact atteint"], ["qualification", "qualified", "Qualification atteinte"], ["enrollment", "enrolled", "Inscription atteinte"], ["loss", "closedLost", "Sans suite actuel"]].map(([key, status, label]) => <div key={key}><dt>{label}</dt><dd>{row.statusVolumes[status!]} / {row.primaryLeadCount} · {row.rates[key!] === null ? "Non calculable" : `${(row.rates[key!]! * 100).toLocaleString("fr-MA", { maximumFractionDigits: 2 })} %`}</dd></div>)}</dl>
    </article>)}</div>
  </section>;
}
type State = { kind: "loading" } | { kind: "ready"; data: PerformanceData; request: string } | { kind: "error"; message: string; request: string };
export default function PerformanceReport({ query }: Readonly<{ query: string }>): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" }), [retry, setRetry] = useState(0);
  const request = `${query}#${retry}`;
  useEffect(() => {
    const controller = new AbortController(); let current = true, expired = false;
    const timeout = setTimeout(() => { expired = true; controller.abort(); if (current) setState({ kind: "error", request, message: "Le rapport n’a pas répondu dans les 15 secondes. Réessayez." }); }, 15_000);
    async function load(): Promise<void> {
      try {
        const response = await fetch(performanceEndpoint(query), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 ? "Session expirée. Reconnectez-vous pour relire le rapport." : response.status === 403 ? "Ce rapport n’est pas accessible dans votre périmètre." : response.status === 400 ? "Filtres invalides. Vérifiez la période et les critères." : "Rapport temporairement indisponible.");
        const data = readPerformance(await response.json());
        if (current && !expired) setState({ kind: "ready", data, request });
      } catch (error) {
        const known = ["Session expirée. Reconnectez-vous pour relire le rapport.", "Ce rapport n’est pas accessible dans votre périmètre.", "Filtres invalides. Vérifiez la période et les critères.", "Rapport temporairement indisponible."];
        if (current) setState({ kind: "error", request, message: expired ? "Le rapport n’a pas répondu dans les 15 secondes. Réessayez." : error instanceof Error && known.includes(error.message) ? error.message : "Données du rapport non vérifiables. Aucun compteur affiché." });
      } finally { clearTimeout(timeout); }
    }
    void load(); return (): void => { current = false; controller.abort(); clearTimeout(timeout); };
  }, [query, retry, request]);
  if (state.kind === "loading" || state.request !== request) return <p role="status">Chargement du portefeuille et des actions autorisés…</p>;
  if (state.kind === "error") return <section role="alert"><p>{state.message}</p><button type="button" onClick={() => { setState({ kind: "loading" }); setRetry((value) => value + 1); }}>Réessayer le rapport</button></section>;
  return <PerformanceResults data={state.data} />;
}
