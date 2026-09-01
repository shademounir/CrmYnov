"use client";

import { Alarm, ChartBar, CheckCircle, Plus, Student, TrendUp, UserPlus, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConnectedResource } from "../../../_components/connected-resource";
import { PageHeader } from "../../../_components/ui/page-header";

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
  const dashboardDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Casablanca" }).format(new Date());
  return <main className="dashboard-page" data-density={preferences.compact ? "compact" : "comfortable"}>
    <PageHeader eyebrow={dashboardDate} title="Centre d’activité" description="Pilotez les priorités commerciales et les admissions du jour." actions={<Link className="primary-button" href="/leads/new"><Plus size={19} weight="bold" /> Nouveau lead</Link>} />
    <div className="dashboard-toolbar"><ReportingFilters filters={initialFilters} /><details className="dashboard-preferences"><summary>Préférences</summary><fieldset><legend>Préférences locales non sensibles</legend>
      <label><input type="checkbox" checked={preferences.compact} onChange={(event) => updatePreference({ ...preferences, compact: event.target.checked })} /> Affichage compact</label>
      <label><input type="checkbox" checked={preferences.showTables} onChange={(event) => updatePreference({ ...preferences, showTables: event.target.checked })} /> Afficher les tableaux accessibles</label>
      <label>Période préférée <select value={preferences.preferredPeriod} onChange={(event) => updatePreference({ ...preferences, preferredPeriod: event.target.value as PreferredPeriod })}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option></select></label>
      <a href={preferredPeriodHref[preferences.preferredPeriod]}>Appliquer la période préférée</a>
      <label>Seuil personnel de charge <input type="number" min={1} max={100} value={preferences.operationalThreshold} onChange={(event) => updatePreference({ ...preferences, operationalThreshold: Math.min(100, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) })} /></label>
      <small>Ces préférences d’affichage restent dans ce navigateur et ne contiennent ni identifiant métier, ni donnée personnelle.</small>
    </fieldset></details><span className="freshness-indicator" role="status"><span aria-hidden="true" /> Données actualisées à la dernière réponse API</span></div>
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
  const start = new Date();
  const end = new Date(start.getTime() + 86_400_000);
  const date = (value: Date): string => value.toLocaleDateString("en-CA", { timeZone: "Africa/Casablanca" });
  const todayHref = `/manager/reports/dashboard?${new URLSearchParams({ period: "custom", from: date(start), to: date(end) }).toString()}`;
  return <div className="reporting-toolbar-content">
    <nav className="period-selector" aria-label="Période globale du dashboard">
      <Link href={todayHref} className={filters.period === "custom" ? "active" : ""}>Aujourd’hui</Link>
      <Link href="/manager/reports/dashboard?period=7d" className={filters.period === "7d" ? "active" : ""}>7 jours</Link>
      <Link href="/manager/reports/dashboard?period=30d" className={!filters.period || filters.period === "30d" ? "active" : ""}>Ce mois</Link>
      <Link href="/manager/reports/dashboard?period=90d" className={filters.period === "90d" ? "active" : ""}>Ce trimestre</Link>
    </nav>
    <details className="reporting-filter-popover"><summary>Filtres avancés</summary><form method="get" action="/manager/reports/dashboard" aria-label="Filtres interactifs du reporting">
    <label>Période <select name="period" defaultValue={filters.period ?? "30d"}><option value="7d">7 jours</option><option value="30d">30 jours</option><option value="90d">90 jours</option><option value="custom">Personnalisée</option></select></label>
    <label>Du <input name="from" type="date" defaultValue={filters.from?.slice(0, 10)} /></label><label>Au <input name="to" type="date" defaultValue={filters.to?.slice(0, 10)} /></label>
    <label>Campus <input name="campus" defaultValue={filters.campus} /></label><label>Campagne <input name="campaign" defaultValue={filters.campaign} /></label>
    <label>Formation <input name="program" defaultValue={filters.program} /></label><label>Source <input name="source" defaultValue={filters.source} /></label>
    <label>Canal <select name="channel" defaultValue={filters.channel ?? ""}><option value="">Tous</option><option value="DIGITAL">Digital</option><option value="PHONE">Téléphone</option><option value="IN_PERSON">Présentiel</option><option value="PARTNER">Partenaire</option><option value="OTHER">Autre</option></select></label>
    <label>Commercial <input name="adviserId" defaultValue={filters.adviserId} autoComplete="off" /></label>
    <label>Statut <select name="status" defaultValue={filters.status ?? ""}><option value="">Tous</option><option value="PROSPECT">Prospect</option><option value="CONTACTED">Contacté</option><option value="QUALIFIED">Qualifié</option><option value="ENROLLED">Inscrit</option><option value="CLOSED_LOST">Sans suite</option></select></label>
    <label>Vue <select name="view" defaultValue={filters.view ?? "global"}><option value="global">Globale</option><option value="personal">Personnelle</option></select></label>
    <button type="submit">Appliquer</button> <a href="/manager/reports/dashboard">Réinitialiser</a></form></details>
  </div>;
}

