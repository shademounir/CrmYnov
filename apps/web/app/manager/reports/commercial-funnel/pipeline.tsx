"use client";

import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowClockwise, ArrowRight, ChartBar, Info, SlidersHorizontal, Thermometer, UsersThree } from "@phosphor-icons/react";
import { PageHeader } from "../../../_components/ui/page-header";
import { buildLeadListHref, parseSnapshot, stages, temperatures, type FunnelSnapshot } from "./funnel-contract";
const styles = {
  page: "pipeline-pilot-page", filters: "pipeline-pilot-filters", panel: "pipeline-pilot-panel",
  help: "pipeline-pilot-help", primaryFilters: "pipeline-pilot-primaryFilters", apply: "pipeline-pilot-apply",
  reset: "pipeline-pilot-reset", advanced: "pipeline-pilot-advanced", hint: "pipeline-pilot-hint",
  panelHeader: "pipeline-pilot-panelHeader", summary: "pipeline-pilot-summary", volumes: "pipeline-pilot-volumes",
  row: "pipeline-pilot-row", rowHeading: "pipeline-pilot-rowHeading", track: "pipeline-pilot-track",
  freshness: "pipeline-pilot-freshness", state: "pipeline-pilot-state", skeleton: "pipeline-pilot-skeleton",
  temperatures: "pipeline-pilot-temperatures", results: "pipeline-pilot-results", dimensions: "pipeline-pilot-dimensions",
  activeFilters: "pipeline-pilot-activeFilters", reconnect: "pipeline-pilot-reconnect", retry: "pipeline-pilot-retry",
};

