"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowClockwise, ChartBar, SlidersHorizontal } from "@phosphor-icons/react";
import { PageHeader } from "../../../_components/ui/page-header";
import { parseSnapshot, stages, temperatures, type FunnelSnapshot } from "./funnel-contract";
const styles = {
  page: "pipeline-pilot-page", filters: "pipeline-pilot-filters", panel: "pipeline-pilot-panel",
  help: "pipeline-pilot-help", primaryFilters: "pipeline-pilot-primaryFilters", apply: "pipeline-pilot-apply",
  reset: "pipeline-pilot-reset", advanced: "pipeline-pilot-advanced", hint: "pipeline-pilot-hint",
  panelHeader: "pipeline-pilot-panelHeader", summary: "pipeline-pilot-summary", volumes: "pipeline-pilot-volumes",
  row: "pipeline-pilot-row", rowHeading: "pipeline-pilot-rowHeading", track: "pipeline-pilot-track",
  freshness: "pipeline-pilot-freshness", state: "pipeline-pilot-state", skeleton: "pipeline-pilot-skeleton",
  temperatures: "pipeline-pilot-temperatures",
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
function Volumes({ data }: { data: FunnelSnapshot }): React.JSX.Element {
  return <><div className={styles.summary}><div><span>Leads de la sélection</span><strong>{number.format(data.total)}</strong></div><p>Chaque lead apparaît dans un seul statut actuel.</p></div>
    <ol className={styles.volumes}>{stages.map((stage, index) => {
      const value = data.counts[stage.key];
      const percent = data.total === 0 ? 0 : 100 * value / data.total;
      return <li key={stage.key} className={styles.row} data-stage={index}>
        <div className={styles.rowHeading}><span>{stage.label}</span><span><strong>{number.format(value)}</strong><small>{percent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % des leads</small></span></div>
        <div className={styles.track} aria-hidden="true"><div style={{ width: `${percent}%` }} /></div>
      </li>;
    })}</ol></>;
}
function TemperatureDistribution({ data }: { data: FunnelSnapshot }): React.JSX.Element {
  return <section className={styles.temperatures} aria-labelledby="pipeline-temperatures"><header><div><h2 id="pipeline-temperatures">Température commerciale</h2><p>Dernière qualification humaine enregistrée</p></div></header><dl>{temperatures.map((item) => <div key={item.key} data-temperature={item.key}><dt>{item.label}</dt><dd>{number.format(data.temperatureDistribution[item.key])}<span className="sr-only"> lead{data.temperatureDistribution[item.key] > 1 ? "s" : ""}</span></dd></div>)}</dl><p>Aucune température n’est déduite automatiquement du statut, des documents ou d’une absence de réponse.</p></section>;
}
export default function Pipeline({ initialFilters }: { initialFilters: Record<string, string> }): React.JSX.Element {
  const [query, setQuery] = useState(() => new URLSearchParams(initialFilters).toString());
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result>({ kind: "loading" });
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
    setQuery(next.toString()); setRevision((value) => value + 1);
  }
  function reset(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    for (const element of event.currentTarget.elements) if (element instanceof HTMLInputElement) element.value = "";
    setQuery(""); setRevision((value) => value + 1);
  }
  return <main className={styles.page}>
    <PageHeader eyebrow="Pilotage commercial" title="Pipeline" description="Une vue claire de vos leads, à chaque étape de leur parcours." />
    <form className={styles.filters} onSubmit={apply} onReset={reset} aria-label="Filtres du Pipeline">
      <div className={styles.primaryFilters}>
        <label>Créés à partir du<input type="date" name="from" defaultValue={initialFilters.from} /></label>
        <label>Créés avant le<input type="date" name="to" defaultValue={initialFilters.to} /></label>
        <button className={styles.apply} type="submit"><ArrowClockwise size={18} aria-hidden="true" />Actualiser</button>
        <button className={styles.reset} type="reset">Réinitialiser</button>
      </div>
      <details className={styles.advanced}><summary><SlidersHorizontal size={18} aria-hidden="true" />Filtres supplémentaires</summary><div>{fields.map((field) => <label key={field.key}>{field.label}<input name={field.key} defaultValue={initialFilters[field.key]} /></label>)}</div></details>
      <p className={styles.hint}>Sans période : tous les leads accessibles. La date de fin est exclue.</p>
    </form>
    <section className={styles.panel} aria-labelledby="pipeline-volumes" aria-busy={result.kind === "loading"}>
      <header className={styles.panelHeader}><div><h2 id="pipeline-volumes">Volumes par statut</h2><p>Photographie actuelle · pas un historique des transitions</p></div><ChartBar size={26} aria-hidden="true" /></header>
      {result.kind === "loading" ? <div className={styles.state} role="status"><span className={styles.skeleton} aria-hidden="true" /><strong>Chargement du Pipeline…</strong><p>Nous préparons les volumes de votre sélection.</p></div> : null}
      {result.kind === "error" ? <div className={styles.state}><div role="alert"><strong>Rapport indisponible</strong><p>{result.message}</p></div><button className={styles.reset} onClick={(): void => setRevision((value) => value + 1)}>Réessayer</button></div> : null}
      {result.kind === "ready" && result.data.total === 0 ? <div className={styles.state} role="status"><ChartBar size={40} aria-hidden="true" /><strong>Aucun lead dans cette sélection</strong><p>Élargissez la période ou ajustez les filtres pour afficher des résultats.</p><span>0 lead · aucun taux calculé</span></div> : null}
      {result.kind === "ready" && result.data.total > 0 ? <Volumes data={result.data} /> : null}
      {result.kind === "ready" ? <TemperatureDistribution data={result.data} /> : null}
      {result.kind === "ready" ? <footer className={styles.freshness}>Mis à jour le {new Date(result.data.generatedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} · heure de Casablanca</footer> : null}
    </section>
    <details className={styles.help}><summary>Comment lire ces chiffres ?</summary><p>La période sélectionne les leads selon leur date de création. Les volumes décrivent leur statut actuel, sans mesurer les passages d’une étape à l’autre.</p><p>Chaque barre indique la part du statut dans l’ensemble des leads uniques de la sélection. « Sans suite » reste inclus dans ce total. Les résultats respectent votre périmètre de consultation.</p></details>
  </main>;
}