function DashboardContent({ report, showTables, query, operationalThreshold }: Readonly<{ report: DashboardReport; showTables: boolean; query: URLSearchParams; operationalThreshold: number }>): React.JSX.Element {
  const funnel = Object.entries(report.panels.funnel.currentState).map(([value, count]) => ({ value, count }));
  const loads = report.panels.performance.advisers.map((item) => ({ value: item.adviserId, count: item.activeLoad }));
  const contributions = report.panels.sharedContributions.contributors.map((item) => ({ value: item.contributorId, count: item.primaryActionCount + item.secondaryActionCount }));
  return <>
    <section className="kpi-grid" aria-label="Indicateurs clés">
      <DashboardKpi icon={UserPlus} tone="teal" label="Leads uniques" value={report.cards.uniqueLeads} hint="Périmètre sélectionné" />
      <DashboardKpi icon={Alarm} tone="amber" label="À relancer" value={report.cards.overdueFollowUps} hint="Échéances dépassées" />
      <DashboardKpi icon={CheckCircle} tone="violet" label="Non affectés" value={report.cards.unassigned} hint="À distribuer" />
      <DashboardKpi icon={Student} tone="green" label="Inscriptions" value={report.cards.enrolled} hint="Statut inscrit" />
      <DashboardKpi icon={TrendUp} tone="teal" label="Alertes actives" value={report.cards.activeAlerts} hint="À surveiller" />
    </section>
    <section className="quick-queues" aria-label="Files rapides"><Link className="queue-item" href={safeInternalHref(report.drillDowns.find((item) => item.key === "unassigned")?.href ?? "/leads?view=UNASSIGNED", ["/leads"])}><span className="icon-disc small neutral"><UserPlus size={20} /></span><span>Non affectés<strong>{report.cards.unassigned}</strong></span></Link><Link className="queue-item" href="/leads?view=FOLLOW_UP"><span className="icon-disc small amber"><Alarm size={20} /></span><span>À relancer<strong>{report.cards.overdueFollowUps}</strong></span></Link><Link className="queue-item" href="/leads?view=NO_ACTIVITY"><span className="icon-disc small blue"><ChartBar size={20} /></span><span>Sans activité<strong>{report.panels.operationalRisks.queues.noActivity ?? 0}</strong></span></Link><Link className="queue-item" href="/leads?savedView=IMPORT_ERRORS"><span className="icon-disc small red"><WarningCircle size={20} /></span><span>Imports en erreur<strong>{report.panels.operationalRisks.queues.importErrors ?? 0}</strong></span></Link></section>
    <div className="dashboard-primary-grid"><section className="panel priority-panel"><div className="panel-heading"><div><h2>À traiter aujourd’hui en priorité</h2><p>{report.panels.operationalRisks.alerts.length} action(s) issue(s) des contrôles API</p></div><Link className="text-button" href="/leads?view=FOLLOW_UP">Voir toutes les actions</Link></div><div className="priority-table"><div className="table-row table-head"><span>Priorité</span><span>Action</span><span>Volume</span><span>File</span><span>Échéance</span></div>{report.panels.operationalRisks.alerts.slice(0, 5).map((alert) => <article className="table-row" key={alert.code}><span data-label="Priorité"><span className="status-badge en-retard"><WarningCircle size={14} weight="fill" />En retard</span></span><span data-label="Action"><b>{alert.code}</b><small>Signal agrégé sans PII</small></span><span data-label="Volume">{alert.count}</span><span data-label="File"><Link href={preserveFilters(alert.drillDown, query)}>Ouvrir</Link></span><span data-label="Échéance" className="due">À traiter</span></article>)}</div><Link className="panel-footer-action" href="/leads?view=FOLLOW_UP">Organiser ma journée</Link></section><section className="panel pipeline-panel"><div className="panel-heading"><h2>Pipeline</h2><Link className="text-button" href="/manager/reports/commercial-funnel">Voir le pipeline complet</Link></div><div className="pipeline-head"><span>Étape</span><span>Leads</span><span>Part</span></div>{funnel.map((item) => <div className="pipeline-row" key={item.value}><span><i className="stage-dot teal" />{item.value}</span><strong>{item.count}</strong><em>{report.cards.uniqueLeads ? `${Math.round((item.count / report.cards.uniqueLeads) * 100)} %` : "0 %"}</em></div>)}</section></div>
    <div className="dashboard-secondary-grid"><section className="panel leads-panel"><div className="panel-heading"><h2>Derniers leads</h2><Link className="text-button" href="/leads">Voir tous les leads</Link></div><ConnectedResource endpoint="/api/crm/leads?page=1&pageSize=5&sortBy=createdAt" ariaLabel="Derniers leads issus de PostgreSQL" emptyMessage="Aucun lead récent." fields={[{ key: "leadCode", label: "Identifiant" }, { key: "firstName", label: "Prénom" }, { key: "lastName", label: "Nom" }, { key: "status", label: "Statut" }, { key: "assignedToId", label: "Conseiller" }]} itemPathPrefix="/leads" /></section><section className="panel activity-panel"><div className="panel-heading"><h2>Activité récente</h2></div><ul className="activity-list">{report.panels.operationalRisks.alerts.slice(0, 5).map((alert) => <li key={alert.code}><span className="icon-disc small red"><WarningCircle size={18} /></span><span><b>{alert.code}</b><small>{alert.count} élément(s) agrégé(s)</small></span></li>)}</ul></section></div>
    <details className="reporting-details"><summary>Analyses détaillées et tableaux accessibles</summary>
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
    </details>
  </>;
}

function DashboardKpi({ icon: Icon, tone, label, value, hint }: Readonly<{ icon: typeof UserPlus; tone: string; label: string; value: number; hint: string }>): React.JSX.Element {
  return <article className="kpi-card"><span className={`icon-disc ${tone}`}><Icon size={25} weight="bold" /></span><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div><span className={`mini-bars ${tone}`} aria-hidden="true"><i /><i /><i /><i /><i /></span></article>;
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