type Result = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: FunnelSnapshot };
const fields = [{ key: "campus", label: "Campus" }, { key: "campaign", label: "Campagne" }, { key: "program", label: "Formation" }, { key: "source", label: "Source" }];
const number = new Intl.NumberFormat("fr-FR");
function failure(status: number): string {
  if (status === 401) return "Votre session a expiré. Reconnectez-vous pour consulter le Pipeline.";
  if (status === 403) return "Vous ne disposez pas des droits nécessaires pour consulter ce rapport.";
  if (status === 400) return "Vérifiez la période et les filtres saisis. La date de fin doit être postérieure au début.";
  return "Le rapport est momentanément indisponible. Vos filtres sont conservés.";
}
function filtersFromQuery(query: string): Record<string, string> { return Object.fromEntries(new URLSearchParams(query)); }
function Volumes({ data, filters }: { data: FunnelSnapshot; filters: Record<string, string> }): React.JSX.Element {
  return <>
    <ol className={styles.volumes}>{stages.map((stage, index) => {
      const value = data.counts[stage.key];
      const percent = data.total === 0 ? 0 : 100 * value / data.total;
      return <li key={stage.key} className={styles.row} data-stage={index}>
        <div className={styles.rowHeading}><span>{stage.label}</span><span><strong>{number.format(value)}</strong><small>{percent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</small></span></div>
        <div className={styles.track} aria-hidden="true"><div style={{ width: `${percent}%` }} /></div>
        <Link href={buildLeadListHref(filters, { status: stage.key })}>Afficher les leads <ArrowRight size={14} aria-hidden="true" /></Link>
      </li>;
    })}</ol></>;
}
function TemperatureDistribution({ data, filters }: { data: FunnelSnapshot; filters: Record<string, string> }): React.JSX.Element {
  return <section className={`${styles.panel} ${styles.temperatures}`} aria-labelledby="pipeline-temperatures"><header className={styles.panelHeader}><div><h2 id="pipeline-temperatures">Température commerciale</h2><p>Dernière qualification humaine enregistrée</p></div><Thermometer size={25} aria-hidden="true" /></header><dl>{temperatures.map((item) => <div key={item.key} data-temperature={item.key}><dt>{item.label}</dt><dd>{number.format(data.temperatureDistribution[item.key])}<span className="sr-only"> lead{data.temperatureDistribution[item.key] > 1 ? "s" : ""}</span></dd><Link href={buildLeadListHref(filters, { temperature: item.key })} aria-label={`Afficher les leads ${item.label.toLocaleLowerCase("fr-FR")}`}><ArrowRight size={15} aria-hidden="true" /></Link></div>)}</dl><p>Aucune température n’est déduite automatiquement du statut, des documents ou d’une absence de réponse.</p></section>;
}
export default function Pipeline({ initialFilters }: { initialFilters: Record<string, string> }): React.JSX.Element {
  const [query, setQuery] = useState(() => new URLSearchParams(initialFilters).toString());
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result>({ kind: "loading" });
  const selectedFilters = useMemo(() => filtersFromQuery(query), [query]);
  const activeFilterCount = useMemo(() => [...new URLSearchParams(query).keys()].length, [query]);
  useEffect(() => {
    function restoreFromHistory(): void {
      setQuery(globalThis.window.location.search.slice(1));
    }
    restoreFromHistory();
    globalThis.window.addEventListener("popstate", restoreFromHistory);
    return (): void => globalThis.window.removeEventListener("popstate", restoreFromHistory);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setResult({ kind: "loading" });
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/crm/reports/commercial-funnel?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) { if (current) setResult({ kind: "error", message: failure(response.status) }); return; }
        const payload: unknown = await response.json();
        const data = parseSnapshot(payload);
        if (current) setResult({ kind: "ready", data });
      } catch { if (current) setResult({ kind: "error", message: "Le rapport n’a pas pu être chargé. Vos filtres sont conservés ; réessayez." }); }
    }
    void load();
    return (): void => { current = false; controller.abort(); };
  }, [query, revision]);
  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ["from", "to", ...fields.map((field) => field.key)]) {
      const value = values.get(key);
      if (typeof value === "string" && value.trim()) next.set(key, value.trim());
    }
    const serialized = next.toString();
    globalThis.window.history.replaceState(null, "", serialized ? `/manager/reports/commercial-funnel?${serialized}` : "/manager/reports/commercial-funnel");
    setQuery(serialized); setRevision((value) => value + 1);
  }
  function reset(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    for (const element of event.currentTarget.elements) if (element instanceof HTMLInputElement) element.value = "";
    globalThis.window.history.replaceState(null, "", "/manager/reports/commercial-funnel");
    setQuery(""); setRevision((value) => value + 1);
  }
  return <main className={styles.page}>
    <PageHeader eyebrow="Pilotage commercial" title="Pipeline" description="Une photographie exploitable de vos leads, dans leur état commercial actuel." actions={<Link className="secondary-button" href={buildLeadListHref(selectedFilters)}><UsersThree size={18} aria-hidden="true" />Voir les leads</Link>} />
    <form key={query} className={styles.filters} onSubmit={apply} onReset={reset} aria-label="Filtres du Pipeline">
      <div className={styles.activeFilters}><div><strong>Affiner la sélection</strong><span>{activeFilterCount ? `${activeFilterCount} filtre${activeFilterCount > 1 ? "s" : ""} actif${activeFilterCount > 1 ? "s" : ""}` : "Tous les leads accessibles"}</span></div></div>
      <div className={styles.primaryFilters}>
        <label>Créés à partir du<input type="date" name="from" defaultValue={selectedFilters.from} /></label>
        <label>Créés avant le<input type="date" name="to" defaultValue={selectedFilters.to} /></label>
        <button className={styles.apply} type="submit"><ArrowClockwise size={18} aria-hidden="true" />Actualiser</button>
        <button className={styles.reset} type="reset">Réinitialiser</button>
      </div>
      <details className={styles.advanced}><summary><SlidersHorizontal size={18} aria-hidden="true" />Filtres supplémentaires</summary><div>{fields.map((field) => <label key={field.key}>{field.label}<input name={field.key} defaultValue={selectedFilters[field.key]} /></label>)}</div></details>
      <p className={styles.hint}>Sans période : tous les leads accessibles. La date de fin est exclue.</p>
    </form>
    {result.kind === "loading" ? <section className={`${styles.panel} ${styles.state}`} role="status" aria-busy="true"><span className={styles.skeleton} aria-hidden="true" /><strong>Chargement du Pipeline…</strong><p>Nous préparons les volumes de votre sélection.</p></section> : null}
    {result.kind === "error" ? <section className={`${styles.panel} ${styles.state}`}><div role="alert"><strong>Rapport indisponible</strong><p>{result.message}</p><span>Aucun compteur n’est affiché tant que l’API n’a pas répondu.</span></div><div>{result.message.includes("session") ? <Link className={styles.reconnect} href="/">Se reconnecter</Link> : null}<button className={styles.retry} type="button" onClick={(): void => setRevision((value) => value + 1)}>Réessayer</button></div></section> : null}
    {result.kind === "ready" && result.data.total === 0 ? <section className={`${styles.panel} ${styles.state}`} role="status"><ChartBar size={40} aria-hidden="true" /><strong>Aucun lead dans cette sélection</strong><p>Élargissez la période ou ajustez les filtres pour afficher des résultats.</p><span>0 lead confirmé par l’API · aucune part calculée</span></section> : null}
    {result.kind === "ready" && result.data.total > 0 ? <><section className={styles.summary} aria-label="Synthèse de la sélection"><div><span>Leads uniques</span><strong>{number.format(result.data.total)}</strong><small>dans le périmètre courant</small></div><div><span>Étapes occupées</span><strong>{number.format(stages.filter((stage) => result.data.counts[stage.key] > 0).length)}</strong><small>sur {stages.length} statuts</small></div><div><span>Qualifiés humainement</span><strong>{number.format(result.data.total - result.data.temperatureDistribution.UNEVALUATED)}</strong><small>température renseignée</small></div></section><div className={styles.results}><section className={styles.panel} aria-labelledby="pipeline-volumes"><header className={styles.panelHeader}><div><h2 id="pipeline-volumes">Volumes par statut</h2><p>Photographie actuelle · pas un historique des transitions</p></div><ChartBar size={26} aria-hidden="true" /></header><Volumes data={result.data} filters={selectedFilters} /></section><TemperatureDistribution data={result.data} filters={selectedFilters} /></div></> : null}
    {result.kind === "ready" ? <><aside className={styles.dimensions} aria-label="Lecture des dimensions"><Info size={20} aria-hidden="true" /><p><strong>Quatre dimensions indépendantes.</strong> Le statut commercial, la température humaine, le dernier résultat de contact et la complétude documentaire ne se remplacent pas et ne sont pas déduits les uns des autres.</p></aside><footer className={styles.freshness}>Données API · {result.data.definitionVersion} · mises à jour le {new Date(result.data.generatedAt).toLocaleString("fr-FR", { timeZone: result.data.timezone })} · heure de Casablanca</footer></> : null}
    <details className={styles.help}><summary>Comment lire ces chiffres ?</summary><p>La période sélectionne les leads selon leur date de création. Cette photographie actuelle décrit leur statut courant, pas un historique des transitions.</p><p>Chaque barre indique la part du statut dans l’ensemble des leads uniques de la sélection. « Sans suite » reste inclus dans ce total. Les résultats respectent votre périmètre de consultation.</p></details>
  </main>;
}
