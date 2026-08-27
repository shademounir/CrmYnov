"use client";

import { useEffect, useMemo, useState } from "react";

type Datum = { value: string; count: number };
type DashboardReport = {
  definitionVersion: string; timezone: string; filters: Record<string, string>;
  cards: Record<"uniqueLeads" | "enrolled" | "unassigned" | "overdueFollowUps" | "activeAlerts", number>;
  trends: Array<{ date: string; leadsCreated: number; leadsEnrolled: number }>;
  distributions: Record<"source" | "campaign" | "program" | "campus", Datum[]>;
  panels: {
    funnel: { currentState: Record<string, number> };
    performance: { advisers: Array<{ adviserId: string; activeLoad: number; primaryLeadCount: number; secondaryLeadCount: number }> };
    operationalRisks: { alerts: Array<{ code: string; count: number; drillDown: string }>; queues: Record<string, number> };
    sharedContributions: { contributors: Array<{ contributorId: string; primaryActionCount: number; secondaryActionCount: number }> };
  };
  drillDowns: Array<{ key: string; count: number; href: string }>;
  export: { href: string; schemaVersion: string; aggregatedOnly: true };
};
type PersonalDashboardReport = {
  definitionVersion: "personal-dashboard-v1"; timezone: string; filters: Record<string, string>;
  performance: { advisers: Array<{ adviserId: string; activeLoad: number; primaryLeadCount: number; secondaryLeadCount: number; followUps: { overdue: number } }> };
  contributions: { contributors: Array<{ contributorId: string; primaryActionCount: number; secondaryActionCount: number }> };
  safeguards: { personalScopeOnly: true; aggregatedOnly: true };
};
type ReportingReport = DashboardReport | PersonalDashboardReport;

const labels: Record<string, string> = { uniqueLeads: "Leads uniques", enrolled: "Inscriptions", unassigned: "Non affectés", overdueFollowUps: "Relances échues", activeAlerts: "Alertes actives" };
const preferenceKey = "crm-reporting-preferences-v1";
type PreferredPeriod = "7d" | "30d" | "90d";
type Preferences = { compact: boolean; showTables: boolean; preferredPeriod: PreferredPeriod; operationalThreshold: number };
const preferredPeriodHref: Record<PreferredPeriod, string> = {
  "7d": "/manager/reports/dashboard?period=7d",
  "30d": "/manager/reports/dashboard?period=30d",
  "90d": "/manager/reports/dashboard?period=90d",
};
const dashboardDestinationRoots = ["/leads", "/reports/manager-dashboard/export"] as const;

function safePreferences(raw: Partial<Preferences>): Preferences {
  const preferredPeriod = ["7d", "30d", "90d"].includes(raw.preferredPeriod ?? "") ? raw.preferredPeriod as PreferredPeriod : "30d";
  const threshold = Number.isInteger(raw.operationalThreshold) && Number(raw.operationalThreshold) >= 1 && Number(raw.operationalThreshold) <= 100
    ? Number(raw.operationalThreshold) : 20;
  return { compact: raw.compact === true, showTables: raw.showTables !== false, preferredPeriod, operationalThreshold: threshold };
}

export default function InteractiveReportingDashboard({ initialFilters, initialReport }: Readonly<{ initialFilters: Record<string, string>; initialReport?: ReportingReport }>): React.JSX.Element {
  const [report, setReport] = useState<ReportingReport | undefined>(initialReport);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">(initialReport ? "ready" : "loading");
  const [preferences, setPreferences] = useState<Preferences>(() => safePreferences({}));
  const query = useMemo(() => {
    const params = new URLSearchParams(initialFilters);
    if (!params.has("period")) params.set("period", "30d");
    return params;
  }, [initialFilters]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved) setPreferences(safePreferences(JSON.parse(saved) as Partial<Preferences>));
    } catch {
      localStorage.removeItem(preferenceKey);
    }
  }, []);
  useEffect(() => {
    if (initialReport) return;
    const controller = new AbortController();
    setState("loading");
    fetch(`/api/crm/reports/${query.get("view") === "personal" ? "personal-dashboard" : "manager-dashboard"}?${query.toString()}`, { credentials: "same-origin", signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`reporting_${response.status}`);
        return response.json() as Promise<ReportingReport>;
      })
      .then((value) => {
        setReport(value);
        setState(reportItemCount(value) > 0 ? "ready" : "empty");
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setState("error");
      });
    return (): void => controller.abort();
  }, [initialReport, query]);
  const updatePreference = (next: Preferences): void => { setPreferences(next); localStorage.setItem(preferenceKey, JSON.stringify(next)); };
  return <main data-density={preferences.compact ? "compact" : "comfortable"}>
    <h1>Tableau de bord CRM</h1><p>Indicateurs agrégés dans le fuseau Africa/Casablanca. Aucune donnée personnelle n’est stockée dans l’URL.</p>
    <ReportingFilters filters={initialFilters} />
    <fieldset><legend>Préférences locales non sensibles</legend>
      <label><input type="checkbox" checked={preferences.compact} onChange={(event) => updatePreference({ ...preferences, compact: event.target.checked })} /> Affichage compact</label>
      <label><input type="checkbox" checked={preferences.showTables} onChange={(event) => updatePreference({ ...preferences, showTables: event.target.checked })} /> Afficher les tableaux accessibles</label>
      <label>Période préférée <select value={preferences.preferredPeriod} onChange={(event) => updatePreference({ ...preferences, preferredPeriod: event.target.value as PreferredPeriod })}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option></select></label>
      <a href={preferredPeriodHref[preferences.preferredPeriod]}>Appliquer la période préférée</a>
      <label>Seuil personnel de charge <input type="number" min={1} max={100} value={preferences.operationalThreshold} onChange={(event) => updatePreference({ ...preferences, operationalThreshold: Math.min(100, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) })} /></label>
      <small>Ces préférences d’affichage restent dans ce navigateur et ne contiennent ni identifiant métier, ni donnée personnelle.</small>
    </fieldset>
    <ReportingState state={state} report={report} showTables={preferences.showTables} query={query} operationalThreshold={preferences.operationalThreshold} />
  </main>;
}

function reportItemCount(report: ReportingReport): number {
  return "cards" in report
    ? Object.values(report.cards).reduce((sum, item) => sum + item, 0)
    : report.performance.advisers.length + report.contributions.contributors.length;
}

function ReportingState({ state, report, showTables, query, operationalThreshold }: Readonly<{ state: "loading" | "ready" | "empty" | "error"; report: ReportingReport | undefined; showTables: boolean; query: URLSearchParams; operationalThreshold: number }>): React.JSX.Element | null {
  if (state === "loading") return <section aria-live="polite" aria-busy="true"><h2>Chargement</h2><p>Calcul des indicateurs agrégés…</p></section>;
  if (state === "error") return <section role="alert"><h2>Erreur de chargement</h2><p>Le rapport n’a pas pu être chargé. Réessayez sans modifier vos filtres.</p></section>;
  if (state === "empty") return <section aria-live="polite"><h2>Aucun résultat</h2><p>Aucune donnée agrégée pour les filtres sélectionnés.</p></section>;
  if (!report) return null;
  if ("cards" in report) return <DashboardContent report={report} showTables={showTables} query={query} operationalThreshold={operationalThreshold} />;
  return <PersonalDashboardContent report={report} showTables={showTables} />;
}

function PersonalDashboardContent({ report, showTables }: Readonly<{ report: PersonalDashboardReport; showTables: boolean }>): React.JSX.Element {
  const adviser = report.performance.advisers[0]; const contributor = report.contributions.contributors[0];
  const data = adviser ? [{ value: "Leads principaux", count: adviser.primaryLeadCount }, { value: "Collaborations", count: adviser.secondaryLeadCount }, { value: "Charge active", count: adviser.activeLoad }, { value: "Relances échues", count: adviser.followUps.overdue }] : [];
  const contributions = contributor ? [{ value: "Actions principales", count: contributor.primaryActionCount }, { value: "Actions secondaires", count: contributor.secondaryActionCount }] : [];
  return <><section aria-label="Vue personnelle"><h2>Mes indicateurs autorisés</h2><p>Cette vue est limitée au collaborateur connecté et à ses contributions autorisées.</p></section><AccessibleChart title="Ma performance" data={data} showTable={showTables} /><AccessibleChart title="Mes contributions" data={contributions} showTable={showTables} /></>;
}

function ReportingFilters({ filters }: Readonly<{ filters: Record<string, string> }>): React.JSX.Element {
  return <form method="get" action="/manager/reports/dashboard" aria-label="Filtres interactifs du reporting">
    <label>Période <select name="period" defaultValue={filters.period ?? "30d"}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option><option value="custom">Personnalisée</option></select></label>
    <label>Du <input name="from" type="date" defaultValue={filters.from?.slice(0, 10)} /></label><label>Au <input name="to" type="date" defaultValue={filters.to?.slice(0, 10)} /></label>
    <label>Campus <input name="campus" defaultValue={filters.campus} /></label><label>Campagne <input name="campaign" defaultValue={filters.campaign} /></label>
    <label>Formation <input name="program" defaultValue={filters.program} /></label><label>Source <input name="source" defaultValue={filters.source} /></label>
    <label>Canal <select name="channel" defaultValue={filters.channel ?? ""}><option value="">Tous</option><option value="DIGITAL">Digital</option><option value="PHONE">Téléphone</option><option value="IN_PERSON">Présentiel</option><option value="PARTNER">Partenaire</option><option value="OTHER">Autre</option></select></label>
    <label>Commercial <input name="adviserId" defaultValue={filters.adviserId} autoComplete="off" /></label>
    <label>Statut <select name="status" defaultValue={filters.status ?? ""}><option value="">Tous</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
    <label>Vue <select name="view" defaultValue={filters.view ?? "global"}><option value="global">Globale</option><option value="personal">Personnelle</option></select></label>
    <button type="submit">Appliquer</button> <a href="/manager/reports/dashboard">Réinitialiser</a>
  </form>;
}

function DashboardContent({ report, showTables, query, operationalThreshold }: Readonly<{ report: DashboardReport; showTables: boolean; query: URLSearchParams; operationalThreshold: number }>): React.JSX.Element {
  const funnel = Object.entries(report.panels.funnel.currentState).map(([value, count]) => ({ value, count }));
  const loads = report.panels.performance.advisers.map((item) => ({ value: item.adviserId, count: item.activeLoad }));
  const contributions = report.panels.sharedContributions.contributors.map((item) => ({ value: item.contributorId, count: item.primaryActionCount + item.secondaryActionCount }));
  return <>
    <section aria-label="Cartes KPI"><h2>Indicateurs clés</h2><ul>{report.drillDowns.map((item) => <li key={item.key}><a href={safeInternalHref(item.href, ["/leads"])}><strong>{labels[item.key] ?? item.key}</strong> : {item.count}</a></li>)}<li><strong>Alertes actives</strong> : {report.cards.activeAlerts}</li></ul></section>
    <AccessibleChart title="Funnel commercial" data={funnel} showTable={showTables} />
    <AccessibleTrend data={report.trends} showTable={showTables} />
    {(["source", "campaign", "program", "campus"] as const).map((dimension) => <AccessibleChart key={dimension} title={`Répartition par ${dimension}`} data={report.distributions[dimension]} showTable={showTables} />)}
    <AccessibleChart title="Charge commerciale" data={loads} showTable={showTables} />
    <p aria-live="polite">{loads.filter((item) => item.count >= operationalThreshold).length} charge(s) atteignent le seuil personnel d’affichage de {operationalThreshold}.</p>
    <AccessibleChart title="Contributions principales et secondaires" data={contributions} showTable={showTables} />
    <section aria-label="Alertes opérationnelles"><h2>Relances et alertes</h2>{report.panels.operationalRisks.alerts.length ? <ul>{report.panels.operationalRisks.alerts.map((alert) => <li key={alert.code}><a href={preserveFilters(alert.drillDown, query)}>{alert.code} : {alert.count}</a></li>)}</ul> : <p>Aucune alerte active.</p>}</section>
    <p><a href={safeInternalHref(report.export.href, ["/reports/manager-dashboard/export"])} download="crm-manager-dashboard-v1.csv">Exporter les agrégats CSV</a></p>
    <p><small>Contrat {report.definitionVersion} — export {report.export.schemaVersion} — {report.timezone}</small></p>
  </>;
}

function AccessibleChart({ title, data, showTable }: Readonly<{ title: string; data: Datum[]; showTable: boolean }>): React.JSX.Element {
  const max = Math.max(1, ...data.map((item) => item.count));
  const values = data.map((item) => `${item.value}: ${item.count}`).join(", ") || "aucune valeur";
  const description = `${title}. ${values}`;
  return <figure><figcaption><h2>{title}</h2></figcaption>
    <button type="button" className="reporting-chart" aria-label={description}>
      {data.map((item) => <div key={item.value}><span>{item.value}</span> <meter min={0} max={max} value={item.count}>{item.count}</meter> <strong>{item.count}</strong></div>)}
    </button>
    {showTable && <table><caption>Données alternatives — {title}</caption><thead><tr><th scope="col">Catégorie</th><th scope="col">Valeur</th></tr></thead><tbody>{data.map((item) => <tr key={item.value}><th scope="row">{item.value}</th><td>{item.count}</td></tr>)}</tbody></table>}
  </figure>;
}

function AccessibleTrend({ data, showTable }: Readonly<{ data: DashboardReport["trends"]; showTable: boolean }>): React.JSX.Element {
  const chart = data.flatMap((item) => [{ value: `${item.date} — créations`, count: item.leadsCreated }, { value: `${item.date} — inscriptions`, count: item.leadsEnrolled }]);
  return <AccessibleChart title="Évolution temporelle" data={chart} showTable={showTable} />;
}

function preserveFilters(href: string, query: URLSearchParams): string {
  const safe = safeInternalHref(href, ["/leads"]);
  if (safe === "#") return safe;
  const [path, current = ""] = safe.split("?");
  const params = new URLSearchParams(current);
  for (const [key, value] of query) {
    if (!params.has(key) && !["period", "view"].includes(key)) params.set(filterTarget(key), value);
  }
  params.set("returnTo", `/manager/reports/dashboard?${query.toString()}`);
  return `${path}?${params.toString()}`;
}

function filterTarget(key: string): string {
  if (key === "from") return "createdFrom";
  if (key === "to") return "createdTo";
  if (key === "adviserId") return "assignedToId";
  return key;
}

function safeInternalHref(href: string, allowedRoots: readonly string[] = dashboardDestinationRoots): string {
  if (!href || href.includes("\0") || href.includes("\\") || href.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(href)) return "#";
  const path = href.split("?")[0] ?? "";
  if (!path.startsWith("/") || path.split("/").includes("..")) return "#";
  if (!allowedRoots.some((root) => path === root || path.startsWith(`${root}/`))) return "#";
  return href;
}

export { preserveFilters, safeInternalHref };
export type { DashboardReport, PersonalDashboardReport };
